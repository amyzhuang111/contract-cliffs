// Offline shell so the page works without a network. Same-origin GETs only; /api is always network (never cached).
const V = 'cc-v8';
const SHELL = ['/', '/index.html', '/app.js', '/extract.js', '/features.js', '/portfolio.js', '/styles.css', '/data/edgar.json', '/vendor/pdf.min.js', '/vendor/pdf.worker.min.js', '/vendor/mammoth.browser.min.js', '/fonts/Geist-Variable.woff2', '/fonts/GeistMono-Variable.woff2', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const key = u.pathname === '/' ? '/index.html' : u.pathname;
  // network first so new deploys show up; cache when offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(ca => ca.put(key, c)); } return r; }).catch(() => caches.match(key, { ignoreSearch: true })));
});
