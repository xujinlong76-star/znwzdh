import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 首页 UI 治理守卫（2026-11-09）。
 *
 * 锁住五类「改回去就会复发」的结构事实：
 *  1. 顶栏搜索框给右侧快捷键徽章留出足够内容区（占位符不被压住）；
 *  2. 侧栏「空间所有者」徽章不收缩、不换行，标题可截断；
 *  3. 主内容底部给右下悬浮工具栏留安全区；
 *  4. 站点卡片每张只有一个可聚焦外链（整卡热区 + sr-only 名称），不出现 `a:empty`；
 *  5. 大分类渲染隔离与 Omni 命令前缀确实接线。
 *
 * 只扫描源码，不启动浏览器；几何/视觉证据由 scripts/tmp-verify-all.cjs 在
 * 1440/768 双视口实测（该脚本为一次性验收工具，不入库）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/'))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('首页顶栏：搜索框与快捷键徽章', () => {
  const src = overlaySource('src/components/search-palette.tsx')

  it('输入框与右侧操作区 Flex 内布局：占位符不可能被 AI 按钮/清空按钮盖住', () => {
    // header-scroll-refactor-1222：旧实现靠 input 右 padding（pr-26 起）给 absolute
    // 操作区让位；1024px 档根节点 lg:min-w-[420px] 把框顶出父容器后，预留失效、
    // 操作区与外部按钮叠在一起。新实现操作区是 in-flow 的 shrink-0 兄弟节点，
    // input 为 flex-1 min-w-0——占位符再也不会被盖住，固定右 padding 不再需要，
    // 断言按新行为改写（仍禁回 absolute 簇 + 固定右 padding 的老写法）。
    expect(src).toContain('className="h-9.5 min-w-0 flex-1 border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0')
    expect(src).toContain('<div className="flex shrink-0 items-center gap-1.5">')
    expect(src).not.toContain('absolute right-2 top-1/2 flex items-center gap-1.5')
    expect(src).not.toContain('pr-26 sm:pr-44 md:pr-48')
  })

  it('Omni 命令前缀四件套齐全（@g / @gh / @npm / @mdn）', () => {
    // Batch 1 L6（2026-11-21）：引擎表从 search-palette.tsx 的 OMNI_ENGINES
    // 搬到 src/lib/quicklinks.ts 的 DEFAULT_QUICKLINK_ENTRIES（全仓唯一定义点），
    // 面板只剩 parseOmniCommand 薄壳。守卫跟到新位置，不改弱：
    // 四引擎必须真实存在 + 面板不得自立第二份引擎表。
    // 键名不带 @、不带冒号（quickPrefix: 'gh'），解析器允许 `@` / `!` / 裸前缀
    // 三种写法；这里锁「四个引擎都真实存在」。
    // Phase 2 批 A：导航搜索条与快捷链接都认 !gh，首页面板旧正则只认 @/无前缀，
    // 输「!gh react」恒为 null、建议行永远不出；三形态正则须都在 quicklinks.ts，
    // 断言按新行为改写。
    const engines = overlaySource('src/lib/quicklinks.ts')
    expect(engines).toContain('DEFAULT_QUICKLINK_ENTRIES')
    for (const key of ['g', 'gh', 'npm', 'mdn']) {
      expect(engines, `缺少 ${key} 引擎`).toContain(`quickPrefix: '${key}'`)
    }
    // 三种前缀形态的解析正则都在 quicklinks.ts（唯一 bang 权威）
    expect(engines).toContain('/^!([A-Za-z0-9_-]+)')
    expect(engines).toContain('/^@([A-Za-z0-9_-]+)')
    expect(engines).toContain('/^([A-Za-z0-9_-]+)')
    // 面板只调薄壳，不自立引擎表：无 OMNI_ENGINES、无 quickPrefix: 定义
    expect(src).toContain('parseOmniCommand')
    expect(src).not.toContain('OMNI_ENGINES')
    expect(src).not.toContain('quickPrefix:')
  })
})

describe('侧栏：空间所有者徽章不被裁切', () => {
  const src = overlaySource('src/components/workspace/workspace-switcher.tsx')

  it('徽章 shrink-0 + nowrap，标题 min-w-0 + truncate', () => {
    expect(src).toContain('shrink-0 whitespace-nowrap')
    expect(src).toContain('truncate font-medium')
    // 触发器必须允许子项收缩，否则长空间名把徽章挤出容器
    expect(src).toContain('min-w-0 flex-1 overflow-hidden')
  })
})

  describe('主内容容器底部留白', () => {
    it('主内容容器底部内边距收至 pb-8', () => {
    const src = overlaySource('src/components/navigation-content.tsx')
      expect(src).toContain('pb-8 flex-1')
  })

  it('悬浮工具栏只在滚动后显形，回顶遵循用户滚动偏好', () => {
    // 订正（2026-11-20 首屏瘦身）：FloatingQuickNav 已整体删除，回顶改由命令
    // 面板「回到页面顶部」指令覆盖，仍遵循 preferredScrollBehavior（减速偏好）。
    const modal = overlaySource('src/components/search/spotlight-modal.tsx')
    expect(modal).toContain("id: 'cmd-scroll-top'")
    expect(modal).toContain('preferredScrollBehavior')
    expect(modal).toContain('window.scrollTo({ top: 0')
    expect(modal).toContain('回到页面顶部')
  })
})

describe('站点卡片：单外链 + 整卡热区', () => {
  const src = overlaySource('src/components/navigation-card.tsx')
  // S2 迁移（2026-11-26）：标准档覆盖层锚点由 SiteCard 渲染，sr-only 文本随组件走
  const siteCardSrc = overlaySource('src/components/site-card.tsx')

  it('整卡热区是一个带无障碍名称的外链，不产生 a:empty', () => {
    // S2–S4 迁移（2026-11-26）：三档覆盖层锚点全部由 SiteCard 渲染，
    // 「absolute inset-0 z-0」基类收进原语；navigation-card 只传 overlayProps 差异。
    expect(siteCardSrc).toContain('absolute inset-0 z-0')
    // 多选态 label 带「按空格切换选中」（580b963 键盘批量整理有意加的读屏提示）；
    // 三档均经 overlayProps 传（对象字面量形态）。
    expect(src).toContain("'aria-label': selectable ? `选择站点：${item.title}，按空格切换选中` : `访问 ${item.title}`")
    // 空锚点会被 a:empty 守卫抓住：外链里必须有 sr-only 文本（SiteCard 统一渲染）
    expect(siteCardSrc).toContain('<span className="sr-only">')
    // 三档必须显式传 overlayLabel（与 aria-label 同一表达式），不能落到默认文案
    expect((src.match(/overlayLabel=\{selectable \? `选择站点：/g) ?? []).length).toBe(3)
  })

  it('标题是单行截断、简介固定两行，保证相邻卡片等高', () => {
    // S2–S4 迁移（2026-11-26）：截断/两行类收进 SiteCard 配方（TITLE_INNER_LINK 的
    // truncate + DESC.grid 的 line-clamp-2 leading-relaxed）；navigation-card 经
    // titleLinkProps 传单行截断（standard/rich line-clamp-1、compact truncate 圆角行内）+
    // rootProps h-full（网格同行等高）。
    expect((src.match(/line-clamp-1/g) ?? []).length).toBe(2)
    expect(src).toContain("truncate rounded-sm text-sm sm:text-base font-semibold")
    expect(src, "三档 rootProps 都带 h-full（网格同行等高）").toContain('h-full overflow-hidden group/card')
    expect(siteCardSrc).toContain('line-clamp-2 leading-relaxed')
    expect(siteCardSrc).toContain('truncate')
  })
})

describe('渲染隔离与统计数字', () => {
  it('分类区块启用 content-visibility + contain-intrinsic-size', () => {
    const css = overlaySource('src/styles/globals.css')
    expect(css).toContain('content-visibility: auto')
    expect(css).toContain('contain-intrinsic-size')
  })

  it('首页组件不硬编码全站站点数（4,639 / 4,839 / 4639 / 4839）', () => {
    for (const file of [
      'src/components/navigation-content.tsx',
      'src/components/navigation-card.tsx',
      'src/components/search-palette.tsx',
    ]) {
      const src = overlaySource(file)
      for (const dead of ['4,639', '4639', '4,839', '4839']) {
        expect(src, `${file} 出现硬编码统计 ${dead}`).not.toContain(dead)
      }
    }
  })
})
