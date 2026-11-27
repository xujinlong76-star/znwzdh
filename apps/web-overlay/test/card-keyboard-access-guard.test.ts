/**
 * P0-3 + P0-4 回归守卫：卡片「平替」与「标签」必须有键盘入口。
 *
 * 背景：
 * - P0-3：「平替」曾是可点 <span>（无 role/tabIndex/onKeyDown，也不在
 *   data-card-action 漫游集内），键盘用户永远到不了。现改为真 <button>，
 *   带 data-card-action + tabIndex={-1}，进方向键漫游，Enter/Space 触发速览。
 * - P0-4：标签曾是真 <Link> 却被 tabIndex={-1} 移出 Tab 序，且不在漫游集内。
 *   现加 data-card-action 纳入 ←/→ 漫游（Tab 停留点仍每卡 1 个，不回 6 个）。
 * - 漫游处理器 handleActionsKeyDown 已从底栏容器移到三处卡片根节点，
 *   漫游集覆盖内容层（标签/平替）与底栏按钮；守卫防与覆盖层 <a> 的 → 双重处理。
 *
 * 注意：仓库 vitest 是 node 环境、无 jsdom，做不了真实键盘漫游实测；
 * 本文件是源码级守卫，浏览器里的 ←/→/Enter 实测须另行复核。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** overlay 与 apps/web 两份布局下都指向包根（与 drag-system-guard 同款） */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function read(rel: string): string {
  return readFileSync(resolve(ROOT, 'src', rel), 'utf-8')
}

describe('P0-3/P0-4 卡片键盘入口守卫', () => {
  const card = () => read('components/navigation-card.tsx')

  it('P0-3：平替是真 button（两处：rich + 默认），不再是可点 span', () => {
    const src = card()
    // 两处平替均为 <button type="button" data-card-action tabIndex={-1}>
    const buttons = src.match(/<button\n\s+type="button"\n\s+data-card-action\n\s+tabIndex=\{-1\}/g) || []
    expect(buttons.length).toBe(2)
    expect(src).toContain('aria-label={`查看平替：${topAlternative.targetTitle}`}')
    // 不得残留可点 span（平替的 onClick 必须挂在 button 上）
    expect(src).not.toMatch(/<span\n\s+onClick=\{\(e\) => \{\n\s+e\.preventDefault\(\)\n\s+e\.stopPropagation\(\)\n\s+onPeek\?\. \(item\)/)
  })

  it('P0-4：两处标签 Link 均带 data-card-action，且仍 tabIndex={-1}（不占 Tab 停留点）', () => {
    const src = card()
    const tagLinks = src.match(/href=\{'\/tags\/' \+ encodeURIComponent\(tagSlug\(tag\)\)\}\n\s+onClick=\{handleTagClick\}\n\s+tabIndex=\{-1\}\n\s+data-card-action/g) || []
    expect(tagLinks.length).toBe(2)
  })

  it('漫游处理器挂在三处卡片根节点，不在底栏容器上（防同一按键处理两次）', () => {
    const src = card()
    const roots = src.match(/onKeyDown=\{handleActionsKeyDown\}/g) || []
    expect(roots.length).toBe(3)
    // 底栏容器不再挂处理器
    expect(src).not.toContain(')}\n                onKeyDown={handleActionsKeyDown}\n              >')
    // 守卫：事件源不是 [data-card-action] 时直接返回（防与覆盖层 <a> 的 → 双重处理）
    expect(src).toContain("if (!(e.target as HTMLElement | null)?.closest?.('[data-card-action]'))")
  })

  it('sr-only 键盘提示说明标签与平替在方向键漫游内', () => {
    const content = read('components/navigation-content.tsx')
    expect(content).toContain('标签、平替与底栏按钮都在内')
  })
})
