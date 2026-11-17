import {$,escapeHTML,localDate,toast,confetti} from './utils.js';
import {store,bus} from './store.js';
import {studyStreak,studyXP} from './stats.js';

const defaultQuotes=[
  'Bạn không cần học hoàn hảo. Bạn chỉ cần bắt đầu.',
  'Mỗi ngày một chút, rồi một ngày bạn sẽ nhìn lại và ngạc nhiên.',
  'Sự tập trung là món quà bạn dành cho tương lai của mình.',
  'Một phiên học tốt bắt đầu từ việc đặt điện thoại xuống.',
  'Đi chậm vẫn là đang tiến về phía trước.',
  'Hãy để sự tò mò dẫn bạn đến trang tiếp theo.',
  'Nghỉ ngơi cũng là một phần của học tập.',
  'Hôm nay bạn đã làm được nhiều hơn bạn nghĩ.'
];
// XP được suy ra từ phiên học và việc đã hoàn thành, không lưu trùng.
const levelFor=xp=>Math.floor(Math.sqrt(Math.max(0,xp)/120))+1;
const threshold=level=>Math.round(120*(level-1)**2);
const todayMinutes=()=>store.get().sessions.filter(s=>s.date===localDate()).reduce((n,s)=>n+(Number(s.minutes)||0),0);
const weekMinutes=()=>{const date=new Date(),start=new Date(date.getFullYear(),date.getMonth(),date.getDate()-(date.getDay()+6)%7),key=localDate(start);return store.get().sessions.filter(s=>s.date>=key).reduce((n,s)=>n+(Number(s.minutes)||0),0)};
const allQuotes=()=>[...defaultQuotes.map((text,i)=>({id:`default-${i}`,text})),...store.get().rewards.quotes];
function quoteIndex(){const date=Number(localDate().replaceAll('-','')),quotes=allQuotes();return(date+(store.get().rewards.quoteIndex||0))%quotes.length}
function currentQuote(){return allQuotes()[quoteIndex()]}

const badges=[
  {icon:'✦',name:'Bước đầu',detail:'Hoàn thành 1 phiên',check:s=>s.sessions.length>=1},
  {icon:'◈',name:'Vào nhịp',detail:'Hoàn thành 5 phiên',check:s=>s.sessions.length>=5},
  {icon:'✿',name:'Bền bỉ',detail:'Học 10 giờ',check:s=>s.sessions.reduce((n,x)=>n+(x.minutes||0),0)>=600},
  {icon:'♢',name:'Chuỗi 7 ngày',detail:'Học 7 ngày liên tiếp',check:()=>studyStreak()>=7},
  {icon:'☑',name:'Người hoàn thành',detail:'Xong 25 việc học',check:s=>s.tasks.filter(t=>t.done).length>=25},
  {icon:'☀',name:'Đạt mục tiêu',detail:'Đạt mục tiêu ngày',check:s=>todayMinutes()>=s.profile.dailyGoal}
];

function plantSVG(){const total=store.get().sessions.reduce((n,s)=>n+(Number(s.minutes)||0),0),stage=Math.min(5,Math.floor(total/120)),last=store.get().sessions.map(s=>s.date).sort().at(-1),wilt=last&&(new Date(`${localDate()}T12:00:00`)-new Date(`${last}T12:00:00`))>3*86400000;const leaf=wilt?'#9b987e':'#9cc992',stem=wilt?'#827966':'#6d9a70';const leaves=Array.from({length:Math.max(2,stage*2+2)},(_,i)=>{const y=116-i*11,side=i%2?-1:1,x=90+side*(17+i*2);return `<ellipse cx="${x}" cy="${y}" rx="${10+stage}" ry="${5+stage/2}" transform="rotate(${side*28} ${x} ${y})" fill="${leaf}" opacity="${.72+i*.025}"/>`}).join('');return `<svg viewBox="0 0 180 180" role="img" aria-label="Cây học tập cấp ${stage+1}${wilt?', cần chăm sóc':''}"><ellipse cx="90" cy="157" rx="49" ry="8" fill="rgba(0,0,0,.13)"/><path d="M73 123h34l-6 34H79z" fill="#c99472"/><path d="M90 125 Q ${stage>2?76:86} 75 90 ${Math.max(30,112-stage*16)}" stroke="${stem}" stroke-width="5" fill="none" stroke-linecap="round"/>${leaves}${stage>=4?`<circle cx="97" cy="37" r="6" fill="#f0c4a0"/>`:''}</svg>`}

function renderBadges(){const state=store.get();$('#reward-badges').innerHTML=badges.map(b=>{const unlocked=b.check(state);return `<div class="badge ${unlocked?'':'locked'}" aria-label="${escapeHTML(b.name)}: ${unlocked?'đã mở khóa':'chưa mở khóa'}"><span class="badge-icon">${b.icon}</span><strong>${b.name}</strong><small>${b.detail}</small></div>`}).join('')}
function renderChallenges(){const day=localDate(),daily=store.get().sessions.filter(s=>s.date===day).length,goal=store.get().profile.dailyGoal,done=store.get().tasks.filter(t=>t.completedAt===day).length,challenges=[['Hoàn thành một phiên hôm nay',daily,1],['Đạt mục tiêu học trong ngày',todayMinutes(),goal],['Hoàn thành 3 việc học',done,3],['Học 5 giờ trong tuần',weekMinutes(),300]];$('#reward-challenges').innerHTML=challenges.map(([name,value,target])=>`<div class="challenge"><div><strong>${name}</strong><small>${Math.min(value,target)} / ${target}${target>=60?' phút':''}</small></div><div class="progress-track"><div style="width:${Math.min(100,value/target*100)}%"></div></div></div>`).join('')}
export function renderRewards(){const xp=studyXP(),level=levelFor(xp),start=threshold(level),next=threshold(level+1),progress=Math.max(0,Math.min(100,(xp-start)/(next-start)*100)),streak=studyStreak();$('#reward-level').textContent=`Cấp ${level} · ${streak} ngày học liên tiếp`;$('#reward-progress').style.width=`${progress}%`;$('#reward-xp').textContent=`${xp} XP · Còn ${next-xp} XP đến cấp ${level+1}`;$('#reward-plant').innerHTML=plantSVG();$('#reward-quote').textContent=currentQuote().text;$('#daily-quote').textContent=currentQuote().text;$('#home-insight').innerHTML=`<div class="insight-big">${streak}<small>ngày liên tiếp</small></div><p>${xp} XP · Cấp ${level}</p><div class="progress-track" style="margin:12px 0"><div style="width:${progress}%"></div></div><button class="text-button" id="open-rewards">Xem hành trình →</button>`;$('#open-rewards').onclick=()=>location.hash='rewards';renderBadges();renderChallenges()}

export function initGamification(){let previousLevel=levelFor(studyXP());renderRewards();$('#next-quote').onclick=()=>{store.update(s=>s.rewards.quoteIndex=(s.rewards.quoteIndex||0)+1,'rewards')};$('#add-quote').onclick=()=>{const text=prompt('Câu nói truyền cảm hứng của bạn:');if(!text?.trim())return;store.update(s=>{s.rewards.quotes.push({id:crypto.randomUUID?.()||String(Date.now()),text:text.trim().slice(0,300)});s.rewards.quoteIndex=allQuotes().length-1-Number(localDate().replaceAll('-',''))},'rewards');toast('Đã thêm câu nói.')};$('#edit-quote').onclick=()=>{const quote=currentQuote(),text=prompt('Sửa câu nói:',quote.text);if(!text?.trim())return;store.update(s=>{const custom=s.rewards.quotes.find(q=>q.id===quote.id);if(custom)custom.text=text.trim().slice(0,300);else{s.rewards.quotes.push({id:crypto.randomUUID?.()||String(Date.now()),text:text.trim().slice(0,300)});s.rewards.quoteIndex=defaultQuotes.length+s.rewards.quotes.length-1-Number(localDate().replaceAll('-',''))}},'rewards');toast('Đã sửa câu nói.')};bus.on('sessions',()=>{const level=levelFor(studyXP());if(level>previousLevel){toast(`Lên cấp ${level}! Bạn đang lớn lên cùng từng phiên học.`);confetti()}previousLevel=level;renderRewards()});bus.on('tasks',renderRewards);bus.on('rewards',renderRewards);bus.on('profile',renderRewards);bus.on('replace',()=>{previousLevel=levelFor(studyXP());renderRewards()})}
