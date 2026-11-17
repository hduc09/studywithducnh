import {communityClient,communityRpc,refreshCommunity} from './community.js';
import {store} from './store.js';
import {setMode,start} from './timer.js';
import {setFocusRoom} from './focus-verification.js';
import {applyRoomSound} from './audio.js';
import {toast} from './utils.js';

const $=selector=>document.querySelector(selector);
const make=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node};
const action=(label,run,style='outline-button')=>{const node=make('button',label,style);node.type='button';node.onclick=async()=>{
  node.disabled=true;try{await run()}catch(error){toast(error.message||'Phòng học đang tạm ngắt.')}
  finally{node.disabled=false}
};return node};
let api=null,room=null,roster=[],channel=null,poll=0,ticker=0,offset=0,replyTo=null,favorites=new Set(),
  presenceIds=new Set(),presenceModes=new Map(),lastTrack=0,musicKey='',listening=false,refreshing=false,roomZen=false,lastTotal=null,
  lockRelease=null,lockTask=null;
const roomStorageKey=()=>`studywithducnh-active-room-${store.getAccountId()}`;
const dateText=value=>new Date(value).toLocaleString('vi-VN');
const safeVideoId=value=>{
  try{const url=new URL(value);if(url.hostname==='youtu.be')return /^[\w-]{11}$/.test(url.pathname.slice(1))?url.pathname.slice(1):'';
    if(['www.youtube.com','youtube.com','www.youtube-nocookie.com'].includes(url.hostname)){
      const id=url.searchParams.get('v')||url.pathname.match(/\/embed\/([\w-]{11})/)?.[1]||'';
      return /^[\w-]{11}$/.test(id)?id:'';
    }}catch{}return '';
};
async function serverClock(){const sent=Date.now(),server=await communityRpc('server_time');offset=new Date(server).getTime()-(sent+Date.now())/2}
async function rpc(name,args){return communityRpc(name,args)}
function showGuest(guest){$('#rooms-guest').hidden=!guest;$('#rooms-body').hidden=guest}
function roomLabel(item){return `${item.member_count}/${item.max_members} người · ${item.subject||'Học tự do'} · ${item.language.toUpperCase()}`}
async function directory(){const root=$('#room-directory');root.replaceChildren();
  const form=new FormData($('#room-filter'));
  const mine=await rpc('my_rooms').catch(()=>[]);
  favorites=new Set(mine.filter(item=>item.favorite).map(item=>item.id));
  if(mine.length){root.append(make('h4','Phòng của tôi · yêu thích & lịch sử'));
    for(const item of mine){const row=make('div','','community-row');
      row.append(make('strong',`${item.favorite?'☆ ':''}${item.name}`),
        make('small',`${item.status} · đã vào ${dateText(item.joined_at)}`));
      if(item.status==='open')row.append(action('Vào lại',()=>joinRoom(item.id,item.invite_code,item.password_required)));
      root.append(row);
    }}
  root.append(make('h4','Đang mở công khai'));
  const list=await rpc('room_directory',{p_subject:String(form.get('subject')).trim()||null,p_language:String(form.get('language'))||null});
  if(!list?.length){root.append(make('p','Chưa có phòng phù hợp.','muted'));return}
  for(const item of list){const row=make('div','','community-row');row.append(make('strong',item.name),
    make('small',roomLabel(item)+' · @'+item.host_username));
    row.append(action('Tham gia',()=>joinRoom(item.id,null,item.password_required)));
    root.append(row);
  }
}
async function joinRoom(id,code=null,passwordRequired=false){
  const password=passwordRequired?prompt('Mật khẩu phòng:'):null;if(passwordRequired&&password===null)return;
  await rpc('join_room',{p_room:id,p_code:code,p_password:password});
  localStorage.setItem(roomStorageKey(),id);
  await openRoom(id);toast('Đã vào phòng học chung.');
}
async function roomRow(){
  const {data,error}=await api.from('rooms').select('id,name,host_id,squad_id,visibility,invite_code,subject,language,rules,max_members,status,chat_enabled,scene,timer_started_at,timer_minutes,timer_mode,music_video_id,music_position,music_playing,music_updated_at,created_at,updated_at').eq('id',room.id).maybeSingle();
  if(error)throw error;if(!data)throw new Error('Bạn không còn quyền vào phòng này.');room=data;
}
async function roomRoster(){roster=await rpc('room_roster',{p_room:room.id})||[]}
async function roomFeed(){return await rpc('room_feed',{p_room:room.id})||[]}
function isManager(){return roster.some(item=>item.user_id===store.getAccountId()&&['host','moderator'].includes(item.role))}
function renderPresence(){const current=channel?.presenceState?.()||{},ids=new Set(),modes=new Map();
  for(const [key,metas] of Object.entries(current))if(metas?.length){ids.add(key);modes.set(key,metas[0])}
  presenceIds=ids;presenceModes=modes;renderRoster();
}
function renderRoster(){const root=$('#room-members');root.replaceChildren();
  for(const person of roster){const card=make('div','','room-avatar');
    const img=document.createElement('img');img.src='./assets/avatars/'+person.avatar_id+'.svg';img.alt='';card.append(img);
    card.append(make('strong','@'+person.username),make('small',person.role==='host'?'Host':person.role==='moderator'?'Moderator':'Thành viên'));
    const live=presenceModes.get(person.user_id);
    const remaining=live?.mode==='focus'&&live.end_at?Math.max(0,Math.ceil((new Date(live.end_at).getTime()-Date.now())/60000)):0;
    card.append(make('small',live?.mode==='focus'?`● Đang Focus ${remaining}p`:presenceIds.has(person.user_id)?'● Đang nghỉ':'◯ Rời tạm','muted'));
    if(person.commitment)card.append(make('p',person.commitment));
    if(person.checkin)card.append(make('small',`Check-in: ${person.checkin}`));
    if(person.user_id!==store.getAccountId())card.append(action('Báo cáo',async()=>{
      const reason=prompt('Lý do báo cáo @'+person.username+' (5–500 ký tự):');if(!reason)return;
      await rpc('room_report',{p_room:room.id,p_target:person.user_id,p_message:null,p_reason:reason});
      toast('Đã gửi báo cáo.');
    }));
    if(isManager()&&person.user_id!==store.getAccountId()&&person.role!=='host'){
      const tools=make('div','','setting-buttons');
      for(const [label,kind] of [['Tắt tiếng','mute'],['Mời ra','kick'],['Chặn','ban'],['Đặt mod','promote']])
        tools.append(action(label,async()=>{if(['kick','ban'].includes(kind)&&!confirm(label+' @'+person.username+'?'))return;
          await rpc('room_action',{p_room:room.id,p_action:kind,p_target:person.user_id});await refreshRoom()}));
      if(room.host_id===store.getAccountId())tools.append(action('Chuyển host',async()=>{
        if(!confirm('Chuyển quyền host cho @'+person.username+'?'))return;
        await rpc('room_action',{p_room:room.id,p_action:'host',p_target:person.user_id});await refreshRoom();
      }));
      card.append(tools);
    }
    root.append(card);
  }
}
function renderTimer(){const root=$('#room-shared-timer');root.replaceChildren();
  if(room.timer_mode!=='shared'||!room.timer_started_at||!room.timer_minutes){
    root.append(make('p','Mỗi người dùng đồng hồ riêng.','muted'));return;
  }
  const end=new Date(room.timer_started_at).getTime()+room.timer_minutes*60000;
  const remaining=Math.max(0,Math.ceil((end-(Date.now()+offset))/1000));
  root.append(make('strong',`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`),
    make('small',`Đồng hồ chung · ${room.timer_minutes} phút · giờ máy chủ`));
  if(remaining>0)root.append(action('Học cùng',()=>{
    setFocusRoom(room.id);setMode('focus');store.update(state=>{state.timer.remaining=remaining},'timer');start();
    toast('Đồng hồ cá nhân đã bắt đầu theo thời gian còn lại.');
  },'primary-button'));
}
function renderMusic(){const root=$('#room-music');root.replaceChildren();
  if(!room.music_video_id){musicKey='';return}
  const controls=make('div','','setting-buttons');controls.append(make('strong','Nhạc chung · YouTube'));
  controls.append(action(listening?'Tắt nhạc riêng':'Nghe nhạc chung',()=>{listening=!listening;renderMusic()}));root.append(controls);
  if(!listening)return;
  const key=[room.music_video_id,room.music_position,room.music_playing,room.music_updated_at].join(':');
  const startAt=room.music_playing?room.music_position+
    Math.max(0,Math.floor((Date.now()+offset-new Date(room.music_updated_at).getTime())/1000)):room.music_position;
  const frame=document.createElement('iframe');frame.title='Nhạc YouTube chung';frame.loading='lazy';frame.allow='autoplay; encrypted-media';
  frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.src=`https://www.youtube-nocookie.com/embed/${room.music_video_id}?start=${Math.max(0,startAt)}&autoplay=${room.music_playing?1:0}&rel=0`;
  frame.className='room-music-frame';root.append(frame);musicKey=key;
}
function renderRoomHead(total=lastTotal){lastTotal=total;$('#active-room').hidden=false;$('#active-room-title').textContent=room.name;
  $('#active-room-meta').textContent=`${room.subject||'Học tự do'} · ${room.visibility} · Mã ${room.invite_code} · ${total?.minutes||0} phút Focus phòng hôm nay`;
  $('#room-chat').hidden=!room.chat_enabled;$('#room-host-tools').hidden=!isManager();
  $('#room-lock').textContent=room.status==='locked'?'Mở khóa phòng':'Khóa phòng';
  $('#room-chat-toggle').textContent=room.chat_enabled?'Tắt chat':'Bật chat';
  $('#room-play-music').textContent=room.music_playing?'Tạm dừng nhạc':'Phát nhạc';
  $('#room-favorite').textContent=favorites.has(room.id)?'★ Bỏ yêu thích':'☆ Yêu thích';
  $('#active-room').dataset.scene=room.scene?.theme||'';
  const background=room.scene?.backgroundURL||'';
  $('#active-room').style.backgroundImage=/^https:\/\//.test(background)?`linear-gradient(#101627ba,#101627ba),url("${background.replaceAll('"','%22')}")`:'';
  $('#active-room').classList.toggle('room-zen',roomZen);
  $('#room-zen').textContent=roomZen?'Thoát Zen':'Zen';
  let sound=$('#room-scene-sound');if(!sound){sound=action('Bật âm thanh phòng',()=>applyRoomSound(room.scene.sound));sound.id='room-scene-sound';
    $('#room-members').before(sound)}sound.hidden=!room.scene?.sound;
}
function renderChat(messages){const root=$('#room-messages');root.replaceChildren();
  for(const message of messages){const row=make('div','','community-row');
    row.append(make('strong','@'+message.username),make('small',dateText(message.created_at)));
    if(message.parent_id)row.append(make('small','↳ Trả lời #'+message.parent_id));
    row.append(make('p',message.body));
    const tools=make('div','','setting-buttons');
    tools.append(action('Trả lời',()=>{replyTo=message.id;$('#room-message-form input[name="body"]').focus();
      toast('Đang trả lời #'+message.id)}));
    for(const emoji of ['👍','❤️','✨'])tools.append(action(`${emoji} ${message.reactions?.[emoji]||''}`,
      async()=>{await rpc('room_react',{p_message:message.id,p_emoji:emoji});await refreshRoom()}));
    tools.append(action('Báo cáo',async()=>{const reason=prompt('Lý do báo cáo tin nhắn (5–500 ký tự):');if(!reason)return;
      await rpc('room_report',{p_room:room.id,p_target:message.user_id,p_message:message.id,p_reason:reason});toast('Đã gửi báo cáo.')}));
    row.append(tools);root.append(row);
  }
  if(!messages.length)root.append(make('p','Chưa có tin nhắn. Hãy bắt đầu bằng một lời chào.','muted'));
}
async function renderEvents(){const root=$('#room-events');root.replaceChildren();
  const heading=make('h4','Hẹn học cùng');root.append(heading);
  root.append(action('Tạo lịch hẹn',async()=>{const title=prompt('Tên buổi học chung:');if(!title)return;
    const when=prompt('Thời gian ISO, ví dụ 2026-11-18T20:00:00+07:00');if(!when)return;
    await rpc('create_room_event',{p_room:room.id,p_squad:room.squad_id,p_title:title,p_starts:new Date(when).toISOString()});
    await renderEvents();toast('Đã tạo lịch hẹn.')}));
  const {data,error}=await api.from('room_events').select('id,title,starts_at,creator_id').eq('room_id',room.id).order('starts_at',{ascending:true}).limit(20);
  if(error)throw error;
  for(const event of data||[]){const row=make('div','','community-row');row.append(make('strong',event.title),make('small',dateText(event.starts_at)));
    const actions=make('div','','setting-buttons');for(const [label,response] of [['Đi','yes'],['Có thể','maybe'],['Không','no']])
      actions.append(action(label,async()=>{await rpc('room_rsvp',{p_event:event.id,p_response:response});toast('Đã trả lời lời mời.')}));
    if(event.creator_id===store.getAccountId())actions.append(action('Mời bạn',async()=>{
      const username=prompt('Username người bạn muốn mời:');if(!username)return;
      const people=await rpc('find_people',{p_query:username.trim().replace(/^@/,'').toLowerCase()});
      const friend=people.find(person=>person.username===username.trim().replace(/^@/,'').toLowerCase());
      if(!friend)throw new Error('Không tìm thấy username chính xác.');
      await rpc('invite_room_event',{p_event:event.id,p_target:friend.user_id});toast('Đã mời bạn học chung.');
    }));
    row.append(actions);root.append(row);
  }
}
async function refreshRoom(){if(!room||refreshing)return;refreshing=true;
  try{await roomRow();await roomRoster();
    if(!roster.some(person=>person.user_id===store.getAccountId()))throw new Error('Bạn không còn quyền vào phòng này.');
    const [messages,total]=await Promise.all([roomFeed(),rpc('room_day_total',{p_room:room.id})]);
    renderRoomHead(total);renderRoster();renderChat(messages);renderTimer();
    if(listening&&musicKey!==[room.music_video_id,room.music_position,room.music_playing,room.music_updated_at].join(':'))renderMusic();
    if(!listening)renderMusic();await renderEvents();
  }catch(error){toast(error.message||'Phòng tạm ngắt, đồng hồ cá nhân vẫn chạy trên máy.');
    if(String(error.message).includes('không còn quyền'))await leaveLocal();}
  finally{refreshing=false}
}
async function trackPresence(){if(!channel||!room||Date.now()-lastTrack<9000)return;
  lastTrack=Date.now();const t=store.get().timer;
  try{await channel.track({user_id:store.getAccountId(),mode:t.running?t.mode:'break',
    end_at:t.running?t.endAt:null,at:new Date().toISOString()})}catch{}
}
async function connectRealtime(){if(channel||!room)return;
  const {data}=await api.auth.getSession();if(data.session?.access_token)api.realtime.setAuth(data.session.access_token);
  const join=()=>{channel=api.channel('room:'+room.id,{config:{private:true,presence:{key:store.getAccountId()}}})
    .on('presence',{event:'sync'},renderPresence)
    .on('broadcast',{event:'room-update'},()=>refreshRoom())
    .on('postgres_changes',{event:'*',schema:'public',table:'room_messages',filter:'room_id=eq.'+room.id},()=>refreshRoom())
    .on('postgres_changes',{event:'*',schema:'public',table:'rooms',filter:'id=eq.'+room.id},()=>refreshRoom())
    .subscribe(status=>{if(status==='SUBSCRIBED')trackPresence();if(status==='CHANNEL_ERROR')toast('Realtime tạm ngắt; phòng sẽ tự tải lại mỗi 15 giây.')})};
  if(navigator.locks?.request){
    let notify;const started=new Promise(resolve=>{notify=resolve});
    lockTask=navigator.locks.request('studywithducnh-presence-'+room.id+'-'+store.getAccountId(),
      {ifAvailable:true},async lock=>{if(!lock){notify(false);return}join();notify(true);
        await new Promise(resolve=>{lockRelease=resolve})});
    if(!await started)toast('Phòng đang mở ở tab khác; tab này vẫn xem được nhưng không gửi Presence.');
  }else join();
}
async function broadcast(){try{await channel?.send({type:'broadcast',event:'room-update',payload:{at:Date.now()}})}catch{}}
async function openRoom(id){
  if(room&&room.id!==id){await rpc('leave_room',{p_room:room.id}).catch(()=>{});await leaveLocal()}
  api=await communityClient();if(!api)throw new Error('Cần đăng nhập.');room={id};
  localStorage.setItem(roomStorageKey(),id);
  await serverClock();await refreshRoom();await connectRealtime();
  clearInterval(poll);poll=setInterval(()=>{if(room)refreshRoom()},15000);
  clearInterval(ticker);ticker=setInterval(()=>{if(room){renderTimer();trackPresence()}},1000);
}
async function leaveLocal(){clearInterval(poll);clearInterval(ticker);poll=0;ticker=0;
  if(channel){await api?.removeChannel(channel).catch(()=>{});channel=null}
  lockRelease?.();lockRelease=null;await lockTask?.catch(()=>{});lockTask=null;
  room=null;roster=[];presenceIds.clear();presenceModes.clear();setFocusRoom(null);localStorage.removeItem(roomStorageKey());
  $('#active-room').hidden=true;
}
async function leave(){if(!room)return;try{await rpc('leave_room',{p_room:room.id})}
  finally{await leaveLocal();await directory()}}
async function hostAction(kind,value=null,extra=null){await rpc('room_action',{p_room:room.id,p_action:kind,p_value:value,p_extra:extra});
  await broadcast();await refreshRoom()}
async function refreshRooms(){try{api=await communityClient();showGuest(!api);if(!api)return;
    await rpc('close_empty_rooms').catch(()=>{});
    await directory();const stored=localStorage.getItem(roomStorageKey());if(stored&&!room)await openRoom(stored);
  }catch(error){toast(error.message||'Không tải được danh sách phòng.')}}
function bind(){
  if(new URL(location.href).searchParams.has('room')){
    $('#room-join-code input[name="code"]').value=location.href;location.hash='rooms';
  }
  const controls=$('#room-chat-toggle').parentElement;
  for(const [id,label] of [['room-word-add','Thêm từ lọc'],['room-word-remove','Bỏ từ lọc'],['room-close','Đóng phòng']]){
    const control=make('button',label,'outline-button');control.id=id;control.type='button';controls.append(control);
  }
  const invite=make('button','Sao chép link phòng','outline-button');invite.type='button';invite.id='room-copy-link';
  $('#room-favorite').after(invite);
  $('#rooms-refresh').onclick=refreshRooms;$('#room-filter').onsubmit=event=>{event.preventDefault();directory().catch(error=>toast(error.message))};
  $('#room-create-form').onsubmit=async event=>{event.preventDefault();try{
    const form=new FormData(event.currentTarget);if(!form.get('rulesAccepted'))throw new Error('Hãy đọc và đồng ý quy tắc cộng đồng.');
    await rpc('accept_community_rules');
    const id=await rpc('create_room',{p_name:String(form.get('name')),p_visibility:String(form.get('visibility')),
      p_squad:String(form.get('squad'))||null,p_password:String(form.get('password'))||null,
      p_capacity:Number(form.get('capacity')),p_subject:String(form.get('subject')),
      p_language:String(form.get('language')),p_rules:String(form.get('rules'))});
    localStorage.setItem(roomStorageKey(),id);await openRoom(id);event.currentTarget.reset();await directory();
  }catch(error){toast(error.message||'Chưa tạo được phòng.')}};
  $('#room-join-code').onsubmit=async event=>{event.preventDefault();try{
    let raw=String(new FormData(event.currentTarget).get('code')).trim(),id='',code=raw;
    try{const link=new URL(raw);id=link.searchParams.get('room')||'';code=link.searchParams.get('code')||''}catch{}
    if(!id){const found=await rpc('find_room_by_code',{p_code:code});id=found?.id;
      if(!id)throw new Error('Không tìm thấy phòng theo mã mời.');
      await joinRoom(id,code,found.password_required);
    }else await joinRoom(id,code,true);
  }catch(error){toast(error.message||'Chưa vào được phòng.')}};
  $('#room-leave').onclick=()=>leave().catch(error=>toast(error.message));
  $('#room-zen').onclick=()=>{roomZen=!roomZen;renderRoomHead()};
  $('#room-favorite').onclick=async()=>{try{const active=!favorites.has(room.id);
      await rpc('room_favorite',{p_room:room.id,p_active:active});
      if(active)favorites.add(room.id);else favorites.delete(room.id);
      renderRoomHead();toast(active?'Đã thêm phòng yêu thích.':'Đã bỏ phòng yêu thích.')}
    catch(error){toast(error.message)}};
  $('#room-copy-link').onclick=async()=>{if(!room)return;const link=new URL(location.href);
    link.searchParams.set('room',room.id);link.searchParams.set('code',room.invite_code);link.hash='rooms';
    try{await navigator.clipboard.writeText(link.href);toast('Đã sao chép link phòng.')}
    catch(error){toast(error.message||'Chưa sao chép được link.')}};
  $('#room-save-commitment').onclick=async()=>{try{await rpc('room_commitment',{p_room:room.id,p_text:$('#room-commitment').value});await broadcast();await refreshRoom()}
    catch(error){toast(error.message)}};
  $('#room-checkin').onclick=async()=>{const value=prompt('Check-in: done / partial / missed','done');if(!value)return;
    try{await rpc('room_commitment',{p_room:room.id,p_text:$('#room-commitment').value,p_checkin:value});await broadcast();await refreshRoom()}
    catch(error){toast(error.message)}};
  $('#room-start-timer').onclick=async()=>{const minutes=prompt('Số phút Focus chung (1–240):','25');if(minutes!==null)try{await hostAction('timer_start',minutes)}catch(error){toast(error.message)}};
  $('#room-stop-timer').onclick=()=>hostAction('timer_stop').catch(error=>toast(error.message));
  $('#room-lock').onclick=()=>hostAction(room.status==='locked'?'unlock':'lock').catch(error=>toast(error.message));
  $('#room-chat-toggle').onclick=()=>hostAction('chat',String(!room.chat_enabled)).catch(error=>toast(error.message));
  $('#room-close').onclick=async()=>{if(!confirm('Đóng phòng này?'))return;
    try{await hostAction('close');await leaveLocal();await directory()}catch(error){toast(error.message)}};
  $('#room-word-add').onclick=async()=>{const word=prompt('Từ cần lọc (2–40 ký tự):');if(!word)return;
    try{await hostAction('word_add',word.trim());toast('Đã thêm từ cần lọc.')}catch(error){toast(error.message)}};
  $('#room-word-remove').onclick=async()=>{const word=prompt('Từ bỏ lọc:');if(!word)return;
    try{await hostAction('word_remove',word.trim());toast('Đã bỏ từ lọc.')}catch(error){toast(error.message)}};
  $('#room-set-scene').onclick=()=>{const raw=$('#room-background-url').value.trim();
    if(raw&&!/^https:\/\//i.test(raw)){toast('Nền phòng cần URL HTTPS.');return}
    hostAction('scene',null,{theme:$('#room-theme').value,sound:$('#room-sound').value,
      backgroundURL:raw}).catch(error=>toast(error.message))};
  $('#room-set-music').onclick=async()=>{const id=safeVideoId($('#room-video-url').value.trim());if(!id){toast('URL YouTube không hợp lệ.');return}
    try{await hostAction('music',id)}catch(error){toast(error.message)}};
  $('#room-play-music').onclick=()=>{const elapsed=room.music_playing?
    Math.max(0,Math.floor((Date.now()+offset-new Date(room.music_updated_at).getTime())/1000)):0;
    return hostAction('music_state',null,{position:(room.music_position||0)+elapsed,playing:!room.music_playing})
      .catch(error=>toast(error.message))};
  $('#room-message-form').onsubmit=async event=>{event.preventDefault();if(!room)return;const input=event.currentTarget.elements.body;
    try{await rpc('send_room_message',{p_room:room.id,p_body:input.value,p_parent:replyTo});input.value='';replyTo=null;
      await broadcast();await refreshRoom()}catch(error){toast(error.message||'Chưa gửi được tin nhắn.')}};
  $('#community-rules').onclick=()=>$('#community-rules-dialog').showModal();
  $('#community-rules-close').onclick=()=>$('#community-rules-dialog').close();
  window.addEventListener('hashchange',()=>{if(location.hash==='#rooms')refreshRooms()});
  window.addEventListener('online',()=>{if(room)connectRealtime().catch(()=>{});if(location.hash==='#rooms')refreshRooms()});
  window.addEventListener('pagehide',()=>{if(channel)channel.untrack().catch(()=>{})});
}
export function initRooms(){bind();if(location.hash==='#rooms')refreshRooms()}
