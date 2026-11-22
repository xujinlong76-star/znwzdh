/**
 * 24 小时待读分流：纯函数（now 一律注入）+ 接线守卫。
 *
 * 锁三件事：
 *   1. 祖父规则——老收藏没有分流字段，缺字段 / 非法值 / 未来时间戳一律 permanent，
 *      绝不能把存量收藏扫进 24 小时箱；
 *   2. 边界——到期判定严格大于窗口（正好 24h 不过期，第 24h+1ms 过期），
 *      与 resurface 的 90 天口径一致；
 *   3. 文案——只写「还剩 X 小时/天」，过期写「已到期，已移到『已移出』」，
 *      不出现「你忘了 / 你没看」。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  DEFAULT_TRIAGE_INBOX_HOURS,
  DEFAULT_TRIAGE_READ_DAYS,
  HOUR_MS,
  describeTriage,
  enterInbox,
  isTriageExpired,
  markTriageRead,
  normalizeTriageSettings,
  promoteToPermanent,
  readTriageSettings,
  renewInbox,
  resolveTriageStatus,
  selectInboxDueSoon,
  settleTriage,
  triageBadgeLabel,
  triageDueAt,
  triageEnteredAt,
  triageMsLeft,
  triageWindowMs,
  writeTriageSettings,
  type TriageSettings,
  type TriageableFavoriteLike,
} from '../src/lib/favorites-triage'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 固定时钟：2026-11-12 12:00 UTC */
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0)
const SETTINGS: TriageSettings = { enabled: true, inboxHours: 24, readDays: 30 }

function fav(
  siteId: string,
  over: Partial<TriageableFavoriteLike> = {},
): TriageableFavoriteLike {
  return {
    siteId,
    title: `站点 ${siteId}`,
    href: `https://example.com/${siteId}`,
    createdAt: NOW - 10 * DAY_MS,
    ...over,
  }
}

describe('祖父规则：缺字段 / 非法值 / 未来时间戳 → permanent 永不过期', () => {
  it('没有分流字段的老收藏是 permanent', () => {
    expect(resolveTriageStatus(fav('a'), NOW)).toBe('permanent')
    expect(triageDueAt(fav('a'), SETTINGS, NOW)).toBeNull()
    expect(isTriageExpired(fav('a'), SETTINGS, NOW)).toBe(false)
    expect(triageMsLeft(fav('a'), SETTINGS, NOW)).toBeNull()
    expect(describeTriage(fav('a'), SETTINGS, NOW)).toBe('永久收藏')
  })

  it('非法状态值按 permanent 算', () => {
    const bad = fav('a', { triageStatus: 'someday', triageAt: NOW })
    expect(resolveTriageStatus(bad, NOW)).toBe('permanent')
    expect(isTriageExpired(bad, SETTINGS, NOW)).toBe(false)
  })

  it('未来 triageAt（时钟回拨 / 脏数据）按 permanent 算，不进待读箱', () => {
    const future = fav('a', { triageStatus: 'inbox', triageAt: NOW + DAY_MS })
    expect(resolveTriageStatus(future, NOW)).toBe('permanent')
    expect(isTriageExpired(future, SETTINGS, NOW)).toBe(false)
  })

  it('triageAt 缺失时回退 createdAt', () => {
    const noStamp = fav('a', { triageStatus: 'inbox' })
    expect(triageEnteredAt(noStamp)).toBe(noStamp.createdAt)
    // createdAt 是 10 天前，24h 窗口早已过期
    expect(isTriageExpired(noStamp, SETTINGS, NOW)).toBe(true)
  })
})

describe('窗口与到期：严格大于，毫秒流逝', () => {
  it('inbox 正好 24h 不过期，第 24h+1ms 过期', () => {
    const item = enterInbox(fav('a'), NOW - 24 * HOUR_MS)
    expect(isTriageExpired(item, SETTINGS, NOW)).toBe(false)
    expect(isTriageExpired(item, SETTINGS, NOW + 1)).toBe(true)
  })

  it('read 正好 30 天不移出，第 30 天+1ms 才移出', () => {
    const item = { ...fav('a'), triageStatus: 'read' as const, triageAt: NOW - 30 * DAY_MS }
    expect(isTriageExpired(item, SETTINGS, NOW)).toBe(false)
    expect(isTriageExpired(item, SETTINGS, NOW + 1)).toBe(true)
  })

  it('窗口可改：inboxHours=72 时 25h 未过期；窗口是现算的', () => {
    const item = enterInbox(fav('a'), NOW - 25 * HOUR_MS)
    expect(isTriageExpired(item, SETTINGS, NOW)).toBe(true)
    expect(isTriageExpired(item, { ...SETTINGS, inboxHours: 72 }, NOW)).toBe(false)
    expect(triageDueAt(item, { ...SETTINGS, inboxHours: 72 }, NOW)).toBe(NOW - 25 * HOUR_MS + 72 * HOUR_MS)
  })

  it('permanent 的窗口与到期时间都是 null', () => {
    expect(triageWindowMs('permanent', SETTINGS)).toBeNull()
    expect(triageWindowMs('inbox', SETTINGS)).toBe(24 * HOUR_MS)
    expect(triageWindowMs('read', SETTINGS)).toBe(30 * DAY_MS)
  })
})

describe('跃迁：纯函数，返回新对象', () => {
  it('enterInbox 打上 inbox 戳与进入时间', () => {
    const item = enterInbox(fav('a'), NOW)
    expect(item.triageStatus).toBe('inbox')
    expect(item.triageAt).toBe(NOW)
  })

  it('markTriageRead 仅 inbox → read；permanent 打开不变，read 再打开不动', () => {
    const inbox = enterInbox(fav('a'), NOW - HOUR_MS)
    const read = markTriageRead(inbox, NOW)
    expect(read.triageStatus).toBe('read')
    expect(read.triageAt).toBe(NOW)

    const permanent = fav('b')
    expect(markTriageRead(permanent, NOW)).toBe(permanent)

    const alreadyRead = { ...fav('c'), triageStatus: 'read' as const, triageAt: NOW - DAY_MS }
    // 同一引用 = 没有状态跃迁：read 再打开不续 30 天
    expect(markTriageRead(alreadyRead, NOW)).toBe(alreadyRead)
  })

  it('promoteToPermanent 后 dueAt=null，且不再过期', () => {
    const promoted = promoteToPermanent(enterInbox(fav('a'), NOW - 23 * HOUR_MS))
    expect(promoted.triageStatus).toBe('permanent')
    expect(triageDueAt(promoted, SETTINGS, NOW)).toBeNull()
    expect(isTriageExpired(promoted, SETTINGS, NOW + 365 * DAY_MS)).toBe(false)
  })

  it('renewInbox 回满 24h 且仍为 inbox；非 inbox 不动', () => {
    const inbox = enterInbox(fav('a'), NOW - 23 * HOUR_MS)
    const renewed = renewInbox(inbox, NOW)
    expect(renewed.triageStatus).toBe('inbox')
    expect(renewed.triageAt).toBe(NOW)
    expect(triageMsLeft(renewed, SETTINGS, NOW)).toBe(24 * HOUR_MS)

    const read = { ...fav('b'), triageStatus: 'read' as const, triageAt: NOW - DAY_MS }
    expect(renewInbox(read, NOW)).toBe(read)
  })
})

describe('settleTriage：一次分区，幂等', () => {
  it('混合列表一次分区：顺序保持、过期按到期先后', () => {
    const items = [
      fav('keep-inbox', { triageStatus: 'inbox', triageAt: NOW - HOUR_MS }),
      fav('old-1', { triageStatus: 'inbox', triageAt: NOW - 30 * HOUR_MS }),
      fav('legacy'),
      fav('old-2', { triageStatus: 'read', triageAt: NOW - 40 * DAY_MS }),
      fav('keep-read', { triageStatus: 'read', triageAt: NOW - DAY_MS }),
      fav('old-3', { triageStatus: 'inbox', triageAt: NOW - 25 * HOUR_MS }),
    ]
    const { items: survivors, expired } = settleTriage(items, SETTINGS, NOW)
    expect(survivors.map((i) => i.siteId)).toEqual(['keep-inbox', 'legacy', 'keep-read'])
    // old-2（40 天前进入 read）比 old-1 / old-3 到期更早
    expect(expired.map((i) => i.siteId)).toEqual(['old-2', 'old-1', 'old-3'])
  })

  it('再结算一次结果不变（幂等）', () => {
    const items = [fav('old', { triageStatus: 'inbox', triageAt: NOW - 30 * HOUR_MS }), fav('keep')]
    const first = settleTriage(items, SETTINGS, NOW)
    const second = settleTriage(first.items, SETTINGS, NOW)
    expect(second.expired).toEqual([])
    expect(second.items).toEqual(first.items)
  })

  it('空列表、全部 permanent 时不写盘（survivors 同一引用、expired 为空）', () => {
    const empty: TriageableFavoriteLike[] = []
    const settledEmpty = settleTriage(empty, SETTINGS, NOW)
    expect(settledEmpty.items).toBe(empty)
    expect(settledEmpty.expired).toEqual([])

    const allPermanent = [fav('a'), fav('b')]
    const settled = settleTriage(allPermanent, SETTINGS, NOW)
    expect(settled.items).toBe(allPermanent)
    expect(settled.expired).toEqual([])
  })

  it('开关关时 settleTriage 返回原样：已有待读箱冻结，不结算、不新进', () => {
    const items = [fav('old', { triageStatus: 'inbox', triageAt: NOW - 30 * HOUR_MS })]
    const settled = settleTriage(items, { ...SETTINGS, enabled: false }, NOW)
    expect(settled.items).toBe(items)
    expect(settled.expired).toEqual([])
  })
})

describe('selectInboxDueSoon：快到期的前几条', () => {
  it('只取未过期的 inbox，按剩余时间从少到多，默认 3 条', () => {
    const items = [
      fav('a', { triageStatus: 'inbox', triageAt: NOW - 23 * HOUR_MS }),
      fav('b', { triageStatus: 'inbox', triageAt: NOW - 2 * HOUR_MS }),
      fav('c', { triageStatus: 'read', triageAt: NOW - DAY_MS }),
      fav('d', { triageStatus: 'inbox', triageAt: NOW - 30 * HOUR_MS }),
      fav('e'),
      fav('f', { triageStatus: 'inbox', triageAt: NOW - 20 * HOUR_MS }),
      fav('g', { triageStatus: 'inbox', triageAt: NOW - 10 * HOUR_MS }),
    ]
    expect(selectInboxDueSoon(items, SETTINGS, NOW).map((i) => i.siteId)).toEqual(['a', 'f', 'g'])
    expect(selectInboxDueSoon(items, SETTINGS, NOW, 2).map((i) => i.siteId)).toEqual(['a', 'f'])
  })

  it('开关关时没有快到期条目', () => {
    const items = [fav('a', { triageStatus: 'inbox', triageAt: NOW - HOUR_MS })]
    expect(selectInboxDueSoon(items, { ...SETTINGS, enabled: false }, NOW)).toEqual([])
  })
})

describe('文案：只写剩余时间，不指责', () => {
  it('剩余时间徽标只写「还剩 X 小时/天」', () => {
    expect(triageBadgeLabel(5 * HOUR_MS)).toBe('还剩 5 小时')
    expect(triageBadgeLabel(30 * HOUR_MS)).toBe('还剩 1 天')
    expect(triageBadgeLabel(3 * DAY_MS)).toBe('还剩 3 天')
    expect(triageBadgeLabel(null)).toBe('')
  })

  it('过期写「已到期，已移到『已移出』」', () => {
    expect(triageBadgeLabel(0)).toBe('已到期，已移到「已移出」')
    expect(triageBadgeLabel(-HOUR_MS)).toBe('已到期，已移到「已移出」')
  })

  it('所有分流文案里没有「你忘了 / 你没看」措辞', () => {
    const texts = [
      triageBadgeLabel(5 * HOUR_MS),
      triageBadgeLabel(0),
      describeTriage(enterInbox(fav('a'), NOW - HOUR_MS), SETTINGS, NOW),
      describeTriage({ ...fav('b'), triageStatus: 'read', triageAt: NOW - DAY_MS }, SETTINGS, NOW),
      describeTriage(fav('c'), SETTINGS, NOW),
    ]
    for (const text of texts) {
      expect(text).not.toContain('忘了')
      expect(text).not.toContain('没看')
    }
  })

  it('describeTriage：待读 / 已读 / 永久各说各的', () => {
    expect(describeTriage(enterInbox(fav('a'), NOW - HOUR_MS), SETTINGS, NOW)).toContain('待读箱')
    expect(describeTriage({ ...fav('b'), triageStatus: 'read', triageAt: NOW - DAY_MS }, SETTINGS, NOW)).toContain('已读')
    expect(describeTriage(fav('c'), SETTINGS, NOW)).toBe('永久收藏')
  })
})

describe('分流偏好：独立键、非法档位回落默认', () => {
  it('默认值：开 / 24 小时 / 30 天', () => {
    expect(DEFAULT_TRIAGE_INBOX_HOURS).toBe(24)
    expect(DEFAULT_TRIAGE_READ_DAYS).toBe(30)
    expect(normalizeTriageSettings(undefined)).toEqual({ enabled: true, inboxHours: 24, readDays: 30 })
  })

  it('非法档位回落默认，不抛', () => {
    expect(normalizeTriageSettings({ enabled: true, inboxHours: 25, readDays: 31 })).toEqual({
      enabled: true,
      inboxHours: 24,
      readDays: 30,
    })
    expect(normalizeTriageSettings({ enabled: 'yes', inboxHours: 72, readDays: 7 })).toEqual({
      enabled: true,
      inboxHours: 72,
      readDays: 7,
    })
  })

  it('读 / 写往返：只改传了的键，其余保留', () => {
    const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
    const store: Record<string, string> = {}
    const localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v)
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    }
    globals.localStorage = localStorage
    globals.window = { localStorage, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
    try {
      expect(readTriageSettings()).toEqual({ enabled: true, inboxHours: 24, readDays: 30 })
      expect(writeTriageSettings({ inboxHours: 72 })).toEqual({ enabled: true, inboxHours: 72, readDays: 30 })
      expect(readTriageSettings()).toEqual({ enabled: true, inboxHours: 72, readDays: 30 })
      expect(writeTriageSettings({ enabled: false })).toEqual({ enabled: false, inboxHours: 72, readDays: 30 })
    } finally {
      delete globals.window
      delete globals.localStorage
    }
  })

  it('坏 JSON / 非对象按默认值，不抛', () => {
    const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
    const localStorage = {
      getItem: () => '{bad json',
      setItem: () => {},
      removeItem: () => {},
    }
    globals.localStorage = localStorage
    globals.window = { localStorage, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
    try {
      expect(readTriageSettings()).toEqual({ enabled: true, inboxHours: 24, readDays: 30 })
    } finally {
      delete globals.window
      delete globals.localStorage
    }
  })
})

describe('接线守卫：hook 与调用点按设计走', () => {
  const hook = read('src/hooks/useFavorites.ts')

  it('初始化读盘后跑一次 settleTriage（打开时结算，不靠后台任务）', () => {
    expect(hook).toContain('settleFavoritesOnLoad(loaded.items, loaded.blocked)')
    expect(hook).toContain('settleTriage(items, settings, now)')
  })

  it('toggle() 新收按开关打戳：开着进 inbox，关着直接 permanent', () => {
    expect(hook).toContain('enterInbox({ ...site, createdAt: now, updatedAt: now }, now)')
    expect(hook).toContain('readTriageSettings().enabled')
  })

  it('recordOpened() 在 inbox 条目上同时完成 inbox → read', () => {
    expect(hook).toContain('markTriageRead(i, now)')
  })

  it('importJson() incoming 一律 permanent：文件里的分流字段不带进收藏', () => {
    expect(hook).toContain('triageStatus: undefined, triageAt: undefined')
  })

  it('exportJson() v1 不带分流字段', () => {
    expect(hook).toContain('delete copy.triageStatus')
    expect(hook).toContain('delete copy.triageAt')
  })

  it('hook 暴露 promote / renew / shelve / restore / settle 入口', () => {
    for (const name of [
      'promoteFavorite',
      'renewInbox',
      'shelveFavorite',
      'restoreShelved',
      'deleteShelved',
      'clearShelved',
      'settledExpiredCount',
    ]) {
      expect(hook).toContain(name)
    }
  })

  it('写已移出区失败时整批不移出：收藏留在原处并交回原因', () => {
    expect(hook).toContain("error: '已移出区写不进去")
  })

  it('survivors 写盘失败时同样整批不移出：saveLocal 返回 boolean，失败返回原列表 + 原因', () => {
    expect(hook).toContain('function saveLocal(items: LocalFavorite[]): boolean')
    expect(hook).toContain('if (!saveLocal(survivors))')
    expect(hook).toContain("error: '本机收藏写不进去")
  })

  it('settleOnLoad 公开方法已删除：结算只走初始化内部的 settleFavoritesOnLoad', () => {
    expect(hook).not.toContain('settleOnLoad')
    expect(hook).toContain('settleFavoritesOnLoad(loaded.items, loaded.blocked)')
  })

  it('⌘K 打开收藏时已调 recordOpened（inbox → read 随它自动生效，无需改调用点）', () => {
    const palette = read('src/components/search-palette.tsx')
    expect(palette).toContain('favorites.recordOpened(fav.siteId)')
    expect(palette).toContain('favorites.recordOpened(item.entry.siteId)')
  })

  it('设置面板有「待读分流」一节：开关 + 两档位选择，只存本机', () => {
    const panel = read('src/components/user-center/settings-panel.tsx')
    expect(panel).toContain('待读分流')
    expect(panel).toContain('TRIAGE_INBOX_HOUR_OPTIONS')
    expect(panel).toContain('TRIAGE_READ_DAY_OPTIONS')
    expect(panel).toContain('只存这台设备，不会上传到云端')
    // 「恢复默认」不重置分流偏好：文案必须写明，否则用户以为一点就全回默认
    expect(panel).toContain('不重置这里的分流设置')
  })

  it('收藏页有待读箱入口 + 角标 + 到期横幅 + 已移出入口，默认视图不变', () => {
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain('待读箱')
    expect(page).toContain("条待读 · ")
    expect(page).toContain('条待读过期，已移到「已移出」')
    expect(page).toContain('href="/favorites/shelved"')
    expect(page).toContain("filterByTriage(byFolder, triageFilter)")
    // 开关关时待读箱入口隐藏，但已移出入口必须保留（里面的收藏还在等找回）
    expect(page).toContain('!triageSettings.enabled && shelvedCount > 0')
  })

  it('新代码没有显式 any，且选择逻辑不读真实时钟（now 一律注入）', () => {
    const triage = read('src/lib/favorites-triage.ts')
    expect(triage).not.toMatch(/:\s*any\b/)
    expect(triage).not.toContain('new Date()')
  })
})
