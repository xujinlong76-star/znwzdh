/**
 * NavHub Service Worker。
 *
 * 缓存策略（按请求类型分流）：
 *  - 导航请求（HTML）：network-first，失败回退缓存首页 —— 离线时仍是可用的导航壳
 *  - /api/*（含 /api/hub/*）：network-only —— 数据必须新鲜，失败由前端降级提示承接
 *  - 静态资源（_next/static、icons、fonts、图片）：stale-while-revalidate
 *
 * 版本号：改 SW 行为时 bump CACHE 版本，activate 会清理旧缓存。
 */

const CACHE = 'navhub-v2'
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
      // 单个资源失败不阻塞安装，但必须可见：静默吞掉曾让"PWA 已接入"的验收结论失真
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

  // 数据请求不走缓存
  if (url.pathname.startsWith('/api/')) return

  // 导航请求：network-first + 离线回退首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    )
    return
  }

  // 静态资源：stale-while-revalidate
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
})
