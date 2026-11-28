import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 详情页出站点击上报：/site/{id} 的两个出站锚点必须进热度统计。
 *
 * 真实缺陷（2026-11-28 21:22 研究轮 §3.2）：site-detail-view.tsx 全文件
 * 0 处 reportClick——URL 文本链与「立即直达官方主站」CTA 都没有 onClick
 * 上报。用户旅程是「卡片 → 详情页 → 出站」，卡片点击只证明「进了详情」，
 * 出站那一下才是「真去了官网」；详情页正是用户出站前的最后一站，传感器
 * 恰好在价值最高的点击上缺失，全站 visit_count / trend_score 因此恒 0。
 *
 * 修复（2026-11-28 22:22 轮 A）：两处出站锚点共用 handleOutboundClick，
 * 口径与 navigation-card.tsx 的 handleLinkClick 一致：
 * reportClick(site.id, getIdentity())，不带 position（详情页无榜单名次）。
 * reportClick 是 fire-and-forget，失败静默落端侧出箱，永不阻塞跳转；
 * href/target/rel/文案/DOM 结构全不动。复制、收藏、纠错、wayback、
 * 相关站链不报——只接两处出站锚点。
 *
 * 诚实边界（与 hot-report-click.test.ts 同口径）：本仓库 vitest 是 node
 * 环境，无 jsdom / @testing-library/react，直接 import .tsx 渲染点按做不到；
 * 本文件钉住「两处接线都在、口径一致、只报两次、其余按钮不报」，真实的
 * 点按送达由 :3200 E2E 合成点击验证（visit_count +1 → trend_score > 0）。
 */

const SRC = join(import.meta.dirname, '..', 'src', 'components', 'site-detail-view.tsx')
const code = readFileSync(SRC, 'utf8')

/** 取某次出现位置前后的窗口文本 */
function windowAround(haystack: string, needle: string, before: number, after: number): string {
  const idx = haystack.indexOf(needle)
  expect(idx).toBeGreaterThan(-1)
  return haystack.slice(Math.max(0, idx - before), idx + needle.length + after)
}

describe('详情页出站点击上报接线', () => {
  it('引入 reportClick 与 getIdentity，口径与导航卡片一致', () => {
    expect(code).toContain("import { getIdentity } from '@/lib/identity'")
    expect(code).toContain('reportClick,')
    expect(code).toContain("from '@/lib/navhub-api'")
  })

  it('两处出站锚点共用一个 handleOutboundClick，不带 position', () => {
    expect(code).toContain('const handleOutboundClick = () => {')
    expect(code).toContain('reportClick(site.id, getIdentity())')
    // 全文件只有这一处 reportClick 调用（handler 内），两处锚点各用一次
    expect(code.match(/reportClick\(site\.id, getIdentity\(\)\)/g)?.length).toBe(1)
    expect(code.match(/onClick=\{handleOutboundClick\}/g)?.length).toBe(2)
    expect(code).not.toContain('reportClick(site.id, getIdentity(), { position')
  })

  it('URL 文本链点击上报', () => {
    const tag = windowAround(code, 'break-all font-mono', 300, 0)
    expect(tag).toContain('href={safeHref(site.url)}')
    expect(tag).toContain('onClick={handleOutboundClick}')
  })

  it('「立即直达官方主站」CTA 点击上报', () => {
    // 用 <span>…</span> 作锚：handler 上方的注释里也出现了「立即直达官方主站」
    // 字样，indexOf 会先命中注释；JSX 里只有这一处是 <span> 包裹的文案。
    const tag = windowAround(code, '<span>立即直达官方主站</span>', 300, 0)
    expect(tag).toContain('href={safeHref(site.url)}')
    expect(tag).toContain('onClick={handleOutboundClick}')
    expect(tag).toContain('target="_blank"')
  })

  it('复制 / 收藏 / 纠错不走出站上报', () => {
    // 复制（URL / Markdown）与纠错仍走各自 handler，收藏仍是 FavoriteButton；
    // 上报只挂在两处出站锚点上（上一条已断言恰好 2 次），这里钉住其余
    // 交互入口存在且未被改成上报。
    expect(code).toContain('onClick={handleCopyUrl}')
    expect(code).toContain('onClick={handleCopyMarkdown}')
    expect(code).toContain('openReportDialog')
    expect(code).toContain('<FavoriteButton')
    // wayback 与相关站链（alt.targetUrl / alt.url）不挂 handleOutboundClick
    for (const needle of ['safeHref(alt.targetUrl)', 'safeHref(alt.url)', 'buildDeadLinkWaybackUrl']) {
      const win = windowAround(code, needle, 400, 200)
      expect(win).not.toContain('handleOutboundClick')
    }
  })
})
