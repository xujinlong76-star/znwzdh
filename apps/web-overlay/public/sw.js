/**
 * NavHub Service Worker。
 *
 * 开发环境与本地回环保护：
 *  如果在 localhost 或 127.0.0.1 下运行，立即自毁并清空缓存，绝不干扰开发与热重载。
 */
if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
  self.addEventListener('install', () => {
    self.skipWaiting()
  })
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
    )
  })
  // 本地开发直接放行，不做任何 fetch 拦截
} else {
  const CACHE = 'navhub-v3'
  const SHELL = [
    '/',
    '/favorites',
    '/algorithms',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/manifest.webmanifest'
  ]

  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE)
        .then((cache) => cache.addAll(SHELL))
        .then(() => self.skipWaiting())
        .catch((err) => console.warn('[sw] 预缓存失败：', err))
    )
  })

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim())
    )
  })

  self.addEventListener('fetch', (event) => {
    const req = event.request
    if (req.method !== 'GET') return
    const url = new URL(req.url)
    if (url.origin !== self.location.origin) return

    // 1. 数据接口与 Next.js RSC 路由载荷：完全直通网络，绝不缓存
    if (url.pathname.startsWith('/api/') || url.searchParams.has('_rsc') || req.headers.get('RSC') === '1') {
      return
    }

    // 2. 导航请求（页面切换）：network-first + 离线回退首页
    if (req.mode === 'navigate') {
      event.respondWith(
        fetch(req)
          .then((res) => {
            // 只缓存 200 成功页，避免把 dev 重建期的 404/500 钉进缓存
            if (res && res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
            }
            return res
          })
          .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
      )
      return
    }

    // 3. 静态构建产物（_next/static、图片、字体）：stale-while-revalidate
    if (
      url.pathname.startsWith('/_next/static/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.startsWith('/fonts/') ||
      url.pathname.startsWith('/assets/')
    ) {
      event.respondWith(
        caches.match(req).then((hit) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.status === 200) {
                const copy = res.clone()
                caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
              }
              return res
            })
            .catch(() => hit)
          return hit || network
        })
      )
    }
  })
}
