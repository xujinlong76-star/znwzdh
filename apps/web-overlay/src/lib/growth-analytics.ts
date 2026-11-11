/**
 * 成长体系埋点（PostHog）——与全站既定口径一致：环境变量开关、未设全关。
 *
 * 开关：NEXT_PUBLIC_POSTHOG_KEY 未设置时本模块所有函数都是空操作，
 * 不发任何请求、不写任何存储。设置后事件经 PostHog capture 接口直发
 * （不引 SDK，成长事件量小、字段固定，没必要多一个依赖）。
 *
 * 隐私口径（v2 度量节定稿）：只报事件名 + 匿名计数/枚举属性，
 * 绝不上报用户内容——搜索词、网址、剧名、收藏内容一律不进 properties。
 * distinct_id 用站内既有匿名身份键（navhub.anonId），不新造身份。
 */

import { ANON_ID_STORAGE_KEY } from './identity-keys'

export type GrowthAnalyticsEvent =
  | 'growth_xp_credited'
  | 'growth_task_completed'
  | 'growth_chest_opened'
  | 'growth_level_up'
  | 'streak_day_lit'
  | 'streak_freeze_used'
  | 'streak_earnback_opened'
  | 'streak_earnback_done'
  | 'streak_broken'
  | 'season_level_up'
  | 'growth_card_view'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
const POSTHOG_HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/+$/, '')

export function growthAnalyticsEnabled(): boolean {
  return POSTHOG_KEY.length > 0
}

function distinctId(): string {
  try {
    let id = window.localStorage.getItem(ANON_ID_STORAGE_KEY)
    if (!id) {
      const rand =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
      id = `anon-${rand}`
      window.localStorage.setItem(ANON_ID_STORAGE_KEY, id)
    }
    return id
  } catch {
    return 'anon-unavailable'
  }
}

/** 发一条成长事件。失败静默（埋点永远不许影响功能），未配置时直接返回。 */
export function trackGrowthEvent(event: GrowthAnalyticsEvent, properties: Record<string, string | number | boolean> = {}): void {
  if (!growthAnalyticsEnabled()) return
  if (typeof window === 'undefined') return
  try {
    const body = JSON.stringify({
      api_key: POSTHOG_KEY,
      event,
      properties: { distinct_id: distinctId(), $lib: 'znwzdh-growth', ...properties },
    })
    // sendBeacon 优先（页面跳转/关闭时不丢），不支持时退 fetch keepalive
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(`${POSTHOG_HOST}/capture/`, blob)) return
    }
    void fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* 埋点发送失败可以吞：统计丢失不影响任何功能，绝不冒泡打扰用户 */
    })
  } catch {
    /* 埋点失败不冒泡 */
  }
}
