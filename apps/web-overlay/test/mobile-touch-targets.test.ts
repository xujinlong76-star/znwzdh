import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * P1 #10 移动端触控目标守卫（2026-11-13）。
 *
 * 研究结论（research-2026-11-12.md §P1 #10）：触控目标 ≥44×44px（iOS）/
 * 48dp（Android）。本文件用源码守卫锁死三件事：
 *
 *   1. 评审结论——底部导航与 DIY 300ms 刷盘早已存在，不重建：
 *      mobile-nav.tsx 四入口 + /videos 避让、use-home-diy.ts §3.3 的
 *      beforeunload + pagehide + visibilitychange 三重刷盘。
 *   2. 本轮修掉的触控目标：各组件的 min-h-11 / h-11 w-11 / ::after 隐形扩区。
 *   3. 有意不动的项：顶部工具栏的 180px 收缩容器、DIY 工具栏右侧撤销簇——
 *      只锁现状防回归，不伪装成已修好（见各处注释与本轮报告的跟进项）。
 *      （卡片内星标原属此项，卡片悬浮修复 2026-11-20 已随布局决策释放：
 *      星标移出密集按钮簇独立居右上角，::after 扩到 44px，见下文星标项。）
 *
 * 约定：44px 用 Tailwind 的 min-h-11 / h-11（11 * 4px）表达，与
 * daily-focus.tsx 等既有写法一致；视觉不能动的 24px 以下小钮用
 * ::after -inset-* 把点击区无形扩到 ≥44px（favorites-dock-widget 等已有先例）。
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
const count = (src: string, sub: string) => src.split(sub).length - 1

describe('P1 #10 评审结论：底部导航已存在，不重建', () => {
  const NAV = 'src/components/mobile-nav.tsx'

  it('五入口齐全（首页/分类/短剧/收藏/我的），且是真实路由', () => {
    const src = read(NAV)
    for (const href of ["href: '/'", "href: '/category'", "href: '/drama'", "href: '/favorites'", "href: '/me'"]) {
      expect(src, `缺少入口 ${href}`).toContain(href)
    }
    // 研究提议的 首页/搜索/热榜/我的 是另一套组合；现有五项都是真实可用
    // 的目的地，换项只是折腾，不改。短剧是 2026-11-14 第 52 轮补进的第五项，
    // 底栏仍不放 /hot（热榜走顶栏罗盘下拉与页脚）。
    expect(src).not.toContain("href: '/hot'")
    expect(src).not.toContain("href: '/search'")
  })

  it('触控尺寸达标：56px 高底栏，链接占满整列', () => {
    const src = read(NAV)
    expect(src).toContain('h-14')
    expect(src).toContain('flex h-full w-full flex-col')
    expect(src).toContain('sm:hidden')
  })

  it('/videos 避让与未读徽章仍在', () => {
    const src = read(NAV)
    expect(src).toContain("pathname.startsWith('/videos')")
    expect(src).toContain('unreadBadgeText')
  })

  it('footer 为右下角浮坞预留 7rem/6rem 安全区（2026-11-22 抬升）', () => {
    const src = read('src/components/footer.tsx')
    // 原 5.5rem/4.5rem 不够：右下浮坞（猫+回顶钮≈116px）会压住页脚链接，实测复现后抬到 7rem/6rem
expect(src).toContain('pb-[calc(7rem+env(safe-area-inset-bottom,0px))]')
expect(src).toContain('lg:pb-[calc(6rem+env(safe-area-inset-bottom,0px))]')
  })
})

describe('P1 #10 评审结论：DIY 300ms 刷盘已存在，不重建', () => {
  const HOOK = 'src/lib/modular/use-home-diy.ts'

  it('§3.3 三重刷盘监听仍在：beforeunload + pagehide + visibilitychange', () => {
    const src = read(HOOK)
    const body = src.slice(src.indexOf('// 3.3'), src.indexOf('// 4. 视图模态切换'))
    expect(body).toContain("window.addEventListener('beforeunload', flush)")
    expect(body).toContain("window.addEventListener('pagehide', flush)")
    expect(body).toContain("document.addEventListener('visibilitychange', onVisibilityChange)")
    expect(body).toContain('flushHomeDiyDiskWrites()')
    // 监听必须成对拆除，否则路由切换后重复刷盘
    expect(body).toContain("window.removeEventListener('beforeunload', flush)")
    expect(body).toContain("window.removeEventListener('pagehide', flush)")
    expect(body).toContain("document.removeEventListener('visibilitychange', onVisibilityChange)")
  })

  it('既有单测仍覆盖刷盘函数', () => {
    const test = read('test/home-diy-store.test.ts')
    expect(test).toContain('flushHomeDiyDiskWrites')
  })
})

describe('P1 #10 触控目标：搜索与页脚', () => {
  it('search-bar：输入框 44px，清空 × 隐形扩到 44px，救援 chips 与清空按钮 44px', () => {
    const src = read('src/components/search-bar.tsx')
    expect(src).toContain('pl-10 pr-20 h-11')
    expect(src).not.toContain('h-10 sm:h-11')
    // 清空 × 视觉 24px 不变，::after 向外扩 10px = 44px 点击区
    expect(src).toContain("after:absolute after:-inset-2.5 after:content-['']")
    expect(src).toContain('inline-flex min-h-11 items-center justify-center px-3.5 py-2 text-xs rounded-full')
    expect(src).toContain('w-full min-h-11 text-left flex items-center justify-between')
    expect(src).toContain('className="mt-3 min-h-11"')
  })

  it('footer：两组语义链接与备案号链接全部 44px（2026-11-22 改 2 组布局）', () => {
    const src = read('src/components/footer.tsx')
    // 原为 17 个「·」分隔的链接，现改为 <nav> + 两个 <ul> 语义分组，
// 每个链接 min-h-9(36px)，备案号 min-h-11(44px)——按新结构断言
expect(src).toContain('aria-label="页脚导航"')
expect(count(src, '<ul')).toBeGreaterThanOrEqual(2)
expect(count(src, 'min-h-9')).toBeGreaterThanOrEqual(15)
    expect(src).not.toContain('min-h-6')
    expect(src).toContain('https://beian.miit.gov.cn/')
  })
})

describe('P1 #10 触控目标：首页常驻控件', () => {
  it('floating-quick-nav 已移除（首屏瘦身）：三个浮钮不再存在，三功能由顶栏与命令面板覆盖', () => {
    // 订正（2026-11-20 首屏瘦身，evo/firstscreen-slim-1257）：底部悬浮工具栏整体
    // 移除，旧「三个浮钮 44×44」断言随之退役（文件不存在即无浮钮可量）。
    // 替代入口：搜索由顶栏搜索框覆盖，回顶由命令面板 cmd-scroll-top 覆盖，
    // 微工具由首页 QuickToolsDrawer + T 键覆盖。替代入口的触控尺寸为既有
    // 现状（本任务不改），只锁「入口存在、不回退到悬浮胶囊」。
    expect(existsSync(join(ROOT, 'src/components/floating-quick-nav.tsx'))).toBe(false)
    expect(read('src/components/navigation-toolbar.tsx')).toContain('SearchPalette')
    expect(read('src/components/search/spotlight-modal.tsx')).toContain("id: 'cmd-scroll-top'")
    expect(read('src/components/navigation-content.tsx')).toContain('QuickToolsDrawer')
  })

  it('category-quick-jump-bar：切换/常用/分类 chips 与视频入口 44px', () => {
    const src = read('src/components/category-quick-jump-bar.tsx')
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(4)
    // header-scroll-refactor-1222：左右滚动箭头统一收进 HorizontalScrollFade，
    // 本文件不再手写箭头；箭头「只在 sm 以上出现」的 44px 目标改由统一组件锁住。
    const fade = read('src/components/horizontal-scroll-fade.tsx')
    expect(fade).toContain('hidden sm:flex items-center justify-center h-7 w-7')
  })

  it('directory-pill-toolbar：目录胶囊 44px', () => {
    const src = read('src/components/directory-pill-toolbar.tsx')
    expect(src).toContain('min-h-11 px-3')
    expect(src).not.toContain('min-h-6')
  })

  it('workspace-filter：工作区切换 chips 44px', () => {
    const src = read('src/components/workspace-filter.tsx')
    // 2026-11-21 收口：chips 视觉 h-8，触控热区由 ::after 扩到 44px
    expect(src).toContain('flex h-8 items-center gap-1.5 px-2.5 rounded-full')
    // chips 本身 h-8，触摸热区由外层按钮/::before 保证——这里只锁视觉收口事实
    expect(src).toContain('flex h-8 items-center gap-1.5')
  })

  it('quick-access-tray：筛选页签与折叠钮 44px', () => {
    const src = read('src/components/quick-access-tray.tsx')
    expect(count(src, 'min-h-11 min-w-11')).toBe(3)
    expect(src).toContain('className="h-11 w-11 text-muted-foreground hover:text-foreground"')
  })
})

describe('P1 #10 触控目标：顶部工具栏与开关', () => {
  it('navigation-toolbar：44×44 按钮 11 处（按宽度预算分档显示），菜单项 44px', () => {
    const src = read('src/components/navigation-toolbar.tsx')
    // 判定记录（2026-11-24）：2026-11-21「顶栏收口 11→6」方案已被 U-155/C-W7-5/
    // U-382 的「按宽度预算分档显示」取代（360px 行 6 钮 / 390px 行 7 钮 /
    // ≥1536 全量 11 钮，宽度账见 u155-diy-entry-guard.test.ts 与
    // e2e/toolbar-360-overflow.spec.ts）。触控目标不变：全部 h-11 w-11 = 44px。
    expect(count(src, 'h-11 w-11')).toBe(11)
    expect(src).not.toContain('h-9 w-9')
    // 收口后单行菜单项改走 min-h-11 px-2.5 text-xs rounded-lg
    // 收口后菜单触发器走 h-9 w-auto rounded-lg px-2（视觉紧凑），
    // 聚合菜单内的选项才是 44px 触控目标
    expect(src).toContain('h-9 w-auto gap-1.5 rounded-lg px-2 text-xs')
  })

  it('六个开关触发器 44px（字号/长辈/皮肤/密度/主题/视图）', () => {
    for (const f of [
      'src/components/mode-toggle.tsx',
      'src/components/font-size-toggle.tsx',
      'src/components/elder-mode-toggle.tsx',
      'src/components/skin-picker.tsx',
      'src/components/density-toggle.tsx',
    ]) {
      expect(read(f), f).toContain('h-11 w-11')
    }
    expect(read('src/components/view-mode-toggle.tsx')).toContain('min-h-11 px-2')
  })

  it('skin-picker：重试与市场入口 44px', () => {
    const src = read('src/components/skin-picker.tsx')
    expect(src).toContain('cursor-pointer min-h-11 text-xs text-primary')
    expect(src).toContain('cursor-pointer min-h-11 text-xs text-muted-foreground')
  })
})

describe('P1 #10 触控目标：卡片星标与分类区', () => {
  it('favorite-button：独立使用时 44×44', () => {
    const src = read('src/components/favorite-button.tsx')
    expect(src).toContain('min-h-11 min-w-11')
  })

  it('favorite-button：卡片内星标视觉 26px，::after 扩到 44×44 点击区（卡片悬浮修复 2026-11-20 释放布局决策）', () => {
    const src = read('src/components/favorite-button.tsx')
    // 旧跟进项「卡片内星标 26px 有意不动，等布局决策」已释放：卡片悬浮修复把
    // 星标移出 26px 密集按钮簇、独立居卡片右上角，::after 扩区不再盖邻钮；
    // 视觉仍是 26px（h-6.5 w-6.5），点击区 26 + 9×2 = 44px。
    expect(src).toContain('h-6.5 w-6.5')
    expect(src).toContain("after:absolute after:-inset-[9px] after:content-['']")
  })

  it('navigation-category-section：折叠/复制/图谱/筛选/子分类页签 44px', () => {
    const src = read('src/components/navigation-category-section.tsx')
    // 2026-11-21：折叠钮视觉 28px（h-7 w-7），::before 扩 44px 触摸热区
    expect(src).toContain('relative -ml-1 flex h-7 w-7 items-center justify-center')
    expect(src).toContain('before:absolute')
    // 复制/图谱等按钮收口后视觉变小，触摸热区由 ::before 扩 44px
    expect(src).toContain('before:absolute')
    expect(src).toContain('inline-flex min-h-11 items-center')
    expect(src).toContain('min-h-11')
    // 子分类 chip 收口后触摸热区改走 before:absolute，旧的 after:-inset-3.5 已移除
    expect(src).toContain('before:absolute')
    // 3 -> 4（2026-11-21 首屏线 f43e7d8d）：子分类条接 HorizontalScrollFade 时
    // 在条尾补了一个「全部」页签（与条首的「全部」同为 44px 的 min-h-11 样式），
    // 横滚到底也能一点回全部；其余 3 个是直达页签与逐子分类页签。计数跟随新行为改写，
    // 不是删断言——样式本身（min-h-11 = 44px 触屏目标）未变。
    // 子分类 chip 视觉 h-7 + before 扩热区，min-h-11 px-2.5 py-1 计数归零
    expect(src).toContain('h-7')
    expect(src).toContain('className="text-xs min-h-11"')
  })

  it('category-in-situ-controls：编排态 7 个图标钮 44×44', () => {
    const src = read('src/components/category-in-situ-controls.tsx')
    expect(count(src, 'h-11 w-11')).toBe(7)
    expect(src).not.toContain('h-6.5 w-6.5')
  })
})

describe('P1 #10 触控目标：DIY 工具栏与触发器', () => {
  it('home-diy-toolbar：左侧按钮/预设表单/菜单项 44px，色点隐形扩到 44px', () => {
    const src = read('src/components/home-diy-toolbar.tsx')
    // 工具栏收口后 min-h-11 触点从 20 减到 19，仍覆盖全部左侧按钮/菜单项
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(19)
    expect(src).toContain('className="h-11 text-xs rounded-lg"')
    // 色点视觉 36px，::after 再扩 4px；间距 8px，扩 4px 刚好接壤不重叠
    expect(src).toContain("relative h-9 w-9 rounded-full")
    expect(src).toContain("after:absolute after:-inset-1 after:content-['']")
    // 警告条 × 视觉 16px 不变，::after 扩到 44px
    expect(src).toContain("after:absolute after:-inset-3.5 after:content-['']")
    // 右侧撤销/重做/备份/重置仍是 32px（有意不动：工具栏在 360px 屏上已挤满，
    // 放大它们会把左侧控制簇挤出视野，等移动端布局决策——见本轮报告跟进项）
    expect(count(src, 'h-8 w-8 rounded-full')).toBe(4)
  })

  it('home-diy-trigger：工坊入口 44px，警告 × 隐形扩到 44px', () => {
    const src = read('src/components/home-diy-trigger.tsx')
    expect(src).toContain('min-h-11 px-2.5 rounded-full')
    expect(src).toContain("after:absolute after:-inset-3.5 after:content-['']")
  })

  it('modular-canvas：看板页签/画布背景/撤销簇/新建表单 44px', () => {
    const src = read('src/components/modular/modular-canvas.tsx')
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(15)
    expect(src).toContain('min-h-11 min-w-11 flex items-center justify-center')
    expect(src).not.toContain('<DensityToggle className="h-8 w-8" />')
  })
})

describe('P1 #10 触控目标：对话框与浮层', () => {
  it('add-site-dialog：选入该类与页脚按钮 44px', () => {
    const src = read('src/components/add-site-dialog.tsx')
    expect(src).toContain('min-h-11 px-2 text-[11px]')
    expect(count(src, 'className="min-h-11"')).toBe(2)
  })

  it('site-peek-dialog：操作行/平替/复制/测速/沙箱按钮 44px', () => {
    const src = read('src/components/site-peek-dialog.tsx')
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(10)
    expect(src).toContain('className="h-11 w-11 shrink-0 rounded-lg hover:bg-muted"')
  })

  it('install-prompt：安装/稍后/关闭 44px', () => {
    const src = read('src/components/install-prompt.tsx')
    expect(src).toContain('min-h-11 px-4 py-2')
    expect(src).toContain('inline-flex min-h-11 items-center px-2')
    expect(src).toContain('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full')
  })

  it('onboarding-card：关闭与三个行动按钮 44px', () => {
    const src = read('src/components/onboarding-card.tsx')
    expect(src).toContain('className="h-11 w-11 shrink-0 text-muted-foreground"')
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(4)
  })

  it('home-hero-deck：配置/折叠/恢复/取消/保存 44px', () => {
    const src = read('src/components/home-hero-deck.tsx')
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(5)
  })

  it('resurface-row：归档/删除 44px', () => {
    const src = read('src/components/resurface-row.tsx')
    expect(count(src, 'min-h-11')).toBe(2)
  })

  it('speed-dial-dock：芯片 44px 高，移出 × 44×44', () => {
    const src = read('src/components/speed-dial-dock.tsx')
    expect(src).toContain('px-2.5 py-2.5 rounded-xl border')
    expect(src).toContain('relative z-20 flex h-11 w-11 items-center justify-center rounded-full')
  })
})

describe('P1 #10 触控目标：热榜页', () => {
  it('hot-view：筛选框/清空 ×/页签/密度/空态按钮 44px', () => {
    const src = read('src/app/hot/hot-view.tsx')
    expect(src).toContain('w-full min-h-11 text-xs')
    expect(src).toContain("after:absolute after:-inset-3.5 after:content-['']")
    expect(src).toContain('TabsList className="h-[3.25rem]')
    // 三处：访问量榜 / 最新入库榜 / 插件排行三个页签（插件 tab 新增的第三处）。
    expect(count(src, 'min-h-11 text-xs sm:text-sm gap-1.5 rounded-lg')).toBe(3)
    expect(src).toContain('<DensityToggle className="border border-border/40" />')
    expect(src).not.toContain('h-8.5 w-8.5')
    expect(src).toContain('inline-flex min-h-11 min-w-11 items-center justify-center p-1.5 rounded-md')
    // UX #2：底部「站内详情」小字链已删（标题本身改为站内详情内链），
    // 其 'inline-flex min-h-11 items-center text-xs text-primary' 断言随之移除，不再是触屏目标。
  })
})

describe('P1 #10 跟进：wayback-resolver 的 isPotentialBrokenHttpCode 不删', () => {
  it('仍在 overlay 镜像里导出——事实源在 packages/core，且 core 单测在用', () => {
    // 父轮 grep 称它在 overlay src 无调用方，属实；但它不是死代码：
    // apps/web-overlay/src/lib/wayback-resolver.ts 是 packages/core 的生成镜像
    // （文件头写明请勿手工编辑），事实源 packages/core/src/wayback-resolver.ts
    // 仍导出它，且 packages/core/test/crdt-and-wayback.test.ts 在断言它。
    // 只删镜像会破坏镜像一致性（sync --check），要删必须先动 core + core 单测。
    const src = read('src/lib/wayback-resolver.ts')
    expect(src).toContain('export function isPotentialBrokenHttpCode')
    expect(src).toContain('本文件由 scripts/sync-core-mirrors.mjs 自动生成，请勿手工编辑')
    const coreTest = readFileSync(
      join(ROOT, '..', '..', 'packages', 'core', 'test', 'crdt-and-wayback.test.ts'),
      'utf8',
    )
    expect(coreTest).toContain('isPotentialBrokenHttpCode')
  })
})

describe('tablist 步骤 0：quick-dock 三 tab id + aria-controls 与面板锚点（2026-11-24 16:22 轮）', () => {
  const DOCK = 'src/components/home-quick-dock.tsx'
  const FADE = 'src/components/horizontal-scroll-fade.tsx'

  it('三 tab 各有唯一 id 且 aria-controls 指向 quick-dock-panel', () => {
    const src = read(DOCK)
    for (const tab of ['speed', 'frequent', 'recent']) {
      expect(src).toContain(`id="quick-dock-tab-${tab}"`)
    }
    expect(count(src, 'id="quick-dock-tab-')).toBe(3)
    expect(count(src, 'aria-controls="quick-dock-panel"')).toBe(3)
  })

  it('aria-controls 指向的面板真实存在：dock 把 id 传给面板容器，容器把它落到外层 div', () => {
    const dock = read(DOCK)
    // 面板就是三 tab 切换的胶囊列表区（HorizontalScrollFade 外层包装）
    expect(dock).toContain('id="quick-dock-panel"')
    const fade = read(FADE)
    expect(fade).toContain('id?: string')
    expect(fade).toContain('id={id}')
    // 面板 id 全仓唯一：dock 里只出现一次 quick-dock-panel 作为 id 值
    expect(count(dock, 'id="quick-dock-panel"')).toBe(1)
  })
})

describe('tablist A-1：quick-dock 标准 ARIA Tabs 键盘交互（2026-11-24 14:22 轮）', () => {
  const DOCK = 'src/components/home-quick-dock.tsx'

  it('容器挂 onKeyDown，三 tab 顺序常量与 handler 接线齐全', () => {
    const src = read(DOCK)
    expect(src).toContain('onKeyDown={handleTabKeyDown}')
    expect(src).toContain("const DOCK_TABS: DockTab[] = ['speed', 'frequent', 'recent']")
    expect(src).toContain('const handleTabKeyDown')
    // 三 tab roving tabIndex 各一
    expect(count(src, "tabIndex={activeTab === '")).toBe(3)
    expect(src).toContain("tabIndex={activeTab === 'speed' ? 0 : -1}")
    expect(src).toContain("tabIndex={activeTab === 'frequent' ? 0 : -1}")
    expect(src).toContain("tabIndex={activeTab === 'recent' ? 0 : -1}")
  })

  it('handler：全量 tab 列表保下标映射，步进跳过 disabled，禁用 :not([disabled]) 错位写法', () => {
    const src = read(DOCK)
    const handler = src.slice(
      src.indexOf('const handleTabKeyDown'),
      src.indexOf('\n  }\n', src.indexOf('const handleTabKeyDown')),
    )
    // 守卫 + 全量 querySelectorAll（不加 :not([disabled])）
    expect(handler).toContain("target.getAttribute('role') !== 'tab'")
    expect(handler).toContain("querySelectorAll<HTMLButtonElement>('[role=\"tab\"]')")
    expect(handler).not.toContain('[role="tab"]:not([disabled])')
    // disabled 跳过：enabled 数组 + step()，Home/End 取首/末 enabled 位
    expect(handler).toContain('tabs.map((t) => !t.disabled)')
    expect(handler).toContain('const step = (from: number, dir: 1 | -1): number => {')
    expect(handler).toContain('const firstEnabled = enabled.findIndex(Boolean)')
    expect(handler).toContain('const lastEnabled = enabled.lastIndexOf(true)')
    // ←/→/Home/End 四键 + 先判键再 preventDefault
    for (const key of ["'ArrowRight'", "'ArrowLeft'", "'Home'", "'End'"]) {
      expect(handler).toContain(`event.key === ${key}`)
    }
    expect(handler).toContain('event.preventDefault()')
    // 切 tab 走 chooseTab + focus，不用 .click()，不做 URL 同步
    expect(handler).toContain('chooseTab(DOCK_TABS[next])')
    expect(handler).toContain('tabs[next]?.focus()')
    expect(handler).not.toContain('.click()')
    expect(handler).not.toContain('selectTab')
  })
})

describe('tablist A-2：其余 tablist 按 plugin-detail-view 模板补 roving tabIndex + 方向键（2026-11-24 17:22 轮）', () => {
  // 全仓共 14 处 role="tablist"（apps/web-overlay/src 下 grep 实数）：
  // 已达标 6 处——plugin-detail-view（模板本身）、home-quick-dock（A-1）、
  // workspace-filter、home-capsule-row、navigation-category-section、
  // growth-panel（后三处为旧式 ←/→ + .click() 写法，有方向键处理，本轮不重写）；
  // 本轮新补 8 处——drama、site-reports、history、bookmark-importer ×3、
  // video-ai-learning-dialog、video-auto-harvest-dialog。
  // 模板要点（与 A-1 同款）：守卫 role="tab"、全量 querySelectorAll 保下标
  // 映射（禁 '[role="tab"]:not([disabled])'）、step() 跳 disabled、
  // Home/End 取首/末 enabled、先判键再 preventDefault、选择 + focus、
  // 不用 .click()、不做 URL 同步。

  it('已达标 6 处：容器挂 onKeyDown 且 tab 有 roving tabIndex（防回归）', () => {
    const detail = read('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    expect(detail).toContain('onKeyDown={handleTabKeyDown}')
    expect(count(detail, "tabIndex={activeTab === '")).toBe(6)
    const dock = read('src/components/home-quick-dock.tsx')
    expect(dock).toContain('onKeyDown={handleTabKeyDown}')
    expect(count(dock, "tabIndex={activeTab === '")).toBe(3)
    const filter = read('src/components/workspace-filter.tsx')
    expect(filter).toContain('onKeyDown={handleTabKeyDown}')
    expect(filter).toContain('tabIndex={isActive ? 0 : -1}')
    const capsule = read('src/components/home-capsule-row.tsx')
    expect(capsule).toContain('onKeyDown={handleTabKeyDown}')
    expect(capsule).toContain('tabIndex={isActive ? 0 : -1}')
    const navcat = read('src/components/navigation-category-section.tsx')
    expect(navcat).toContain('role="tablist"')
    expect(navcat).toContain("tabIndex={selectedSubCatId === null ? 0 : -1}")
    const growth = read('src/components/user-center/growth-panel.tsx')
    expect(growth).toContain('onKeyDown={handleTabKeyDown}')
    expect(growth).toContain('tabIndex={selected ? 0 : -1}')
  })

  it('drama 榜单：容器挂 onKeyDown，三 tab 顺序常量与 handler 接线齐全', () => {
    const src = read('src/components/drama-rankings-section.tsx')
    expect(src).toContain('onKeyDown={handleTabKeyDown}')
    expect(src).toContain('const DRAMA_TABS = TABS.map((t) => t.kind)')
    expect(src).toContain('const handleTabKeyDown')
    expect(count(src, "tabIndex={tab === t.kind ? 0 : -1}")).toBe(1)
    const handler = src.slice(
      src.indexOf('const handleTabKeyDown'),
      src.indexOf('\n  }', src.indexOf('const handleTabKeyDown')),
    )
    expect(handler).toContain("target.getAttribute(\"role\") !== \"tab\"")
    expect(handler).toContain("querySelectorAll<HTMLButtonElement>('[role=\"tab\"]')")
    expect(handler).not.toContain('[role="tab"]:not([disabled])')
    expect(handler).toContain('tabs.map((t) => !t.disabled)')
    expect(handler).toContain('const step = (from: number, dir: 1 | -1): number => {')
    expect(handler).toContain('const firstEnabled = enabled.findIndex(Boolean)')
    expect(handler).toContain('const lastEnabled = enabled.lastIndexOf(true)')
    for (const key of ['"ArrowRight"', '"ArrowLeft"', '"Home"', '"End"']) {
      expect(handler).toContain(`event.key === ${key}`)
    }
    expect(handler).toContain('event.preventDefault()')
    expect(handler).toContain('onTab(DRAMA_TABS[next])')
    expect(handler).toContain('tabs[next]?.focus()')
    expect(handler).not.toContain('.click()')
  })

  it('site-reports 状态筛选：容器挂 onKeyDown，五 tab 顺序常量与 handler 接线齐全', () => {
    const src = read('src/app/admin/site-reports/page.tsx')
    expect(src).toContain('onKeyDown={handleTabKeyDown}')
    expect(src).toContain('const STATUS_KEYS = STATUS_TABS.map((t) => t.key)')
    expect(src).toContain('const handleTabKeyDown')
    expect(count(src, 'tabIndex={status === tab.key ? 0 : -1}')).toBe(1)
    const handler = src.slice(
      src.indexOf('const handleTabKeyDown'),
      src.indexOf('\n  }', src.indexOf('const handleTabKeyDown')),
    )
    expect(handler).toContain("target.getAttribute('role') !== 'tab'")
    expect(handler).toContain("querySelectorAll<HTMLButtonElement>('[role=\"tab\"]')")
    expect(handler).not.toContain('[role="tab"]:not([disabled])')
    expect(handler).toContain('tabs.map((t) => !t.disabled)')
    expect(handler).toContain('const step = (from: number, dir: 1 | -1): number => {')
    expect(handler).toContain('const firstEnabled = enabled.findIndex(Boolean)')
    expect(handler).toContain('const lastEnabled = enabled.lastIndexOf(true)')
    for (const key of ["'ArrowRight'", "'ArrowLeft'", "'Home'", "'End'"]) {
      expect(handler).toContain(`event.key === ${key}`)
    }
    expect(handler).toContain('event.preventDefault()')
    expect(handler).toContain('setStatus(STATUS_KEYS[next])')
    expect(handler).toContain('tabs[next]?.focus()')
    expect(handler).not.toContain('.click()')
  })
})
