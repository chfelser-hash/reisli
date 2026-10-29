// Service Worker: macht Reisli installierbar und offline nutzbar (Unterwegs-Modus).
// - Oberfläche: wird beim Installieren vollständig vorgeladen; danach zuerst Netzwerk (immer aktuelle Version),
//   bei Ausfall oder langsamer Verbindung (> 4 s) aus dem Cache.
// - Belege (/api/files/…): einmal geladen, kommen sie aus dem Cache – sie ändern sich nie.
// - Alle anderen API-Aufrufe gehen immer ans Netz; den Offline-Datenstand verwaltet die App selbst (IndexedDB).
const SHELL = 'reisli-shell-__VERSION__'; // setzt der Server (Version aus package.json)
const FILES = 'reisli-files';
const ASSETS = [
  '/', '/index.html', '/styles.css', '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/js/app.js', '/js/calc.js', '/js/ui.js', '/js/idb.js', '/js/booking-parse.js',
  '/js/views/auswertung.js', '/js/views/dokumente.js', '/js/views/erfassen.js', '/js/views/heute.js', '/js/views/importbuchung.js', '/js/views/item.js', '/js/views/kasse.js', '/js/views/mehr.js',
  '/js/views/newtrip.js', '/js/views/offen.js', '/js/views/packliste.js', '/js/views/plan.js', '/js/views/rechner.js', '/js/views/reise.js', '/js/views/shared.js', '/js/views/timeline.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function networkFirst(req) {
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('/index.html') : null));
    const timer = setTimeout(() => fallback().then((r) => { if (r && !done) { done = true; resolve(r); } }), 4000);
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        clearTimeout(timer);
        if (!done) { done = true; resolve(res); }
      })
      .catch(() => {
        clearTimeout(timer);
        fallback().then((r) => { if (!done) { done = true; resolve(r || Response.error()); } });
      });
  });
}

async function fileCacheFirst(req) {
  const c = await caches.open(FILES);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && !new URL(req.url).searchParams.has('download')) c.put(req, res.clone());
  return res;
}

/** Android «Teilen → Reisli»: Inhalt ablegen, dann die App mit dem Import-Dialog öffnen */
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const c = await caches.open('reisli-share');
    const files = form.getAll('file').filter((f) => f && typeof f === 'object' && f.size);
    for (const [i, f] of files.entries()) await c.put('/shared/file' + i, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
    const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: files.map((f) => ({ name: f.name, type: f.type })) };
    await c.put('/shared/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* dann eben leer */ }
  return Response.redirect('/#import', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname === '/share') return e.respondWith(receiveShare(e.request));
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/files/')) return e.respondWith(fileCacheFirst(e.request));
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(networkFirst(e.request));
});
