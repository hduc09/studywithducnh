// Mỗi tài khoản có database riêng. Không xoá outbox khi mất mạng hoặc đăng xuất.
const DB_VERSION=1;
const queues=new Map();
export const databaseName=scope=>'studywithducnh-data-'+(scope||'guest');
const request=request=>new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('IndexedDB error'));
});
export function openLocalDB(scope){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB unavailable'));return}
    const opening=indexedDB.open(databaseName(scope),DB_VERSION);
    opening.onupgradeneeded=()=>{
      const db=opening.result;
      if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots');
      if(!db.objectStoreNames.contains('outbox'))db.createObjectStore('outbox',{keyPath:'opId'});
      if(!db.objectStoreNames.contains('versions'))db.createObjectStore('versions',{keyPath:'key'});
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');
      if(!db.objectStoreNames.contains('errors'))db.createObjectStore('errors',{keyPath:'id'});
      if(!db.objectStoreNames.contains('revisions'))db.createObjectStore('revisions',{keyPath:'id'});
    };
    opening.onsuccess=()=>resolve(opening.result);
    opening.onerror=()=>reject(opening.error||new Error('Cannot open local database'));
  });
}
function withDB(scope,stores,mode,run){
  return openLocalDB(scope).then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);
    let result;
    try{result=run(tx)}catch(error){tx.abort();reject(error)}
    tx.oncomplete=()=>{db.close();resolve(result)};
    tx.onerror=()=>{db.close();reject(tx.error||new Error('IndexedDB transaction failed'))};
    tx.onabort=()=>{db.close();reject(tx.error||new Error('IndexedDB transaction aborted'))};
  }));
}
export function serial(scope,task){
  const previous=queues.get(scope)||Promise.resolve();
  const next=previous.catch(()=>{}).then(task);
  queues.set(scope,next);
  return next;
}
export function persistLocal(scope,data,changes=[]){
  return serial(scope,()=>withDB(scope,['snapshots','outbox'],'readwrite',tx=>{
    tx.objectStore('snapshots').put({at:Date.now(),data},'current');
    for(const change of changes)tx.objectStore('outbox').put(change);
  }));
}
export async function localSnapshot(scope){
  await queues.get(scope)?.catch(()=>{});
  const db=await openLocalDB(scope);
  try{return await request(db.transaction('snapshots').objectStore('snapshots').get('current'))}
  finally{db.close()}
}
export async function listOutbox(scope){
  await queues.get(scope)?.catch(()=>{});
  const db=await openLocalDB(scope);
  try{const all=await request(db.transaction('outbox').objectStore('outbox').getAll());
    return all.sort((a,b)=>a.createdAt-b.createdAt)}finally{db.close()}
}
export function acknowledge(scope,op,version){
  return serial(scope,()=>withDB(scope,['outbox','versions'],'readwrite',tx=>{
    tx.objectStore('outbox').delete(op.opId);
    if(version!=null)tx.objectStore('versions').put({key:op.kind+':'+op.entityId,version});
  }));
}
export async function getVersion(scope,kind,entityId){
  await queues.get(scope)?.catch(()=>{});
  const db=await openLocalDB(scope);
  try{return (await request(db.transaction('versions').objectStore('versions').get(kind+':'+entityId)))?.version||0}
  finally{db.close()}
}
export function setVersion(scope,kind,entityId,version){
  return serial(scope,()=>withDB(scope,['versions'],'readwrite',tx=>{
    tx.objectStore('versions').put({key:kind+':'+entityId,version});
  }));
}
export async function getMeta(scope,key){
  await queues.get(scope)?.catch(()=>{});
  const db=await openLocalDB(scope);
  try{return await request(db.transaction('meta').objectStore('meta').get(key))}finally{db.close()}
}
export function setMeta(scope,key,value){
  return serial(scope,()=>withDB(scope,['meta'],'readwrite',tx=>{
    tx.objectStore('meta').put(value,key);
  }));
}
export function addSyncError(scope,error){
  const entry={id:crypto.randomUUID(),at:new Date().toISOString(),message:String(error.message||error).slice(0,1000)};
  return serial(scope,()=>withDB(scope,['errors'],'readwrite',tx=>{
    tx.objectStore('errors').put(entry);
  }));
}
export async function listSyncErrors(scope){
  const db=await openLocalDB(scope);
  try{return await request(db.transaction('errors').objectStore('errors').getAll())}finally{db.close()}
}
export function addLocalRevision(scope,note){
  const entry={id:crypto.randomUUID(),entityId:String(note.id),at:new Date().toISOString(),data:note};
  return serial(scope,()=>withDB(scope,['revisions'],'readwrite',tx=>{
    tx.objectStore('revisions').put(entry);
  }));
}
export async function localRevisions(scope,entityId){
  const db=await openLocalDB(scope);
  try{const all=await request(db.transaction('revisions').objectStore('revisions').getAll());
    return all.filter(r=>r.entityId===String(entityId)).sort((a,b)=>b.at.localeCompare(a.at))}
  finally{db.close()}
}
export async function requestPersistentStorage(){
  try{return Boolean(await navigator.storage?.persist?.())}catch{return false}
}
