/* Service worker: app-shell caching + offline support.
   Paths are relative so the app works when hosted under a sub-path
   (e.g. GitHub Pages project sites). Separate cache name from the
   inventory app's service worker — these are two independent apps. */
const CACHE = 'dorm-spending-v1'
const SHELL = './'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([SHELL, './manifest.webmanifest', './icon.svg', './icon-maskable.svg'])
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Navigations: network first so updates land, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
          }
          return res
        })
        .catch(() => caches.match(SHELL))
    )
    return
  }

  // Hashed build assets: cache first (immutable filenames).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(req, copy))
          }
          return res
        })
    )
  )
})
