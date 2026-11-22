import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * U-408：/marketplace 每次加载水合失败。
 *
 * 根因：插件卡片作者行是 `<p>`，里面挂了 `AuthorVerifiedBadge` → `Badge`
 * 根节点是 `<div>`。HTML 解析器遇到 `<p>` 内的 `<div>` 会提前闭合 `<p>`，
 * SSR 发出的 `<p><div data-testid="author-verified-badge">…` 到浏览器里
 * 变成 `<p>…</p><div …>`，与 React 客户端树不一致 → 整树丢弃重生成，
 * 首轮点击可被吞。实发 HTML 实锤：48 处作者行 `<p class="flex flex-wrap …">`
 * 内含 `<div … data-testid="author-verified-badge">`，42/43 插件触发。
 *
 * 修复（选 b，不动全局 Badge）：作者行 `<p>` → `<div>`。作者行是元数据行
 * （标签 + 作者链接 + 徽章），不是正文段落，`<div>` 语义无损；全部 flex
 * 类名原样保留，布局不变。Badge 仍是 `<div>`（76 个文件 / 236 处用量，
 * 改全局根节点回归面过大，不为单点缺陷改全局组件）。
 *
 * 断言风格沿用 P2-1 plugin-author-verified-badge-p2-1.test.ts 的源码断言：
 * 卡片不做 DOM 渲染（next/link、next/dynamic 需整套 mock），锁定嵌套结构。
 *
 * R7 证伪：本文件在基底（作者行仍是 `<p>`）上必须红——「作者行不是 <p>」
 * 与「没有任何 <p> 块包含 <div>/Badge」两条都会失败；修复后全绿。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..')

function overlayRead(rel: string): string {
  return readFileSync(resolve(OVERLAY, rel), 'utf8')
}

const CARD = overlayRead('src/components/plugins/plugin-card.tsx')

/** 取出所有 `<p …>…</p>` 块（非贪婪，与浏览器解析前的源码结构一致）。 */
function pBlocks(src: string): string[] {
  return src.match(/<p[\s>][\s\S]*?<\/p>/g) ?? []
}

describe('U-408 插件卡片作者行水合：<p> 内不得嵌套 <div>/Badge', () => {
  it('作者行不是 <p>：改用 <div> 承载作者名 + 链接 + 认证徽章', () => {
    // 作者行锚点：徽章条件渲染仍在作者行内
    expect(CARD).toContain('{plugin.authorVerified === true && <AuthorVerifiedBadge />}')
    // 作者行容器是 div（flex 类名原样保留，布局不变）
    expect(CARD).toContain(
      '<div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">'
    )
    expect(CARD).not.toContain(
      '<p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">'
    )
  })

  it('卡片内没有任何 <p> 块包含 <div> / <Badge> / AuthorVerifiedBadge', () => {
    const bad = pBlocks(CARD).filter((b) => /<div|<Badge|AuthorVerifiedBadge/.test(b))
    expect(bad).toEqual([])
  })

  it('作者行仍展示作者名、ownerKey 链向作者页、徽章只在严格 true 时出现（行为不变）', () => {
    expect(CARD).toContain('作者：')
    expect(CARD).toContain('href={`/marketplace/author/${encodeURIComponent(plugin.ownerKey)}`}')
    expect(CARD).toContain('{plugin.authorVerified === true && <AuthorVerifiedBadge />}')
    const badgeUses = CARD.split('<AuthorVerifiedBadge />').length - 1
    expect(badgeUses).toBe(1)
  })

  it('徽章本体未动：仍是共享 AuthorVerifiedBadge，data-testid 与文案不变', () => {
    expect(CARD).toContain('export function AuthorVerifiedBadge')
    expect(CARD).toContain('data-testid="author-verified-badge"')
    expect(CARD).toContain('认证作者')
  })

  it('描述段落仍是 <p>（纯文本，无块级子元素，水合安全）', () => {
    expect(CARD).toContain(
      '<p className="text-[13px] text-muted-foreground line-clamp-2 leading-relaxed min-h-[38px] break-words">'
    )
    const desc = pBlocks(CARD).find((b) => b.includes('line-clamp-2'))
    expect(desc).toBeDefined()
    expect(desc).not.toMatch(/<div|<Badge|AuthorVerifiedBadge/)
  })
})
