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
 *   3. 有意不动的项：卡片内星标（操作区 26px 间距装不下 44px，需布局决策）、
 *      顶部工具栏的 180px 收缩容器、DIY 工具栏右侧撤销簇——只锁现状防回归，
 *      不伪装成已修好（见各处注释与本轮报告的跟进项）。
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

  it('footer 仍为底栏预留 5.5rem + 安全区', () => {
    const src = read('src/components/footer.tsx')
    expect(src).toContain('pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:pb-8')
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

  it('footer：16 个页脚链接与备案号链接全部 44px', () => {
    const src = read('src/components/footer.tsx')
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(17)
    expect(src).not.toContain('min-h-6')
    expect(src).toContain('https://beian.miit.gov.cn/')
  })
})

describe('P1 #10 触控目标：首页常驻控件', () => {
  it('floating-quick-nav：三个浮钮 44×44', () => {
    const src = read('src/components/floating-quick-nav.tsx')
    expect(count(src, 'h-11 w-11')).toBe(3)
    expect(src).not.toContain('w-7.5 h-7.5')
  })

  it('category-quick-jump-bar：切换/常用/分类 chips 与视频入口 44px', () => {
    const src = read('src/components/category-quick-jump-bar.tsx')
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(4)
    // 左右滚动箭头只在 sm 以上出现，不是移动端目标
    expect(src).toContain('hidden sm:flex items-center justify-center h-7 w-7')
  })

  it('directory-pill-toolbar：目录胶囊 44px', () => {
    const src = read('src/components/directory-pill-toolbar.tsx')
    expect(src).toContain('min-h-11 px-3')
    expect(src).not.toContain('min-h-6')
  })

  it('workspace-filter：工作区切换 chips 44px', () => {
    const src = read('src/components/workspace-filter.tsx')
    expect(src).toContain('flex min-h-11 items-center gap-1.5 px-2.5 py-1 rounded-full')
  })

  it('quick-access-tray：筛选页签与折叠钮 44px', () => {
    const src = read('src/components/quick-access-tray.tsx')
    expect(count(src, 'min-h-11 min-w-11')).toBe(3)
    expect(src).toContain('className="h-11 w-11 text-muted-foreground hover:text-foreground"')
  })
})

describe('P1 #10 触控目标：顶部工具栏与开关', () => {
  it('navigation-toolbar：8 个图标钮统一 44×44，单行菜单项 44px', () => {
    const src = read('src/components/navigation-toolbar.tsx')
    expect(count(src, 'h-11 w-11')).toBe(8)
    expect(src).not.toContain('h-9 w-9')
    expect(count(src, 'min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent')).toBe(8)
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

  it('favorite-button：卡片内星标仍是 26px（有意不动，等布局决策）', () => {
    const src = read('src/components/favorite-button.tsx')
    // 卡片操作区是 26px 间距的密集按钮簇（navigation-card.tsx），44px 命中区
    // 会盖住邻钮；这里锁死现状，改动必须先做布局决策（见本轮报告跟进项）。
    expect(src).toContain('h-6.5 w-6.5')
    expect(src).toContain('26px 间距的密集按钮簇')
  })

  it('navigation-category-section：折叠/复制/图谱/筛选/子分类页签 44px', () => {
    const src = read('src/components/navigation-category-section.tsx')
    expect(src).toContain('min-h-11 min-w-11 p-1 -ml-1')
    expect(src).toContain('min-h-11 min-w-11 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground')
    expect(src).toContain('min-h-11 min-w-11 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-primary')
    expect(src).toContain('min-h-11 min-w-11 px-1.5 rounded-md')
    expect(src).toContain("after:absolute after:-inset-3.5 after:content-['']")
    expect(count(src, 'min-h-11 px-2.5 py-1 rounded-lg')).toBe(3)
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
    expect(count(src, 'min-h-11')).toBeGreaterThanOrEqual(20)
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
    expect(count(src, 'min-h-11 text-xs sm:text-sm gap-1.5 rounded-lg')).toBe(2)
    expect(src).toContain('<DensityToggle className="border border-border/40" />')
    expect(src).not.toContain('h-8.5 w-8.5')
    expect(src).toContain('inline-flex min-h-11 min-w-11 items-center justify-center p-1.5 rounded-md')
    expect(src).toContain('inline-flex min-h-11 items-center text-xs text-primary')
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
