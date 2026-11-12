/**
 * 数据管理页（/admin/data，DEV_BACKLOG A9）的守卫。
 *
 * 锁住三件事：
 *   1. 灌入判定是纯函数、可枚举：0 = 空、(0, 基线) = 低于基线、≥ 基线 = 已灌入。
 *   2. 基线数字不是拍脑袋的：每次跑测试都重数一遍仓库事实源——
 *      navigation.json（323 站 / 47 二级 / 14 一级）与 videos.json（6007 条）。
 *      仓库扩容时这里会先红，提醒人同步改基线，而不是页面悄悄拿旧数比较。
 *   3. 页面只展示从中枢取回的 live 数：页面源码里不许出现 323/6007 的
 *      字面量（基线只能来自 lib 常量），两个计数端点与三个管理入口必须在位，
 *      冷备导出必须走带 token 的 hubGet（普通 <a href> 带不上 admin token）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  BASELINE_SITES,
  BASELINE_VIDEOS,
  parseBaselineMarker,
  seedStatus,
} from '../src/lib/data-management'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

function overlayJson(rel: string): unknown {
  return JSON.parse(overlaySource(rel)) as unknown
}

function countWhere(node: unknown, pred: (obj: Record<string, unknown>) => boolean): number {
  let n = 0
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const v of x) walk(v)
      return
    }
    if (x && typeof x === 'object') {
      const obj = x as Record<string, unknown>
      if (pred(obj)) n += 1
      for (const v of Object.values(obj)) walk(v)
    }
  }
  walk(node)
  return n
}

const PAGE = overlaySource('src/app/admin/data/page.tsx')

/**
 * 剥掉注释后的源码：页头注释里为了解释基线出处会真的写出 322/6007，
 * 「页面不许出现字面量」的断言必须对它用，否则自己把自己判红
 * （restore-page-guard 同款教训，见 TESTING-CONVENTIONS 第 4 条）。
 */
const CODE_ONLY = PAGE.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
  .join('\n')

describe('灌入判定 seedStatus', () => {
  it('0 条就是空（一定是漏了导入）', () => {
    expect(seedStatus(0, 298)).toBe('empty')
    expect(seedStatus(-3, 298)).toBe('empty')
    expect(seedStatus(Number.NaN, 298)).toBe('empty')
  })

  it('(0, 基线) 是低于基线，不擅自断言原因', () => {
    expect(seedStatus(1, 298)).toBe('below-baseline')
    expect(seedStatus(84, 298)).toBe('below-baseline')
    expect(seedStatus(297, 298)).toBe('below-baseline')
  })

  it('达到与超过基线都是已灌入（管理员自己加站不报假警）', () => {
    expect(seedStatus(298, 298)).toBe('seeded')
    expect(seedStatus(500, 298)).toBe('seeded')
    expect(seedStatus(6007, 6007)).toBe('seeded')
  })
})

describe('基线数字钉住仓库事实源', () => {
  it('站点基线 = navigation.json 实测（14 一级 / 47 二级 / 323 站）', () => {
    const nav = overlayJson('src/navsphere/content/navigation.json') as {
      navigationItems: Array<{ subCategories?: unknown[] }>
    }
    const sites = countWhere(nav, (o) => typeof o.href === 'string')
    const subs = nav.navigationItems.reduce(
      (sum, c) => sum + (Array.isArray(c.subCategories) ? c.subCategories.length : 0),
      0,
    )
    expect(nav.navigationItems.length).toBe(14)
    expect(subs).toBe(47)
    expect(sites).toBe(323)
    expect(BASELINE_SITES).toBe(323)
  })

  it('视频基线 = videos.json 实测 6007 条', () => {
    const videos = overlayJson('src/navsphere/content/videos.json')
    const items = countWhere(
      videos,
      (o) => typeof o.bvid === 'string' || (typeof o.durationSec === 'number' && typeof o.title === 'string'),
    )
    expect(items).toBe(6007)
    expect(BASELINE_VIDEOS).toBe(6007)
  })
})

describe('数据管理页：结构与端点契约', () => {
  it('是客户端组件，恰好一个 h1「数据管理」', () => {
    expect(PAGE.startsWith("'use client'")).toBe(true)
    expect(PAGE.match(/<h1\b/g) ?? []).toHaveLength(1)
    expect(PAGE).toMatch(/<h1[^>]*>\s*数据管理\s*<\/h1>/)
  })

  it('两个计数都走 live 端点（总览 + 视频），不是写死数', () => {
    expect(PAGE).toContain("hubGet<DashboardOverview>('/api/admin/dashboard/overview')")
    expect(PAGE).toContain("hubGet<VideosSummary>('/api/videos?limit=1')")
    // 基线只能来自 lib 常量：页面代码里出现 323/6007 字面量就是在展示假数
    // （注释不算：页头注释要写明出处，见 CODE_ONLY 的说明）
    expect(CODE_ONLY).not.toContain('323')
    expect(CODE_ONLY).not.toContain('6007')
    expect(PAGE).toContain('BASELINE_SITES')
    expect(PAGE).toContain('BASELINE_VIDEOS')
    expect(PAGE).toContain('seedStatus(')
  })

  it('两路计数互相独立：一路失败不连累另一路', () => {
    expect(PAGE).toContain('Promise.allSettled')
    expect(PAGE).toContain('overviewError')
    expect(PAGE).toContain('videosError')
    // 失败态只说「暂时读不到」，不拿 0 充数
    expect(PAGE).toContain('暂时读不到')
  })

  it('三个管理入口都在位：恢复、站点、视频', () => {
    expect(PAGE).toContain('href="/admin/data/restore"')
    expect(PAGE).toContain('href="/admin/navigation"')
    expect(PAGE).toContain('href="/admin/videos"')
  })

  it('冷备导出走 hubGet（admin 作用域，普通链接带不上 token），书签走公开直链', () => {
    expect(PAGE).toContain("hubGet<ColdBackupDoc>('/api/export/backup.json')")
    expect(PAGE).toContain('href="/api/hub/export/bookmarks.html"')
    expect(PAGE).toContain('.nhbak.json')
  })

  it('低于基线与空库都有人话提示，且区分两种状态', () => {
    expect(PAGE).toContain('低于基线')
    expect(PAGE).toContain('未灌入')
    expect(PAGE).toContain('已灌入')
    // 空库提示必须点出「漏了整包导入」这个最可能的根因
    expect(PAGE).toContain('漏了整包导入')
  })

  it('刷新按钮复用同一份加载逻辑，不另写一套取数', () => {
    expect(PAGE).toMatch(/onClick=\{\(\) => void load\(\)\}/)
    expect(PAGE).toContain('const load = useCallback')
  })
})

describe('基线导入标记解析 parseBaselineMarker', () => {
  const marker = {
    version: 1,
    at: '2026-11-11T02:00:00.000Z',
    navigation: { status: 'imported', count: 298, fileCount: 298, categories: 60 },
    videos: { status: 'skipped_existing', count: 6007, fileCount: 6007 },
  }

  it('标记本体（中枢当前实际返回）解析为 present，字段逐项对齐 baseline.ts 口径', () => {
    const parsed = parseBaselineMarker(marker)
    expect(parsed.kind).toBe('present')
    if (parsed.kind !== 'present') return
    expect(parsed.marker.version).toBe(1)
    expect(parsed.marker.at).toBe(marker.at)
    expect(parsed.marker.navigation.status).toBe('imported')
    expect(parsed.marker.navigation.count).toBe(298)
    expect(parsed.marker.navigation.categories).toBe(60)
    expect(parsed.marker.videos.status).toBe('skipped_existing')
    expect(parsed.marker.videos.fileCount).toBe(6007)
    expect(parsed.marker.videos.categories).toBeNull()
  })

  it('count/fileCount 为 null（关闭/文件不可读）时保留 null，不拿 0 充数', () => {
    const parsed = parseBaselineMarker({
      version: 1,
      at: '2026-11-11T02:00:00.000Z',
      navigation: { status: 'disabled', count: null, fileCount: null, categories: null },
      videos: { status: 'failed', count: 0, fileCount: 12, error: 'boom' },
    })
    expect(parsed.kind).toBe('present')
    if (parsed.kind !== 'present') return
    expect(parsed.marker.navigation.count).toBeNull()
    expect(parsed.marker.videos.error).toBe('boom')
  })

  it('文档不存在的各种回法都判 missing（老部署无记录）', () => {
    expect(parseBaselineMarker(null).kind).toBe('missing')
    expect(parseBaselineMarker(undefined).kind).toBe('missing')
    expect(parseBaselineMarker('null').kind).toBe('missing')
    expect(parseBaselineMarker({ synced: false, document: null }).kind).toBe('missing')
    expect(parseBaselineMarker({ document: null }).kind).toBe('missing')
  })

  it('信封包了一层时拆开解析', () => {
    expect(parseBaselineMarker({ document: marker }).kind).toBe('present')
    expect(parseBaselineMarker({ synced: true, document: marker }).kind).toBe('present')
    expect(parseBaselineMarker(JSON.stringify(marker)).kind).toBe('present')
  })

  it('结构对不上判 invalid，不误报 missing 也不硬凑 present', () => {
    expect(parseBaselineMarker({}).kind).toBe('invalid')
    expect(parseBaselineMarker(42).kind).toBe('invalid')
    expect(parseBaselineMarker('not-json').kind).toBe('invalid')
    expect(
      parseBaselineMarker({
        version: 1,
        at: '2026-11-11T02:00:00.000Z',
        navigation: { status: 'weird', count: 1, fileCount: 1 },
        videos: { status: 'imported', count: 1, fileCount: 1 },
      }).kind,
    ).toBe('invalid')
    expect(
      parseBaselineMarker({
        version: 1,
        navigation: marker.navigation,
        videos: marker.videos,
      }).kind,
    ).toBe('invalid')
  })

  it('五种状态全认：imported/skipped_existing/missing_file/failed/disabled', () => {
    for (const status of ['imported', 'skipped_existing', 'missing_file', 'failed', 'disabled']) {
      const parsed = parseBaselineMarker({
        version: 1,
        at: '2026-11-11T02:00:00.000Z',
        navigation: { status, count: 1, fileCount: 1 },
        videos: { status, count: 1, fileCount: 1 },
      })
      expect(parsed.kind).toBe('present')
    }
  })
})

describe('数据管理页：基线导入标记卡（A9 合并）', () => {
  it('标记走与其它卡同一条取数通道：hubGet 读 /api/storage 的 baseline-import.json', () => {
    expect(PAGE).toContain("hubGet<unknown>('/api/storage?path=baseline-import.json')")
    expect(PAGE).toContain('parseBaselineMarker(')
    expect(PAGE).toContain('baselineError')
    expect(PAGE).toContain('baselineMissing')
  })

  it('卡片在位：标题、五种状态文案与无记录降级文案齐全', () => {
    expect(PAGE).toContain('冷启动基线导入')
    expect(PAGE).toContain('已自动导入')
    expect(PAGE).toContain('已有数据，已跳过（正常）')
    expect(PAGE).toContain('基线文件缺失')
    expect(PAGE).toContain('导入失败')
    expect(PAGE).toContain('基线导入已关闭')
    expect(PAGE).toContain('暂无基线导入记录')
    // 读取失败只坏这一张卡：同款「暂时读不到」口径，不整页报错
    expect(PAGE).toContain('基线导入记录暂时读不到')
  })

  it('标记卡取数并入同一份 load 的 allSettled，三路互不连累', () => {
    expect(PAGE).toContain('baselineResult')
    expect(PAGE).toMatch(/Promise\.allSettled\(\[[\s\S]*baseline-import\.json/)
  })
})
