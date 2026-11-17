// Chạy sau khi đã tạo project Supabase, áp dụng schema.sql và xác minh hai tài khoản test.
import assert from 'node:assert/strict';

const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY;
const credentials=[
  [process.env.TEST_USER_A_EMAIL,process.env.TEST_USER_A_PASSWORD],
  [process.env.TEST_USER_B_EMAIL,process.env.TEST_USER_B_PASSWORD]
];
if(!url||!key||credentials.some(pair=>pair.some(value=>!value))){
  console.log('SKIP: cần project Supabase và hai tài khoản test A/B.');process.exit(0);
}
async function request(path,token,method='GET',body){
  const response=await fetch(url+path,{method,headers:{apikey:key,Authorization:`Bearer ${token}`,
    'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}
  return {status:response.status,data};
}
async function login(email,password){
  const response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',
    headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
}
const [a,b]=await Promise.all(credentials.map(pair=>login(...pair)));
assert.notEqual(a.user.id,b.user.id);
const rpc=(name,token,args={})=>request('/rest/v1/rpc/'+name,token,'POST',args);
const accepted=await rpc('accept_community_rules',a.access_token);
assert.equal(accepted.status,200,JSON.stringify(accepted));
const room=await rpc('create_room',a.access_token,{p_name:'RLS test '+crypto.randomUUID().slice(0,8),
  p_visibility:'private',p_squad:null,p_password:null,p_capacity:2,p_subject:'',p_language:'vi',p_rules:''});
assert.equal(room.status,200,JSON.stringify(room));
const roomId=room.data;
try{
  const outsiders=await request('/rest/v1/room_messages?room_id=eq.'+roomId,b.access_token);
  assert.equal(outsiders.status,200);assert.deepEqual(outsiders.data,[]);
  const roster=await request('/rest/v1/room_members?room_id=eq.'+roomId,b.access_token);
  assert.equal(roster.status,200);assert.deepEqual(roster.data,[]);
  const post=await rpc('send_room_message',b.access_token,{p_room:roomId,p_body:'forged',p_parent:null});
  assert.ok(post.status>=400,'Outsider must not send room chat');
  const forged=await request('/rest/v1/room_messages',b.access_token,'POST',{
    room_id:roomId,user_id:a.user.id,body:'forged'});
  assert.ok(forged.status>=400,'Direct room write must be denied');
  console.log('PASS: người ngoài không đọc hoặc gửi được chat/phòng.');
}finally{
  await rpc('room_action',a.access_token,{p_room:roomId,p_action:'close'});
  await rpc('leave_room',a.access_token,{p_room:roomId});
}
const squad=await rpc('create_squad',a.access_token,{p_name:'RLS Squad '+crypto.randomUUID().slice(0,8),
  p_avatar:'star',p_timezone:'Asia/Ho_Chi_Minh'});
assert.equal(squad.status,200,JSON.stringify(squad));
const squadId=squad.data.id;
try{
  const outsiders=await request('/rest/v1/squads?id=eq.'+squadId,b.access_token);
  assert.equal(outsiders.status,200);assert.deepEqual(outsiders.data,[]);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const day=await rpc('squad_day',b.access_token,{p_squad:squadId,p_day:today});
  assert.ok(day.status>=400,'Outsider must not see squad streak');
  const forged=await request('/rest/v1/focus_sessions',b.access_token,'POST',{
    user_id:a.user.id,planned_end_at:new Date(Date.now()+1500000).toISOString()});
  assert.ok(forged.status>=400,'Direct verified Focus write must be denied');
  console.log('PASS: người ngoài không xem được Squad; không thể tự ghi phút Focus xác thực.');
}finally{await rpc('squad_action',a.access_token,{p_squad:squadId,p_action:'leave'});}
