const CACHE_NAME = "sima-shell-v5";
const ROOT = new URL("./", self.registration.scope);
const SHELL = ["", "index.html", "admin.html", "manifest.webmanifest", "sima-config.js", "brand-image.js", "assets/sima-brand.webp.b64", "assets/sima-mark.svg", "assets/covers/01-nile-pyramids.svg", "assets/covers/02-nubian-gate.svg", "assets/covers/03-nile-city.svg", "assets/covers/04-sabaloga.svg", "assets/covers/05-hashab.svg", "assets/covers/06-atbara-rail.svg", "assets/covers/07-geometric-textile.svg", "assets/covers/08-begrawiya.svg", "assets/covers/09-sudan-map.svg", "assets/covers/10-modern-sudan.svg"].map(p => new URL(p, ROOT).href);
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