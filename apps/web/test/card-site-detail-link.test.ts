import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 卡片 → 站内站点详情（/site/{id}）。
 *
 * 改的是什么：卡片此前只有「整卡直达外站」一条路，用户想看收录详情
 * （标签、平替、健康度）必须自己拼 URL。现在标题是站内内链，卡片主体
 * 仍开外站。
 *
 * 棘手的约束是键盘模型：整卡只能有一个 Tab 停留点。标题内链因此
 * tabIndex=-1，键盘用户经 → 进入操作区后，用共用的「详情」按钮到达同一目标；
 * 三个密度变体必须各接一次，漏一个就有一种密度键盘不可达。
 */

const SRC = join(import.meta.dirname, '..', 'src')
const code = readFileSync(join(SRC, 'components', 'navigation-card.tsx'), 'utf8')

describe('卡片标题站内详情内链', () => {
  it('三种密度都渲染 /site/{id} 标题内链', () => {
    expect(code).toContain('const siteDetailHref = `/site/${encodeURIComponent(item.id)}`')
    // 3 处标题内链 + detailAction() 里 1 处共用操作入口
    expect(code.match(/href=\{siteDetailHref\}/g)?.length).toBe(4)
  })

  it('标题内链与详情入口都不新增 Tab 停留点（tabIndex=-1）', () => {
    const matches = [...code.matchAll(/href=\{siteDetailHref\}[\s\S]{0,700}?>/g)]
    expect(matches.length).toBe(4)
    for (const m of matches) expect(m[0]).toContain('tabIndex={-1}')
  })

  it('自定义合成站点不渲染详情内链（/site/{id} 会 404）', () => {
    expect(code).toContain("const hasSiteDetail = !item.id.startsWith('custom_site_')")
    expect(code.match(/\{hasSiteDetail \? \(/g)?.length).toBe(3)
  })

  it('多选模式下标题点击与整卡同语义：不导航，只切换选中', () => {
    const idx = code.indexOf('const handleDetailClick')
    expect(idx).toBeGreaterThan(-1)
    const body = code.slice(idx, idx + 220)
    expect(body).toContain('if (!selectable) return')
    expect(body.indexOf('if (!selectable) return')).toBeLessThan(body.indexOf('preventDefault'))
    expect(body).toContain('onToggleSelect?.(item.id)')
  })

  it('操作区有键盘可达的详情入口（共用 detailAction，三变体各用一次）', () => {
    expect(code).toContain('data-card-action=""')
    expect(code).toContain('title="查看站点详情"')
    expect(code.match(/detailAction\(/g)?.length).toBe(3)
    expect(code).toContain('aria-label={`查看站点详情：${item.title}`}')
  })

  it('外链覆盖层有可读名称，且禁止原生链接拖拽（不劫持 DIY 拖拽）', () => {
    expect(code).toContain('aria-label={selectable ? `选择站点：${item.title}` : `访问 ${item.title}`}')
    expect(code.match(/draggable=\{false\}/g)?.length).toBe(3)
  })
})
