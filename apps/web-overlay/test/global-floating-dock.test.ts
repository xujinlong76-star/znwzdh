import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 全局浮坞 GlobalFloatingDock 的静态守卫（U-363 回顶入口只剩命令面板）。
 *
 * 背景：首屏瘦身移除了常驻悬浮胶囊 floating-quick-nav，回顶只剩命令面板
 * 「回到页面顶部」指令（键盘用户）。本浮坞是唯一的可见回顶入口：scrollY >
 * 1200 才出现 44px 按钮，首屏零成本；点按用 preferredScrollBehavior 回顶。
 *
 * 本文件锁死三件事，改任何一件都必须同步改这里（R7：守卫断言只按新行为改写）：
 *  1. 阈值/尺寸/行为：1200px、44px（h-11 w-11）、preferredScrollBehavior、
 *     首屏不渲染（条件渲染，非 CSS 隐藏）。
 *  2. 错开位置：<md 时按钮在小猫挂件的上方（猫顶沿 + 8px 间隙），分档底距；
 *     旧底距 4.75rem 会让按钮与猫收起后半露的圆标重叠 1152px²、按钮中心
 *     点到猫的 IMG（2026-11-26 实测，见 SUMMARY），绝不回退。
 *  3. 不复活常驻胶囊：floating-quick-nav 组件文件仍不存在，本浮坞不引用它。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const COMPONENT = 'src/components/global-floating-dock.tsx'
const CAT_SCRIPT = 'public/xiaomaomao/xiaomaomao.js'
const LAYOUT = 'src/app/layout.tsx'

/** 从源码里抓 `bottom-[calc(Xrem+env(safe-area-inset-bottom,0px))]` 的 X（rem 数） */
function dockBottomRem(src: string, prefix: string): number {
  const re = new RegExp(prefix + 'bottom-\\[calc\\(([0-9.]+)rem\\+env\\(safe-area-inset-bottom,0px\\)\\)\\]')
  const m = src.match(re)
  expect(m, `浮坞须有 ${prefix}bottom-[calc(Xrem+safe-area)]`).not.toBeNull()
  return Number((m as RegExpMatchArray)[1])
}

describe('global-floating-dock 组件本体', () => {
  it('存在，是客户端组件且具名导出阈值常量', () => {
    expect(existsSync(join(ROOT, COMPONENT))).toBe(true)
    const src = read(COMPONENT)
    expect(src).toContain("'use client'")
    expect(src).toContain('export function GlobalFloatingDock')
    expect(src).toContain('export const SCROLL_TOP_VISIBLE_AFTER = 1200')
  })

  it('阈值 1200：scrollY 超过 1200 才显示回顶按钮', () => {
    const src = read(COMPONENT)
    expect(src).toContain('window.scrollY > SCROLL_TOP_VISIBLE_AFTER')
  })

  it('44px 按钮：h-11 w-11，aria-label 回到顶部', () => {
    const src = read(COMPONENT)
    expect(src).toContain('aria-label="回到顶部"')
    expect(src).toContain('h-11 w-11')
  })

  it('首屏零成本：按钮只在 showTop 且猫无覆盖层时渲染（条件渲染，不是 CSS 隐藏）', () => {
    const src = read(COMPONENT)
    const condAt = src.indexOf('{showTop && !catOverlayOpen ? (')
    const btnAt = src.indexOf('aria-label="回到顶部"')
    expect(condAt).toBeGreaterThan(-1)
    expect(btnAt).toBeGreaterThan(condAt)
    // 按钮 JSX 之后须闭合条件分支（: null），证明非首屏不挂载
    expect(src.slice(btnAt)).toContain(': null')
  })

  it('回顶走 preferredScrollBehavior（减弱动效时为 auto）', () => {
    const src = read(COMPONENT)
    expect(src).toContain("import { preferredScrollBehavior } from '@/lib/motion'")
    expect(src).toContain('window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })')
  })

  it('不复活常驻胶囊：floating-quick-nav 仍不存在且不被引用', () => {
    expect(existsSync(join(ROOT, 'src/components/floating-quick-nav.tsx'))).toBe(false)
    expect(read(COMPONENT)).not.toContain('FloatingQuickNav')
    expect(read(COMPONENT)).not.toContain('floating-quick-nav')
  })

  it('根 layout 仍全局挂载且仅挂载一次', () => {
    const layout = read(LAYOUT)
    const hits = layout.match(/<GlobalFloatingDock \/>/g) ?? []
    expect(hits.length).toBe(1)
  })
})

describe('U-363 错开位置：按钮在猫的上方（猫顶沿 + 8px 间隙）', () => {
  it('间隙常量 8px', () => {
    const src = read(COMPONENT)
    expect(src).toContain('export const BACK_TO_TOP_BOTTOM_GAP_PX = 8')
  })

  it('旧底距 4.75rem 已移除（该底距与猫圆标重叠 1152px²）', () => {
    expect(read(COMPONENT)).not.toContain('4.75rem')
  })

  it('<640px：底距 11.5rem = 猫顶沿 176px + 8px', () => {
    const dock = read(COMPONENT)
    const cat = read(CAT_SCRIPT)
    // 猫 ≤640：底沿 3.5rem(56px) + 32px = 88px，猫高 88px（.xm-wrap 88px）
    expect(cat).toContain('bottom:calc(3.5rem + env(safe-area-inset-bottom,0px) + 32px)')
    expect(cat).toContain('.xm-wrap{width:88px;height:88px}')
    const catTopPx = 56 + 32 + 88
    const bottomPx = dockBottomRem(dock, '') * 16
    expect(bottomPx - catTopPx).toBe(8)
  })

  it('640–767px：底距 14.5rem = 猫顶沿 224px + 8px', () => {
    const dock = read(COMPONENT)
    const cat = read(CAT_SCRIPT)
    // 猫 640–1023：底沿 112px，猫高 112px（默认 .xm-wrap 112px）
    expect(cat).toContain("bottom:calc(112px + env(safe-area-inset-bottom,0px))")
    expect(cat).toContain('.xm-wrap{position:relative;width:112px;height:112px}')
    const catTopPx = 112 + 112
    const bottomPx = dockBottomRem(dock, 'sm:') * 16
    expect(bottomPx - catTopPx).toBe(8)
  })

  it('≥768px：桌面端底距仍为安全区 16px（按钮顶沿 60px，猫顶沿 224px，本就错开）', () => {
    const src = read(COMPONENT)
    expect(src).toContain('md:bottom-[max(16px,env(safe-area-inset-bottom))]')
  })
})

describe('U-363 覆盖层让位：猫开面板/唤出控件坞时按钮隐藏', () => {
  it('覆盖态 class 锁死：xm-open（面板/游戏）与 xm-ctl（控件坞）', () => {
    const src = read(COMPONENT)
    expect(src).toContain("export const CAT_OVERLAY_CLASSES = ['xm-open', 'xm-ctl']")
  })

  it('MutationObserver 看 #xiaomaomao 的 class，挂件晚加载时先守 body', () => {
    const src = read(COMPONENT)
    expect(src).toContain("document.getElementById('xiaomaomao')")
    expect(src).toContain('new MutationObserver')
    expect(src).toContain("attributeFilter: ['class']")
    expect(src).toContain('childList: true, subtree: true')
    expect(src).toContain('classObserver?.disconnect()')
    expect(src).toContain('bodyObserver?.disconnect()')
  })

  it('按钮渲染条件含 !catOverlayOpen（覆盖层开着时不挂载按钮）', () => {
    const src = read(COMPONENT)
    expect(src).toContain('{showTop && !catOverlayOpen ? (')
    expect(src).toContain('const [catOverlayOpen, setCatOverlayOpen] = useState(false)')
  })

  it('覆盖层 class 与猫脚本一致（猫脚本里 xm-open 开面板、xm-ctl 唤控件坞）', () => {
    const cat = read(CAT_SCRIPT)
    expect(cat).toContain('#xiaomaomao.xm-open .xm-panel{display:flex}')
    expect(cat).toContain('.xm-dock')
    expect(cat).toContain('xm-ctl')
  })
})
