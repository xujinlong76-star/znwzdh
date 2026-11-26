/**
 * 中枢写操作之后的 Data Cache 失效 —— 读侧打标、写侧按标签失效。
 *
 * 要防的具体场景：公开收录页用 `hubGet(..., 60)` 走 Data Cache；用户在后台删了一个
 * 站点/通过审核后，页面最多还会按 revalidate 窗口继续展示旧数据 60 秒。
 * 失效必须在**写成功**时发生，且失败不能倒过来把已经成功的写报成 502。
 *
 * route.ts 是 Next 路由处理器（串着 auth/身份/签名），根 vitest 跑在 node 环境里
 * 起不了真 Next server，所以接线部分按本仓库既有做法钉「结构 + 顺序」；
 * 取数打过什么标签、谓词怎么判，则是可执行的行为断言。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** overlay 是事实源；apps/web 下那份是镜像，两边都可能跑这份测试 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return hit
}

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

async function loadHub() {
  vi.resetModules()
  return import('@/lib/server/hub')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('取数侧：带 revalidate 的取数必须打上中枢缓存标签', () => {
  it('revalidate>0 时 next 同时带 revalidate 与 tags', async () => {
    const inits: RequestInit[] = []
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
      inits.push(init ?? {})
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) } as Response
    })
    const { hubGet } = await loadHub()
    await hubGet('/api/sites', 60)
    expect((inits[0] as { next?: { revalidate: number; tags: string[] } }).next).toEqual({
      revalidate: 60,
      tags: ['navhub-hub'],
    })
  })

  it('revalidate=0（实时读）不打 next：本来就不进 Data Cache', async () => {
    const inits: RequestInit[] = []
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
      inits.push(init ?? {})
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) } as Response
    })
    const { hubGet } = await loadHub()
    await hubGet('/api/sites')
    expect((inits[0] as { next?: unknown }).next).toBeUndefined()
  })
})

describe('shouldInvalidateAfter：什么时候失效', () => {
  it('GET/HEAD 永不失效（读请求不改缓存状态）', async () => {
    const { shouldInvalidateAfter } = await import('@/lib/server/hub-cache')
    expect(shouldInvalidateAfter('GET', 200)).toBe(false)
    expect(shouldInvalidateAfter('head', 204)).toBe(false)
  })

  it('写方法 2xx 才失效（大小写不敏感）', async () => {
    const { shouldInvalidateAfter } = await import('@/lib/server/hub-cache')
    for (const m of ['POST', 'put', 'PATCH', 'delete']) {
      expect(shouldInvalidateAfter(m, 200), m).toBe(true)
      expect(shouldInvalidateAfter(m, 201), m).toBe(true)
      expect(shouldInvalidateAfter(m, 204), m).toBe(true)
    }
  })

  it('写失败不失效：中枢抖动时清空缓存会让下一次访问直面不健康的上游', async () => {
    const { shouldInvalidateAfter } = await import('@/lib/server/hub-cache')
    for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503, 504]) {
      expect(shouldInvalidateAfter('POST', status), String(status)).toBe(false)
    }
  })
})

describe('写侧接线（route.ts 结构 + 顺序）', () => {
  const ROUTE = codeOnly(readFileSync(overlayFile('src/app/api/hub/[...path]/route.ts'), 'utf8'))

  it('失效判在上游 fetch 之后，且用同一份标签常量', () => {
    const atFetch = ROUTE.indexOf('await fetch(target')
    const atInvalidate = ROUTE.indexOf('revalidateTag(HUB_CACHE_TAG')
    expect(atFetch).toBeGreaterThan(-1)
    expect(atInvalidate).toBeGreaterThan(atFetch)
    expect(ROUTE).toMatch(/shouldInvalidateAfter\(method,\s*upstream\.status\)/)
    expect(ROUTE).toContain("from '@/lib/server/hub-cache'")
    // 手写标签字符串就会和取数侧漂移：必须只在 hub-cache.ts 里出现一次
    expect(ROUTE).not.toContain("'navhub-hub'")
    expect(ROUTE).not.toContain('"navhub-hub"')
  })

  it('失效失败在自己的 try/catch 里：外层 catch 会把异常写成 502/504', () => {
    const start = ROUTE.indexOf('if (shouldInvalidateAfter')
    expect(start).toBeGreaterThan(-1)
    const block = ROUTE.slice(start, start + 700)
    expect(block).toContain('try {')
    expect(block).toContain('revalidateTag(HUB_CACHE_TAG, \'max\')')
    expect(block).toContain('catch')
    expect(block).toContain('console.warn')
  })

  it('取数侧也导入同一常量（跨文件一致性）', () => {
    const hub = codeOnly(readFileSync(overlayFile('src/lib/server/hub.ts'), 'utf8'))
    expect(hub).toContain("from '@/lib/server/hub-cache'")
    expect(hub).toMatch(/tags:\s*\[\s*HUB_CACHE_TAG\s*\]/)
  })
})
