/**
 * 数据管理页（/admin/data，DEV_BACKLOG A9）的守卫。
 *
 * 锁住三件事：
 *   1. 灌入判定是纯函数、可枚举：0 = 空、(0, 基线) = 低于基线、≥ 基线 = 已灌入。
 *   2. 基线数字不是拍脑袋的：每次跑测试都重数一遍仓库事实源——
 *      navigation.json（377 站 / 48 二级 / 14 一级）与 videos.json（2265 条）。
 *      仓库扩容时这里会先红，提醒人同步改基线，而不是页面悄悄拿旧数比较。
 *      2026-11-15 T5 元宝收录：新增「AI 搜索」二级与元宝搜索一站。
 *      2026-11-15 卸载合集：补 github.com/trending 一站，基线 334→335。
 *      2026-11-16 进化第 89 轮 B 线：补齐「AI 搜索知识」二级 5 站，基线 335→340。
 *      2026-11-16 进化第 92 轮 D 线：补站「编程学习」二级 2 站，基线 340→342。
 *      2026-11-17 进化轮 15:22：补站 U-22（Todoist/Make/Descript/OpusClip/NotebookLM），基线 341→346。
 *      2026-11-18 进化轮 05:22：补站微博（消费生活 > 社交与婚恋），基线 346→347。
 *      2026-11-19 进化轮 16:22：补站 U-08（AI 短剧与漫剧创作：SkyReels/讯飞绘镜），基线 347→349。
 *      2026-11-19 进化轮 19:22：补站 U-08（配色与色板 3 站、编程学习 1 站、在线课程 1 站），基线 349→354。
 *      2026-11-19 进化轮 21:22：补站 U-08（UI 资源素材 1 站、气象与环境 1 站、数字图书馆 2 站、免费短剧 3 站、学习路线 4 站），基线 354→365。
 *      2026-11-19 进化轮 22:22：补站 U-08（影视评分 2 站），基线 365→367。
 *      2026-11-19 进化轮 23:22：补站 U-08（官方文档 2 站），基线 367→369。
 *      2026-11-20 进化轮 00:22：补站 U-08（配色与色板 2 站），基线 369→371。
 *      2026-11-20 进化轮 01:22：补站 U-08（免费短剧：FlexTV/MoboReels 2 站），基线 371→373。
 *      2026-11-20 进化轮 02:22：补站 U-08（问答社区 2 站），基线 373→375。
 *      2026-11-20 进化轮 05:08：补站 U-252（免费短剧：Melolo 1 站），基线 375→376。
 *      2026-11-20 进化轮 05:22：补站 U-08（容器与编排：Rancher 1 站），基线 376→377。
 *   3. 页面只展示从中枢取回的 live 数：页面源码里不许出现 346/2265 的
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
 * 剥掉注释后的源码：页头注释里为了解释基线出处会真的写出 322/2265，
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
    expect(seedStatus(2265, 2265)).toBe('seeded')
  })
})

describe('基线数字钉住仓库事实源', () => {
  it('站点基线 = navigation.json 实测（14 一级 / 48 二级 / 377 站）', () => {
    const nav = overlayJson('src/navsphere/content/navigation.json') as {
      navigationItems: Array<{ subCategories?: unknown[] }>
    }
    const sites = countWhere(nav, (o) => typeof o.href === 'string')
    const subs = nav.navigationItems.reduce(
      (sum, c) => sum + (Array.isArray(c.subCategories) ? c.subCategories.length : 0),
      0,
    )
    expect(nav.navigationItems.length).toBe(14)
    expect(subs).toBe(48)
    expect(sites).toBe(377)
    expect(BASELINE_SITES).toBe(377)
  })

  it('视频基线 = videos.json 实测 2265 条', () => {
    const videos = overlayJson('src/navsphere/content/videos.json') as {
      navigationItems: Array<{
        items?: unknown[]
        subCategories?: Array<{ items?: unknown[] }>
      }>
    }
    // 与生产口径 storage.ts countVideoDocItems 一致：导航分类 items +
    // 子分类 items。旧的 countWhere（bvid / durationSec+title）会漏数
    // YouTube 条目（无 bvid），又会误数 replacementHistory 里的历史记录。
    const items = videos.navigationItems.reduce(
      (sum, c) =>
        sum +
        (c.items?.length || 0) +
        (c.subCategories || []).reduce((s, sub) => s + (sub.items?.length || 0), 0),
      0,
    )
    expect(items).toBe(2265)
    expect(BASELINE_VIDEOS).toBe(2265)
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
    // 基线只能来自 lib 常量：页面代码里出现 346/2265 字面量就是在展示假数
    // （注释不算：页头注释要写明出处，见 CODE_ONLY 的说明）
    expect(CODE_ONLY).not.toContain('346')
    expect(CODE_ONLY).not.toContain('2265')
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
    videos: { status: 'skipped_existing', count: 2265, fileCount: 2265 },
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
    expect(parsed.marker.videos.fileCount).toBe(2265)
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
