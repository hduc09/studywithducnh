import {cloudClient,cloudConfigured} from './cloud.js';
import {store,bus} from './store.js';
import {toast} from './utils.js';
import {setCommunityCalendar} from './planner.js';
import {onSyncStatus} from './sync.js';

const $=selector=>document.querySelector(selector);
const make=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node};
const button=(text,run,style='outline-button')=>{const node=make('button',text,style);node.type='button';node.onclick=async()=>{
  node.disabled=true;try{await run()}catch(error){toast(error.message||'Chưa thể hoàn tất thao tác.')}
  finally{node.disabled=false}
};return node};
const line=(title,detail,actions=[])=>{const node=make('div','','community-row');node.append(make('strong',title));
  if(detail)node.append(make('small',detail));const group=make('div','','setting-buttons');for(const item of actions)group.append(item);node.append(group);return node};
let client=null,overview={friends:[],incoming:[],outgoing:[],squads:[],blocked:[]},refreshing=false,lastNotice=0;
export async function communityClient(){
  if(!cloudConfigured()||!store.getAccountId())return null;
  client ||= await cloudClient();
  const {data,error}=await client.auth.getSession();if(error)throw error;
  if(data.session?.user?.id!==store.getAccountId())return null;
  return client;
}
export async function communityRpc(name,args={}){
  const api=await communityClient();if(!api)throw new Error('Hãy đăng nhập để dùng tính năng cộng đồng.');
  const {data,error}=await api.rpc(name,args);if(error)throw error;return data;
}
const showGuest=guest=>{$('#community-guest').hidden=!guest;$('#community-body').hidden=guest;
  $('#rooms-guest').hidden=!guest;$('#rooms-body').hidden=guest};
const safeDate=value=>{try{return new Date(value).toLocaleString('vi-VN')}catch{return ''}};
const countStreak=days=>{let count=0;for(const day of days){if(day.qualified)count++;else break}return count};
const isQuiet=()=>{const {quietStart:start,quietEnd:end}=store.get().settings;if(!start||!end)return false;
  const now=new Date().toTimeString().slice(0,5);return start<end?now>=start&&now<end:now>=start||now<end};
async function syncPrivacy(){const s=store.get().settings;
  if(!await communityClient())return;
  await communityRpc('update_privacy',{p_minutes:Boolean(s.shareMinutes),p_status:Boolean(s.shareStudyStatus),
    p_hidden:Boolean(s.hidePresence),p_prefs:s.communityNotify||{},
    p_quiet_start:s.quietStart||null,p_quiet_end:s.quietEnd||null});
}
function renderPeople(){const friends=$('#friends-list'),incoming=$('#friend-incoming'),outgoing=$('#friend-outgoing');
  friends.replaceChildren();incoming.replaceChildren();outgoing.replaceChildren();
  if(!overview.friends.length)friends.append(make('p','Chưa kết bạn.','muted'));
  for(const person of overview.friends)friends.append(line('@'+person.username,
    `${person.share_status?(person.studying?'● Đang học':'◯ Đang nghỉ'):'Ẩn trạng thái'} · ${person.minutes_today==null?'Phút học riêng tư':`${person.minutes_today} phút Focus hôm nay`}`,[
      button('Hủy kết bạn',async()=>{if(!confirm('Hủy kết bạn với @'+person.username+'?'))return;
        await communityRpc('friend_action',{p_target:person.user_id,p_action:'remove'});await refreshCommunity()}),
      button('Chặn',async()=>{if(!confirm('Chặn @'+person.username+'?'))return;
        await communityRpc('friend_action',{p_target:person.user_id,p_action:'block'});await refreshCommunity()},'outline-button danger')
    ]));
  if(overview.blocked?.length){friends.append(make('h4','Người đã chặn'));
    for(const person of overview.blocked)friends.append(line('@'+person.username,'Đã chặn',[
      button('Bỏ chặn',async()=>{await communityRpc('friend_action',{p_target:person.user_id,p_action:'unblock'});await refreshCommunity()})
    ]));}
  if(!overview.incoming.length)incoming.append(make('p','Không có lời mời.','muted'));
  for(const person of overview.incoming)incoming.append(line('@'+person.username,safeDate(person.created_at),[
    button('Chấp nhận',async()=>{await communityRpc('friend_action',{p_target:person.user_id,p_action:'accept'});await refreshCommunity()}),
    button('Từ chối',async()=>{await communityRpc('friend_action',{p_target:person.user_id,p_action:'reject'});await refreshCommunity()})
  ]));
  for(const person of overview.outgoing)outgoing.append(line('@'+person.username,'Đang chờ phản hồi',[
    button('Hủy lời mời',async()=>{await communityRpc('friend_action',{p_target:person.user_id,p_action:'cancel'});await refreshCommunity()})
  ]));
  if(!overview.outgoing.length)outgoing.append(make('p','Chưa gửi lời mời.','muted'));
}
async function renderSquads(){const root=$('#squads-list');root.replaceChildren();const streakDays=new Set();
  const select=$('#room-squad-select');select.replaceChildren(new Option('Không gắn Squad',''));
  if(!overview.squads.length){root.append(make('p','Tạo Squad hoặc nhập mã để học cùng 2–10 người.','muted'));return []}
  for(const squad of overview.squads){
    select.add(new Option(squad.name,squad.id));
    const card=make('div','','community-row squad-card');
    card.append(make('strong',squad.name),make('small',`Mã mời ${squad.invite_code} · ${squad.threshold_percent}% thành viên · ${squad.min_focus_minutes} phút Focus/ngày`));
    const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:squad.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const day=await communityRpc('squad_day',{p_squad:squad.id,p_day:localDay}).catch(()=>null);
    const history=await communityRpc('squad_history',{p_squad:squad.id,p_days:30}).catch(()=>[]);
    for(const item of history||[])if(item.qualified)streakDays.add(item.day);
    if(day){const week=(history||[]).slice(0,7).filter(item=>item.qualified).length;
      card.append(make('p',`${day.achieved}/${day.total} thành viên đạt mục tiêu hôm nay · Chuỗi ${countStreak(history||[])} ngày · Tuần này ${week}/7 ngày`,'muted'));
      const roster=make('div','','squad-roster');for(const person of day.members||[]){
        const chip=make('span',`${person.achieved?'🔥':'◯'} @${person.username}${person.minutes==null?'':` · ${person.minutes}p`}`,'squad-chip');
        roster.append(chip);
        if(!person.achieved&&person.user_id!==store.getAccountId())roster.append(button('Nhắc @'+person.username,
          async()=>{await communityRpc('squad_action',{p_squad:squad.id,p_action:'remind',p_target:person.user_id});toast('Đã nhắc bạn nhẹ nhàng.')}));
        if(squad.role==='admin'&&person.user_id!==store.getAccountId()){
          roster.append(button('Mời ra @'+person.username,async()=>{if(!confirm('Mời @'+person.username+' ra khỏi Squad?'))return;
            await communityRpc('squad_action',{p_squad:squad.id,p_action:'kick',p_target:person.user_id});await refreshCommunity()}));
          if(squad.owner_id===store.getAccountId())roster.append(button('Chuyển admin @'+person.username,
            async()=>{if(!confirm('Chuyển quyền chủ Squad cho @'+person.username+'?'))return;
              await communityRpc('squad_action',{p_squad:squad.id,p_action:'promote',p_target:person.user_id});await refreshCommunity()}));
        }
      }card.append(roster);
      const ranked=await communityRpc('squad_week_leaderboard',{p_squad:squad.id}).catch(()=>[]);
      if(squad.leaderboard_enabled&&ranked.length)card.append(make('small','Bảng tuần (opt-in): '+ranked.map((person,i)=>`${i+1}. @${person.username} ${person.minutes}p`).join(' · ')));
    }
    const api=await communityClient();
    const {data:challenges}=await api.from('squad_challenges').select('id,title,target_minutes,ends_on').eq('squad_id',squad.id).gte('ends_on',localDay).limit(10);
    for(const challenge of challenges||[]){const progress=await communityRpc('squad_challenge_progress',{p_challenge:challenge.id}).catch(()=>null);
      if(progress)card.append(make('small',`Thử thách ${challenge.title}: ${progress.minutes}/${progress.target} phút · đến ${challenge.ends_on}`));}
    const actions=make('div','','setting-buttons');
    actions.append(button('Sao chép mã',async()=>{await navigator.clipboard.writeText(squad.invite_code);toast('Đã sao chép mã Squad.')}));
    actions.append(button('Khiên tuần',async()=>{if(!confirm('Dùng một khiên cho ngày hôm nay?'))return;
      await communityRpc('squad_action',{p_squad:squad.id,p_action:'shield'});await refreshCommunity()}));
    actions.append(button('Rời Squad',async()=>{if(!confirm('Rời Squad '+squad.name+'?'))return;
      await communityRpc('squad_action',{p_squad:squad.id,p_action:'leave'});await refreshCommunity()},'outline-button danger'));
    if(squad.role==='admin'){
      actions.append(button('Mục tiêu',async()=>{const value=prompt('Phút Focus tối thiểu mỗi ngày (5–180)',String(squad.min_focus_minutes));
        if(value===null)return;await communityRpc('squad_action',{p_squad:squad.id,p_action:'minutes',p_value:value});await refreshCommunity()}));
      actions.append(button('Ngưỡng',async()=>{const value=prompt('Tỷ lệ thành viên cần đạt: 50, 70 hoặc 100',String(squad.threshold_percent));
        if(value===null)return;await communityRpc('squad_action',{p_squad:squad.id,p_action:'threshold',p_value:value});await refreshCommunity()}));
      actions.append(button('Thử thách',async()=>{const title=prompt('Tên thử thách chung:');if(!title)return;
        const minutes=Number(prompt('Tổng phút Focus mục tiêu:', '3000'));if(!minutes)return;
        const start=new Date().toISOString().slice(0,10);const end=new Date(Date.now()+6*86400000).toISOString().slice(0,10);
        await communityRpc('create_squad_challenge',{p_squad:squad.id,p_title:title,p_minutes:minutes,p_start:start,p_end:end});toast('Đã tạo thử thách.')}));
      actions.append(button('Ngày nghỉ',async()=>{const day=prompt('Ngày nghỉ theo múi giờ Squad (YYYY-MM-DD):',localDay);
        if(!day)return;await communityRpc('squad_action',{p_squad:squad.id,p_action:'rest',p_value:day});await refreshCommunity()}));
    }
    card.append(actions);root.append(card);
  }
  return [...streakDays];
}
async function renderNotifications(){const api=await communityClient(),root=$('#community-notifications');root.replaceChildren();
  const {data,error}=await api.from('notifications').select('id,kind,title,body,created_at,read_at').order('created_at',{ascending:false}).limit(30);
  if(error)throw error;
  if(!data?.length){root.append(make('p','Chưa có thông báo.','muted'));return}
  for(const item of data){const entry=line(item.title,item.body+' · '+safeDate(item.created_at));
    if(!item.read_at)entry.classList.add('unread');root.append(entry)}
  const unread=data.filter(item=>!item.read_at);
  const allowed=unread.filter(item=>store.get().settings.communityNotify?.[item.kind==='reminder'?'streak':item.kind]);
  if(allowed.length&&!isQuiet()&&store.get().settings.notify&&'Notification'in window&&Notification.permission==='granted'&&Date.now()-lastNotice>60000){
    lastNotice=Date.now();new Notification('studywithducnh',{body:`${allowed.length} thông báo mới`,icon:'./assets/icons/icon.svg'});
  }
}
export async function refreshCommunity(){if(refreshing)return;refreshing=true;
  try{const api=await communityClient();showGuest(!api);if(!api)return;
    overview=await communityRpc('social_overview');renderPeople();const streakDays=await renderSquads();await renderNotifications();
    const {data:events}=await api.from('room_events').select('id,title,starts_at,room_id').gte('starts_at',new Date(Date.now()-30*86400000).toISOString()).limit(100);
    setCommunityCalendar(events||[],streakDays);
    $('#home-friends').textContent=`${overview.friends.length} bạn · ${overview.friends.filter(p=>p.share_status).length} người chia sẻ trạng thái`;
    $('#home-squad').textContent=`${overview.squads.length} Squad · ${streakDays.length} ngày đạt trong 30 ngày`;
    const rooms=await communityRpc('room_directory',{p_subject:null,p_language:null}).catch(()=>[]);
    $('#home-rooms').textContent=`${rooms.length} phòng công khai đang mở`;
  }catch(error){toast('Cộng đồng đang tạm ngắt. Việc học trên máy vẫn an toàn. '+(error.message||''))}
  finally{refreshing=false}
}
function bind(){
  const friendParam=new URL(location.href).searchParams.get('friend');
  if(friendParam){$('#friend-query').value=friendParam;location.hash='community'}
  $('#copy-friend-link').onclick=async()=>{try{const api=await communityClient();if(!api)throw new Error('Hãy đăng nhập trước.');
    const {data,error}=await api.from('profiles').select('username').eq('user_id',store.getAccountId()).single();
    if(error||!data?.username)throw error||new Error('Hãy đặt username trong Tài khoản trước.');
    const url=new URL(location.href);url.searchParams.set('friend',data.username);url.hash='community';
    await navigator.clipboard.writeText(url.href);toast('Đã sao chép link kết bạn.');
  }catch(error){toast(error.message||'Chưa sao chép được link.')}};
  document.querySelectorAll('[data-go-community]').forEach(node=>node.onclick=()=>location.hash='community');
  document.querySelectorAll('[data-go-rooms]').forEach(node=>node.onclick=()=>location.hash='rooms');
  $('#home-sync-open').onclick=()=>$('#sync-status').click();
  onSyncStatus(snapshot=>{$('#home-sync').textContent=snapshot.detail||
    (snapshot.userId?'Đã lưu trên máy và cloud':'Chế độ Khách · lưu trên máy')});
  $('#community-refresh').onclick=refreshCommunity;
  $('#friend-search-form').onsubmit=async event=>{event.preventDefault();
    try{let query=$('#friend-query').value.trim();try{query=new URL(query).searchParams.get('friend')||query}catch{}
      query=query.replace(/^@/,'').toLowerCase();const matches=await communityRpc('find_people',{p_query:query});
      const root=$('#friend-results');root.replaceChildren();
      if(!matches.length)root.append(make('p','Không tìm thấy username.','muted'));
      for(const person of matches)root.append(line('@'+person.username,'Avatar '+person.avatar_id,[
        button('Kết bạn',async()=>{await communityRpc('friend_action',{p_target:person.user_id,p_action:'request'});toast('Đã gửi lời mời.');await refreshCommunity()})
      ]));
    }catch(error){toast(error.message||'Không tìm thấy bạn.')}};
  $('#squad-create-form').onsubmit=async event=>{event.preventDefault();try{const form=new FormData(event.currentTarget);
    await communityRpc('create_squad',{p_name:String(form.get('name')),p_avatar:String(form.get('avatar')),
      p_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Ho_Chi_Minh'});
    event.currentTarget.reset();await refreshCommunity();toast('Đã tạo Squad.');
  }catch(error){toast(error.message||'Chưa tạo được Squad.')}};
  $('#squad-join-form').onsubmit=async event=>{event.preventDefault();try{const code=String(new FormData(event.currentTarget).get('code'));
    await communityRpc('join_squad',{p_code:code});event.currentTarget.reset();await refreshCommunity();toast('Đã vào Squad.');
  }catch(error){toast(error.message||'Mã mời không hợp lệ.')}};
  $('#notifications-read').onclick=async()=>{try{await communityRpc('mark_notifications_read');await refreshCommunity()}
    catch(error){toast(error.message||'Chưa cập nhật được thông báo.')}};
  $('#settings-content').addEventListener('change',event=>{
    const id=event.target.id,key=event.target.dataset.communityNotify;
    if(key)store.update(state=>{state.settings.communityNotify[key]=event.target.checked},'settings');
    if(id==='quiet-start'||id==='quiet-end')store.update(state=>{
      state.settings[id==='quiet-start'?'quietStart':'quietEnd']=event.target.value},'settings');
    if(key||id.startsWith('privacy-')||id.startsWith('quiet-'))syncPrivacy().catch(error=>toast(error.message));
  });
  window.addEventListener('online',()=>syncPrivacy().catch(()=>{}));
  window.addEventListener('hashchange',()=>{if(location.hash==='#community')refreshCommunity()});
  bus.on('replace',()=>{if(location.hash==='#community')refreshCommunity()});
}
export function initCommunity(){bind();refreshCommunity()}
