import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  parseMarketplaceFilters,
  buildMarketplaceQuery,
  DEFAULT_MARKETPLACE_SORT,
} from '../src/lib/plugins/marketplace-filters'
import { rankingMetric } from '../src/lib/plugins/marketplace-rankings'
import { buildAuditView, buildAuditViewFromSummary } from '../src/lib/plugins/audit-report-view'
import type { HubPluginAuditReport } from '../src/lib/navhub-api'
import type { HubPluginItem } from '../src/lib/navhub-api'

/**
 * 假功能修复线 F：F-1 榜单假标签 / F-2 星标入口无视图 / F-3 审计弹窗写死。
 *
 * 复现测试（先红后绿）：
 * - F-1：0 安装/0 评价的包在榜单上贴“官方精选”“审计通过”——榜单 metric
 *   必须说真话（暂无安装/暂无评价），不得用精选/审计通过填充。
 * - F-2：“星标插件”卡片点进通用市场——市场必须有真实的星标筛选视图
 *  （`?starred=1`），卡片链过去；否则就是假入口。
 * - F-3：中/高风险插件的审计弹窗仍显示全绿“优良 (Verified)”——弹窗必须
 *   按真实审计报告（checks / dimensionScores / level）渲染分维结论。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function fakePlugin(overrides: Partial<HubPluginItem>): HubPluginItem {
  return {
    id: 'p1',
    slug: 'fake-pack',
    name: 'Fake Pack',
    description: '测试用插件',
    version: '1.0.0',
    source: 'seed',
    status: 'published',
    installCount: 0,
    starCount: 0,
    reportCount: 0,
    createdAt: 0,
    updatedAt: 0,
    manifest: {},
    ...overrides,
  } as unknown as HubPluginItem
}

function fakeReport(overrides: Partial<HubPluginAuditReport>): HubPluginAuditReport {
  return {
    slug: 'fake-pack',
    score: 42,
    level: 'high_risk',
    verifiedAuthor: false,
    checks: [
      { name: '开发者认证 (Author Authenticity)', passed: false, detail: '社区自建未签名作者' },
      { name: '协议加密性 (HTTPS Enforcement)', passed: true, detail: '所有外链均强制采用 HTTPS' },
      { name: '代码注入与 XSS 防护 (Script Injection Guard)', passed: false, detail: '检测到恶意伪协议注入' },
    ],
    auditedAt: 1763300000000,
    decision: 'reject',
    dimensionScores: { security: 42, availability: 80, compliance: null, relevance: null },
    linkSurvivalRate: 0.5,
    llmReviewed: true,
    reviewSkipped: null,
    scoreBasis: 'full',
    ...overrides,
  }
}

describe('F-1 榜单 metric：0 数据不再贴假标签', () => {
  it('安装榜：0 安装时显示“暂无安装”，不冒充精选', () => {
    expect(rankingMetric('popular', fakePlugin({ installCount: 0 }))).toBe('暂无安装')
    expect(rankingMetric('popular', fakePlugin({ installCount: 3 }))).toBe('3 次安装')
  })

  it('口碑榜：0 评价时显示“暂无评价”，不冒充审计通过', () => {
    expect(rankingMetric('rating', fakePlugin({ reviewCount: 0, ratingAvg: 0 }))).toBe('暂无评价')
    expect(rankingMetric('rating', fakePlugin({ reviewCount: 5, ratingAvg: 4.8 }))).toBe('4.8 ★ · 5 评')
  })

  it('榜单源码不再含硬编码假标签兜底', () => {
    const board = overlaySource('src/components/plugin-market-board.tsx')
    expect(board).not.toContain('官方精选')
    expect(board).not.toContain('审计通过')
    expect(board).not.toContain('站点 · 精选')
    expect(board).toContain('marketplace-rankings')
  })
})

describe('F-2 星标筛选：市场有真实星标视图', () => {
  it('parse/build 往返 starred=1', () => {
    expect(parseMarketplaceFilters('?starred=1').starred).toBe(true)
    expect(parseMarketplaceFilters('?starred=true').starred).toBe(true)
    expect(parseMarketplaceFilters('').starred).toBe(false)
    expect(parseMarketplaceFilters('?starred=0').starred).toBe(false)
    expect(
      buildMarketplaceQuery({ kind: '', q: '', sort: DEFAULT_MARKETPLACE_SORT, starred: true }),
    ).toBe('?starred=1')
    expect(
      buildMarketplaceQuery({ kind: '', q: '', sort: DEFAULT_MARKETPLACE_SORT, starred: false }),
    ).toBe('')
  })

  it('“星标插件”卡片链到星标筛选视图，不再是通用市场', () => {
    const view = overlaySource('src/app/me/plugins/me-plugins-view.tsx')
    expect(view).toContain('/marketplace?starred=1')
  })

  it('市场岛接线星标筛选：读 URL 参数、带 starred 取数、有切换入口', () => {
    const board = overlaySource('src/components/plugin-market-board.tsx')
    expect(board).toContain('starred')
    expect(board).toContain('starred=1')
    const api = overlaySource('src/lib/navhub-api.ts')
    expect(api).toContain('starred')
  })
})

describe('F-3 审计弹窗：按真实报告渲染分维结论', () => {
  it('高风险报告不得显示“优良 (Verified)”', () => {
    const view = buildAuditView(fakeReport({ level: 'high_risk', score: 42 }))
    expect(view.levelLabel).toBe('高风险')
    expect(view.levelLabel).not.toContain('优良')
    expect(view.score).toBe(42)
  })

  it('各等级标签与报告 level 一一对应', () => {
    expect(buildAuditView(fakeReport({ level: 'safe', score: 98 })).levelLabel).toBe('优良 (Verified)')
    expect(buildAuditView(fakeReport({ level: 'low_risk', score: 90 })).levelLabel).toBe('低风险')
    expect(buildAuditView(fakeReport({ level: 'medium_risk', score: 70 })).levelLabel).toBe('中风险')
  })

  it('未测量的维度显示 null（不冒充 0 分也不冒充满分），checks 原样透传', () => {
    const view = buildAuditView(fakeReport({}))
    const byKey = new Map(view.dimensions.map((d) => [d.key, d.score]))
    expect(byKey.get('security')).toBe(42)
    expect(byKey.get('availability')).toBe(80)
    expect(byKey.get('compliance')).toBeNull()
    expect(byKey.get('relevance')).toBeNull()
    expect(view.checks).toHaveLength(3)
    expect(view.checks[0]?.passed).toBe(false)
    expect(view.checks[1]?.passed).toBe(true)
  })

  it('只有摘要（报告拉取失败）时也不写死四项全绿结论', () => {
    const view = buildAuditViewFromSummary(42, 'high_risk', 1763300000000)
    expect(view.levelLabel).toBe('高风险')
    expect(view.dimensions.every((d) => d.score === null)).toBe(true)
    expect(view.checks).toHaveLength(0)
  })

  it('弹窗源码不再写死四项全绿文案，改为读真实报告', () => {
    const modal = overlaySource('src/components/plugins/plugin-audit-modal.tsx')
    expect(modal).not.toContain('100% 声明式隔离')
    expect(modal).not.toContain('全量 HTTPS 认证')
    expect(modal).not.toContain('零注入 · 零违禁词')
    expect(modal).not.toContain('主题与内容对齐')
    expect(modal).not.toContain('安全等级：优良 (Verified)')
    expect(modal).toContain('fetchPluginAudit')
  })
})
