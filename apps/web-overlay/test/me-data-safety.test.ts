/**
 * 第 15 项：数据安全可见补完（Phase 1）——前端。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了；渲染用 renderToString（effects 在 SSR 下不跑，initialSafety
 * 受控渲染只依赖 props），接线用源码守卫（与 sync-health-card.test.ts
 * 与 import-persist-failure.test.ts 同款做法）。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatAbsoluteTime, formatRelativeTime } from '../src/lib/format-relative-time'
import { buildLocalSnapshotCheck } from '../src/lib/user-settings'
import { DataSafetyCard, describeSyncErrorCode, overallTitle } from '../src/components/user-center/data-safety-card'
import type { DataSafety } from '../src/lib/me-types'

const HERE = dirname(fileURLToPath(import.meta.url))
const DAY = 86_400_000

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function safetyFixture(overrides: Partial<DataSafety> = {}): DataSafety {
  const now = Date.now()
  return {
    ok: true,
    checkedAt: now,
    overall: 'ok',
    lastExport: {
      at: now - 3 * DAY,
      format: 'json',
      counts: { favorites: 128, folders: 4, searches: 12 },
      truncated: false,
      sizeBytes: null,
    },
    lastImport: {
      at: now - 10 * DAY,
      imported: { folders: 1, favorites: 2, searches: 3 },
      skipped: 0,
    },
    sync: {
      favorites: { lastSuccessAt: now - 60 * 60_000, lastFailureAt: null, lastErrorCode: null },
      watchlist: { lastSuccessAt: now - 2 * 60 * 60_000, lastFailureAt: null, lastErrorCode: null },
      vault: { exists: true, version: 3, updatedAt: now - DAY },
      crdt: { exists: true, updatedAt: now - DAY },
      unreadSyncFailures: 0,
    },
    localCounts: { favorites: 128, folders: 4, searches: 12, recentEvents: 5 },
    serverBackup: { status: 'unknown', reason: 'not-instrumented' },
    checks: [
      { id: 'export_freshness', label: '导出新鲜度', status: 'ok', detail: '上次导出在 3 天前。来源：你的导出记录。' },
      { id: 'sync_failures', label: '云端同步失败', status: 'ok', detail: '没有未读同步失败通知。来源：同步失败通知。' },
      { id: 'vault_and_crdt', label: '金库与跨端排版日志', status: 'ok', detail: '金库已创建。来源：云端金库记录。' },
    ],
    ...overrides,
  }
}

function renderCard(safety: DataSafety): string {
  return renderToString(createElement(DataSafetyCard, { initialSafety: safety }))
}

describe('format-relative-time', () => {
  it('刚刚 / 分钟前 / 小时前 / 天前', () => {
    const now = Date.now()
    expect(formatRelativeTime(now, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5分钟前')
    expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe('2小时前')
    expect(formatRelativeTime(now - 3 * DAY, now)).toBe('3天前')
  })

  it('超 1 年回落绝对时间；非法时间戳返回“—”；未来时间戳按“刚刚”', () => {
    const now = Date.now()
    const old = now - 400 * DAY
    expect(formatRelativeTime(old, now)).toBe(new Date(old).toLocaleString('zh-CN', { hour12: false }))
    expect(formatRelativeTime(null, now)).toBe('—')
    expect(formatRelativeTime(undefined, now)).toBe('—')
    expect(formatRelativeTime(Number.NaN, now)).toBe('—')
    expect(formatRelativeTime(now + 60_000, now)).toBe('刚刚')
    expect(formatAbsoluteTime(null)).toBe('—')
    expect(formatAbsoluteTime(now)).toBe(new Date(now).toLocaleString('zh-CN', { hour12: false }))
  })
})

describe('文案 helpers', () => {
  it('overall 四态标题', () => {
    expect(overallTitle('ok')).toBe('数据有备份，放心用')
    expect(overallTitle('warning')).toBe('该导一份备份了')
    expect(overallTitle('critical')).toBe('你的数据还没有安全备份')
    expect(overallTitle('unknown')).toBe('暂时看不到这项状态')
  })

  it('失败原因只给三档分类，映射不到写“原因未知”', () => {
    expect(describeSyncErrorCode('timeout')).toBe('请求超时')
    expect(describeSyncErrorCode('network')).toBe('网络波动')
    expect(describeSyncErrorCode('server_5xx')).toBe('服务端暂时不可用')
    expect(describeSyncErrorCode('validation_4xx')).toBe('请求数据未被接受')
    expect(describeSyncErrorCode('unknown')).toBe('原因未知')
    expect(describeSyncErrorCode(null)).toBe('原因未知')
  })
})

describe('buildLocalSnapshotCheck（纯前端 JSON.parse 探针，不读内容）', () => {
  function fakeStore(entries: Record<string, string>) {
    return {
      getItem: (k: string) => (k in entries ? entries[k] : null),
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Parameters<typeof buildLocalSnapshotCheck>[0]
  }

  it('无快照 → unknown；全部可解析 → ok；有损坏 → warning', () => {
    expect(buildLocalSnapshotCheck(fakeStore({})).status).toBe('unknown')
    expect(
      buildLocalSnapshotCheck(
        fakeStore({ 'navhub.favorites.v1': '{"version":1}', navhub_user_settings: '{}' }),
      ).status,
    ).toBe('ok')
    const bad = buildLocalSnapshotCheck(
      fakeStore({ 'navhub.favorites.v1': '{"version":', navhub_user_settings: '{}' }),
    )
    expect(bad.status).toBe('warning')
    expect(bad.detail).toContain('解析失败')
  })
})

describe('DataSafetyCard 四态渲染', () => {
  it('ok：绿态标题、无 role="alert" 横幅、相对 + 绝对时间同时出现', () => {
    const fixture = safetyFixture()
    const html = renderCard(fixture)
    expect(html).toContain('数据有备份，放心用')
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('3天前')
    // 期望的绝对时间必须取 fixture 自身的 at：渲染后重算 Date.now() 会在跨秒时差 1 秒抖动
    expect(html).toContain(new Date(fixture.lastExport?.at ?? 0).toLocaleString('zh-CN', { hour12: false }))
    expect(html).toContain('该次导出完整')
  })

  it('warning：amber 横幅 role="alert"，标题“该导一份备份了”', () => {
    const now = Date.now()
    const html = renderCard(
      safetyFixture({ overall: 'warning', lastExport: { at: now - 18 * DAY, format: 'json', counts: { favorites: 10, folders: 1, searches: 0 }, truncated: null, sizeBytes: null } }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('该导一份备份了')
    expect(html).toContain('18天前')
    expect(html).toContain('该次导出是否完整未知')
  })

  it('critical：红横幅 role="alert"，无记录写“近一年内没有导出记录”', () => {
    const html = renderCard(
      safetyFixture({ overall: 'critical', lastExport: null, lastImport: null }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('你的数据还没有安全备份')
    expect(html).toContain('近一年内没有导出记录')
    expect(html).not.toContain('从未导出')
  })

  it('unknown 同步：不冒充“同步正常”，写“尚未记录到成功同步”', () => {
    const html = renderCard(
      safetyFixture({
        overall: 'unknown',
        sync: {
          favorites: { lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null },
          watchlist: { lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null },
          vault: { exists: false, version: null, updatedAt: null },
          crdt: { exists: false, updatedAt: null },
          unreadSyncFailures: 0,
        },
      }),
    )
    expect(html).toContain('尚未记录到成功同步')
    expect(html).not.toContain('同步正常')
    expect(html).not.toContain('role="alert"')
  })

  it('1 小时内同步失败：critical 行 + 原因分类，不展示原始异常文本', () => {
    const now = Date.now()
    const html = renderToString(
      createElement(DataSafetyCard, {
        initialSafety: safetyFixture({
          overall: 'critical',
          sync: {
            favorites: { lastSuccessAt: now - 2 * 60 * 60_000, lastFailureAt: now - 10 * 60_000, lastErrorCode: 'timeout' },
            watchlist: { lastSuccessAt: null, lastFailureAt: null, lastErrorCode: null },
            vault: { exists: false, version: null, updatedAt: null },
            crdt: { exists: false, updatedAt: null },
            unreadSyncFailures: 1,
          },
        }),
      }),
    )
    expect(html).toContain('1 小时内失败')
    expect(html).toContain('请求超时')
    expect(html).toContain('去通知页查看')
  })

  it('全站冷备行恒为 unknown，不写成用户的备份', () => {
    const html = renderCard(safetyFixture())
    expect(html).toContain('全站冷备')
    expect(html).toContain('站长侧维护，不在此列')
    expect(html).toContain('不能只恢复某一个用户')
  })
})

describe('DataSafetyCard 一键动作与接线（源码守卫）', () => {
  const src = overlaySource('src/components/user-center/data-safety-card.tsx')

  it('四个动作齐全：立即导出 / 重新同步收藏 / 查看通知 / 一键检查', () => {
    const html = renderCard(safetyFixture())
    expect(html).toContain('立即导出一份 JSON')
    expect(html).toContain('重新同步收藏')
    expect(html).toContain('查看通知')
    expect(html).toContain('一键检查')
    expect(html).toContain('href="/me/notifications"')
    expect(src).toContain("fetch('/api/me/diagnostics'")
    expect(src).toContain('buildLocalSnapshotCheck()')
    expect(src).toContain('syncFavoritesToCloud()')
  })

  it('导出成功后重新拉取 /api/me/safety（安全区即时刷新）', () => {
    expect(src).toContain("fetch('/api/me/safety'")
    expect(src).toContain('await loadSafety()')
  })

  it('按钮窄屏块级（w-full sm:w-auto），触摸目标沿用现有 h-9 按钮', () => {
    expect(src).toContain('w-full text-xs sm:w-auto')
    expect(src).not.toMatch(/h-7 text-\[11px\]/)
  })

  it('文案禁区：不写“你的数据已备份”“云端已自动备份”，不把全站冷备写成用户的备份', () => {
    for (const banned of ['你的数据已备份', '云端已自动备份', '你的备份']) {
      expect(src, `禁区文案出现：${banned}`).not.toContain(banned)
    }
    expect(src).not.toContain('diff.error')
    expect(src).not.toContain('健康评分')
  })

  it('每项状态下标注来源小字', () => {
    for (const source of ['你的导出记录', '同步记录', '云端金库记录']) {
      expect(renderCard(safetyFixture())).toContain(source)
    }
  })
})

describe('/me/data 接线（源码守卫）', () => {
  const page = overlaySource('src/app/me/data/page.tsx')

  it('安全区在页头之后、清点之前，且只在登录态挂载', () => {
    expect(page).toContain('<DataSafetyCard')
    const readyIdx = page.indexOf("state === 'ready'")
    const cardIdx = page.indexOf('<DataSafetyCard')
    expect(cardIdx).toBeGreaterThan(readyIdx)
    expect(page.indexOf('云端数据资产全景清点')).toBeGreaterThan(cardIdx)
  })

  it('DataOverviewSummary 补了 vault.updatedAt；导出区有锚点供安全区跳转', () => {
    expect(page).toContain('vault: { exists: boolean; version: number | null; updatedAt: number | null }')
    expect(page).toContain('id="export-section"')
  })

  it('匿名态只放本机部分 + 登录提示，不编云端状态', () => {
    const anonIdx = page.indexOf("state === 'anonymous'")
    const cardIdx = page.indexOf('<DataSafetyCard')
    expect(anonIdx).toBeGreaterThan(-1)
    expect(cardIdx).toBeGreaterThan(anonIdx)
    // 匿名分支在卡片挂载之前结束：卡片不在匿名分支内
    expect(page.slice(anonIdx, cardIdx)).toContain('登录后可看云端导出与同步状态')
  })
})

describe('SyncHealthCard 只加一行备份链接（决策 6）', () => {
  it('有一行“备份状态 → /me/data”链接，不加状态值', () => {
    const src = overlaySource('src/components/user-center/dashboard/sync-health-card.tsx')
    expect(src).toContain('备份状态')
    expect(src).toContain("safeHref('/me/data'")
    // 仍是五行 Row，不多加状态行
    expect(src.split('<Row\n').length - 1).toBe(5)
  })
})
