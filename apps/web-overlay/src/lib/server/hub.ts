/**
 * 服务端直连中枢的取数封装 —— 只可在 Server Component / Route Handler 里用。
 *
 * 为什么不能复用 `lib/navhub-api.ts`：那个模块是浏览器侧的，`BASE = '/api/hub'`
 * 是相对路径，在 RSC 里 fetch 会抛 `Failed to parse URL`。
 *
 * 为什么不能走 `:3000/api/sites`：web 侧没有这个路由（实测 404），rewrites 只
 * 代理 `/api/auth/*`，`/api/hub/*` 走运行时 route 转发。服务端应当直接访问中枢。
 */
const HUB_BASE = (
  process.env.NAVHUB_STORAGE_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787'
).replace(/\/+$/, '')

/**
 * 失败一律返回 null，由调用方降级：sitemap / 页面元信息不该因为一次上游抖动
 * 把整站爬虫体验打穿。
 *
 * `revalidate <= 0` 表示**不加** `next.revalidate`（实时读）。Phase 6a 起
 * 爬虫面页面（/tags、/tags/[slug]、/sites、首页）显式传 60 走 Next Data
 * Cache——注意早期注释说的「带缓存会只剩 loading 骨架」是 loading.tsx
 * 时代的坑，两个 loading 已随 Batch B 删除，缓存与 SSR 直出不再冲突。
 * admin 系列继续用默认 0（后台要实时）。
 */
export async function hubGet<T>(path: string, revalidate = 0): Promise<T | null> {
  try {
    const init: RequestInit & { next?: { revalidate: number } } = {
      headers: { accept: 'application/json' },
    }
    if (revalidate > 0) init.next = { revalidate }
    const res = await fetch(`${HUB_BASE}${path}`, init)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** hubGetProbe 的三态结果：ok=取到数据；miss=API 确认不存在；failed=取数失败 */
export type HubProbe<T> = { status: 'ok'; data: T } | { status: 'miss' } | { status: 'failed' }

/**
 * 与 hubGet 同源，但把「API 确认不存在（HTTP 404）」与「取数失败」分开——
 * 软 404 消灭战需要这个区别：失败要降级渲染，确认不存在才 notFound()。
 * hubGet 把两者都折叠成 null，用它做存在性判定会把中枢抖动误伤成 404。
 *
 * 口径与 navhub-api 的 isNotFound 对齐（客户端侧早有同样的三分法）。
 */
export async function hubGetProbe<T>(path: string, revalidate = 0): Promise<HubProbe<T>> {
  try {
    const init: RequestInit & { next?: { revalidate: number } } = {
      headers: { accept: 'application/json' },
    }
    if (revalidate > 0) init.next = { revalidate }
    const res = await fetch(`${HUB_BASE}${path}`, init)
    if (res.status === 404) return { status: 'miss' }
    if (!res.ok) return { status: 'failed' }
    return { status: 'ok', data: (await res.json()) as T }
  } catch {
    return { status: 'failed' }
  }
}
