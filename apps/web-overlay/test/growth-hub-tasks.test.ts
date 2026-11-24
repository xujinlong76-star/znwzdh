/**
 * /me 成长系统体验重构（evo/me-growth-1120）断言：
 *  - 追剧分支设门：无短剧历史的档案，核心槽主选与备选均为 AI 任务且互不相同；
 *    有短剧历史的档案，短剧任务可作为主选或备选出现。
 *  - 一键直达映射完整性：每个任务 id 要么有映射，要么在明确的无按钮清单
 *    （s1/d6/d7）内；每个 href 均为已核实的站内真实路由。
 *  - 展示层守卫：挂机大段文案已弱化为注脚、宝箱概率已折叠进 Popover、
 *    新手一周为横向步骤条、GrowthHubTab 别名导出存在。
 * 时间全部用注入的 now 控制，不依赖真实时钟。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assignDailySlots,
  dailyTaskStatus,
  emptyProfile,
  growthDayKey,
  type GrowthDay,
  type GrowthProfile,
} from '../src/lib/growth'
import {
  EVENT_METRIC_ACTIONS,
  TASK_ACTIONS,
  eventMetricAction,
  taskAction,
} from '../src/components/growth/task-actions'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..', '..', 'web-overlay')

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel)
  if (!existsSync(p)) throw new Error('overlay 缺少文件 ' + rel)
  return readFileSync(p, 'utf8')
}

/** 本地时间构造：2026 年 11 月 20 日正午（避开 04:00 切日平移） */
function at(month: number, day: number, hour = 12): Date {
  return new Date(2026, month - 1, day, hour)
}

function key(month: number, day: number): string {
  return growthDayKey(at(month, day))
}

/** 造一个指定 counts 的日子（直接写状态，绕过逐日调用） */
function dayWithCounts(counts: GrowthDay['counts']): GrowthDay {
  return {
    xp: 40,
    seasonXp: 0,
    visitGranted: true,
    usageXp: 40,
    counts,
    idleMinutes: 0,
    sitesOpened: [],
    categoriesVisited: [],
    newCategories: [],
    searchTerms: [],
    pageVisits: [],
    favRewarded: 0,
    watchlistNew: 0,
    customSiteAdded: 0,
    dailySlots: null,
    dailyGranted: [],
    chestGranted: false,
    seasonZoneVisit: false,
    taskXp: 0,
  }
}

const AI_IDS = new Set(['core-ai-find', 'core-search'])
const DRAMA_IDS = new Set(['core-drama-progress', 'core-drama-new'])
/** 已核实的站内真实路由基准路径（允许带语义引导 query 参数，如 ?from=growth_task&...） */
const REAL_PATHNAMES = new Set(['/', '/brief', '/hot', '/search', '/me/watchlist', '/category/duanju', '/submit'])
function pathnameOf(href: string): string {
  const q = href.indexOf('?')
  return q === -1 ? href : href.slice(0, q)
}
/** 完成动作就在当前面板内、无需跳转的任务 */
const NO_BUTTON_IDS = new Set(['s1', 'd6', 'd7'])

describe('追剧分支设门（assignDailySlots）', () => {
  it('无短剧历史：核心槽主选与备选均为 AI 任务且互不相同', () => {
    const p = emptyProfile(at(11, 20))
    const slots = assignDailySlots(p, key(11, 20))
    expect(AI_IDS.has(slots.coreA)).toBe(true)
    expect(AI_IDS.has(slots.coreB)).toBe(true)
    expect(slots.coreB).not.toBe(slots.coreA)
    expect(DRAMA_IDS.has(slots.coreA)).toBe(false)
    expect(DRAMA_IDS.has(slots.coreB)).toBe(false)
  })

  it('无短剧历史：dailyTaskStatus 的核心槽 id 也是 AI 任务', () => {
    const p = emptyProfile(at(11, 20))
    const { slots } = dailyTaskStatus(p, at(11, 20))
    const core = slots.find((s) => s.slot === 'core')
    expect(core).toBeDefined()
    expect(AI_IDS.has(core!.id)).toBe(true)
  })

  it('有短剧历史（dramaDates）：备选可为短剧任务', () => {
    const p = emptyProfile(at(11, 20))
    p.dramaDates = [key(11, 18)]
    const slots = assignDailySlots(p, key(11, 20))
    // AI 仍为主轨（近 7 日无行为时 aiOps == dramaOps == 0 → aiMain），备选为短剧
    expect(AI_IDS.has(slots.coreA)).toBe(true)
    expect(DRAMA_IDS.has(slots.coreB)).toBe(true)
  })

  it('近 7 日短剧行为多于 AI：短剧可作主选', () => {
    const p: GrowthProfile = emptyProfile(at(11, 20))
    p.days[key(11, 19)] = dayWithCounts({ drama_visit: 2 })
    p.dramaDates = [key(11, 19)]
    const slots = assignDailySlots(p, key(11, 20))
    expect(DRAMA_IDS.has(slots.coreA)).toBe(true)
    expect(AI_IDS.has(slots.coreB)).toBe(true)
  })

  it('同一天多次计算结果一致（确定性不受设门影响）', () => {
    const p = emptyProfile(at(11, 20))
    expect(assignDailySlots(p, key(11, 20))).toEqual(assignDailySlots(p, key(11, 20)))
  })
})

describe('一键直达映射完整性（task-actions）', () => {
  const ALL_TASK_IDS = [
    // 每日三件事
    'sh-brief', 'sh-sites', 'sh-hot',
    'core-ai-find', 'core-search', 'core-drama-progress', 'core-drama-new',
    'st-fav', 'st-cat', 'st-custom',
    // 本周任务
    'w1', 'w2', 'w3', 'w4', 'w5',
    // 赛季任务
    's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8',
    // 新手一周
    'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
    // 回归包
    'r1', 'r2', 'r3',
  ]

  it('每个任务 id 要么有映射，要么在明确的无按钮清单内', () => {
    for (const id of ALL_TASK_IDS) {
      const hasAction = taskAction(id) !== undefined
      const noButton = NO_BUTTON_IDS.has(id) || id === 'd3'
      expect(hasAction || noButton).toBe(true)
    }
  })

  it('d3（设为首页）无 href：它是面板内动作（切到图鉴 Tab），不走路由', () => {
    expect(taskAction('d3')).toBeUndefined()
  })

  it('每个映射的 href 均为已核实的站内真实路由（且携带 from=growth_task 语义上下文）', () => {
    for (const [_id, a] of Object.entries(TASK_ACTIONS)) {
      expect(REAL_PATHNAMES.has(pathnameOf(a.href))).toBe(true)
      expect(a.href).toContain('from=growth_task')
      expect(a.cta.length).toBeGreaterThan(0)
    }
    for (const [_metric, a] of Object.entries(EVENT_METRIC_ACTIONS)) {
      expect(REAL_PATHNAMES.has(pathnameOf(a.href))).toBe(true)
      expect(a.href).toContain('from=growth_task')
      expect(a.cta.length).toBeGreaterThan(0)
    }
  })

  it('季中事件 6 个指标全部有映射', () => {
    for (const m of ['fav_adds', 'distinct_categories', 'brief_days', 'watchlist_progress', 'drama_days', 'ai_find_days']) {
      expect(eventMetricAction(m)).toBeDefined()
    }
  })
})

describe('展示层守卫（去抽卡感 + 2026-11-21 UX 全面重构）', () => {
  it('主界面无「挂机陪伴：前台浏览每分钟 +1 经验」大段文案，并配备无障碍专注浏览 Tooltip', () => {
    const s = overlayFile('src/components/user-center/growth-panel.tsx')
    expect(s).not.toContain('挂机陪伴：前台浏览每分钟 +1 经验')
    expect(s).toContain('专注浏览换算规则')
  })

  it('宝箱概率规则已折叠进「? 规则说明」Popover，不再是 details 大段铺开', () => {
    const s = overlayFile('src/components/growth/growth-tasks.tsx')
    expect(s).not.toContain('查看宝箱概率与规则')
    expect(s).toContain('规则说明')
    expect(s).toContain('Popover')
    // 规则正文本身一字不动
    expect(s).toContain('连开 3 个没出卡，第 4 个必出')
  })

  it('新手一周为横向 7 天圆点步骤条 + 未完成时动态置顶在今天的三件事正上方', () => {
    const s = overlayFile('src/components/growth/growth-tasks.tsx')
    expect(s).toContain('新手一周 7 天进度')
    expect(s).toContain('data-rookie-section={isPinnedTop ? \'pinned-top\' : \'archived-bottom\'}')
    expect(s).toContain('{pinRookieTop && renderRookieBanner(true)}')
    expect(s).not.toContain('sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4')
  })

  it('成长面板导出 GrowthHubTab 别名（供「成长与任务」Tab 挂载）且二级 Tab 独立于档案大卡外部', () => {
    const s = overlayFile('src/components/user-center/growth-panel.tsx')
    expect(s).toContain('export const GrowthHubTab = GrowthPanel')
    expect(s).toContain('export function GrowthPanel')
    expect(s).toContain('data-growth-profile-card="true"')
    expect(s).toContain('data-growth-segmented-control="true"')
    // 二级 Tab 必须在顶部档案大卡的 </section> 之外
    const profileCloseIdx = s.indexOf('</section>', s.indexOf('data-growth-profile-card="true"'))
    const tablistIdx = s.indexOf('data-growth-segmented-control="true"')
    expect(profileCloseIdx).toBeGreaterThan(-1)
    expect(tablistIdx).toBeGreaterThan(profileCloseIdx)
  })

  it('每日三槽仅第一条未完成项使用 Primary CTA，且本周/回归任务行均接了直达按钮', () => {
    const s = overlayFile('src/components/growth/growth-tasks.tsx')
    expect(s).toContain('<TaskGoButton id={s.id} variant={isPrimaryAction ? \'primary\' : \'secondary\'} />')
    expect(s).toContain('action={taskAction(t.id)}')
    expect(s).toContain('完成同一动作将自动同步推进今日、本周与新手多条进度')
  })
})
