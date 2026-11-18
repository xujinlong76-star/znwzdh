'use client'

import { useEffect, useState } from 'react'

/**
 * 首页今日行倒计时徽章（考试峰值日包 W7，纯展示组件）。
 *
 * 只做一件事：把调用方给定的目标时刻渲染成短文案。不取业务数据、
 * 不读 exam-calendar、不从 ExamNode 推导时刻——ExamNode 只有
 * startISO / endISO 两个北京时间自然日字段，没有时刻字段（见
 * lib/exam-calendar.ts 的 ExamNode 接口；todayNodes() 返回的
 * { exam, node, kind } 里也没有可用的目标时刻）。京考报名 18:00
 * 截止这类时点只存在于节点 detail 原文里，调用方（实现轮）必须
 * 用已核实的时刻构造 target 传进来，绝不能拿 endISO 当天 00:00
 * 冒充目标时刻——那会在当天 0 点就显示「已截止」。
 *
 * 水合安全（照抄同站 ExamCountdown 的做法：倒计时依赖客户端时间，
 * SSR 直出会在分钟边界与水合结果差一分钟）：
 *  - 挂载前（nowMs === null）只渲染固定静态文案「倒计时」：服务端
 *    与客户端首帧输出逐字一致，不可能水合错位；
 *  - 挂载后 effect 立即取一次 Date.now()，再每 30 秒 tick 一次，
 *    每次都用 Date.now() 重算，不用 prev-1 累加，防后台节流漂移；
 *  - tick 间隔 30 秒：文案以分钟为单位变化，30 秒 tick 保证在
 *    分钟边界后 30 秒内刷新，比 60 秒 tick 最多快半分钟。
 *
 * 样式沿用今日行「今日截止」徽章（home-today-zone.tsx）：
 * rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium
 * text-amber-700 dark:text-amber-400；另加 whitespace-nowrap +
 * tabular-nums，390px 下不换行、不溢出（最长文案「剩23小时59分」8 字）。
 * 不写开通状态文案：开通状态未核实，组件只表达剩余时间 / 已截止。
 * hideWhenPassed（W10）：查分节点过期后 chip 直接消失，不显示「已截止」。
 */

/** 今日行倒计时徽章的类名：与「今日截止」徽章同一配方。 */
const COUNTDOWN_BADGE_CLASS =
  'shrink-0 whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-400'

/** tick 间隔：30 秒（文案分钟级变化，见文件头注释）。 */
const TICK_MS = 30_000

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

export interface HomeTodayCountdownProps {
  /**
   * 目标时刻：ISO 字符串或 Date。调用方负责提供已核实的时刻；
   * 组件不推导、不补默认值。无效值（解析出 NaN）渲染 null，
   * 不编造文案。服务端组件向本客户端组件传值时请传 ISO 字符串
   * （可跨 RSC 序列化）；Date 只用于客户端内直接渲染或测试。
   */
  target: string | Date
  /** 目标时刻已过时显示的文案，缺省「已截止」。 */
  endedLabel?: string
  /**
   * 目标时刻已过时直接不渲染（缺省 false，沿用 endedLabel 文案）。
   * 峰值日包 W10：查分节点（kind === 'today'，「距开通」语义）用它——
   * 公告时刻已过后 chip 消失，不显示「已截止」，避免误导用户以为
   * 查分通道关闭。只在挂载后（nowMs 已取到）生效，挂载前占位不动。
   */
  hideWhenPassed?: boolean
}

/**
 * 剩余时间格式化（纯函数，单元测试直接测它）：
 *  - 已过（diff <= 0）：endedLabel，缺省「已截止」；
 *  - 不足 1 分钟：`剩不到 1 分`；
 *  - 不足 1 小时：`剩X分`（X = 向下取整的分钟数，>= 1）；
 *  - 1 小时及以上：`剩X小时Y分`（X = 向下取整的小时数，Y = 余分钟数，可为 0）。
 */
export function formatRemaining(
  targetMs: number,
  nowMs: number,
  endedLabel = '已截止',
): string {
  const diffMs = targetMs - nowMs
  if (diffMs <= 0) return endedLabel
  if (diffMs < MINUTE_MS) return '剩不到 1 分'
  if (diffMs < HOUR_MS) return `剩${Math.floor(diffMs / MINUTE_MS)}分`
  const hours = Math.floor(diffMs / HOUR_MS)
  const minutes = Math.floor((diffMs % HOUR_MS) / MINUTE_MS)
  return `剩${hours}小时${minutes}分`
}

/** 目标时刻解析：string | Date → 毫秒时间戳，无效值返回 NaN。 */
function toTargetMs(target: string | Date): number {
  return target instanceof Date ? target.getTime() : Date.parse(target)
}

export function HomeTodayCountdown({
  target,
  endedLabel = '已截止',
  hideWhenPassed = false,
}: HomeTodayCountdownProps) {
  const [nowMs, setNowMs] = useState<number | null>(null)

  useEffect(() => {
    setNowMs(Date.now())
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const targetMs = toTargetMs(target)
  if (Number.isNaN(targetMs)) return null

  // 挂载前只渲染固定静态文案：SSR 与客户端首帧逐字一致，零水合错位；
  // 挂载后 effect 立即取时并开始 tick，文案随即变为实时剩余时间。
  if (nowMs === null) {
    return (
      <span role="timer" aria-label="倒计时" className={COUNTDOWN_BADGE_CLASS}>
        倒计时
      </span>
    )
  }

  const text = formatRemaining(targetMs, nowMs, endedLabel)
  // 挂载后：目标已过且 hideWhenPassed 时直接消失（不渲染 endedLabel）；
  // 挂载前的「倒计时」占位不受影响（见上，SSR 测试依赖它）。
  if (hideWhenPassed && targetMs <= nowMs) return null
  return (
    <span role="timer" aria-label={`倒计时 ${text}`} className={COUNTDOWN_BADGE_CLASS}>
      {text}
    </span>
  )
}
