import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 视频页分类筛选（?c=）的源码级守卫。
 *
 * 为什么不上行为测试：筛选逻辑依赖 window.location / history.replaceState，
 * 行为测试要拉起 Next 才能覆盖；而最容易回归的两点——「为了筛选芯片把 ISR
 * 静态页拖成动态渲染」和「URL 状态与渲染用的不是同一份值」——都能在源码层
 * 一眼断言。
 */

const SRC = join(import.meta.dirname, '..', 'src')
const code = readFileSync(join(SRC, 'components', 'video-content.tsx'), 'utf8')

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('视频页分类 chips 与 URL 深链', () => {
  it('不用 useSearchParams（ISR 静态页读到 searchParams 会整段退化为客户端渲染）', () => {
    expect(stripComments(code)).not.toContain('useSearchParams')
  })

  it('从 location 读取 ?c=，并监听 popstate 覆盖前进/后退', () => {
    expect(code).toContain("new URLSearchParams(window.location.search).get('c')")
    expect(code).toContain("addEventListener('popstate'")
    expect(code).toContain("removeEventListener('popstate'")
  })

  it('筛选切换用 replaceState 而不是 pushState（不产生历史条目）', () => {
    expect(code).toContain("url.searchParams.set('c', id)")
    expect(code).toContain("url.searchParams.delete('c')")
    expect(code).toContain('window.history.replaceState')
    expect(stripComments(code)).not.toContain('window.history.pushState')
  })

  it('失效的 ?c= 回退到「全部」，不渲染空列表', () => {
    expect(code).toMatch(/categoryChips\.some\(\(chip\) => chip\.id === activeCategory\)/)
  })

  it('芯片是带 aria-pressed 的 button，计数派生自可见数据', () => {
    expect(code).toContain('aria-label="按分类筛选视频"')
    expect(code).toContain('aria-pressed={activeCategoryId === null}')
    expect(code).toContain('aria-pressed={activeCategoryId === chip.id}')
    expect(code).toContain('const categoryChips = useMemo(')
    expect(code).toContain('visibleCategories.map(')
  })

  it('分类锚点 id 保留（深链 /videos#<categoryId> 仍然有效）', () => {
    expect(code).toContain('<section key={category.id} id={category.id}')
  })

  it('支持二级子分类 chips 与 ?sub= 级联筛选', () => {
    expect(code).toContain("new URLSearchParams(window.location.search).get('sub')")
    expect(code).toContain("url.searchParams.set('sub', subId)")
    expect(code).toContain("url.searchParams.delete('sub')")
    expect(code).toContain('aria-label="按二级子分类细化筛选"')
    expect(code).toContain('const subCategoryChips = useMemo(')
  })
})
