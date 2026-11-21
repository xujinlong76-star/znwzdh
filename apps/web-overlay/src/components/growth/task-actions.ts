/**
 * 成长任务一键直达（Actionable Tasks）：任务 id → 跳转目标。
 *
 * 展示层元数据：只决定“未完成任务的按钮链到哪里”，不参与 XP 结算、
 * 不改任务判定。所有 href 均为站内真实路由（2026-11-21 逐个核实）：
 *  - `/`：首页（站点卡片、分类、AI 找站微胶囊、自定义站添加均在此）
 *  - `/?scene=make-ppt`：首页 + AI 找站小窗自动跑「做 PPT」场景
 *    （navigation-content 读 scene 参数 → HomeMicroStrip 自动开窗 →
 *    ai-finder-dialog remount → ai-finder-panel 自动跑场景）
 *  - `/hot`：热榜页（growth-tracker 对其记 `recordPageVisitAction('hot')`）
 *  - `/brief`：每日简报（FEATURE_META.brief_read.href）
 *  - `/search`：站内搜索（FEATURE_META.search.href）
 *  - `/me/watchlist`：追剧清单（FEATURE_META.watchlist_progress.href）
 *  - `/category/duanju`：短剧专区（FEATURE_META.drama_visit.href）
 *  - `/submit`：提交收录（app/submit/page.tsx 存在）
 *
 * 无按钮的任务（不在本表内）：完成动作就在当前面板内，无需跳转——
 *  - s1 专区常客：到访赛季专区 = 打开成长页本身；
 *  - d6 看一眼成长档案：正在看；
 *  - d7 每周任务 + 全清宝箱：均在本面板内完成。
 * 新手 D3（设为首页）是面板内动作（切到「图鉴与指南」Tab 看设置向导），
 * 由 GrowthTasks 的 onGoToGuide 回调处理，不走 href。
 */

export interface TaskAction {
  /** 站内目标路由 */
  href: string
  /** 按钮文案（统一以“去…”开头，带 →） */
  cta: string
}

export const TASK_ACTIONS: Readonly<Record<string, TaskAction>> = {
  // 每日三件事 · 浅层槽
  'sh-brief': { href: '/brief', cta: '去读简报 →' },
  'sh-sites': { href: '/', cta: '去逛逛 →' },
  'sh-hot': { href: '/hot', cta: '去逛热榜 →' },
  // 每日三件事 · 核心槽（AI 主轨）
  'core-ai-find': { href: '/?scene=make-ppt', cta: '去试试 AI 找站 →' },
  'core-search': { href: '/search', cta: '去搜一次 →' },
  // 每日三件事 · 核心槽（短剧主轨，仅有短剧历史的用户可见）
  'core-drama-progress': { href: '/me/watchlist', cta: '去更新进度 →' },
  'core-drama-new': { href: '/me/watchlist', cta: '去加入清单 →' },
  // 每日三件事 · 沉淀槽
  'st-fav': { href: '/', cta: '去收藏一个站 →' },
  'st-cat': { href: '/', cta: '去逛新分类 →' },
  'st-custom': { href: '/', cta: '去添加 →' },
  // 本周任务
  w1: { href: '/', cta: '去逛逛 →' },
  w2: { href: '/', cta: '去逛分类 →' },
  w3: { href: '/brief', cta: '去读简报 →' },
  w4: { href: '/', cta: '去逛逛 →' },
  w5: { href: '/', cta: '去赚经验 →' },
  // 赛季任务（s1 专区常客无按钮：完成动作就是打开本页）
  s2: { href: '/', cta: '去收藏 →' },
  s3: { href: '/brief', cta: '去读简报 →' },
  s4: { href: '/me/watchlist', cta: '去更新进度 →' },
  s5: { href: '/?scene=make-ppt', cta: '去试试 AI 找站 →' },
  s6: { href: '/', cta: '去逛分类 →' },
  s7: { href: '/', cta: '去逛逛 →' },
  s8: { href: '/submit', cta: '去提交收录 →' },
  // 新手一周（d3 设为首页是面板内动作，见 GrowthTasks onGoToGuide；d6/d7 无按钮）
  d1: { href: '/', cta: '去逛逛 →' },
  d2: { href: '/?scene=make-ppt', cta: '去试试 AI 找站 →' },
  d4: { href: '/me/watchlist', cta: '去加入清单 →' },
  d5: { href: '/', cta: '去收藏 →' },
  // 回归包
  r1: { href: '/', cta: '去逛逛 →' },
  r2: { href: '/brief', cta: '去读简报 →' },
  r3: { href: '/', cta: '去收藏一个站 →' },
}

/** 季中事件任务按指标映射（SeasonEventTaskDef.metric → 直达目标） */
export const EVENT_METRIC_ACTIONS: Readonly<Record<string, TaskAction>> = {
  fav_adds: { href: '/', cta: '去收藏 →' },
  distinct_categories: { href: '/', cta: '去逛分类 →' },
  brief_days: { href: '/brief', cta: '去读简报 →' },
  watchlist_progress: { href: '/me/watchlist', cta: '去更新进度 →' },
  drama_days: { href: '/category/duanju', cta: '去逛短剧专区 →' },
  ai_find_days: { href: '/?scene=make-ppt', cta: '去试试 AI 找站 →' },
}

export function taskAction(id: string): TaskAction | undefined {
  return TASK_ACTIONS[id]
}

export function eventMetricAction(metric: string): TaskAction | undefined {
  return EVENT_METRIC_ACTIONS[metric]
}
