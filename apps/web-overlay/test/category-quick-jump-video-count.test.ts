/**
 * U-416 移动端「精选视频」徽章：实时总数，不许手写约数。
 *
 * 契约：
 *  - 徽章数字来自 `GET /api/videos?limit=1` 的 `X-Total-Items` 响应头
 *   （与服务端 countItems 同口径）；取不到 / 非正数 → 不渲染徽章，
 *    绝不回落任何手写数字；
 *  - 旧徽章硬编码 "6k+"，实际库只有 2265 条——全仓无 "6k+" 残留；
 *  - 格式是精确千分位（2265 → "2,265"），不用 "2.2k+" 这类约数；
 *  - 仓库 vitest 是 node 环境、无 jsdom：effect 行为用可导出的纯函数
 *    `loadVideoTotalCount` / `formatVideoCount` 锁定，首漆用 renderToString
 *    断言（videoCount prop 直通），接线用源码守卫锁定；浏览器内 effect
 *    真跑通由 dev 实测覆盖。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  CategoryQuickJumpBar,
  formatVideoCount,
  loadVideoTotalCount,
} from '../src/components/category-quick-jump-bar'

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

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock，这里统一清掉。
afterAll(() => {
  vi.resetModules()
})

function stubFetch(total: string | null) {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    return { headers: { get: (name: string) => (name === 'X-Total-Items' ? total : null) } }
  }
  return { fn, calls }
}

describe('U-416 精选视频徽章：实时总数', () => {
  it('formatVideoCount：精确千分位，不约数', () => {
    expect(formatVideoCount(2265)).toBe('2,265')
    expect(formatVideoCount(999)).toBe('999')
    expect(formatVideoCount(12345)).toBe('12,345')
  })

  it('loadVideoTotalCount：读 X-Total-Items，只取 limit:1', async () => {
    const { fn, calls } = stubFetch('2265')
    await expect(loadVideoTotalCount(fn)).resolves.toBe(2265)
    expect(calls).toEqual(['/api/videos?limit=1'])
  })

  it('总数变化跟随：2265 → 3000 各自显示对应数字', async () => {
    await expect(loadVideoTotalCount(stubFetch('2265').fn)).resolves.toBe(2265)
    await expect(loadVideoTotalCount(stubFetch('3000').fn)).resolves.toBe(3000)
  })

  it('取不到 / 非正数 / 非数字 → null，不回落手写数字', async () => {
    await expect(loadVideoTotalCount(stubFetch(null).fn)).resolves.toBeNull()
    await expect(loadVideoTotalCount(stubFetch('0').fn)).resolves.toBeNull()
    await expect(loadVideoTotalCount(stubFetch('-5').fn)).resolves.toBeNull()
    await expect(loadVideoTotalCount(stubFetch('n/a').fn)).resolves.toBeNull()
    const failing = async () => {
      throw new Error('network down')
    }
    await expect(loadVideoTotalCount(failing)).resolves.toBeNull()
  })

  it('首漆：videoCount=2265 渲染「2,265」，不含「6k+」', () => {
    const html = renderToString(
      createElement(CategoryQuickJumpBar, {
        categories: [{ id: 'cat-1', title: '分类一', count: 3 }],
        videoCount: 2265,
      }),
    )
    expect(html).toContain('精选视频')
    expect(html).toContain('2,265')
    expect(html).not.toContain('6k+')
  })

  it('首漆：未传 videoCount 时不渲染任何数字徽章（不编数）', () => {
    const html = renderToString(
      createElement(CategoryQuickJumpBar, {
        categories: [{ id: 'cat-1', title: '分类一', count: 3 }],
      }),
    )
    expect(html).toContain('精选视频')
    expect(html).not.toContain('6k+')
    expect(html).not.toContain('2,265')
  })

  it('源码守卫：无「6k+」，接线走 /api/videos?limit=1 + X-Total-Items', () => {
    const src = readSrc('components/category-quick-jump-bar.tsx')
    expect(src).not.toContain('6k+')
    expect(src).toContain('/api/videos?limit=1')
    expect(src).toContain('X-Total-Items')
    expect(src).toContain('loadVideoTotalCount')
    expect(src).toContain('formatVideoCount')
  })
})
