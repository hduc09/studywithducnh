// Chạy với SUPABASE_URL, SUPABASE_ANON_KEY và hai tài khoản test riêng biệt.
import assert from 'node:assert/strict';

const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_ANON_KEY;
const accounts=[
  [process.env.TEST_USER_A_EMAIL,process.env.TEST_USER_A_PASSWORD],
  [process.env.TEST_USER_B_EMAIL,process.env.TEST_USER_B_PASSWORD]
];
if(!url||!key||accounts.some(row=>row.some(value=>!value))){
  console.log('SKIP: cần URL, anon key và hai tài khoản test A/B.');
  process.exit(0);
}
const call=async(path,token,method='GET',body)=>{
  const response=await fetch(url+path,{method,headers:{apikey:key,Authorization:`Bearer ${token}`,
    'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();return {status:response.status,data:text?JSON.parse(text):null};
};
const login=async(email,password)=>{
  const response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',
    headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
  return data;
};
const [a,b]=await Promise.all(accounts.map(row=>login(...row)));
assert.notEqual(a.user.id,b.user.id);
const id='rls-test-'+crypto.randomUUID();
const created=await call('/rest/v1/rpc/apply_record_change',a.access_token,'POST',{
  p_op_id:crypto.randomUUID(),p_kind:'note',p_entity_id:id,
  p_patch:{id,title:'Private A',body:'Only A'},p_base_version:0,p_deleted:false
});
assert.equal(created.status,200,JSON.stringify(created));
const path='/rest/v1/records?kind=eq.note&entity_id=eq.'+encodeURIComponent(id);
const own=await call(path,a.access_token);
const other=await call(path,b.access_token);
assert.equal(own.status,200);assert.equal(own.data.length,1);
assert.equal(other.status,200);assert.equal(other.data.length,0);
const direct=await call('/rest/v1/records',b.access_token,'POST',{
  user_id:a.user.id,kind:'note',entity_id:id+'-forged',payload:{body:'forged'}
});
assert.ok(direct.status>=400,'B must not directly write A records');
const foreignProfile=await call('/rest/v1/profiles?user_id=eq.'+a.user.id,b.access_token);
assert.equal(foreignProfile.status,200);assert.equal(foreignProfile.data.length,0);
const deleted=await call('/rest/v1/rpc/apply_record_change',a.access_token,'POST',{
  p_op_id:crypto.randomUUID(),p_kind:'note',p_entity_id:id,p_patch:{},
  p_base_version:created.data.version,p_deleted:true
});
assert.equal(deleted.status,200,JSON.stringify(deleted));
const purged=await call('/rest/v1/rpc/purge_record',a.access_token,'POST',{
  p_kind:'note',p_entity_id:id
});
assert.equal(purged.status,200,JSON.stringify(purged));
console.log('PASS: A owns its record; B cannot read/write it or view A profile.');
