import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 半屏下沉栏 HalfScreenDock（Batch 3 第 12 项）的静态守卫。
 *
 * 定义（Ryan 2026-11-13 22:01 确认）：视口 640–1024px 时，顶部工具栏
 * 在半屏下丢失的操作下沉到底部常驻栏；不是 DIY 模块半屏沉底。
 * 仿 mobile-nav.test.ts / mobile-touch-targets.test.ts 的静态守卫范式，
 * 锁死：组件存在且为客户端组件；6 项齐全；断点类名与 footer / UndoBar /
 * OfflineBanner 的三段偏移量逐字锁定；menuSide="top" 有传入；编辑态 /
 * 多选态隐藏条件有源码守卫；每项 ≥44px、栏高 56px + safe-area。
 *
 * 挂载点（评审结论）：navigation-content.tsx（选项 b），而非
 * navigation-toolbar.tsx——工具栏没有 isEditingLayout 这个 prop，
 * 编辑态隐藏在该文件内无法直接实现。
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

const COMPONENT = 'src/components/half-screen-dock.tsx'
const PREF_LIB = 'src/lib/half-screen-dock.ts'
const NAV_CONTENT = 'src/components/navigation-content.tsx'
const NAV_TOOLBAR = 'src/components/navigation-toolbar.tsx'
const FOOTER = 'src/components/footer.tsx'
const UNDO_BAR = 'src/components/undo-bar.tsx'
const OFFLINE_BANNER = 'src/components/offline-banner.tsx'
const SETTINGS_PANEL = 'src/components/user-center/settings-panel.tsx'
const DIY_TRIGGER = 'src/components/home-diy-trigger.tsx'
const XIAOMAOMAO = 'public/xiaomaomao/xiaomaomao.js'
const LAYOUT = 'src/app/layout.tsx'

describe('half-screen-dock 组件本体', () => {
  it('存在，是客户端组件且具名导出', () => {
    expect(existsSync(join(ROOT, COMPONENT))).toBe(true)
    const src = read(COMPONENT)
    expect(src).toContain("'use client'")
    expect(src).toContain('export function HalfScreenDock')
  })

  it('6 项齐全：场景 / 密度 / 视图 / 工具箱 / 热度榜 / 关闭', () => {
    const src = read(COMPONENT)
    expect(src).toContain('<SceneSwitcher')
    expect(src).toContain('<DensityToggle')
    expect(src).toContain('<ViewModeToggle')
    // 工具箱：复用透传的 onOpenTools，与工具栏同款文案
    expect(src).toContain('onOpenTools()')
    expect(src).toContain('aria-label="微工具箱"')
    // 热度榜：真实路由 /hot，不是下拉里的两步入口
    expect(src).toContain('href="/hot"')
    expect(src).toContain('aria-label="热度趋势榜"')
    // 关闭 ×：写本机偏好 off
    expect(src).toContain('aria-label="关闭半屏下沉栏"')
    expect(src).toContain("toast({ title: '已关闭半屏下沉栏，可在设置页重新打开' })")
  })

  it('明确不进栏的入口一个都没有：导航四入口 / 搜索 / 字号 / 长辈 / 皮肤 / 明暗', () => {
    const src = read(COMPONENT)
    // 断言挂载/引用形式而非裸词：注释里提及「MobileNav」「明暗」是为了解释
    // 区间互斥与不进栏原因，不算引入；ViewModeToggle 含 ModeToggle 子串同理
    for (const banned of [
      '<MobileNav',
      "from '@/components/mobile-nav'",
      'SearchPalette',
      'FontSizeToggle',
      'ElderModeToggle',
      'SkinPicker',
      "from '@/components/mode-toggle'",
      "href: '/category'",
      "href: '/favorites'",
      "href: '/me'",
    ]) {
      expect(src, `下沉栏不应包含 ${banned}`).not.toContain(banned)
    }
  })

  it('显隐用纯 CSS：默认 hidden，只在 640–1024px 区间 flex', () => {
    const src = read(COMPONENT)
    expect(src).toContain('hidden min-[640px]:max-[1024px]:flex')
    // 不用 JS 量宽度：没有 matchMedia / innerWidth / ResizeObserver
    expect(src).not.toContain('matchMedia')
    expect(src).not.toContain('innerWidth')
    expect(src).not.toContain('ResizeObserver')
  })

  it('栏高 56px + safe-area，与 MobileNav 同高；role 与 aria-label 齐全', () => {
    const src = read(COMPONENT)
    expect(src).toContain('fixed bottom-0')
    expect(src).toContain('z-40')
    // 3.5rem = 56px 的基准高度 + safe-area：用 calc 增高容器而非把 padding 塞进固定 h-14，
    // 避免全面屏 iPhone 上安全区内边距压缩图标/文字（P3-8）。
    expect(
      src.includes('h-[calc(3.5rem+env(safe-area-inset-bottom,0px))]') || src.includes('h-14')
    ).toBe(true)
    expect(src).toContain('pb-[env(safe-area-inset-bottom,0px)]')
    expect(src).toContain('role="toolbar"')
    expect(src).toContain('aria-label="半屏快捷操作"')
  })

  it('每项 ≥44px：工具箱 / 热度榜 / 关闭为 h-11 w-11；视图补方形 className', () => {
    const src = read(COMPONENT)
    // 三个原生按钮直接 h-11 w-11
    const squareButtons = src.match(/h-11 w-11/g) ?? []
    expect(squareButtons.length).toBeGreaterThanOrEqual(3)
    // ViewModeToggle 触发钮非方形，进栏须补 h-11 w-11 / min-w-11
    expect(src).toContain('className="h-11 w-11 min-w-11 justify-center"')
    // 密度触发钮本身就是 h-11 w-11（density-toggle.tsx）
    expect(read('src/components/density-toggle.tsx')).toContain('h-11 w-11')
    // 场景触发钮 h-11 w-auto（图标 + 名称，宽 ≥44px，顺带核实）
    expect(read('src/components/scene-switcher.tsx')).toContain('h-11 w-auto')
  })

  it('编辑态 / 多选态隐藏条件有源码守卫', () => {
    const src = read(COMPONENT)
    expect(src).toContain('isEditingLayout')
    expect(src).toContain('if (isEditingLayout) return null')
    expect(src).toContain('if (selectionMode && selectedIds.length > 0) return null')
  })

  it('不新建场景 / 密度状态：复用已有组件，不另写状态机', () => {
    const src = read(COMPONENT)
    // 断言调用/导入形式：注释里提及 useDensity / useUserScenes 是为了解释
    // 复用关系，不算另建状态机
    expect(src).not.toContain('useDensity(')
    expect(src).not.toContain('useUserScenes(')
    expect(src).not.toContain('performSceneSwitch(')
    // 只 import 了 user-scenes 的类型（activeWorkspace 的类型标注），不读其状态
    expect(src).not.toContain("from '@/lib/modular/use-home-diy'")
    // 组件内唯一的 useState 是开关本身的 on/off（本机偏好），不是场景/密度状态
    // （import 一处 + 调用一处，共 2 次出现）
    expect(src.match(/useState/g)?.length).toBe(2)
  })
})

describe('下拉菜单必须向上开', () => {
  it('下沉栏给三个下拉都传 menuSide="top"', () => {
    const src = read(COMPONENT)
    expect(src.match(/menuSide="top"/g)?.length).toBe(3)
  })

  it('DensityToggle / SceneSwitcher / ViewModeToggle 都有 menuSide prop，默认 bottom', () => {
    for (const file of [
      'src/components/density-toggle.tsx',
      'src/components/scene-switcher.tsx',
      'src/components/view-mode-toggle.tsx',
    ]) {
      const src = read(file)
      expect(src, `${file} 缺 menuSide prop`).toContain("menuSide?: 'top' | 'bottom'")
      expect(src, `${file} 默认值应为 bottom`).toContain("menuSide = 'bottom'")
      expect(src, `${file} 未把 side 传给 DropdownMenuContent`).toContain('side={menuSide}')
    }
  })

  it('工具栏等既有挂载点不传 menuSide，行为保持向下开', () => {
    const toolbar = read(NAV_TOOLBAR)
    expect(toolbar).not.toContain('menuSide')
  })
})

describe('开关：默认开，本机存储', () => {
  it('新键 navhub.halfScreenDock.v1，值 { on: boolean }，默认开', () => {
    expect(existsSync(join(ROOT, PREF_LIB))).toBe(true)
    const lib = read(PREF_LIB)
    expect(lib).toContain("HALF_SCREEN_DOCK_STORAGE_KEY = 'navhub.halfScreenDock.v1'")
    expect(lib).toContain('on: boolean')
    // 读不到 / 损坏按开处理
    expect(lib).toContain('if (!raw) return { on: true }')
    expect(lib).toContain('return { on: true }')
  })

  it('组件读本机偏好，关闭只影响本栏显隐', () => {
    const src = read(COMPONENT)
    expect(src).toContain('loadHalfScreenDockOn(window.localStorage)')
    expect(src).toContain('setHalfScreenDockOn(false, window.localStorage)')
    expect(src).toContain('if (!on) return null')
  })

  it('零新增云端契约：UserSettingsModel / me.ts zod 均无 halfScreenDock', () => {
    expect(read('src/lib/user-settings.ts')).not.toContain('halfScreenDock')
    expect(read('src/app/api/me/[[...path]]/route.ts')).not.toContain('halfScreenDock')
    expect(read(SETTINGS_PANEL)).not.toContain('halfScreenDock: ')
  })

  it('设置页开关在密度设置同区，抄本机模式，不走云端 onChange', () => {
    const panel = read(SETTINGS_PANEL)
    expect(panel).toContain('HalfScreenDockField')
    expect(panel).toContain('<HalfScreenDockField idPrefix={idPrefix} />')
    // 密度字段与下沉栏字段同属一个 grid
    const densityAt = panel.indexOf('导航卡片展示密度')
    const dockAt = panel.indexOf('HalfScreenDockField idPrefix')
    expect(densityAt).toBeGreaterThan(-1)
    expect(dockAt).toBeGreaterThan(densityAt)
    expect(panel).toContain('loadHalfScreenDockOn(window.localStorage)')
    expect(panel).toContain('setHalfScreenDockOn(next, window.localStorage)')
  })
})

describe('挂载点：navigation-content.tsx（选项 b）', () => {
  it('首页挂载 HalfScreenDock，透传编辑态 / 多选态 / 工具箱 / 场景所需的全部 props', () => {
    const src = read(NAV_CONTENT)
    expect(src).toContain("import { HalfScreenDock } from '@/components/half-screen-dock'")
    expect(src).toContain('<HalfScreenDock')
    expect(src).toContain('activeWorkspace={activeWorkspace}')
    expect(src).toContain('onOpenTools={() => setIsToolsOpen(true)}')
    expect(src).toContain('isEditingLayout={isEditingLayout}')
    expect(src).toContain('selectionMode={selectionMode}')
    expect(src).toContain('selectedIds={selectedIds}')
  })

  it('不在 navigation-toolbar.tsx 内挂载（工具栏无 isEditingLayout prop）', () => {
    expect(read(NAV_TOOLBAR)).not.toContain('HalfScreenDock')
  })
})

describe('底部契约：三段断点表逐字锁定', () => {
  it('footer：<640 留 5.5rem，640–1024 留 4.5rem，≥1024 只留 pb-8', () => {
    const footer = read(FOOTER)
    expect(footer).toContain('pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]')
    expect(footer).toContain(
      'min-[640px]:max-[1024px]:pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
    )
    expect(footer).toContain('lg:pb-8')
    expect(footer).not.toContain('sm:pb-8')
  })

  it('UndoBar：<640 为 safe-area+72px，640–1024 抬到 4.5rem，≥1024 为 bottom-6', () => {
    const src = read(UNDO_BAR)
    expect(src).toContain('bottom-[calc(env(safe-area-inset-bottom,0px)+72px)]')
    expect(src).toContain(
      'min-[640px]:max-[1024px]:bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
    )
    expect(src).toContain('lg:bottom-6')
    expect(src).not.toContain('sm:bottom-6')
  })

  it('OfflineBanner：<640 与 640–1024 均为 4.5rem，≥1024 为 1rem', () => {
    const src = read(OFFLINE_BANNER)
    expect(src).toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]')
    expect(src).toContain(
      'min-[640px]:max-[1024px]:bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
    )
    expect(src).toContain('lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]')
    expect(src).not.toContain('sm:bottom-')
  })
})

describe('已知局限（v1 接受，不擅自修）', () => {
  it('1024–1280px 断层诚实标注在组件注释里，下沉栏不延到 1280', () => {
    const src = read(COMPONENT)
    expect(src).toContain('1024–1280px')
    expect(src).toContain('max-[1024px]')
    expect(src).not.toContain('max-[1279px]')
    expect(src).not.toContain('max-[1280px]')
  })

  it('不碰禁区文件：导航工具栏多选按钮 title 与第 11 项落点一致', () => {
    const toolbar = read(NAV_TOOLBAR)
    expect(toolbar).toContain("title={selectionMode ? '退出多选模式（快捷键 M）' : '多选模式：批量导出 / 复制 / 置顶（快捷键 M）'}")
  })

  it('下沉栏不新增 window 级 Esc 监听（第 11 项禁令，只依赖 Radix 默认行为）', () => {
    const src = read(COMPONENT)
    expect(src).not.toContain("key === 'Escape'")
    expect(src).not.toContain('keydown')
    // 唯一的 window 监听是本机偏好变更事件（设置页开关同步），不是键盘监听
    expect(src).toContain('HALF_SCREEN_DOCK_CHANGED_EVENT')
  })
})

describe('BLOCK 修复：640–1024px 两处遮挡源（2026-11-14 独立评审）', () => {
  it('DIY 入口 pill 在 640–1024 抬到栏之上（4.5rem，与 UndoBar / OfflineBanner 同值）', () => {
    const src = read(DIY_TRIGGER)
    // 三段表：<640 抬到 MobileNav 之上（既有），640–1024 抬到下沉栏之上，≥1024 回到底距 14px
    expect(src).toContain('bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)]')
    expect(src).toContain(
      'min-[640px]:max-[1024px]:bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
    )
    expect(src).toContain('lg:bottom-3.5')
    // sm:bottom-3.5 不能留：它在 640–1024 全段生效，会与中段规则争层叠顺序
    expect(src).not.toContain('sm:bottom-3.5')
  })

  it('小猫挂件在 640–1024 抬到栏之上：媒体规则逐字锁定，区间与栏 [640,1024) 对齐', () => {
    const js = read(XIAOMAOMAO)
    // K1 悬浮栈规范（f0283bb8）：与桌面默认底边同值 112px（96px→112px）；原 4.5rem+18px=90px 会蹭胶囊顶部（见 K1 守卫测试 xiaomaomao-widget-k12345.test.ts）
    expect(js).toContain(
      "@media (min-width:640px) and (max-width:1023px){#xiaomaomao{bottom:calc(112px + env(safe-area-inset-bottom,0px))}}",
    )
    // 640px 整点：新规则必须在 ≤640 规则之后，否则 ≤640 规则把 bottom 写回 68px
    const smallAt = js.indexOf('@media (max-width:640px)')
    const midAt = js.indexOf('@media (min-width:640px) and (max-width:1023px)')
    expect(smallAt).toBeGreaterThan(-1)
    expect(midAt).toBeGreaterThan(smallAt)
    // 不用 !important 压用户拖动的位置：新规则里没有 !important
    const rule = js.slice(midAt, js.indexOf("'", midAt))
    expect(rule).not.toContain('!important')
  })

  it('小猫拖动语义不变：拖后行内 left/top + right/bottom:auto，媒体规则只对未拖动过的猫生效', () => {
    const js = read(XIAOMAOMAO)
    expect(js).toContain("root.style.left = left + 'px'")
    expect(js).toContain("root.style.top = top + 'px'")
    expect(js).toContain("root.style.right = 'auto'")
    expect(js).toContain("root.style.bottom = 'auto'")
    // 闲置贴边只写 transform（横向），抬高后仍成立
    expect(js).toContain("root.style.transform = 'translateX('")
  })

  it('设置页文案补上工具箱与热度榜', () => {
    expect(read(SETTINGS_PANEL)).toContain('场景、密度、视图、工具箱与热度榜')
  })

  it('layout 注释按修复后真实行为重写，不再 blanket 宣称“平时零遮挡”', () => {
    const layout = read(LAYOUT)
    expect(layout).not.toContain('v7：平时零遮挡')
    expect(layout).toContain('640–1024px 区间猫默认抬到半屏下沉栏之上')
    expect(layout).toContain('拖动过的猫以用户自选位置为准')
  })
})
