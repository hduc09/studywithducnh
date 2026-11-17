// Các phép biến đổi thuần, dùng chung cho outbox, nhập dữ liệu và kiểm thử.
export const ARRAY_KINDS = Object.freeze({
  tasks:'task', subjects:'subject', sessions:'session', notes:'note',
  schedule:'schedule', thoughts:'thought'
});
export const MAP_KINDS = Object.freeze({priorities:'priority', reviews:'review'});
export const SINGLE_KINDS = Object.freeze({
  profile:'profile', settings:'settings', layout:'layout', audio:'audio',
  rewards:'rewards', weather:'weather', timer:'timer'
});
const same = (a,b) => stableStringify(a) === stableStringify(b);
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export async function checksum(value) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function stateRecords(state) {
  const records = new Map();
  for (const [field,kind] of Object.entries(ARRAY_KINDS)) {
    for (const item of state[field] || []) if (item && item.id != null)
      records.set(kind + ':' + String(item.id), {kind,entity_id:String(item.id),payload:item});
  }
  for (const [field,kind] of Object.entries(MAP_KINDS)) {
    for (const [id,payload] of Object.entries(state[field] || {}))
      records.set(kind + ':' + id,{kind,entity_id:id,payload:{value:payload}});
  }
  for (const [field,kind] of Object.entries(SINGLE_KINDS))
    records.set(kind + ':singleton',{kind,entity_id:'singleton',payload:state[field] || {}});
  records.set('scratch:singleton',{kind:'scratch',entity_id:'singleton',payload:{value:state.scratch || ''}});
  return records;
}
export function fieldPatch(before={},after={}) {
  const patch={};
  for(const key of Object.keys(after)) if(!same(before[key],after[key])) patch[key]=after[key];
  for(const key of Object.keys(before)) if(!(key in after)) patch[key]=null;
  return patch;
}
export function changesBetween(before,after,makeId=()=>crypto.randomUUID()) {
  const left=stateRecords(before),right=stateRecords(after),changes=[];
  for(const [key,record] of right){
    const prior=left.get(key);
    if(!prior || !same(prior.payload,record.payload)) changes.push({
      opId:makeId(),kind:record.kind,entityId:record.entity_id,
      patch:prior?fieldPatch(prior.payload,record.payload):record.payload,deleted:false,
      createdAt:Date.now()
    });
  }
  for(const [key,record] of left) if(!right.has(key)) changes.push({
    opId:makeId(),kind:record.kind,entityId:record.entity_id,
    patch:{},deleted:true,createdAt:Date.now()
  });
  return changes;
}
const ARRAY_FIELD=Object.fromEntries(Object.entries(ARRAY_KINDS).map(([field,kind])=>[kind,field]));
const MAP_FIELD=Object.fromEntries(Object.entries(MAP_KINDS).map(([field,kind])=>[kind,field]));
const SINGLE_FIELD=Object.fromEntries(Object.entries(SINGLE_KINDS).map(([field,kind])=>[kind,field]));
export function applyCloudRecord(state,record) {
  const next=structuredClone(state),kind=record.kind,id=record.entity_id;
  const deleted=Boolean(record.deleted_at);
  if(ARRAY_FIELD[kind]){
    const field=ARRAY_FIELD[kind],index=next[field].findIndex(item=>String(item.id)===id);
    if(deleted){
      if(index>=0){next.trash ||= [];next.trash.push({kind,entityId:id,data:next[field][index],deletedAt:record.deleted_at});next[field].splice(index,1)}
    }else if(index>=0)next[field][index]=record.payload;
    else next[field].push(record.payload);
  }else if(MAP_FIELD[kind]){
    const field=MAP_FIELD[kind];
    if(deleted)delete next[field][id];else next[field][id]=record.payload.value;
  }else if(SINGLE_FIELD[kind]&&!deleted)next[SINGLE_FIELD[kind]]=record.payload;
  else if(kind==='scratch'&&!deleted)next.scratch=record.payload.value||'';
  return next;
}
export function countPreview(state) {
  return {tasks:(state.tasks||[]).length,notes:(state.notes||[]).length,
    events:(state.schedule||[]).length + (state.subjects||[]).filter(s=>s.examDate).length};
}
export function mergeWithoutOverwrite(current,incoming,makeId=()=>crypto.randomUUID()) {
  const next=structuredClone(current),conflicts=[];
  for(const field of Object.keys(ARRAY_KINDS)){
    next[field] ||= [];
    const byId=new Map(next[field].map(item=>[String(item.id),item]));
    for(const item of incoming[field]||[]){
      const id=String(item.id||makeId());
      if(!byId.has(id)){const copy={...item,id};next[field].push(copy);byId.set(id,copy)}
      else if(!same(byId.get(id),item)){
        const copy={...item,id:makeId(),importedFrom:id};next[field].push(copy);
        conflicts.push({field,id});
      }
    }
  }
  for(const field of Object.keys(MAP_KINDS)){
    next[field] ||= {};
    for(const [key,value] of Object.entries(incoming[field]||{})){
      if(!(key in next[field]))next[field][key]=value;
      else if(!same(next[field][key],value))conflicts.push({field,id:key,value});
    }
  }
  if(conflicts.length){next.importConflicts ||= [];next.importConflicts.push({
    at:new Date().toISOString(),conflicts,source:incoming
  })}
  return {data:next,conflicts};
}
