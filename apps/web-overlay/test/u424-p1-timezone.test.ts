/**
 * U-424 P1：54 处用户可见低频路径日期渲染固定 Asia/Shanghai（与 U-285 / U-419 / P0 口径一致）。
 *
 * 临界值：2026-11-21 16:30 UTC = 2026-11-22 00:30 CST。未修复时渲染跟进程
 * 本地时区：UTC 部署上日期差一天、时间差 8 小时；北京时间部署上正确。
 * 修复后无论进程 TZ 是什么，一律按北京时间出结果。
 * 跑法（仿 P0）：TZ=UTC / TZ=America/New_York / TZ=Asia/Shanghai 三跑，断言不变。
 *
 * 注意：#42/#46 的 date_to_ts 方向（`2026-11-22 00:30` 这类墙钟输入）没有跨 TZ
 * 行为断言——输入墙钟按进程本地时区解析成绝对时刻，渲染固定上海后在 UTC 与
 * 上海进程上恰好都还原输入墙钟，但在 New York 进程上会差 13 小时，这是输入
 * 解析语义本身决定的，不是渲染时区问题；该方向只做源码锁死断言。
 * 跨 TZ 行为断言只覆盖绝对时刻 → 字符串的方向（时间戳、JWT exp/nbf、
 * formatVerifiedDate、批注导出）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatVerifiedDate } from '@/lib/compare'
import { parseSpeculativeIntent } from '@/lib/speculative'
import {
  exportAnnotationsToMarkdown,
  type SaveAnnotation,
} from '@/lib/save-annotations'
import { tryParseTimestamp } from '../../../packages/core/src/speculative-intent/time'
import { tryParseJwt } from '../../../packages/core/src/speculative-intent/network'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 临界值：2026-11-21 16:30 UTC = 2026-11-22 00:30 CST。 */
const CRITICAL = Date.UTC(2026, 10, 21, 16, 30, 0)
const CRITICAL_SEC = CRITICAL / 1000

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function repoSource(rel: string): string {
  const p = resolve(HERE, '..', '..', '..', rel)
  if (!existsSync(p)) throw new Error('无法定位 ' + rel)
  return readFileSync(p, 'utf8')
}

/** P1 清单 overlay 38 文件 47 处（ask 1 / preferences 2 / compare 页 1 / compare.ts 1 / site-detail 2 / 其余各 1–4）。 */
const P1_OVERLAY: Array<[string, number]> = [
  ['src/app/ask/ask-view.tsx', 1],
  ['src/app/preferences/page.tsx', 2],
  ['src/app/pub/compare/[slug]/page.tsx', 1],
  ['src/lib/compare.ts', 1],
  ['src/components/site-detail-view.tsx', 2],
  ['src/components/snapshot-panel.tsx', 1],
  ['src/lib/modular/diy-snapshots.ts', 1],
  ['src/components/user-center/local-data-manager.tsx', 2],
  ['src/components/user-center/api-tokens-panel.tsx', 1],
  ['src/components/user-center/dashboard/sync-health-card.tsx', 1],
  ['src/components/user-center/session-devices-panel.tsx', 1],
  ['src/components/user-center/wanted-searches-view.tsx', 1],
  ['src/components/user-center/quarantine-zone.tsx', 1],
  ['src/lib/modular/layout-import-plan.ts', 1],
  ['src/lib/modular/use-modular-layout.ts', 1],
  ['src/components/home-diy-backup-dialog.tsx', 1],
  ['src/components/modular/modules/declarative-widget.tsx', 1],
  ['src/components/modular/modules/live-api-widget.tsx', 1],
  ['src/components/modular/modules/quick-tools-widget.tsx', 1],
  ['src/components/quick-tools-drawer.tsx', 1],
  ['src/components/tools/geek-micro-tools.tsx', 2],
  ['src/lib/speculative.ts', 4],
  ['src/components/save-annotation-panel.tsx', 1],
  ['src/lib/save-annotations.ts', 1],
  ['src/components/reader/site-archive-reader-modal.tsx', 2],
  ['src/components/plugins/plugin-audit-modal.tsx', 1],
  ['src/components/plugins/plugin-review-section.tsx', 2],
  ['src/components/plugins/plugin-taps-modal.tsx', 1],
  ['src/components/plugins/plugin-version-timeline.tsx', 1],
  ['src/components/video-player-page.tsx', 1],
  ['src/components/video-player-side-panel.tsx', 1],
  ['src/components/video-offline-manager.tsx', 1],
  ['src/components/video-slide-deck-viewer.tsx', 1],
  ['src/lib/video-frame-clipper.ts', 1],
  ['src/lib/video-transcript-sync.ts', 1],
  ['src/components/ai/site-health-audit-modal.tsx', 1],
  ['src/components/algorithm-lab/trajectory-lab.tsx', 1],
  ['src/components/p2p/p2p-airdrop-modal.tsx', 1],
]

describe('U-424 P1：源码锁死 timeZone（与 U-285 / U-419 / P0 口径一致）', () => {
  it.each(P1_OVERLAY)('%s 含 %d 处 timeZone: Asia/Shanghai', (rel, count) => {
    const src = overlaySource(rel)
    expect(src.split("timeZone: 'Asia/Shanghai'").length - 1).toBe(count)
  })

  it('core time.ts 含 2 处、network.ts 含 3 处 timeZone: Asia/Shanghai', () => {
    expect(
      repoSource('packages/core/src/speculative-intent/time.ts').split(
        "timeZone: 'Asia/Shanghai'",
      ).length - 1,
    ).toBe(2)
    expect(
      repoSource('packages/core/src/speculative-intent/network.ts').split(
        "timeZone: 'Asia/Shanghai'",
      ).length - 1,
    ).toBe(3)
  })

  it('api archive.ts 含 2 处 timeZone: Asia/Shanghai', () => {
    expect(
      repoSource('apps/api/src/routes/archive.ts').split("timeZone: 'Asia/Shanghai'")
        .length - 1,
    ).toBe(2)
  })

  it('54 处总数对得上清单（overlay 47 + core 5 + api 2）', () => {
    const overlayTotal = P1_OVERLAY.reduce((sum, [, count]) => sum + count, 0)
    expect(overlayTotal).toBe(47)
    expect(overlayTotal + 5 + 2).toBe(54)
  })

  it('P1 文件里不再有无时区的 zh-CN 日期型 toLocale 调用', () => {
    for (const [rel] of P1_OVERLAY) {
      const src = overlaySource(rel)
      // 仍带 'zh-CN' 但无时区的旧形态应已消失。裸 toLocale*() 不在此断言：
      // 清单排除的数字格式化调用（如 speculative.ts 的主机数/Bytes 计数）
      // 仍是合法的裸 toLocaleString()，由上文逐文件计数锁死，此处不误杀。
      expect(src).not.toContain("toLocaleString('zh-CN')")
      expect(src).not.toContain("toLocaleDateString('zh-CN')")
      expect(src).not.toContain("toLocaleString('zh-CN', { hour12: false })")
      expect(src).not.toContain("toLocaleTimeString('zh-CN', { hour12: false })")
    }
  })
})

describe('U-424 P1 #21：对比页核实日期按北京时间出日期（compare.ts）', () => {
  it('临界值 2026-11-21 16:30 UTC（00:30 CST）渲染为 2026/11/22', () => {
    expect(formatVerifiedDate(CRITICAL)).toBe('2026/11/22')
  })

  it('临界值另一侧：2026-11-21 15:30 UTC（23:30 CST）仍为 2026/11/21', () => {
    expect(formatVerifiedDate(Date.UTC(2026, 10, 21, 15, 30, 0))).toBe('2026/11/21')
  })

  it('缺失返回 null（不编造日期）', () => {
    expect(formatVerifiedDate(null)).toBeNull()
    expect(formatVerifiedDate(undefined)).toBeNull()
  })
})

describe('U-424 P1 #52：批注导出 Markdown 日期按北京时间出日期（save-annotations.ts）', () => {
  function annotation(): SaveAnnotation {
    return {
      id: 'a1',
      siteId: 's1',
      siteTitle: '示例站',
      siteUrl: 'https://example.com',
      quote: '示例',
      source: 'title',
      note: '',
      createdAt: CRITICAL,
      updatedAt: CRITICAL,
    }
  }

  it('临界值批注导出含 2026/11/22，不含 2026/11/21', () => {
    const md = exportAnnotationsToMarkdown([annotation()])
    expect(md).toContain('2026/11/22')
    expect(md).not.toContain('2026/11/21')
  })
})

describe('U-424 P1 #43/#47：时间戳换算按北京时间出时间（speculative / core）', () => {
  it('overlay：秒级戳 1795278600 渲染为 2026/11/22 00:30:00', () => {
    const res = parseSpeculativeIntent(String(CRITICAL_SEC))
    expect(res?.type).toBe('timestamp')
    expect(res?.details?.['本地时间']).toBe('2026/11/22 00:30:00')
  })

  it('core：秒级戳 1795278600 渲染为 2026/11/22 00:30:00', () => {
    const res = tryParseTimestamp(String(CRITICAL_SEC))
    expect(res?.type).toBe('timestamp')
    expect(res?.details?.['本地时间']).toBe('2026/11/22 00:30:00')
  })
})

describe('U-424 P1 #44/#45/#48/#49/#50：JWT 过期/nbf 按北京时间出时间', () => {
  // 裸 toLocaleString(undefined, { timeZone }) 只定时刻换算、不改默认 locale
  // 与格式（P0 口径）：Node 默认 locale 下渲染为美式 `11/22/2026, 12:30:00 AM`，
  // zh-CN 默认 locale 下为 `2026/11/22 00:30:00`；两种都代表同一北京时间
  // 时刻，断言用双格式正则覆盖，关键是日期是 11/22 而不是 UTC 的 11/21。
  const SHANGHAI_DATE = /(2026\/11\/22|11\/22\/2026)/
  const SHANGHAI_TIME = /(00:30:00|12:30:00 AM)/

  function jwt(): string {
    const b64url = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url')
    return [
      b64url({ alg: 'HS256', typ: 'JWT' }),
      b64url({ sub: 'u1', exp: CRITICAL_SEC, nbf: CRITICAL_SEC }),
      'sig',
    ].join('.')
  }

  it('overlay：已过期的临界值 token 到期时间为北京时间 11/22 00:30', () => {
    const res = parseSpeculativeIntent(jwt())
    expect(res?.type).toBe('jwt')
    expect(res?.details?.['到期时间']).toMatch(SHANGHAI_DATE)
    expect(res?.details?.['到期时间']).toMatch(SHANGHAI_TIME)
    expect(res?.details?.['到期时间']).toContain('过期')
    expect(res?.details?.['到期时间']).not.toMatch(/(2026\/11\/21|11\/21\/2026)/)
    expect(res?.details?.['到期时间']).not.toContain('16:30')
  })

  it('core：到期时间与 nbf 均为北京时间 11/22 00:30', () => {
    const res = tryParseJwt(jwt())
    expect(res?.type).toBe('jwt')
    expect(res?.details?.['到期时间']).toMatch(SHANGHAI_DATE)
    expect(res?.details?.['到期时间']).toMatch(SHANGHAI_TIME)
    expect(res?.subtitle).toMatch(/nbf: (2026\/11\/22 00:30:00|11\/22\/2026, 12:30:00 AM)/)
    expect(res?.subtitle).not.toMatch(/(2026\/11\/21|11\/21\/2026)/)
    expect(res?.subtitle).not.toContain('16:30')
  })
})
