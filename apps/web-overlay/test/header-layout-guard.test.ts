/**
 * 顶栏布局守卫（header-scroll-refactor-1222）：
 * 1024px–1366px 档搜索框 / AI 找站 / Ctrl+K 徽章 /「今日 N 项」文字重叠的回归守卫。
 *
 * 根因（2026-11-20 Playwright 实测）：SearchPalette 根节点
 * `lg:min-w-[420px]` 在 1024px 档把搜索框顶出只有 136px 宽的父容器，
 * 溢出的搜索框盖住「AI 找站」按钮与「今日」按钮，框内 absolute 的
 * Ctrl+K 徽章又与「今日」按钮叠在一起。修复后三档视口边界框重叠为 0
 *（measure-header.cjs after 档），本文件把布局类名锁死，防回退。
 *
 * 订正（2026-11-20 复核阻塞项 ②）：1280px 档输入框仅 18px，kbd 徽章与
 *「今日」文字标签的显示断点由 xl 延后到 2xl（<1536px 隐藏），本文件两处
 * 断言随新行为改写。
 *
 * 按 ask-page.test.ts 同款做法用源码守卫（node 环境无 jsdom/RTL）；
 * 真实重叠检测由 Playwright 在 dev 服务器上做，不在这里重复测。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

function windowAround(src: string, needle: string, before = 800, after = 400): string {
  const i = src.indexOf(needle)
  expect(i, `源码中找不到锚点：${needle}`).toBeGreaterThanOrEqual(0)
  return src.slice(Math.max(0, i - before), i + after)
}

describe('navigation-toolbar：顶栏 Flex 布局', () => {
  const src = read('src/components/navigation-toolbar.tsx')

  it('搜索容器 flex-1 min-w-[260px] max-w-[560px]（可缩、不顶出）', () => {
    expect(src).toContain('flex flex-1 min-w-[260px] max-w-[560px] items-center gap-1.5')
    expect(src).not.toContain('max-w-md sm:max-w-xl')
  })

  it('顶栏行 gap-3（不再用 gap-1.5 挤两组）', () => {
    expect(src).toContain('justify-between gap-3 md:h-14 md:flex-nowrap')
  })

  it('右侧工具组 shrink-0 flex items-center gap-1.5（不再 basis-full + overflow-hidden 裁剪）', () => {
    expect(src).toContain('shrink-0 flex items-center gap-1.5')
    expect(src).not.toContain('basis-full max-w-none md:basis-auto overflow-hidden')
  })

  // 订正（2026-11-20 复核阻塞项 ②）：1280px 档文字标签 49px 会把搜索容器压窄、
  // 输入框只剩 18px，xl 改 2xl，<1536px 只留图标；Tooltip 与红点徽章不受影响。
  it('「今日」按钮 <1536px 只留图标：按钮 2xl:w-auto、文字标签 hidden 2xl:inline', () => {
    const btn = windowAround(src, 'aria-label="打开今日中心小窗"', 800, 1500)
    expect(btn).toContain('2xl:w-auto')
    expect(btn).not.toContain('sm:w-auto')
    expect(btn).toContain('hidden whitespace-nowrap')
    expect(btn).toContain('2xl:inline')
  })

  it('「今日」按钮保留 title Tooltip 与红点徽章（只藏文字，不丢入口）', () => {
    const btn = windowAround(src, 'aria-label="打开今日中心小窗"', 800, 1500)
    expect(btn).toContain("title={todayBadge?.countdownLabel")
    expect(btn).toContain('hasTodayAlert')
    expect(btn).toContain('rounded-full bg-amber-500')
  })
})

describe('search-palette：搜索框 Flex 内布局', () => {
  const src = read('src/components/search-palette.tsx')

  it('根节点去掉 sm:min-w-[380px] / lg:min-w-[420px]（不再顶出父容器）', () => {
    expect(src).toContain('relative w-full max-w-2xl min-w-0 mx-auto')
    expect(src).not.toContain('sm:min-w-[380px]')
    expect(src).not.toContain('lg:min-w-[420px]')
  })

  it('输入框为 flex-1 min-w-0（外层做边框样式，input 本身无边框）', () => {
    expect(src).toContain('className="h-9.5 min-w-0 flex-1 border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0')
  })

  it('右侧操作区不再用裸 absolute 定位（无 absolute right-2 簇、无固定右 padding）', () => {
    expect(src).not.toContain('absolute right-2 top-1/2 flex items-center gap-1.5')
    expect(src).not.toContain('pr-26 sm:pr-44 md:pr-48')
    expect(src).toContain('<div className="flex shrink-0 items-center gap-1.5">')
  })

  it('外层容器承接焦点环（focus-within:ring-2），输入框聚焦仍有可见焦点态', () => {
    expect(src).toContain('focus-within:ring-2')
    expect(src).toContain('focus-within:border-primary/50')
  })

  // 订正（2026-11-20 复核阻塞项 ②）：1280px 档徽章 91px 会把输入框压到只剩
  // 18px，xl 改 2xl，<1536px 隐藏；触屏降噪（pointer-coarse:hidden）本身不丢。
  it('Ctrl+K 徽章 <1536px 隐藏（2xl:flex），窄档不再顶出输入框', () => {
    const kbd = windowAround(src, '呼出超级搜索', 1200, 200)
    expect(kbd).toContain('2xl:flex 2xl:pointer-coarse:hidden')
    expect(kbd).not.toContain('sm:flex sm:pointer-coarse:hidden')
  })
})

describe('横向胶囊条：统一走 HorizontalScrollFade', () => {
  it('极速置顶栏、二级分类栏、快捷专题条、分类筛选行都接入统一组件', () => {
    for (const f of [
      'src/components/home-quick-dock.tsx',
      'src/components/category-quick-jump-bar.tsx',
      'src/components/home-micro-strip.tsx',
      'src/components/category-site-filter-bar.tsx',
    ]) {
      const s = read(f)
      expect(s, f).toContain("from '@/components/horizontal-scroll-fade'")
      expect(s, f).toContain('<HorizontalScrollFade')
      expect(s, f).toContain('</HorizontalScrollFade>')
    }
  })

  it('二级分类栏不再手写边界状态、箭头与渐变 div（统一组件负责）', () => {
    const s = read('src/components/category-quick-jump-bar.tsx')
    expect(s).not.toContain('canScrollLeft')
    expect(s).not.toContain('canScrollRight')
    expect(s).not.toContain('bg-gradient-to-r from-background')
    expect(s).not.toContain('bg-gradient-to-l from-background')
    expect(s).not.toContain('scrollHorizontally')
    // ScrollSpy 仍保留：ref 透传给统一组件，激活 Pill 照常滚回可视区
    expect(s).toContain('ref={scrollContainerRef}')
    expect(s).toContain('<HorizontalScrollFade')
  })

  it('极速置顶栏不再裸 overflow-x-auto（渐隐 + 箭头由统一组件提供）', () => {
    const s = read('src/components/home-quick-dock.tsx')
    expect(s).not.toContain('overflow-x-auto')
  })

  it('快捷专题条、分类筛选行不再裸 overflow-x-auto', () => {
    expect(read('src/components/home-micro-strip.tsx')).not.toContain('overflow-x-auto')
    expect(read('src/components/category-site-filter-bar.tsx')).not.toContain('overflow-x-auto')
  })
})
