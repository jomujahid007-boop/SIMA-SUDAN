const CACHE_NAME = "sima-shell-v11";
const ROOT = new URL("./", self.registration.scope);
const SHELL = ["", "index.html", "admin.html", "manifest.webmanifest", "sima-config.js", "assets/sima-mark.svg", "photo-credits.html"].map(p => new URL(p, ROOT).href);
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("sima-shell-") && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(ROOT.href)) return;
  if (requestIsApi(url)) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(res => { if (res.ok) caches.open(CACHE_NAME).then(c => c.put(req, res.clone())); return res; }).catch(() => caches.match(req).then(hit => hit || caches.match(new URL("index.html", ROOT).href))));
    return;
  }
  if (!SHELL.includes(url.href)) return;
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) caches.open(CACHE_NAME).then(c => c.put(req, res.clone())); return res; })));
});
function requestIsApi(url) { return url.hostname.endsWith("supabase.co") || url.pathname.includes("/rest/v1/") || url.pathname.includes("/auth/v1/"); }