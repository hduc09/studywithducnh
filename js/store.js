import {localDate,toast,download} from './utils.js';
import {STORAGE_KEY,PREVIOUS_STORAGE_KEY,DATABASE_NAME,PREVIOUS_DATABASE_NAME,prepareMigration,normalizeLegacyFields,hasLegacyContent,legacyCounts,legacyArchive,archiveFilename,confirmLegacyRemoval,acceptsBackupApp} from './migration.js';

export const migrationStatus=prepareMigration();
const defaults=()=>({
  version:4,
  profile:{name:'',dailyGoal:120,onboarded:false},
  settings:{lang:'vi',theme:'aurora',accent:'',font:'be',autoTheme:false,backgroundURL:'',backgroundType:'',blur:0,dim:48,customCSS:'',focus:25,short:5,long:15,custom:30,longEvery:4,autoNext:false,notify:false,leaveAlert:false,clockFormat:'24',clockStyle:'digital',backupAt:Date.now()},
  timer:{mode:'focus',running:false,endAt:0,startedAt:0,remaining:1500,elapsed:0,session:1,activeTaskId:''},
  tasks:[],subjects:[],sessions:[],thoughts:[],notes:[],scratch:'',schedule:[],priorities:{},reviews:{},
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
    reviews:raw.reviews&&typeof raw.reviews==='object'?raw.reviews:{}
  };
}
let state=merge(migrationStatus.data);
try{if(migrationStatus.data&&!hasLegacyContent(state))localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch{}
const listeners=new Map();
export const bus={
  on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);return()=>listeners.get(event).delete(fn)},
  emit(event,data){listeners.get(event)?.forEach(fn=>fn(data))}
};
function warnStorage(){
  if(typeof document!=='undefined')toast('Bộ nhớ trình duyệt đã đầy. Dữ liệu cũ vẫn nguyên vẹn; hãy tải bản sao lưu và giải phóng dung lượng.');
}
function save(next){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));return true}catch{warnStorage();return false}
}
function announce(event){
  bus.emit('change',state);
  if(event!=='change')bus.emit(event,state);
}
export const store={
  get:()=>state,
  update(fn,event='change'){
    let next;
    try{next=structuredClone(state);fn(next)}catch{return false}
    if(!save(next))return false;
    state=next;announce(event);return true
  },
  replace(input){
    const next=merge(input);
    if(!save(next))return false;
    state=next;announce('replace');return true
  },
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
const openDB=(name=DATABASE_NAME)=>new Promise((resolve,reject)=>{
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
  });localStorage.removeItem(CLEAR_FLAG)}finally{db.close()}
}
export async function getBackground(){
  const current=await readBackground(DATABASE_NAME);
  if(current||localStorage.getItem(CLEAR_FLAG))return current;
  return readBackground(PREVIOUS_DATABASE_NAME).catch(()=>undefined)
}
export async function ensureBackgroundMigration(){
  try{
    const current=await readBackground(DATABASE_NAME);
    if(current||localStorage.getItem(CLEAR_FLAG))return true;
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
  });localStorage.setItem(CLEAR_FLAG,'1')}finally{db.close()}
}
const fileAsDataURL=file=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=reject;
  reader.readAsDataURL(file)
});
export async function exportData(){
  const backup={app:'studywithducnh',schemaVersion:4,createdAt:new Date().toISOString(),data:structuredClone(state)};
  try{const file=await getBackground();if(file)backup.background={type:file.type,name:file.name,data:await fileAsDataURL(file)}}catch{}
  download('studywithducnh-backup-'+localDate()+'.json',JSON.stringify(backup,null,2));
  store.update(s=>{s.settings.backupAt=Date.now()},'settings');
  if(typeof document!=='undefined')toast('Đã tạo file sao lưu. Hãy kiểm tra thư mục Tải xuống.');
  return backup
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
  await exportData();
  if(typeof confirm==='function'&&!confirm('Đã lưu file sao lưu hiện tại? Nhập file sẽ thay dữ liệu đang có.'))return false;
  let previousBackground;
  try{previousBackground=await getBackground()}catch{}
  if(backup.background?.data){
    const response=await fetch(backup.background.data),blob=await response.blob();
    await putBackground(new File([blob],backup.background.name||'background',{type:backup.background.type||blob.type}))
  }else await clearBackground();
  if(!store.replace(backup.data)){
    try{if(previousBackground)await putBackground(previousBackground);else await clearBackground()}catch{}
    throw new Error('Không đủ bộ nhớ để nhập dữ liệu; bản hiện tại vẫn được giữ.');
  }
  if(typeof document!=='undefined')toast('Đã khôi phục dữ liệu.');
  return true
}
export async function resetData(){
  if(!store.replace(defaults()))return false;
  await clearBackground().catch(()=>{});
  return true
}
export function checkBackupReminder(){
  const s=store.get();
  if(s.profile.onboarded&&Date.now()-(s.settings.backupAt||0)>7*86400000&&typeof document!=='undefined')
    toast('Đã hơn một tuần kể từ lần sao lưu gần nhất.',{label:'Sao lưu',run:exportData})
}
