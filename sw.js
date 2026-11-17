const CACHE='studywithducnh-v2';
const CORE=[
  './','./index.html','./manifest.json',
  './css/base.css','./css/themes.css','./css/components.css','./css/animations.css','./css/stage2.css','./css/stage3.css',
  './js/main.js','./js/store.js','./js/migration.js','./js/utils.js','./js/i18n.js','./js/themes.js',
  './js/timer.js','./js/tasks.js','./js/subjects.js','./js/stats.js','./js/audio.js','./js/notes.js',
  './js/planner.js','./js/gamification.js','./js/commands.js','./js/utility.js',
  './js/config.js','./js/cloud.js','./js/account.js','./js/sync.js','./js/localdb.js','./js/sync-model.js',
  './assets/icons/icon.svg','./assets/icons/icon-192.png','./assets/icons/icon-512.png',
  './assets/icons/icon-maskable.svg','./assets/icons/icon-maskable-192.png','./assets/icons/icon-maskable-512.png',
  './assets/avatars/moon.svg','./assets/avatars/sun.svg','./assets/avatars/leaf.svg',
  './assets/avatars/star.svg','./assets/avatars/wave.svg','./assets/avatars/book.svg'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith('studywithducnh-')&&key!==CACHE).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy));
      }
      return response
    }).catch(async()=>await caches.match(request)||await caches.match('./index.html')));
    return
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok){
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(request,copy));
    }
    return response
  })));
});
