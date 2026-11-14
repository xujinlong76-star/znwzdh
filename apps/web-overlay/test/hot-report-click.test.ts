import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /hot 点击上报：榜单页点的点击必须进统计，否则榜单永远长不出真实数据。
 *
 * 真实缺陷（走查 2026-11-14 11:22 问题 1）：hot-view.tsx 全文件 0 处
 * reportClick 调用——卡片标题外链、ExternalLink 直达按钮、站内详情内链
 * 三处都没有 onClick 上报。榜单的排序依据（visit_count / trend_score）
 * 正是它自己不采集的数据：首页/搜索点的点击能攒热度，榜单页点的不能。
 *
 * 现在三处共用 handleSiteClick，口径与 navigation-card.tsx:270 的
 * handleLinkClick 一致：reportClick(site.id, getIdentity(), { position })，
 * position 取卡片在当前榜单里的名次（1 起，与左上角名次徽章一致）。
 * reportClick 是 fire-and-forget，失败静默落端侧出箱，永不阻塞跳转；
 * 详情页挂载时不另外上报（site-detail-view.tsx 无 reportClick），
 * 这里是 /hot → 详情的唯一一次上报，不会重复计数。
 *
 * 诚实边界（与 skin-picker.test.ts 的 P1-9 复核结论同口径）：本仓库
 * vitest 是 node 环境，无 jsdom / @testing-library/react，直接 import
 * .tsx 渲染点按做不到；本文件钉住「三处接线都在、口径一致、只报一次」，
 * 真实的点按送达由 Playwright e2e / 真机复核覆盖。
 */

const SRC = join(import.meta.dirname, '..', 'src', 'app', 'hot', 'hot-view.tsx')
const code = readFileSync(SRC, 'utf8')

/** 取某次出现位置前后的窗口文本 */
function windowAround(haystack: string, needle: string, before: number, after: number): string {
  const idx = haystack.indexOf(needle)
  expect(idx).toBeGreaterThan(-1)
  return haystack.slice(Math.max(0, idx - before), idx + needle.length + after)
}

describe('/hot 点击上报接线', () => {
  it('引入 reportClick 与 getIdentity，口径与导航卡片一致', () => {
    expect(code).toContain("import { fetchNewSites, fetchTrending, reportClick, type HubSite } from '@/lib/navhub-api'")
    expect(code).toContain("import { getIdentity } from '@/lib/identity'")
  })

  it('三处点击共用一个 handleSiteClick，位置取榜单名次 i + 1', () => {
    expect(code).toContain('const handleSiteClick = (site: HubSite, position: number) => {')
    expect(code).toContain('reportClick(site.id, getIdentity(), { position })')
    // 三处调用点：标题外链、站内详情、直达按钮，各一次
    expect(code.match(/handleSiteClick\(site, i \+ 1\)/g)?.length).toBe(3)
  })

  it('卡片标题外链点击上报', () => {
    const tag = windowAround(
      code,
      'className="block min-w-0 flex-1"',
      200,
      0,
    )
    expect(tag).toContain('href={safeHref(site.url)}')
    expect(tag).toContain('onClick={() => handleSiteClick(site, i + 1)}')
  })

  it('站内详情内链点击上报', () => {
    const tag = windowAround(
      code,
      'href={`/site/${encodeURIComponent(site.id)}`}',
      0,
      200,
    )
    expect(tag).toContain('onClick={() => handleSiteClick(site, i + 1)}')
  })

  it('ExternalLink 直达按钮点击上报', () => {
    const tag = windowAround(code, 'title="新窗口直达"', 400, 0)
    expect(tag).toContain('href={safeHref(site.url)}')
    expect(tag).toContain('onClick={() => handleSiteClick(site, i + 1)}')
  })

  it('上报只经过 handleSiteClick 一处，不在别处另起 reportClick', () => {
    // import 行是 `reportClick,`（无括号），正文调用只应有 handler 里的一次
    expect(code.match(/reportClick\(/g)?.length).toBe(1)
  })

  it('上报不阻塞跳转：handler 与三处 onClick 均无 preventDefault / stopPropagation', () => {
    const start = code.indexOf('const handleSiteClick')
    expect(start).toBeGreaterThan(-1)
    const body = code.slice(start, code.indexOf('}', code.indexOf('reportClick(site.id')) + 1)
    expect(body).not.toContain('preventDefault')
    expect(body).not.toContain('stopPropagation')
    expect(body).not.toContain('await')
    for (const m of code.matchAll(/onClick=\{\(\) => handleSiteClick\(site, i \+ 1\)\}/g)) {
      expect(m[0]).not.toContain('preventDefault')
    }
  })
})
