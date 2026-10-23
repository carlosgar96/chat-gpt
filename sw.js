const CACHE='autoeditor-iphone-pwa-v4-20261023';
const ASSETS=['./','./index.html','./manifest.webmanifest','./assets/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const req=e.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 if(req.mode==='navigate'){
   e.respondWith(fetch(req).then(res=>{
     if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
     return res;
   }).catch(()=>caches.match(req).then(saved=>saved||caches.match('./index.html'))));
   return;
 }
 e.respondWith(caches.match(req).then(saved=>saved||fetch(req).then(res=>{
   if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
   return res;
 })));
});
