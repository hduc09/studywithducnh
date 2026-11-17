import {$,escapeHTML} from './utils.js';
import {store,exportData} from './store.js';
import {toggle,skip,addFive} from './timer.js';
import {openTaskForm} from './tasks.js';
import {openSubjectForm} from './subjects.js';
import {openSettings,themes} from './themes.js';
import {openDailyReview} from './planner.js';

let selectedIndex=0,shown=[];
const go=view=>location.hash=view;
const commands=()=>[
  ...[['home','Tổng quan','◈'],['tasks','Việc cần học','☷'],['subjects','Môn học','▦'],['stats','Thống kê','▤'],['audio','Âm thanh','♫'],['notes','Ghi chú','✎'],['planner','Kế hoạch','▦'],['rewards','Động lực','✧'],['community','Bạn bè & Squad','♧'],['rooms','Phòng học chung','◫']].map(([id,label,icon])=>({id:`go-${id}`,label:`Mở ${label}`,icon,group:'Điều hướng',run:()=>go(id)})),
  {id:'timer-toggle',label:'Bắt đầu / tạm dừng đồng hồ',icon:'◷',group:'Tập trung',run:toggle},
  {id:'timer-skip',label:'Bỏ qua phiên hiện tại',icon:'⏭',group:'Tập trung',run:skip},
  {id:'timer-add',label:'Thêm 5 phút',icon:'＋',group:'Tập trung',run:addFive},
  {id:'zen',label:'Mở chế độ Zen',icon:'⛶',group:'Tập trung',run:()=>$('#zen-trigger').click()},
  {id:'new-task',label:'Thêm việc học',icon:'☷',group:'Tạo mới',run:()=>openTaskForm()},
  {id:'new-subject',label:'Thêm môn học',icon:'▦',group:'Tạo mới',run:()=>openSubjectForm()},
  {id:'new-note',label:'Tạo ghi chú',icon:'✎',group:'Tạo mới',run:()=>{$('#new-note').click();go('notes')}},
  {id:'review',label:'Tổng kết hôm nay',icon:'✧',group:'Kế hoạch',run:openDailyReview},
  {id:'scratch',label:'Mở ghi chú nhanh',icon:'✎',group:'Tiện ích',run:()=>$('#scratch-trigger').click()},
  {id:'settings',label:'Mở cài đặt',icon:'⚙',group:'Tiện ích',run:()=>openSettings()},
  {id:'backup',label:'Xuất bản sao lưu JSON',icon:'⇩',group:'Tiện ích',run:exportData},
  {id:'create-room',label:'Tạo phòng học chung',icon:'◫',group:'Cộng đồng',run:()=>{go('rooms');$('#room-create-form input[name="name"]').focus()}},
  {id:'invite-friend',label:'Mời bạn học cùng',icon:'♧',group:'Cộng đồng',run:()=>{go('community');$('#friend-query').focus()}},
  {id:'language',label:'Đổi ngôn ngữ VI / EN',icon:'文',group:'Tiện ích',run:()=>$('#lang-trigger').click()},
  ...themes.map(theme=>({id:`theme-${theme.id}`,label:`Theme ${theme.name}`,icon:'◐',group:'Giao diện',run:()=>store.update(s=>s.settings.theme=theme.id,'settings')}))
];
const normalize=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
function matches(command,query){const hay=normalize(`${command.label} ${command.group}`),words=normalize(query).split(/\s+/).filter(Boolean);return words.every(word=>hay.includes(word))}
function render(){const query=$('#command-input').value.trim();shown=commands().filter(command=>matches(command,query)).slice(0,30);selectedIndex=Math.max(0,Math.min(selectedIndex,shown.length-1));$('#command-results').innerHTML=shown.length?shown.map((command,i)=>`<button class="command-option ${i===selectedIndex?'selected':''}" data-command-id="${command.id}" role="option" aria-selected="${i===selectedIndex}"><span class="command-icon">${command.icon}</span><span>${escapeHTML(command.label)}</span><small>${escapeHTML(command.group)}</small></button>`).join(''):'<div class="empty-state"><strong>Không tìm thấy lệnh</strong>Thử từ khóa khác nhé.</div>'}
function close(){if($('#command-dialog').open)$('#command-dialog').close()}
export function openPalette(){const dialog=$('#command-dialog');if(dialog.open){close();return}selectedIndex=0;$('#command-input').value='';render();dialog.showModal();$('#command-input').focus()}
function execute(id){const command=commands().find(item=>item.id===id);if(!command)return;close();command.run()}
export function openShortcuts(){const rows=[['Ctrl / Cmd + K','Bảng lệnh'],['Space','Bắt đầu hoặc tạm dừng đồng hồ'],['?','Bảng phím tắt'],['F','Toàn màn hình khi ở Zen'],['Esc','Thoát Zen hoặc đóng bảng lệnh'],['↑ / ↓ / Enter','Chọn và chạy lệnh']];$('#shortcut-list').innerHTML=rows.map(([key,label])=>`<div><span>${label}</span><kbd>${key}</kbd></div>`).join('');$('#shortcuts-dialog').showModal()}
export function initCommands(){$('#palette-trigger').onclick=openPalette;$('#command-input').oninput=()=>{selectedIndex=0;render()};$('#command-results').onclick=e=>{const id=e.target.closest('[data-command-id]')?.dataset.commandId;if(id)execute(id)};$('#shortcuts-close').onclick=()=>$('#shortcuts-dialog').close();document.addEventListener('keydown',e=>{const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable;if((e.ctrlKey||e.metaKey)&&e.key.toLocaleLowerCase()==='k'){e.preventDefault();e.stopImmediatePropagation();openPalette();return}if($('#command-dialog').open){if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopImmediatePropagation();selectedIndex=(selectedIndex+(e.key==='ArrowDown'?1:-1)+shown.length)%Math.max(1,shown.length);render();$('#command-results .selected')?.scrollIntoView({block:'nearest'})}else if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();if(shown[selectedIndex])execute(shown[selectedIndex].id)}return}if(e.key==='?'&&!typing&&!$('#shortcuts-dialog').open){e.preventDefault();e.stopImmediatePropagation();openShortcuts()}},true)}
