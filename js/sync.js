import {store} from './store.js';
import {STORAGE_KEY} from './migration.js';
import {stateRecords,changesBetween,applyCloudRecord,checksum,countPreview,mergeWithoutOverwrite} from './sync-model.js';
import {persistLocal,listOutbox,acknowledge,getVersion,setVersion,getMeta,setMeta,addSyncError,listSyncErrors,requestPersistentStorage} from './localdb.js';
import {toast,download} from './utils.js';

let client=null,userId='',running=false,timer=0,pollTimer=0,channel=null;
const onVisible=()=>{if(!document.hidden)syncNow()};
let status='saved',detail='',conflicts=0;
const listeners=new Set();
const report=()=>{
  const snapshot={status,detail,conflicts,userId};
  for(const fn of listeners)fn(snapshot);
  const badge=document.querySelector('#sync-status');
  if(badge){badge.dataset.state=status;badge.textContent=status==='saved'?'✓ Đã lưu':
    status==='syncing'?'↻ Đang đồng bộ':status==='offline'?'◷ Chờ mạng':
    status==='error'?'! Lỗi đồng bộ':'◷ Chưa đồng bộ';
    badge.title=detail}
};
export const onSyncStatus=fn=>{listeners.add(fn);fn({status,detail,conflicts,userId});return()=>listeners.delete(fn)};
export const syncStatus=()=>({status,detail,conflicts,userId});
const setStatus=(value,message='')=>{status=value;detail=message;report()};
const pendingKeys=ops=>new Set(ops.map(op=>op.kind+':'+op.entityId));

async function flush(){
  const ops=await listOutbox(userId);
  if(!ops.length)return;
  setStatus('syncing',`${ops.length} thay đổi đang gửi`);
  for(const op of ops){
    if(!navigator.onLine)throw new Error('offline');
    const version=await getVersion(userId,op.kind,op.entityId);
    const {data,error}=await client.rpc('apply_record_change',{
      p_op_id:op.opId,p_kind:op.kind,p_entity_id:op.entityId,
      p_patch:op.patch,p_base_version:version,p_deleted:op.deleted
    });
    if(error)throw error;
    if(data?.status==='conflict'){
      const keys=new Set(await getMeta(userId,'conflictKeys')||[]);
      keys.add(op.kind+':'+op.entityId);
      await setMeta(userId,'conflictKeys',[...keys]);
      conflicts=keys.size;
      await acknowledge(userId,op,data.version);
      setStatus('error',`${conflicts} ghi chú có bản xung đột cần giải quyết`);
      continue;
    }
    if(data?.status!=='ok')throw new Error('Máy chủ chưa xác nhận thao tác.');
    await acknowledge(userId,op,data.version);
  }
}
async function pull(){
  const cursor=await getMeta(userId,'cursor')||{at:null,id:0};
  const pending=pendingKeys(await listOutbox(userId));
  const conflicting=new Set(await getMeta(userId,'conflictKeys')||[]);
  let at=cursor.at,id=cursor.id,changed=false,next=store.get();
  for(let page=0;page<100;page++){
    const {data,error}=await client.rpc('pull_records',{p_after_at:at,p_after_id:id,p_limit:500});
    if(error)throw error;
    if(!data?.length)break;
    for(const row of data){
      const key=row.kind+':'+row.entity_id;
      if(!pending.has(key)&&!conflicting.has(key)){
        next=applyCloudRecord(next,row);changed=true;
        await setVersion(userId,row.kind,row.entity_id,row.version);
      }
    }
    const last=data.at(-1);at=last.updated_at;id=last.id;
    await setMeta(userId,'cursor',{at,id});
    if(data.length<500)break;
  }
  if(changed&&!store.applyRemote(next))throw new Error('Bộ nhớ cục bộ đầy; chưa thể áp dụng dữ liệu cloud.');
}
async function recoverMissedChanges(){
  const synced=await getMeta(userId,'lastSyncedState');
  if(!synced)return;
  const missed=changesBetween(synced,store.get());
  const pending=pendingKeys(await listOutbox(userId));
  const fresh=missed.filter(op=>!pending.has(op.kind+':'+op.entityId));
  if(fresh.length)await persistLocal(userId,store.get(),fresh);
}
export async function syncNow(){
  if(!client||!userId||running)return;
  if(!navigator.onLine){const count=(await listOutbox(userId)).length;setStatus('offline',`Chờ mạng (${count} thay đổi)`);return}
  running=true;
  try{
    await recoverMissedChanges();
    await flush();
    await pull();
    const pending=(await listOutbox(userId)).length;
    if(!pending){
      await setMeta(userId,'lastSyncedState',store.get());
      if(!conflicts)setStatus('saved','Đã lưu trên máy và cloud');
      Promise.resolve(client.rpc('capture_daily_snapshot')).catch(()=>{});
    }else setStatus('syncing',`${pending} thay đổi đang chờ`);
  }catch(error){
    if(String(error.message).includes('offline')||!navigator.onLine)
      setStatus('offline',`Chờ mạng (${(await listOutbox(userId)).length} thay đổi)`);
    else{
      await addSyncError(userId,error).catch(()=>{});
      setStatus('error','Máy chủ tạm nghỉ, dữ liệu trên máy vẫn an toàn. '+(error.message||''));
      const wait=Math.min(60000,1000*2**Math.min(6,(await getMeta(userId,'retryCount')||0)))+Math.random()*750;
      await setMeta(userId,'retryCount',Math.min(6,(await getMeta(userId,'retryCount')||0)+1)).catch(()=>{});
      clearTimeout(timer);timer=setTimeout(syncNow,wait);
    }
  }finally{running=false;report()}
}
export async function startSync(supabase,id){
  stopSync();client=supabase;userId=id;
  await requestPersistentStorage();
  await store.restoreFromIndexedDB();
  if(!await getMeta(id,'cursor')&&!await getMeta(id,'lastSyncedState')){
    const before=structuredClone(store.get());
    const cloudRows=await allCloudRecordsFor(client);
    const pending=pendingKeys(await listOutbox(id));
    let cloudState=structuredClone(before);
    for(const row of cloudRows){
      if(pending.has(row.kind+':'+row.entity_id))continue;
      cloudState=applyCloudRecord(cloudState,row);
      await setVersion(id,row.kind,row.entity_id,row.version);
    }
    const incoming=structuredClone(before);
    for(const row of cloudRows)if(row.deleted_at&&!pending.has(row.kind+':'+row.entity_id)){
      const fields={task:'tasks',subject:'subjects',session:'sessions',note:'notes',
        schedule:'schedule',thought:'thoughts'};
      const field=fields[row.kind];
      if(field)incoming[field]=incoming[field].filter(item=>String(item.id)!==row.entity_id);
    }
    const merged=mergeWithoutOverwrite(cloudState,incoming).data;
    if(cloudRows.length&&JSON.stringify(merged)!==JSON.stringify(before)){
      merged.importArchives ||= [];
      merged.importArchives.push({at:new Date().toISOString(),reason:'first-cloud-merge',data:before});
    }
    const cloudKeys=new Set(cloudRows.map(row=>row.kind+':'+row.entity_id));
    const missing=[...stateRecords(merged).values()].filter(row=>!cloudKeys.has(row.kind+':'+row.entity_id))
      .map(row=>({opId:crypto.randomUUID(),kind:row.kind,entityId:row.entity_id,
        patch:row.payload,deleted:false,createdAt:Date.now()}));
    if(!store.applyRemote(merged))throw new Error('Không đủ bộ nhớ để hợp nhất cloud; dữ liệu trên máy vẫn nguyên.');
    await persistLocal(id,merged,missing);
    const last=cloudRows.at(-1);
    if(last)await setMeta(id,'cursor',{at:last.updated_at,id:last.id});
  }
  const keys=await getMeta(userId,'conflictKeys').catch(()=>[])||[];conflicts=keys.length;
  store.onPersist(message=>{
    if(message.type==='changes'){
      setStatus(navigator.onLine?'syncing':'offline','Thay đổi đã lưu trên máy, chờ cloud');
      clearTimeout(timer);timer=setTimeout(syncNow,250);
    }else if(message.type==='error')setStatus('error','Không lưu được IndexedDB; hãy xuất JSON.');
  });
  window.addEventListener('online',syncNow);
  window.addEventListener('focus',syncNow);
  document.addEventListener('visibilitychange',onVisible);
  pollTimer=setInterval(syncNow,60000);
  channel=client.channel('own-records-'+id).on('postgres_changes',{
    event:'*',schema:'public',table:'records',filter:'user_id=eq.'+id
  },()=>syncNow()).subscribe();
  setStatus(navigator.onLine?'syncing':'offline','Đang kiểm tra thay đổi');
  await syncNow();
}
export function stopSync(){
  clearTimeout(timer);clearInterval(pollTimer);
  window.removeEventListener('online',syncNow);
  window.removeEventListener('focus',syncNow);
  document.removeEventListener('visibilitychange',onVisible);
  if(client&&channel)client.removeChannel(channel);
  channel=null;client=null;userId='';store.onPersist(()=>{});
  setStatus('saved','Chế độ Khách: chỉ lưu trên thiết bị');
}
export async function pendingCount(id=userId){return id?(await listOutbox(id)).length:0}
export async function syncDiagnostics(){return userId?await listSyncErrors(userId):[]}
export async function downloadDiagnostics(){
  const errors=await syncDiagnostics();
  download('studywithducnh-sync-errors.json',JSON.stringify({at:new Date().toISOString(),errors},null,2));
}
export async function migrateGuestToCloud(supabase,id){
  const guest=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
  if(!guest)return {ok:true,preview:{tasks:0,notes:0,events:0}};
  const expected=[...stateRecords(guest).values()];
  const preview=countPreview(guest);
  const existing=await allCloudRecordsFor(supabase);
  const existingMap=new Map(existing.map(row=>[row.kind+':'+row.entity_id,row]));
  const migrationKey='studywithducnh-guest-migration-'+id;
  const ids=JSON.parse(localStorage.getItem(migrationKey)||'{}');
  for(const record of expected){
    const key=record.kind+':'+record.entity_id;
    if(existingMap.has(key)){
      if(await checksum(existingMap.get(key).payload)!==await checksum(record.payload))
        throw new Error('Cloud có bản khác cho '+key+'. Bản Khách vẫn nguyên; hãy sao lưu và xử lý xung đột trước.');
      continue;
    }
    ids[key] ||= crypto.randomUUID();localStorage.setItem(migrationKey,JSON.stringify(ids));
    const {data,error}=await supabase.rpc('apply_record_change',{
      p_op_id:ids[key],p_kind:record.kind,p_entity_id:record.entity_id,
      p_patch:record.payload,p_base_version:0,p_deleted:false
    });
    if(error||data?.status!=='ok')throw error||new Error('Cloud chưa nhận đủ dữ liệu Khách.');
  }
  const verified=new Map((await allCloudRecordsFor(supabase)).map(row=>[row.kind+':'+row.entity_id,row]));
  let confirmed=0;
  for(const record of expected){
    const cloud=verified.get(record.kind+':'+record.entity_id);
    if(!cloud||cloud.deleted_at||await checksum(cloud.payload)!==await checksum(record.payload))
      throw new Error('Checksum cloud chưa khớp. Dữ liệu Khách vẫn được giữ nguyên.');
    confirmed++;
  }
  if(confirmed!==expected.length)throw new Error('Số bản ghi cloud chưa khớp.');
  const accountKey='studywithducnh-user-'+id+'-v1';
  const local=JSON.parse(localStorage.getItem(accountKey)||'null');
  const merged=local?mergeWithoutOverwrite(local,guest).data:guest;
  localStorage.setItem(accountKey,JSON.stringify(merged));
  await persistLocal(id,merged,[]);
  return {ok:true,preview,confirmed,checksum:await checksum(expected.map(r=>r.payload))};
}
async function allCloudRecordsFor(supabase){
  const rows=[];let at=null,id=0;
  for(let page=0;page<100;page++){
    const {data,error}=await supabase.rpc('pull_records',{p_after_at:at,p_after_id:id,p_limit:500});
    if(error)throw error;if(!data?.length)break;
    rows.push(...data);const last=data.at(-1);at=last.updated_at;id=last.id;
    if(data.length<500)break;
  }
  return rows;
}
export async function openConflicts(){
  if(!client||!userId)return [];
  const {data,error}=await client.from('note_conflicts').select('*').eq('status','open').order('created_at',{ascending:false});
  if(error)throw error;return data||[];
}
export async function remoteRevisions(entityId){
  if(!client||!userId)return [];
  const {data,error}=await client.from('record_revisions').select('id,payload,recorded_at')
    .eq('kind','note').eq('entity_id',entityId).order('recorded_at',{ascending:false}).limit(90);
  if(error)throw error;
  return (data||[]).map(row=>({id:'cloud-'+row.id,data:row.payload,at:row.recorded_at}));
}
export async function resolveConflict(conflict,choice,mergedPayload){
  if(!client||!userId)throw new Error('Chưa đăng nhập.');
  const {error}=await client.rpc('resolve_note_conflict',{
    p_conflict_id:conflict.id,p_choice:choice,p_merged_payload:mergedPayload||null
  });
  if(error)throw error;
  const keys=new Set(await getMeta(userId,'conflictKeys')||[]);
  keys.delete('note:'+conflict.entity_id);await setMeta(userId,'conflictKeys',[...keys]);
  conflicts=keys.size;await syncNow();
  if(!conflicts)toast('Đã giải quyết bản xung đột.');
}
export async function purgeCloudRecord(kind,entityId){
  if(!store.getAccountId())return true;
  if(!client)throw new Error('Cần đăng nhập và kết nối cloud trước khi xóa vĩnh viễn.');
  const {data,error}=await client.rpc('purge_record',{p_kind:kind,p_entity_id:entityId});
  if(error||data?.status!=='ok')throw error||new Error('Cloud chưa xác nhận xóa vĩnh viễn.');
  return true;
}
