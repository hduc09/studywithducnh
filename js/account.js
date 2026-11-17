import {cloudClient,cloudConfigured} from './cloud.js';
import {store,exportData,chooseAutomaticBackup} from './store.js';
import {STORAGE_KEY} from './migration.js';
import {countPreview} from './sync-model.js';
import {localRevisions} from './localdb.js';
import {startSync,stopSync,syncNow,pendingCount,syncStatus,onSyncStatus,
  downloadDiagnostics,migrateGuestToCloud,openConflicts,resolveConflict,purgeCloudRecord,remoteRevisions} from './sync.js';
import {toast} from './utils.js';

const $=selector=>document.querySelector(selector);
const avatars=['moon','sun','leaf','star','wave','book'];
let client=null,currentUser=null,handling=false,explicitSignout=false,selectedAvatar='moon';
const redirectTo=()=>new URL('./',location.href).href;
const showMessage=(text,error=false)=>{const node=$('#account-message');node.textContent=text;node.classList.toggle('danger',error)};
const close=(selector)=>{const dialog=$(selector);if(dialog?.open)dialog.close()};
const open=(selector)=>{const dialog=$(selector);if(dialog&&!dialog.open)dialog.showModal()};
const renderBanner=()=>{
  const account=store.getAccountId();
  $('#guest-banner').hidden=Boolean(account);
  $('#account-trigger span:last-child').textContent=account?'Tài khoản của tôi':'Tài khoản';
};
function showAccount(){
  $('#account-unconfigured').hidden=cloudConfigured();
  $('#account-auth').hidden=!cloudConfigured()||Boolean(currentUser);
  $('#account-signed').hidden=!currentUser;
  if(currentUser)$('#account-email').textContent=currentUser.email||'Đã đăng nhập';
  open('#account-dialog');
}
function renderAvatars(){
  const root=$('#avatar-options');root.replaceChildren();
  for(const id of avatars){
    const button=document.createElement('button');button.type='button';button.className='avatar-option';
    button.classList.toggle('selected',id===selectedAvatar);button.setAttribute('aria-label','Avatar '+id);
    button.setAttribute('aria-pressed',String(id===selectedAvatar));
    const image=document.createElement('img');image.src='./assets/avatars/'+id+'.svg';image.alt='';
    button.append(image);button.onclick=()=>{selectedAvatar=id;renderAvatars()};root.append(button);
  }
}
async function loadProfile(){
  if(!client||!currentUser)return;
  const {data,error}=await client.from('profiles').select('username,display_name,avatar_id,timezone').eq('user_id',currentUser.id).maybeSingle();
  if(error){showMessage(error.message,true);return}
  $('#profile-username').value=data?.username||'';
  $('#profile-display-name').value=data?.display_name||'';
  $('#profile-timezone').value=data?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Ho_Chi_Minh';
  selectedAvatar=data?.avatar_id||'moon';renderAvatars();
}
async function guestDecision(id){
  const guest=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
  const preview=countPreview(guest||{});
  if(!guest?.profile?.onboarded&&!preview.tasks&&!preview.notes&&!preview.events)return 'keep';
  const key='studywithducnh-guest-decision-'+id;
  const prior=localStorage.getItem(key);
  if(prior)return prior;
  close('#account-dialog');
  $('#guest-import-preview').textContent=`${preview.tasks} việc, ${preview.notes} ghi chú, ${preview.events} sự kiện trên máy này.`;
  open('#guest-import-dialog');
  return new Promise(resolve=>{
    $('#guest-keep').onclick=()=>{localStorage.setItem(key,'keep');close('#guest-import-dialog');resolve('keep')};
    $('#guest-send').onclick=async()=>{
      const button=$('#guest-send');button.disabled=true;button.textContent='Đang kiểm tra cloud…';
      try{
        const result=await migrateGuestToCloud(client,id);
        if(!result.ok)throw new Error('Cloud chưa xác nhận đủ dữ liệu.');
        localStorage.setItem(key,'migrated');close('#guest-import-dialog');
        toast(`Đã xác nhận ${result.confirmed} bản ghi trên cloud. Bản Khách vẫn còn.`);
        resolve('migrated');
      }catch(error){showMessage(error.message||'Chưa thể chuyển dữ liệu Khách.',true);toast(error.message||'Dữ liệu Khách vẫn được giữ.');}
      finally{button.disabled=false;button.textContent='Đưa vào tài khoản'}
    };
  });
}
async function handleSession(user){
  if(handling)return;
  handling=true;
  try{
    currentUser=user;
    if(!user){renderBanner();showAccountState();return}
    const existing=store.getAccountId();
    if(existing&&existing!==user.id&&await pendingCount(existing)>0){
      await client.auth.signOut({scope:'local'});
      currentUser=null;
      showMessage('Tài khoản trước còn thay đổi chưa đồng bộ. Hãy đăng nhập lại tài khoản đó để đồng bộ trước khi đổi.',true);
      toast('Đã chặn đổi tài khoản vì outbox chưa gửi hết.');
      return;
    }
    if(existing!==user.id){
      if(!existing)await guestDecision(user.id);
      store.activateAccount(user.id);
      location.reload();return;
    }
    await startSync(client,user.id);
    await loadProfile();
    renderBanner();showAccountState();
  }catch(error){showMessage(error.message||'Máy chủ tạm nghỉ, dữ liệu trên máy vẫn an toàn.',true);
    toast('Máy chủ tạm nghỉ, dữ liệu trên máy vẫn an toàn.');}
  finally{handling=false;document.body.classList.remove('auth-pending')}
}
function showAccountState(){
  $('#account-unconfigured').hidden=cloudConfigured();
  $('#account-auth').hidden=!cloudConfigured()||Boolean(currentUser);
  $('#account-signed').hidden=!currentUser;
  if(currentUser)$('#account-email').textContent=currentUser.email||'Đã đăng nhập';
}
const action=fn=>async event=>{
  event.preventDefault();
  const button=event.submitter||event.currentTarget;
  if(button)button.disabled=true;
  try{await fn(event)}catch(error){showMessage(error.message||'Không thể hoàn tất thao tác.',true)}
  finally{if(button)button.disabled=false}
};
function bindAuthForms(){
  $('#signup-rules').onclick=()=>$('#community-rules-dialog').showModal();
  const forms={login:'#login-form',signup:'#signup-form',magic:'#magic-form',reset:'#reset-form'};
  for(const button of document.querySelectorAll('[data-auth-tab]'))button.onclick=()=>{
    const tab=button.dataset.authTab;
    for(const [key,selector] of Object.entries(forms))$(selector).hidden=key!==tab;
    $('#password-recovery-form').hidden=true;
    for(const other of document.querySelectorAll('[data-auth-tab]'))other.classList.toggle('active',other===button);
    showMessage('');
  };
  $('#login-form').onsubmit=action(async event=>{
    const form=new FormData(event.currentTarget);
    const {error}=await client.auth.signInWithPassword({email:String(form.get('email')).trim(),password:String(form.get('password'))});
    if(error)throw error;showMessage('Đăng nhập thành công.');
  });
  $('#signup-form').onsubmit=action(async event=>{
    const form=new FormData(event.currentTarget);
    const {error}=await client.auth.signUp({email:String(form.get('email')).trim(),password:String(form.get('password')),
      options:{emailRedirectTo:redirectTo(),data:{display_name:String(form.get('displayName')||'').trim()}}});
    if(error)throw error;showMessage('Hãy mở email xác minh rồi quay lại ứng dụng.');
  });
  $('#magic-form').onsubmit=action(async event=>{
    const email=String(new FormData(event.currentTarget).get('email')).trim();
    const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo(),shouldCreateUser:false}});
    if(error)throw error;showMessage('Đã gửi magic link. Hãy kiểm tra email.');
  });
  $('#reset-form').onsubmit=action(async event=>{
    const email=String(new FormData(event.currentTarget).get('email')).trim();
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:redirectTo()});
    if(error)throw error;showMessage('Đã gửi link đặt lại mật khẩu.');
  });
  $('#password-recovery-form').onsubmit=action(async event=>{
    const password=String(new FormData(event.currentTarget).get('password'));
    const {error}=await client.auth.updateUser({password});if(error)throw error;
    event.currentTarget.hidden=true;showMessage('Đã đổi mật khẩu.');
  });
  $('#google-login').onclick=action(async()=>{
    const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo()}});
    if(error)throw error;
  });
}
function bindProfile(){
  $('#profile-form').onsubmit=action(async event=>{
    if(!currentUser)throw new Error('Chưa đăng nhập.');
    const form=new FormData(event.currentTarget),username=String(form.get('username')).trim().toLowerCase();
    const timezone=String(form.get('timezone')).trim();
    if(!/^[a-z0-9_]{3,20}$/.test(username))throw new Error('Username cần 3–20 ký tự a-z0-9_.');
    try{new Intl.DateTimeFormat('en',{timeZone:timezone})}catch{throw new Error('Múi giờ không hợp lệ.')}
    const {error}=await client.from('profiles').upsert({user_id:currentUser.id,username,
      display_name:String(form.get('displayName')||'').trim(),avatar_id:selectedAvatar,timezone},{onConflict:'user_id'});
    if(error)throw error;
    showMessage('Đã lưu hồ sơ.');
  });
  $('#change-password').onclick=()=>{$('#password-change-form').hidden=!$('#password-change-form').hidden};
  $('#change-email').onclick=()=>{$('#email-change-form').hidden=!$('#email-change-form').hidden};
  $('#password-change-form').onsubmit=action(async event=>{
    const password=String(new FormData(event.currentTarget).get('password'));
    const {error}=await client.auth.updateUser({password});if(error)throw error;
    event.currentTarget.hidden=true;showMessage('Đã đổi mật khẩu.');
  });
  $('#email-change-form').onsubmit=action(async event=>{
    const email=String(new FormData(event.currentTarget).get('email')).trim();
    const {error}=await client.auth.updateUser({email});if(error)throw error;
    event.currentTarget.hidden=true;showMessage('Đã gửi email xác nhận địa chỉ mới.');
  });
  const signout=scope=>action(async()=>{
    const count=await pendingCount();
    if(count)throw new Error(`Còn ${count} thay đổi chưa đồng bộ. Hãy thử lại khi có mạng.`);
    explicitSignout=true;
    const {error}=await client.auth.signOut({scope});if(error){explicitSignout=false;throw error}
    stopSync();store.activateAccount('');location.reload();
  });
  $('#signout').onclick=signout('local');
  $('#signout-all').onclick=signout('global');
  $('#delete-account').onclick=action(async()=>{
    if(!currentUser)throw new Error('Chưa đăng nhập.');
    const count=await pendingCount();if(count)throw new Error('Còn thay đổi chưa đồng bộ. Hãy đồng bộ trước.');
    const username=$('#profile-username').value.trim();
    if(!username)throw new Error('Hãy lưu username trước khi xóa tài khoản.');
    await exportData();
    if(!confirm('Bạn đã kiểm tra file sao lưu vừa tải xuống? Đây là bước 1/2.'))return;
    const phrase=prompt(`Bước 2/2: nhập chính xác DELETE ${username} để xóa tài khoản và dữ liệu cloud.`);
    if(phrase!==`DELETE ${username}`)return;
    const {data,error}=await client.rpc('delete_my_account',{p_confirmation:phrase});
    if(error||!data)throw error||new Error('Máy chủ chưa xác nhận xóa tài khoản.');
    explicitSignout=true;stopSync();store.activateAccount('');location.reload();
  });
}
function row(container,title,body,buttons){
  const box=document.createElement('div');box.className='recovery-row';
  const strong=document.createElement('strong');strong.textContent=title;box.append(strong);
  if(body){const paragraph=document.createElement('p');paragraph.textContent=body;box.append(paragraph)}
  const actions=document.createElement('div');actions.className='setting-buttons';
  for(const [label,run] of buttons){const button=document.createElement('button');button.className='outline-button';button.textContent=label;button.onclick=run;actions.append(button)}
  box.append(actions);container.append(box);
}
function renderTrash(){
  const root=$('#trash-list');root.replaceChildren();
  const trash=store.get().trash||[];
  if(!trash.length){root.textContent='Thùng rác trống.';return}
  trash.forEach((item,index)=>row(root,
    `${item.kind} · ${item.data?.title||item.data?.name||item.entityId}`,
    `Đã xóa ${new Date(item.deletedAt).toLocaleString('vi-VN')}`,[
      ['Khôi phục',()=>{if(store.restoreTrash(index)){renderTrash();toast('Đã khôi phục.')}}],
      ['Xóa vĩnh viễn',async()=>{
        if(!confirm('Xóa vĩnh viễn bản này? Hãy chắc chắn bạn đã tải sao lưu.'))return;
        try{
          if(store.getAccountId()&&await pendingCount())throw new Error('Còn thay đổi chưa đồng bộ. Hãy thử lại khi có mạng.');
          await purgeCloudRecord(item.kind,item.entityId);
          store.purgeTrash(index);renderTrash();toast('Đã xóa vĩnh viễn.');
        }catch(error){toast(error.message||'Chưa thể xóa trên cloud; bản trong thùng rác vẫn được giữ.')}
      }]
    ]));
}
async function renderRevisions(id){
  const root=$('#revisions-list');root.replaceChildren();
  const local=await localRevisions(store.getAccountId(),id);
  const remote=await remoteRevisions(id).catch(()=>[]);
  const versions=[...local,...remote].sort((a,b)=>b.at.localeCompare(a.at));
  if(!versions.length){root.textContent='Chưa có bản lịch sử.';return}
  for(const revision of versions){
    const current=store.get().notes.find(note=>String(note.id)===id);
    row(root,`${revision.data.title||'Ghi chú'} · ${new Date(revision.at).toLocaleString('vi-VN')}`,
      `Bản trước:\n${revision.data.body||''}\n\nBản hiện tại:\n${current?.body||''}`,[
        ['Khôi phục bản này',()=>{
          if(!confirm('Khôi phục phiên bản này? Bản hiện tại sẽ được lưu trong lịch sử trước.'))return;
          if(current)store.saveNoteRevision(current).catch(()=>{});
          store.update(state=>{
            const note=state.notes.find(n=>String(n.id)===id);
            if(note)Object.assign(note,revision.data,{updatedAt:new Date().toISOString()});
          },'notes');close('#revisions-dialog');toast('Đã khôi phục ghi chú.');
        }]
      ]);
  }
}
async function renderConflicts(){
  const root=$('#conflicts-list');root.replaceChildren();
  const list=await openConflicts();
  if(!list.length){root.textContent='Không có bản xung đột.';return}
  for(const conflict of list){
    const local=store.get().notes.find(note=>String(note.id)===conflict.entity_id);
    const server=conflict.server_payload||{};
    const box=document.createElement('div');box.className='recovery-row';
    const title=document.createElement('strong');title.textContent=local?.title||server.title||'Ghi chú';box.append(title);
    const left=document.createElement('p');left.textContent='Bản trên máy:\n'+(local?.body||'');box.append(left);
    const right=document.createElement('p');right.textContent='Bản cloud:\n'+(server.body||'');box.append(right);
    const textarea=document.createElement('textarea');textarea.value=local?.body||'';textarea.setAttribute('aria-label','Nội dung ghép');box.append(textarea);
    const actions=document.createElement('div');actions.className='setting-buttons';
    for(const [label,choice] of [['Giữ cloud','server'],['Giữ bản trên máy','local'],['Ghép theo ô trên','merge']]){
      const button=document.createElement('button');button.className='outline-button';button.textContent=label;
      button.onclick=async()=>{
        try{
          const payload=choice==='merge'?{...server,...local,body:textarea.value}:
            choice==='local'?local:null;
          await resolveConflict(conflict,choice,payload);
          if(choice==='server'){
            const next=structuredClone(store.get());
            const index=next.notes.findIndex(n=>String(n.id)===conflict.entity_id);
            if(index>=0)next.notes[index]=server;
            store.applyRemote(next);
          }
          await renderConflicts();
        }catch(error){toast(error.message||'Chưa thể giải quyết xung đột.')}
      };actions.append(button);
    }
    box.append(actions);root.append(box);
  }
}
function bindPanels(){
  $('#settings-content').addEventListener('click',event=>{
    const action=event.target.closest('[data-setting-action]')?.dataset.settingAction;
    if(action==='open-account')showAccount();
    if(action==='open-sync')$('#sync-status').click();
    if(action==='open-trash'){renderTrash();open('#trash-dialog')}
    if(action==='auto-backup')chooseAutomaticBackup().catch(error=>toast(error.message||'Không thể chọn file sao lưu.'));
  });
  $('#settings-content').addEventListener('change',event=>{
    const key={'privacy-status':'shareStudyStatus','privacy-minutes':'shareMinutes','privacy-hide':'hidePresence'}[event.target.id];
    if(key)store.update(state=>{state.settings[key]=event.target.checked},'settings');
  });
  $('#account-trigger').onclick=showAccount;
  $('#sync-status').onclick=()=>{const current=syncStatus();
    $('#sync-detail').textContent=current.detail||'Dữ liệu được lưu trên máy trước khi gửi lên cloud.';
    open('#sync-dialog')};
  $('#sync-retry').onclick=syncNow;
  $('#sync-errors-download').onclick=downloadDiagnostics;
  $('#sync-open-conflicts').onclick=()=>{close('#sync-dialog');renderConflicts().then(()=>open('#conflicts-dialog')).catch(error=>toast(error.message))};
  for(const [selector,dialog] of [['[data-close-account]','#account-dialog'],['[data-close-sync]','#sync-dialog'],
    ['[data-close-trash]','#trash-dialog'],['[data-close-revisions]','#revisions-dialog'],
    ['[data-close-conflicts]','#conflicts-dialog']])$(selector).onclick=()=>close(dialog);
  window.addEventListener('open-account',showAccount);
  window.addEventListener('open-sync',()=>$('#sync-status').click());
  window.addEventListener('open-trash',()=>{renderTrash();open('#trash-dialog')});
  window.addEventListener('open-note-history',event=>{
    const id=String(event.detail?.id||'');if(!id)return;
    renderRevisions(id).then(()=>open('#revisions-dialog')).catch(error=>toast(error.message));
  });
  onSyncStatus(current=>{if($('#sync-dialog').open)$('#sync-detail').textContent=current.detail});
}
export async function initAccount(){
  bindAuthForms();bindProfile();bindPanels();renderBanner();
  if(!cloudConfigured()){
    showAccountState();await store.restoreFromIndexedDB();
    $('#sync-status').textContent='✓ Lưu trên máy';
    document.body.classList.remove('auth-pending');return;
  }
  try{
    client=await cloudClient();
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'){
        $('#account-auth').hidden=false;$('#account-signed').hidden=true;
        for(const id of ['login','signup','magic','reset'])$('#'+id+'-form').hidden=true;
        $('#password-recovery-form').hidden=false;open('#account-dialog');return;
      }
      if(event==='SIGNED_OUT'){
        currentUser=null;showAccountState();
        if(!explicitSignout&&store.getAccountId()){
          showMessage('Phiên đăng nhập đã kết thúc. Dữ liệu cục bộ vẫn được giữ; hãy đăng nhập lại để đồng bộ.',true);
        }
        return;
      }
      if(session?.user&&event==='SIGNED_IN')setTimeout(()=>handleSession(session.user),0);
    });
    const {data,error}=await client.auth.getSession();if(error)throw error;
    if(data.session?.user)await handleSession(data.session.user);
    else if(store.getAccountId()){
      showMessage('Cần đăng nhập lại để đồng bộ. Dữ liệu tài khoản vẫn nằm trên máy.',true);
      $('#sync-status').dataset.state='offline';$('#sync-status').textContent='◷ Cần đăng nhập';
    }else showAccountState();
  }catch(error){showMessage('Máy chủ tạm nghỉ, dữ liệu trên máy vẫn an toàn.',true);
    $('#sync-status').dataset.state='offline';$('#sync-status').textContent='◷ Chờ mạng';
  }finally{document.body.classList.remove('auth-pending')}
}
