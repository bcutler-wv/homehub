const CACHE_NAME = 'home-hub-v3';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and browser-extension requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Leave cross-origin requests to the browser. Re-issuing them here puts them
  // under this worker's own CSP connect-src rather than the page's img-src, so
  // a third-party product image would be blocked, throw, and fall through to
  // the HTML fallback below — the <img> receives index.html and shows nothing.
  // The browser handles them correctly, and we have no reason to cache them.
  if (url.origin !== self.location.origin) return;

  // Network-first for API calls — never serve stale data
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Stale-while-revalidate for JS/CSS bundles (hashed filenames — safe to cache long)
  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // Cache-first for images and icons
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico|gif)$/)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Network-first with cache fallback for everything else (HTML navigation, etc.)
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        // cache.match() returns a Promise, which is always truthy — the old
        // `a || b` here never reached the fallback and resolved to undefined.
        const cached = await cache.match(request);
        if (cached) return cached;
        // Only a navigation may fall back to the shell; handing index.html to
        // an image or asset request is what made a failed fetch look like a
        // broken picture rather than a missing file.
        if (request.mode === 'navigate') {
          const shell = await cache.match('/index.html');
          if (shell) return shell;
        }
        return Response.error();
      }
    })
  );
});
