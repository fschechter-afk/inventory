/* Service worker: app-shell caching + offline support.
   Paths are relative so the app works when hosted under a sub-path
   (e.g. GitHub Pages project sites). Two shells share this worker: the
   inventory app at ./ and the ordering portal at ./portal/. */
const CACHE = 'dorm-inventory-v2'
const SHELL = './'
const PORTAL_SHELL = './portal/'

const PORTAL_PATH = new URL(PORTAL_SHELL, self.location.href).pathname

/** Which cached page answers a navigation to this URL. */
function shellFor(url) {
  return url.pathname.startsWith(PORTAL_PATH) ? PORTAL_SHELL : SHELL
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([
        SHELL,
        './manifest.webmanifest',
        './icon.svg',
        './icon-maskable.svg',
        PORTAL_SHELL,
        './portal/manifest.webmanifest',
        './portal/icon.svg',
        './portal/icon-maskable.svg',
      ])
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
    const shell = shellFor(url)
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(shell, copy))
          }
          return res
        })
        .catch(() => caches.match(shell))
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
