import {localDate,toast,download} from './utils.js';
import {STORAGE_KEY,PREVIOUS_STORAGE_KEY,DATABASE_NAME,PREVIOUS_DATABASE_NAME,prepareMigration,normalizeLegacyFields,hasLegacyContent,legacyCounts,legacyArchive,archiveFilename,confirmLegacyRemoval,acceptsBackupApp} from './migration.js';
import {changesBetween,checksum,countPreview,mergeWithoutOverwrite} from './sync-model.js';
import {persistLocal,localSnapshot,addLocalRevision,getMeta,setMeta} from './localdb.js';

export const migrationStatus=prepareMigration();
const ACTIVE_ACCOUNT_KEY='studywithducnh-active-account-v1';
const validAccount=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
let activeAccountId=validAccount(localStorage.getItem(ACTIVE_ACCOUNT_KEY))?localStorage.getItem(ACTIVE_ACCOUNT_KEY):'';
const stateKey=()=>activeAccountId?'studywithducnh-user-'+activeAccountId+'-v1':STORAGE_KEY;
const defaults=()=>({
  version:4,
  profile:{name:'',dailyGoal:120,onboarded:false},
  settings:{lang:'vi',theme:'aurora',accent:'',font:'be',autoTheme:false,backgroundURL:'',backgroundType:'',blur:0,dim:48,customCSS:'',focus:25,short:5,long:15,custom:30,longEvery:4,autoNext:false,notify:false,leaveAlert:false,clockFormat:'24',clockStyle:'digital',backupAt:Date.now()},
  timer:{mode:'focus',running:false,endAt:0,startedAt:0,remaining:1500,elapsed:0,session:1,activeTaskId:''},
  tasks:[],subjects:[],sessions:[],thoughts:[],notes:[],scratch:'',schedule:[],priorities:{},reviews:{},trash:[],importConflicts:[],importArchives:[],
  audio:{volumes:{},presets:[],sleepAt:0,musicURL:''},
  rewards:{quotes:[],quoteIndex:0},
  weather:{city:'',lat:null,lon:null,temp:null,code:null,updatedAt:0},
  layout:{order:['timer','tasks','hero','subjects','next','insight','goal','utility'],hidden:[],sizes:{}}
});
function merge(input){
  const base=defaults(),raw=normalizeLegacyFields(input);
  if(!raw||typeof raw!=='object')return base;
  const order=Array.isArray(raw.layout?.order)?[...new Set([...raw.layout.order.filter(id=>base.layout.order.includes(id)),...base.layout.order])]:base.layout.order;
  return {...base,...raw,version:4,
    profile:{...base.profile,...raw.profile},
    settings:{...base.settings,...raw.settings},
    timer:{...base.timer,...raw.timer},
    layout:{...base.layout,...raw.layout,order,hidden:Array.isArray(raw.layout?.hidden)?raw.layout.hidden:[],sizes:raw.layout?.sizes||{}},
    audio:{...base.audio,...raw.audio,volumes:{...base.audio.volumes,...raw.audio?.volumes},presets:Array.isArray(raw.audio?.presets)?raw.audio.presets:[]},
    rewards:{...base.rewards,...raw.rewards,quotes:Array.isArray(raw.rewards?.quotes)?raw.rewards.quotes:[]},
    weather:{...base.weather,...raw.weather},
    tasks:Array.isArray(raw.tasks)?raw.tasks:[],subjects:Array.isArray(raw.subjects)?raw.subjects:[],
    sessions:Array.isArray(raw.sessions)?raw.sessions:[],thoughts:Array.isArray(raw.thoughts)?raw.thoughts:[],
    notes:Array.isArray(raw.notes)?raw.notes:[],schedule:Array.isArray(raw.schedule)?raw.schedule:[],
    priorities:raw.priorities&&typeof raw.priorities==='object'?raw.priorities:{},
    reviews:raw.reviews&&typeof raw.reviews==='object'?raw.reviews:{},
    trash:Array.isArray(raw.trash)?raw.trash:[],
    importConflicts:Array.isArray(raw.importConflicts)?raw.importConflicts:[],
    importArchives:Array.isArray(raw.importArchives)?raw.importArchives:[]
  };
}
const parseState=raw=>{try{return raw?JSON.parse(raw):null}catch{return null}};
let state=merge(activeAccountId?parseState(localStorage.getItem(stateKey())):migrationStatus.data);
try{if(!activeAccountId&&migrationStatus.data&&!hasLegacyContent(state))localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch{}
const listeners=new Map();
export const bus={
  on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);return()=>listeners.get(event).delete(fn)},
  emit(event,data){listeners.get(event)?.forEach(fn=>fn(data))}
};
function warnStorage(){
  if(typeof document!=='undefined')toast('Bộ nhớ trình duyệt đã đầy. Dữ liệu cũ vẫn nguyên vẹn; hãy tải bản sao lưu và giải phóng dung lượng.');
}
function save(next){
  try{localStorage.setItem(stateKey(),JSON.stringify(next));return true}catch{warnStorage();return false}
}
let persistListener=()=>{};
function persist(before,next,event,remote=false){
  const changes=activeAccountId&&!remote?changesBetween(before,next):[];
  persistLocal(activeAccountId,next,changes).catch(error=>{
    if(typeof document!=='undefined')toast('Không lưu được IndexedDB. Bản localStorage vẫn còn; hãy tải sao lưu JSON.');
    persistListener({type:'error',error});
  });
  if(changes.length)persistListener({type:'changes',changes,event});
}
const deletedFields={tasks:'task',subjects:'subject',sessions:'session',notes:'note',schedule:'schedule',thoughts:'thought'};
function addTombstones(before,next){
  next.trash ||= [];
  for(const [field,kind] of Object.entries(deletedFields)){
    const current=new Set((next[field]||[]).map(item=>String(item.id)));
    for(const item of before[field]||[])if(!current.has(String(item.id))){
      const exists=next.trash.some(t=>t.kind===kind&&t.entityId===String(item.id));
      if(!exists)next.trash.push({kind,entityId:String(item.id),data:item,deletedAt:new Date().toISOString()});
    }
  }
}
function announce(event){
  bus.emit('change',state);
  if(event!=='change')bus.emit(event,state);
}
export const store={
  get:()=>state,
  getAccountId:()=>activeAccountId,
  onPersist(fn){persistListener=fn},
  activateAccount(id){
    if(id&&!validAccount(id))throw new Error('ID tài khoản không hợp lệ.');
    if(id)localStorage.setItem(ACTIVE_ACCOUNT_KEY,id);else localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    activeAccountId=id||'';
    state=merge(parseState(localStorage.getItem(stateKey())) || (!id?migrationStatus.data:null));
    announce('replace');
  },
  async restoreFromIndexedDB(){
    const snapshot=await localSnapshot(activeAccountId).catch(()=>null);
    if(!snapshot?.data||localStorage.getItem(stateKey()))return false;
    const before=state,next=merge(snapshot.data);
    if(!save(next))return false;
    state=next;persist(before,next,'restore',true);announce('replace');return true;
  },
  applyRemote(input){
    const before=state,next=merge(input);
    if(!save(next))return false;
    state=next;persist(before,next,'remote',true);announce('replace');return true;
  },
  update(fn,event='change'){
    let next;
    try{next=structuredClone(state);fn(next)}catch{return false}
    addTombstones(state,next);
    if(!save(next))return false;
    const before=state;state=next;persist(before,next,event);announce(event);return true
  },
  replace(input){
    const next=merge(input);
    if(!save(next))return false;
    const before=state;state=next;persist(before,next,'replace');announce('replace');return true
  },
  restoreTrash(index){
    const entry=state.trash[index];if(!entry)return false;
    const field=Object.keys(deletedFields).find(key=>deletedFields[key]===entry.kind);
    if(!field)return false;
    return this.update(s=>{s[field].push(entry.data);s.trash.splice(index,1)},field);
  },
  purgeTrash(index){return this.update(s=>{s.trash.splice(index,1)},'trash')},
  saveNoteRevision(note){return addLocalRevision(activeAccountId,structuredClone(note))},
  legacyCounts:()=>legacyCounts(state),
  hasLegacy:()=>hasLegacyContent(state),
  legacyArchive:()=>legacyArchive(state),
  confirmLegacy(){
    try{
      const next=confirmLegacyRemoval(state);
      state=merge(next);
      announce('replace');
      return true
    }catch(error){if(typeof document!=='undefined')toast(error.message||'Chưa thể dọn dữ liệu cũ.');return false}
  }
};

const CLEAR_FLAG='studywithducnh-background-cleared';
const backgroundDBName=()=>activeAccountId?DATABASE_NAME+'-'+activeAccountId:DATABASE_NAME;
const clearFlag=()=>CLEAR_FLAG+(activeAccountId?'-'+activeAccountId:'');
const openDB=(name=backgroundDBName())=>new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB unavailable'));return}
  const request=indexedDB.open(name,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('files'))request.result.createObjectStore('files')};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error)
});
const readBackground=async name=>{
  const db=await openDB(name);
  try{return await new Promise((resolve,reject)=>{
    const request=db.transaction('files').objectStore('files').get('background');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error)
  })}finally{db.close()}
};
export async function putBackground(file){
  const db=await openDB();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('files','readwrite');
    tx.objectStore('files').put(file,'background');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
  });localStorage.removeItem(clearFlag())}finally{db.close()}
}
export async function getBackground(){
  const current=await readBackground(backgroundDBName());
  if(current||localStorage.getItem(clearFlag())||activeAccountId)return current;
  return readBackground(PREVIOUS_DATABASE_NAME).catch(()=>undefined)
}
export async function ensureBackgroundMigration(){
  try{
    if(activeAccountId)return true;
    const current=await readBackground(DATABASE_NAME);
    if(current||localStorage.getItem(clearFlag()))return true;
    const previous=await readBackground(PREVIOUS_DATABASE_NAME);
    if(!previous)return true;
    await putBackground(previous);
    return true
  }catch{return false}
}
export async function clearBackground(){
  const db=await openDB();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('files','readwrite');
    tx.objectStore('files').delete('background');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
  });localStorage.setItem(clearFlag(),'1')}finally{db.close()}
}
const fileAsDataURL=file=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=reject;
  reader.readAsDataURL(file)
});
async function makeBackup(){
  const backup={app:'studywithducnh',schemaVersion:5,createdAt:new Date().toISOString(),accountId:activeAccountId||null,data:structuredClone(state)};
  backup.checksum=await checksum(backup.data);
  try{const file=await getBackground();if(file)backup.background={type:file.type,name:file.name,data:await fileAsDataURL(file)}}catch{}
  return backup;
}
export async function exportData(){
  const backup=await makeBackup();
  download('studywithducnh-backup-'+localDate()+'.json',JSON.stringify(backup,null,2));
  store.update(s=>{s.settings.backupAt=Date.now()},'settings');
  if(typeof document!=='undefined')toast('Đã tạo file sao lưu. Hãy kiểm tra thư mục Tải xuống.');
  return backup
}
export async function chooseAutomaticBackup(){
  if(!window.showSaveFilePicker)throw new Error('Trình duyệt này chưa hỗ trợ chọn file sao lưu tự động.');
  const handle=await window.showSaveFilePicker({suggestedName:'studywithducnh-backup.json',
    types:[{description:'JSON backup',accept:{'application/json':['.json']}}]});
  await setMeta(activeAccountId,'backupHandle',handle);
  const backup=await makeBackup();
  const writable=await handle.createWritable();
  await writable.write(JSON.stringify(backup,null,2));await writable.close();
  store.update(s=>{s.settings.backupAt=Date.now()},'settings');
  toast('Đã lưu file sao lưu tự động. Ứng dụng sẽ thử cập nhật file mỗi tuần.');
}
export async function autoBackupIfDue(){
  if(Date.now()-(state.settings.backupAt||0)<7*86400000)return false;
  const handle=await getMeta(activeAccountId,'backupHandle').catch(()=>null);
  if(!handle)return false;
  try{
    if(await handle.queryPermission({mode:'readwrite'})!=='granted')return false;
    const backup=await makeBackup(),writable=await handle.createWritable();
    await writable.write(JSON.stringify(backup,null,2));await writable.close();
    store.update(s=>{s.settings.backupAt=Date.now()},'settings');return true;
  }catch{return false}
}
export function downloadLegacyData(){
  const archive=store.legacyArchive();
  if(!archive)return false;
  download(archiveFilename(),JSON.stringify(archive,null,2));
  return true
}
export async function importData(file){
  if(file.size>30*1024*1024)throw new Error('File quá lớn (tối đa 30 MB).');
  const backup=JSON.parse(await file.text());
  if(!acceptsBackupApp(backup.app)||!backup.data||!Array.isArray(backup.data.tasks))throw new Error('File sao lưu không hợp lệ.');
  if(backup.schemaVersion>=5&&!backup.checksum)throw new Error('File thiếu checksum.');
  if(backup.checksum&&backup.checksum!==await checksum(backup.data))throw new Error('Checksum không khớp; file có thể bị hỏng.');
  const preview=countPreview(backup.data),merged=mergeWithoutOverwrite(state,backup.data);
  await exportData();
  if(typeof confirm==='function'&&!confirm(`File có ${preview.tasks} việc, ${preview.notes} ghi chú, ${preview.events} sự kiện. Đã tải bản sao lưu hiện tại? Nhập sẽ hợp nhất, giữ cả bản trùng khác nội dung (${merged.conflicts.length}).`))return false;
  if(hasLegacyContent(backup.data)){
    merged.data.importArchives ||= [];
    merged.data.importArchives.push({at:new Date().toISOString(),data:backup.data});
  }
  let existingBackground;
  try{existingBackground=await getBackground()}catch{}
  if(!existingBackground&&backup.background?.data){
    const response=await fetch(backup.background.data),blob=await response.blob();
    await putBackground(new File([blob],backup.background.name||'background',{type:backup.background.type||blob.type}))
  }
  if(!store.replace(merged.data))throw new Error('Không đủ bộ nhớ để nhập dữ liệu; bản hiện tại vẫn được giữ.');
  if(typeof document!=='undefined')toast('Đã hợp nhất dữ liệu. Bản hiện tại vẫn được giữ.');
  return true
}
export async function resetData(){
  if(activeAccountId)throw new Error('Để xóa toàn bộ dữ liệu tài khoản, hãy dùng Xóa tài khoản trong phần Tài khoản.');
  if(!store.replace(defaults()))return false;
  await clearBackground().catch(()=>{});
  return true
}
export function checkBackupReminder(){
  const s=store.get();
  if(s.profile.onboarded&&Date.now()-(s.settings.backupAt||0)>7*86400000&&typeof document!=='undefined')
    toast('Đã hơn một tuần kể từ lần sao lưu gần nhất.',{label:'Sao lưu',run:exportData})
}
