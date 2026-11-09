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

  it('输入框右侧预留 ≥ 6.75rem（pr-36 = 9rem 起），占位符不会被徽章盖住', () => {
    expect(src).toContain('pr-36 sm:pr-44 md:pr-48')
    // 不许退回「只留 pr-2/pr-3」的老写法
    expect(src).not.toMatch(/\bpl-9[^"']*\bpr-[1-8]\b/)
  })

  it('Omni 命令前缀四件套齐全（@g / @gh / @npm / @mdn）', () => {
    // 键名不带 @，解析器允许 `@` 前缀；这里锁「四个引擎都真实存在」
    for (const key of ['g:', 'gh:', 'npm:', 'mdn:']) {
      expect(src, `缺少 ${key} 引擎`).toContain(key)
    }
    expect(src).toContain('parseOmniCommand')
    expect(src).toContain('/^@?([a-zA-Z]+)')
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

describe('悬浮工具栏：内容底部安全区', () => {
  it('主内容容器留出 pb-28 sm:pb-36（≥ 7rem）', () => {
    const src = overlaySource('src/components/navigation-content.tsx')
    expect(src).toContain('pb-28 sm:pb-36')
  })

  it('悬浮工具栏只在滚动后显形，回顶遵循用户滚动偏好', () => {
    const src = overlaySource('src/components/floating-quick-nav.tsx')
    expect(src).toContain('preferredScrollBehavior')
    expect(src).toContain('scrollToTop')
  })
})

describe('站点卡片：单外链 + 整卡热区', () => {
  const src = overlaySource('src/components/navigation-card.tsx')

  it('整卡热区是一个带无障碍名称的外链，不产生 a:empty', () => {
    expect(src).toContain('absolute inset-0 z-0')
    expect(src).toContain('aria-label={selectable ? `选择站点：${item.title}` : `访问 ${item.title}`}')
    // 空锚点会被 a:empty 守卫抓住：外链里必须有 sr-only 文本
    expect(src).toContain('<span className="sr-only">{`访问 ${item.title}`}</span>')
  })

  it('标题是单行截断、简介固定两行，保证相邻卡片等高', () => {
    expect(src).toContain('line-clamp-1 truncate')
    expect(src).toContain('line-clamp-2 leading-relaxed')
    expect(src).toContain('min-h-[2.5rem]')
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
