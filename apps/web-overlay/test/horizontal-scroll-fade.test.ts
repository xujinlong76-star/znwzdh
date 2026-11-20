/**
 * HorizontalScrollFade（横向滚动渐隐容器）测试。
 *
 * node 环境无 jsdom/RTL，行为层按 ask-page.test.ts 同款做法分两层：
 *  - 纯函数 computeScrollFadeMask 直接测四种边界组合；
 *  - 组件用 renderToString 验静态结构（滚动容器、遮罩初态、子内容透传）；
 *  - 滚动监听 / 滚轮接管 / 箭头滚动的接线用源码守卫（行为本身由
 *    Playwright 在真机 dev 服务器上实测，见 measure-header.cjs after 档）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'
import {
  computeScrollFadeMask,
  HorizontalScrollFade,
} from '../src/components/horizontal-scroll-fade'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

describe('computeScrollFadeMask：四种边界组合', () => {
  it('两侧都到底 → 无遮罩', () => {
    expect(computeScrollFadeMask(false, false)).toBe('none')
  })

  it('只能向右滚 → 只在右侧渐隐', () => {
    expect(computeScrollFadeMask(false, true)).toBe(
      'linear-gradient(to right, #000 0, #000 calc(100% - 32px), transparent 100%)',
    )
  })

  it('只能向左滚 → 只在左侧渐隐', () => {
    expect(computeScrollFadeMask(true, false)).toBe(
      'linear-gradient(to right, transparent 0, #000 32px, #000 100%)',
    )
  })

  it('两侧都能滚 → 两侧都渐隐', () => {
    expect(computeScrollFadeMask(true, true)).toBe(
      'linear-gradient(to right, transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%)',
    )
  })

  it('fadeWidth 可调，遮罩带宽跟随', () => {
    expect(computeScrollFadeMask(false, true, 48)).toContain('calc(100% - 48px)')
    expect(computeScrollFadeMask(true, true, 48)).toContain('#000 48px')
  })
})

describe('HorizontalScrollFade：静态结构（renderToString）', () => {
  it('渲染子内容，滚动容器带 overflow-x-auto + no-scrollbar', () => {
    const html = renderToString(
      React.createElement(
        HorizontalScrollFade,
        { ariaLabel: '测试条' },
        React.createElement('span', null, '胶囊一'),
        React.createElement('span', null, '胶囊二'),
      ),
    )
    expect(html).toContain('胶囊一')
    expect(html).toContain('胶囊二')
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('no-scrollbar')
    expect(html).toContain('aria-label="测试条"')
  })

  it('SSR 初态未量测 → 无 mask-image（客户端量测后才按需加遮罩）', () => {
    const html = renderToString(
      React.createElement(HorizontalScrollFade, {}, React.createElement('span', null, 'x')),
    )
    expect(html).not.toContain('mask-image')
  })

  it('SSR 初态未量测 → 箭头不渲染（客户端确认可滚后才出现，不闪一下）', () => {
    const html = renderToString(
      React.createElement(HorizontalScrollFade, {}, React.createElement('span', null, 'x')),
    )
    expect(html).not.toContain('向左滚动')
    expect(html).not.toContain('向右滚动')
  })

  it('showArrows=false 时源码不含箭头分支（细胶囊行只留渐隐 + 滚轮）', () => {
    const src = read('src/components/horizontal-scroll-fade.tsx')
    expect(src).toContain('showArrows = true')
    expect(src).toContain('showArrows && canScrollLeft')
    expect(src).toContain('showArrows && canScrollRight')
  })
})

describe('HorizontalScrollFade：接线源码守卫', () => {
  const src = read('src/components/horizontal-scroll-fade.tsx')

  it('滚动边界由 scroll + resize + ResizeObserver 三路复核', () => {
    expect(src).toContain("addEventListener('scroll', checkBounds")
    expect(src).toContain("addEventListener('resize', checkBounds")
    expect(src).toContain('new ResizeObserver(checkBounds)')
  })

  it('滚轮纵向转横向用非被动监听（否则 preventDefault 无效）', () => {
    expect(src).toContain("addEventListener('wheel', onWheel, { passive: false })")
    expect(src).toContain('el.scrollLeft += e.deltaY')
  })

  it('到头后放行滚轮（不吃掉页面滚动）', () => {
    expect(src).toContain('if (e.deltaY > 0 && !canRight) return')
    expect(src).toContain('if (e.deltaY < 0 && !canLeft) return')
  })

  it('箭头滚动尊重减速偏好（preferredScrollBehavior）', () => {
    expect(src).toContain('behavior: preferredScrollBehavior()')
  })

  it('遮罩走 mask-image + WebkitMaskImage（Safari 也要渐隐）', () => {
    expect(src).toContain('maskImage: mask')
    expect(src).toContain('WebkitMaskImage: mask')
  })

  it('ref 透传到滚动容器（调用方 ScrollSpy 仍能拿到容器）', () => {
    expect(src).toContain('forwardRef<HTMLDivElement, HorizontalScrollFadeProps>')
    expect(src).toContain('ref={setRefs}')
  })
})
