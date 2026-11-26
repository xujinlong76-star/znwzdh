/**
 * U-92 插件徽章回落改动态计数（测试先行）。
 *
 * 契约：
 *  - 已装 > 0 →「N 已安装」，且不发 fetchPlugins 请求；
 *  - 否则 fetchPlugins({ limit: 1 }).total →「N 款生态」，total 变化跟随；
 *  - 失败或 total <= 0 → 中性「插件生态」，不回落 77、不显示 0；
 *  - 首漆中性文案（SSR 只出默认徽章），hydration 后 effect 取数；
 *  - 全仓无「77 款生态」残留；不动 /api/me 契约。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：effect 行为用可导出的纯函数
 * `loadPluginCatalogBadge` / `resolvePluginBadge` 锁定（把 fetch 逻辑
 * 抽成以 fetcher 为参数的纯 async 函数），首漆用 renderToString 断言，
 * 接线用源码守卫锁定；浏览器内 effect 真跑通由 E2E 覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  EntryGroups,
  loadPluginCatalogBadge,
  resolvePluginBadge,
} from '../src/components/user-center/dashboard/entry-groups'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const readSrc = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  }
})

// EntryGroups 只从 navhub-api 取 fetchPlugins：桩掉，避免拉起整条 hub 客户端。
vi.mock('@/lib/navhub-api', () => ({
  fetchPlugins: vi.fn(async () => ({ items: [], total: 0, limit: 1, offset: 0 })),
}))

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock，这里统一清掉。
afterAll(() => {
  vi.resetModules()
})

/** 可数调用的 fetch 桩：total 可配，记录每次入参。 */
function stubFetch(total: number) {
  const calls: Array<{ limit: number }> = []
  const fn = async (params: { limit: number }) => {
    calls.push(params)
    return { total }
  }
  return { fn, calls }
}

function rejectingFetch() {
  const calls: Array<{ limit: number }> = []
  const fn = async (params: { limit: number }): Promise<{ total: number }> => {
    calls.push(params)
    throw new Error('network down')
  }
  return { fn, calls }
}

describe('U-92 插件徽章：动态计数', () => {
  it('total=42 显示「42 款生态」，且只取 limit:1', async () => {
    const { fn, calls } = stubFetch(42)
    await expect(loadPluginCatalogBadge(fn, undefined)).resolves.toBe('42 款生态')
    expect(calls).toEqual([{ limit: 1 }])
    expect(resolvePluginBadge(undefined, 42)).toBe('42 款生态')
  })

  it('total 变化跟随：42 → 128 各自显示对应数字', async () => {
    const first = stubFetch(42)
    const second = stubFetch(128)
    await expect(loadPluginCatalogBadge(first.fn, undefined)).resolves.toBe('42 款生态')
    await expect(loadPluginCatalogBadge(second.fn, undefined)).resolves.toBe('128 款生态')
    expect(resolvePluginBadge(undefined, 128)).toBe('128 款生态')
  })

  it('已装>0 显示「N 已安装」且不调 fetchPlugins', async () => {
    const { fn, calls } = stubFetch(42)
    await expect(loadPluginCatalogBadge(fn, 5)).resolves.toBe('5 已安装')
    expect(calls).toEqual([])
    // 已装优先于目录总数：哪怕 total 更大也不改口径。
    expect(resolvePluginBadge(5, 42)).toBe('5 已安装')
    expect(resolvePluginBadge(1, 42)).toBe('1 已安装')
  })

  it('失败或 total<=0 显示中性「插件生态」，不回落 77、不显示 0', async () => {
    const failing = rejectingFetch()
    await expect(loadPluginCatalogBadge(failing.fn, undefined)).resolves.toBe('插件生态')
    expect(failing.calls).toEqual([{ limit: 1 }])
    const empty = stubFetch(0)
    await expect(loadPluginCatalogBadge(empty.fn, undefined)).resolves.toBe('插件生态')
    expect(resolvePluginBadge(undefined, 0)).toBe('插件生态')
    expect(resolvePluginBadge(undefined, null)).toBe('插件生态')
    expect(resolvePluginBadge(undefined, undefined)).toBe('插件生态')
  })

  it('首漆中性：SSR 只出「插件生态」，不含「77 款生态」', () => {
    const html = renderToString(createElement(EntryGroups, {}))
    expect(html).toContain('插件生态')
    expect(html).not.toContain('77 款生态')
    expect(html).not.toContain('0 款生态')
  })

  it('U-432：SSR 即含 /me/sites「我的站点」入口（内容组第 5 项）', () => {
    const html = renderToString(createElement(EntryGroups, {}))
    expect(html).toContain('/me/sites')
    expect(html).toContain('我的站点')
  })

  it('源码守卫：无「77 款生态」，接线走 fetchPlugins({ limit: 1 }) 且已装跳过取数', () => {
    const src = readSrc('components/user-center/dashboard/entry-groups.tsx')
    expect(src).not.toContain('77 款生态')
    expect(src).toContain('fetchPlugins')
    expect(src).toContain('limit: 1')
    expect(src).toContain('loadPluginCatalogBadge(fetchPlugins')
    expect(src).toContain('插件生态')
  })
})
