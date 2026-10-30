'use client'

/**
 * 每日 LLM 用量堆叠柱 + 累计花费线（按天×模型）。
 *
 * 解的是「用量/花费随时间怎么变、谁占大头」——现有 hourly 趋势是「小时归并」
 * （7/30 天窗口是同小时跨天合计，非连续时间轴），看不了跨天变化；成本也只有一个
 * 窗口总数。这里每天一根堆叠柱（按模型分层），同图叠一条累计已知花费线（右轴）。
 *
 * 三条口径约束（与数据层一致）：
 *  1. costRmb 为 null = 当天没有带价快照的调用：累计线在该日不增长，
 *     但也不补 0 —— 「未知」不是「免费」；
 *  2. 无任何带价数据时整条成本线不画（连同右轴），写明原因，绝不折算；
 *  3. 明细被截断（truncated）时日柱与窗口合计对不上，如实标注而不是抹平。
 *
 * 空态只写「暂无调用记录」：不生成合成曲线（dashboard-traffic-chart 的
 * generateSynthesizedPoints 是反面教材——没有数据时看起来像有数据）。
 *
 * 关键值常显不依赖 hover：窗口合计、累计花费、分模型图例（带总量）都在图外文本里；
 * SVG 内的 <title> 只补细节。纯 SVG + viewBox 自适应，移动端随容器缩放。
 */
import { useMemo } from 'react'
import type { HubAiDailyTrendPoint } from '@/lib/navhub-api'

/**
 * 模型配色台账（冷色系堆叠，成本线用暖色焦点色单独一支）。
 * 超过 8 个模型时按调用数排序后循环取色并降透明度——管理端实际不会超过个位数，
 * 真出现了也要保证图例颜色可区分。
 */
export const MODEL_PALETTE = [
  '#6366f1', // indigo-500
  '#8b5cf6', // violet-500
  '#14b8a6', // teal-500
  '#0ea5e9', // sky-500
  '#10b981', // emerald-500
  '#a855f7', // purple-500
  '#f59e0b', // amber-500
  '#f43f5e', // rose-500
] as const

/** 累计花费线：焦点色，与冷色堆叠明确分开 */
export const COST_LINE_COLOR = '#e11d48'

export interface DailyChartModel {
  /** 图例/堆叠顺序：按窗口内总调用数降序，各日同序堆叠（同模型不换层） */
  models: Array<{ model: string; color: string; totalCalls: number; totalCostRmb: number | null }>
  days: Array<{
    day: string
    /** 横轴标签 MM-DD */
    label: string
    /** 自下而上的堆叠段（顺序与 models 一致；calls=0 的模型不出段） */
    segments: Array<{ model: string; color: string; calls: number; costRmb: number | null }>
    totalCalls: number
    costRmb: number | null
    /** 截至当日的累计已知花费（元）；从未有过带价数据时为 null */
    cumCostRmb: number | null
  }>
  maxTotalCalls: number
  maxCumCostRmb: number
  /** 窗口内出现过任何带价调用（决定成本线与右轴是否绘制） */
  hasAnyCost: boolean
  windowCalls: number
  /** 窗口内已知成本合计；全无单价时为 null */
  windowCostRmb: number | null
}

/**
 * 日堆叠柱 + 累计线的语义层（不碰像素）：图例顺序、颜色、累计序列。
 * 抽出来是为了让它可单测——像素映射留在组件里。
 */
export function buildDailyChartModel(daily: HubAiDailyTrendPoint[]): DailyChartModel {
  const totals = new Map<string, { calls: number; cost: number | null }>()
  for (const d of daily) {
    for (const m of d.models) {
      const t = totals.get(m.model) ?? { calls: 0, cost: null }
      t.calls += m.calls
      if (m.costRmb !== null) t.cost = (t.cost ?? 0) + m.costRmb
      totals.set(m.model, t)
    }
  }
  const models = Array.from(totals.entries())
    .sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]))
    .map(([model, t], idx) => ({
      model,
      color: MODEL_PALETTE[idx % MODEL_PALETTE.length],
      totalCalls: t.calls,
      totalCostRmb: t.cost === null ? null : Number(t.cost.toFixed(6)),
    }))
  const order = new Map(models.map((m, i) => [m.model, i]))
  const colorOf = new Map(models.map((m) => [m.model, m.color]))

  let cum = 0
  let hasAnyCost = false
  let maxTotalCalls = 0
  let windowCalls = 0
  let windowCost: number | null = null
  const days = daily.map((d) => {
    const segs = d.models
      .filter((m) => m.calls > 0)
      .map((m) => ({
        model: m.model,
        color: colorOf.get(m.model) ?? MODEL_PALETTE[0],
        calls: m.calls,
        costRmb: m.costRmb,
      }))
      .sort((a, b) => (order.get(a.model) ?? 0) - (order.get(b.model) ?? 0))
    // 未带价的日子累计不增长：已知花费没有增加，但也不补 0 进曲线
    if (d.costRmb !== null) {
      cum += d.costRmb
      hasAnyCost = true
      windowCost = (windowCost ?? 0) + d.costRmb
    }
    windowCalls += d.calls
    maxTotalCalls = Math.max(maxTotalCalls, d.calls)
    return {
      day: d.day,
      label: d.day.slice(5), // MM-DD
      segments: segs,
      totalCalls: d.calls,
      costRmb: d.costRmb,
      cumCostRmb: hasAnyCost ? Number(cum.toFixed(6)) : null,
    }
  })

  return {
    models,
    days,
    maxTotalCalls,
    maxCumCostRmb: cum,
    hasAnyCost,
    windowCalls,
    windowCostRmb: windowCost === null ? null : Number(windowCost.toFixed(6)),
  }
}

function fmtCost(v: number | null): string {
  return v === null ? '无价' : `¥${v.toFixed(v >= 100 ? 0 : 2)}`
}

export function LlmDailyCostChart({
  daily,
  truncated,
}: {
  daily?: HubAiDailyTrendPoint[]
  truncated?: boolean
}) {
  const chart = useMemo(() => buildDailyChartModel(daily ?? []), [daily])

  // viewBox 自适应：容器再窄也保持比例，移动端随宽度缩放
  const W = 760
  const H = 260
  const padL = 46
  const padR = chart.hasAnyCost ? 60 : 16
  const padT = 14
  const padB = 30
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const n = chart.days.length
  const band = n > 0 ? plotW / n : plotW
  const barW = Math.min(30, Math.max(8, band * 0.62))
  const yCalls = (calls: number) =>
    padT + plotH - (chart.maxTotalCalls > 0 ? (calls / chart.maxTotalCalls) * plotH : 0)
  const yCost = (c: number) =>
    padT + plotH - (chart.maxCumCostRmb > 0 ? (c / chart.maxCumCostRmb) * plotH : 0)

  const costPoints = chart.hasAnyCost
    ? chart.days
        .filter((d) => d.cumCostRmb !== null)
        .map((d, i, arr) => ({
          x: padL + band * (chart.days.indexOf(d) + 0.5),
          y: yCost(d.cumCostRmb as number),
          cum: d.cumCostRmb as number,
          isLast: i === arr.length - 1,
        }))
    : []

  // 天数多时横轴抽稀标注（≤10 标全，否则约 10 个）
  const labelStep = Math.max(1, Math.ceil(n / 10))

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            每日调用量与累计花费（按模型堆叠）
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            柱高=当日调用次数（按实际应答模型分层）；线=累计已知花费（快照口径）。
            无价调用不折算成 ¥0——成本线只走带价样本。
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>窗口合计 {chart.windowCalls.toLocaleString()} 次</span>
          <span className="text-muted-foreground/60">·</span>
          <span>
            累计已知花费{' '}
            <span className="font-medium" style={{ color: COST_LINE_COLOR }}>
              {fmtCost(chart.windowCostRmb)}
            </span>
          </span>
        </div>
      </div>

      {truncated && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          ⚠ 调用明细超出读取上限，已从最旧一端截断：日柱与分位数只反映最近一批样本，
          与上方窗口合计对不上是截断所致，不是数据丢失。
        </p>
      )}

      {n === 0 ? (
        // 空态如实说：绝不生成合成曲线冒充数据
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
          <p className="text-xs text-muted-foreground">窗口内暂无调用记录，产生真实调用后按日呈现。</p>
        </div>
      ) : (
        <>
          {/* 分模型图例：颜色 + 总量直接标注，细节不靠 hover */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            {chart.models.map((m) => (
              <span key={m.model} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: m.color }} />
                <code className="text-[11px] bg-muted/60 px-1.5 py-0.5 rounded">{m.model}</code>
                <span className="text-muted-foreground">
                  {m.totalCalls.toLocaleString()} 次 · {fmtCost(m.totalCostRmb)}
                </span>
              </span>
            ))}
            {chart.hasAnyCost && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4 rounded-full"
                  style={{ backgroundColor: COST_LINE_COLOR }}
                />
                <span className="text-muted-foreground">累计花费（右轴）</span>
              </span>
            )}
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto"
            role="img"
            aria-label={`每日调用量堆叠柱与累计花费线，共 ${n} 天，窗口合计 ${chart.windowCalls} 次`}
          >
            {/* 横向网格 + 左轴（调用数）刻度 */}
            {[0, 0.5, 1].map((f) => {
              const y = padT + plotH - f * plotH
              return (
                <g key={f}>
                  <line
                    x1={padL}
                    x2={padL + plotW}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-border"
                    strokeWidth={1}
                  />
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} className="fill-muted-foreground">
                    {Math.round(chart.maxTotalCalls * f)}
                  </text>
                </g>
              )
            })}
            {/* 右轴（累计花费）：只有存在带价数据才绘制 */}
            {chart.hasAnyCost && (
              <>
                <line
                  x1={padL + plotW}
                  x2={padL + plotW}
                  y1={padT}
                  y2={padT + plotH}
                  stroke={COST_LINE_COLOR}
                  strokeWidth={1}
                  strokeOpacity={0.35}
                />
                <text
                  x={padL + plotW + 6}
                  y={padT + 4}
                  fontSize={10}
                  fill={COST_LINE_COLOR}
                  fillOpacity={0.8}
                >
                  ¥{chart.maxCumCostRmb.toFixed(chart.maxCumCostRmb >= 100 ? 0 : 1)}
                </text>
                <text
                  x={padL + plotW + 6}
                  y={padT + plotH}
                  fontSize={10}
                  fill={COST_LINE_COLOR}
                  fillOpacity={0.8}
                >
                  ¥0
                </text>
              </>
            )}

            {/* 日堆叠柱 */}
            {chart.days.map((d, i) => {
              const cx = padL + band * (i + 0.5)
              let acc = 0
              return (
                <g key={d.day}>
                  <title>
                    {d.day}：{d.totalCalls} 次（
                    {d.segments.map((s) => `${s.model}×${s.calls}`).join('、')}）
                    {d.costRmb !== null ? ` · 当日已知花费 ¥${d.costRmb.toFixed(4)}` : ' · 当日无价样本'}
                    {d.cumCostRmb !== null ? ` · 累计 ¥${d.cumCostRmb.toFixed(4)}` : ''}
                  </title>
                  {d.segments.map((s) => {
                    const h = chart.maxTotalCalls > 0 ? (s.calls / chart.maxTotalCalls) * plotH : 0
                    // 极小段给 2px 保底可见高度（视觉保真，数值仍以标注为准）
                    const hh = Math.max(h, 2)
                    acc += hh
                    return (
                      <rect
                        key={s.model}
                        x={cx - barW / 2}
                        y={padT + plotH - acc}
                        width={barW}
                        height={hh}
                        fill={s.color}
                        rx={1.5}
                      />
                    )
                  })}
                  {/* 日期标签（抽稀） */}
                  {i % labelStep === 0 && (
                    <text
                      x={cx}
                      y={padT + plotH + 16}
                      textAnchor="middle"
                      fontSize={10}
                      className="fill-muted-foreground"
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* 累计花费线：折线 + 末点圆点 + 末端直接标注 */}
            {costPoints.length > 1 && (
              <polyline
                points={costPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={COST_LINE_COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            )}
            {costPoints.map((p) => (
              <circle key={`${p.x}`} cx={p.x} cy={p.y} r={p.isLast ? 4 : 2.5} fill={COST_LINE_COLOR}>
                <title>{`累计已知花费 ¥${p.cum.toFixed(4)}`}</title>
              </circle>
            ))}
            {costPoints.length > 0 && (
              <text
                x={costPoints[costPoints.length - 1].x}
                y={Math.max(padT + 10, costPoints[costPoints.length - 1].y - 8)}
                textAnchor="end"
                fontSize={11}
                fontWeight={600}
                fill={COST_LINE_COLOR}
              >
                ¥{costPoints[costPoints.length - 1].cum.toFixed(costPoints[costPoints.length - 1].cum >= 100 ? 0 : 2)}
              </text>
            )}
          </svg>
        </>
      )}
    </div>
  )
}
