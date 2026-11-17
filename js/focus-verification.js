import {store} from './store.js';
import {communityRpc} from './community.js';

let roomId=null,starting=false;
export const setFocusRoom=id=>{roomId=id||null};
const id=()=>store.get().timer.verifiedFocusId;
export async function retryVerifiedFocus(){
  if(!id()||store.get().timer.running&&!store.get().timer.verifiedFocusAbandon||!navigator.onLine)return;
  const pending=id();
  try{await communityRpc('focus_abandon',{p_id:pending});
    store.update(state=>{if(state.timer.verifiedFocusId===pending){state.timer.verifiedFocusId='';
      state.timer.verifiedFocusAbandon=false}},'timer');
  }catch{}
}
export async function startVerifiedFocus(minutes){
  if(starting||!store.getAccountId()||!navigator.onLine)return;
  starting=true;
  try{
    await retryVerifiedFocus();
    if(id())return;
    const serverId=await communityRpc('focus_start',{p_minutes:Math.min(240,Math.max(1,Math.ceil(minutes))),p_room:roomId});
    if(store.get().timer.running&&store.get().timer.mode==='focus')
      store.update(state=>{state.timer.verifiedFocusId=serverId;state.timer.verifiedFocusAbandon=false},'timer');
    else await communityRpc('focus_abandon',{p_id:serverId});
  }catch{ /* Phiên cá nhân vẫn chạy; chỉ phiên server xác nhận mới tính chuỗi nhóm. */ }
  finally{starting=false}
}
export async function stopVerifiedFocus(abandon=false){
  const pending=id();if(!pending)return;
  if(!navigator.onLine){store.update(state=>{state.timer.verifiedFocusAbandon=true},'timer');return}
  try{
    await communityRpc(abandon?'focus_abandon':'focus_stop',{p_id:pending});
    store.update(state=>{if(state.timer.verifiedFocusId===pending){state.timer.verifiedFocusId='';
      state.timer.verifiedFocusAbandon=false}},'timer');
  }catch{store.update(state=>{state.timer.verifiedFocusAbandon=true},'timer')}
}
window.addEventListener('online',retryVerifiedFocus);
