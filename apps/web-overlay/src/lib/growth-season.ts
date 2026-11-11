/**
 * 成长赛季配置（自然季历法 + 季中内容）——配置驱动，换季只改这里、不改引擎代码。
 *
 * 赛季历法：以 SEASON_EPOCH（本地日期）为第 1 季第 1 天，每 90 天一季，
 * 所有用户共享同一套赛季日历（季中事件窗口因此对全站同时开启/结束）。
 *
 * 季中内容（William 2026-11-11 指示「季中内容也一并规划进去」）：
 * v2 模拟显示中度用户第 22 天、重度第 7 天即打满 20 级主轨，第 30–60 天
 * 新鲜感只剩等级慢轴。本配置在每季第 30–60 天排两个主题事件 + 一组
 * SP 里程碑节点，事件任务与里程碑奖励都由 growth.ts 引擎真实结算
 * （窗口内计数、达标自动发放、领取状态落档案），不是展示文案。
 * 后续赛季换主题/换任务：改 EVENTS 的文案与窗口即可，指标口径不动。
 */

export const SEASON_EPOCH_KEY = '2026-01-01'
export const SEASON_LENGTH_DAYS = 90
export const SEASON_LEVEL_COUNT = 20
/** 每级所需 SP（赛季积分 = 赛季内成长值 1:1 镜像） */
export const SEASON_SP_PER_LEVEL = 100
/** 满级后漫游轨：每攒够多少 SP 得 1 个漫游节点 */
export const ROAMING_SP_PER_NODE = 400
/** 赛季等级小奖（每升一级，非镜像发放，防自循环） */
export const SEASON_LEVEL_REWARD_XP = 10
/** 漫游节点奖励（非镜像） */
export const ROAMING_NODE_REWARD_XP = 15

/** 事件任务的计数口径：全部取「窗口内天数记录」的派生量，引擎可直接核 */
export type SeasonEventMetric =
  | 'fav_adds' // 窗口内净增收藏（过净增锁的计数）
  | 'distinct_categories' // 窗口内到访过的不同一级分类数
  | 'brief_days' // 窗口内读过简报的不同天数
  | 'watchlist_progress' // 窗口内追剧进度更新次数
  | 'drama_days' // 窗口内到访短剧专区的不同天数
  | 'ai_find_days' // 窗口内用 AI 找站的不同天数

export interface SeasonEventTaskDef {
  id: string
  title: string
  metric: SeasonEventMetric
  target: number
  /** 达标奖励成长值（任务类，不吃倍率；镜像进 SP 与普通任务一致） */
  xp: number
}

export interface SeasonEventDef {
  id: string
  name: string
  /** 一句主题说明，成长页赛季区展示 */
  blurb: string
  /** 赛季内窗口（第几天起/止，1 起含两端） */
  dayFrom: number
  dayTo: number
  tasks: SeasonEventTaskDef[]
}

export const SEASON_EVENTS: SeasonEventDef[] = [
  {
    id: 'mid-treasure',
    name: '季中寻宝',
    blurb: '赛季过半，把窝里的收藏和地图再充实一轮——这半个月的收获，季末都算数。',
    dayFrom: 30,
    dayTo: 44,
    tasks: [
      { id: 'mt-fav', title: '寻宝季：新收藏 3 个站', metric: 'fav_adds', target: 3, xp: 30 },
      { id: 'mt-cat', title: '逛新街：逛 4 个不同的一级分类', metric: 'distinct_categories', target: 4, xp: 30 },
      { id: 'mt-brief', title: '读报人：读 5 期每日简报', metric: 'brief_days', target: 5, xp: 30 },
    ],
  },
  {
    id: 'mid-stage',
    name: '季中追光',
    blurb: '下半程是追剧和找站的主场：把在追的剧往前推一推，再让小猫帮你挖几个新站。',
    dayFrom: 45,
    dayTo: 60,
    tasks: [
      { id: 'ms-drama-progress', title: '追光马拉松：更新追剧进度 6 次', metric: 'watchlist_progress', target: 6, xp: 30 },
      { id: 'ms-drama-days', title: '常驻剧场：4 个不同的日子来短剧专区', metric: 'drama_days', target: 4, xp: 30 },
      { id: 'ms-ai', title: '问问小猫：3 个不同的日子用 AI 找站', metric: 'ai_find_days', target: 3, xp: 30 },
    ],
  },
]

/** 季中 SP 里程碑：只在第 30–60 天窗口内跨越才触发（季中内容的第二条腿） */
export interface MidSeasonMilestoneDef {
  sp: number
  xp: number
  freezeCard: boolean
}

export const MID_SEASON_MILESTONES: MidSeasonMilestoneDef[] = [
  { sp: 800, xp: 25, freezeCard: false },
  { sp: 1200, xp: 25, freezeCard: false },
  { sp: 1600, xp: 25, freezeCard: true },
]

export const MID_SEASON_WINDOW = { dayFrom: 30, dayTo: 60 } as const
