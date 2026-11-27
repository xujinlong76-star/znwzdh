import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /hot 标题链进站内详情（UX #2）：榜单卡片标题点按应进 `/site/{id}` 站内
 * 详情页，而不是新标签页直接跳外站；右上角图标按钮保留为唯一站外直达。
 * 与首页 navigation-card.tsx 的「标题内链」模型一致。
 *
 * 行为变化点（有意为之，见 hot-view.tsx 注释）：2026-11-15 前标题是
 * `<a href={safeHref(site.url)} target="_blank">` 外链，底部另有一条
 * 「站内详情」小字链与标题同目标、重复占一个 Tab 停留点；本次把标题
 * 改为站内详情内链并删掉底部小字链，站外直达只剩右上角图标按钮。
 */

const SRC = join(import.meta.dirname, '..', 'src', 'app', 'hot', 'hot-view.tsx')
const code = readFileSync(SRC, 'utf8')

describe('/hot 标题链进站内详情', () => {
  it('标题锚点是站内详情内链 /site/{id}，不是外链', () => {
    const idx = code.indexOf('className="block min-w-0 flex-1"')
    expect(idx).toBeGreaterThan(-1)
    const tag = code.slice(Math.max(0, idx - 200), idx)
    expect(tag).toContain('<Link')
    expect(tag).toContain('href={`/site/${encodeURIComponent(site.id)}`}')
    expect(tag).not.toContain('target="_blank"')
    expect(tag).not.toContain('safeHref(site.url)')
  })

  it('站外直达只剩右上角图标按钮一处', () => {
    expect(code.match(/safeHref\(site\.url\)/g)?.length).toBe(1)
    const idx = code.indexOf('title="新窗口直达"')
    expect(idx).toBeGreaterThan(-1)
    const tag = code.slice(Math.max(0, idx - 400), idx)
    expect(tag).toContain('href={safeHref(site.url)}')
    expect(tag).toContain('target="_blank"')
  })

  it('卡片内不再有与标题同目标的「站内详情」小字链', () => {
    expect(code).not.toContain('站内详情')
  })
})
