'use client'

/**
 * P12 对比卡 PoC：结构化事实对照表（展示层）。
 *
 * 只列 6 个结构化事实字段（见 lib/decision-compare.ts 的 DECISION_COMPARE_FIELDS），
 * 字段缺失时整格显示“未验证”；不输出胜者、不输出总分、不输出百分比排名、
 * 不做站间排序（站列顺序 = 对比篮加入顺序）。
 *
 * 控件：
 *   - “只看不同”默认开启（PoC 口径）；
 *   - 用户勾 1–3 个在意点，被勾字段的行高亮——权重由用户当场选，不预设，
 *     高亮只影响视觉强调，不改变行顺序、不参与任何总分。
 * 站点标题只链条目原 url，不拼任何追踪/佣金参数。
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatVerifiedDate } from '@/lib/compare'
import {
  buildDecisionCompareRows,
  decisionRowDiffers,
  DECISION_COMPARE_FIELDS,
  formatDecisionCellValue,
  toggleDecisionPriority,
  visibleDecisionRows,
  type DecisionCompareEntry,
  type DecisionCompareFieldKey,
} from '@/lib/decision-compare'

export function DecisionCompareCard({
  entries,
  onRemove,
}: {
  entries: readonly DecisionCompareEntry[]
  onRemove?: (siteId: string) => void
}) {
  // P12 口径：“只看不同”默认开启。
  const [onlyDifferent, setOnlyDifferent] = useState(true)
  const [priorities, setPriorities] = useState<DecisionCompareFieldKey[]>([])
  const [priorityNote, setPriorityNote] = useState<string | null>(null)

  const rows = useMemo(() => buildDecisionCompareRows(entries), [entries])
  const shownRows = useMemo(() => visibleDecisionRows(rows, onlyDifferent), [rows, onlyDifferent])
  const differingKeys = useMemo(
    () => new Set(rows.filter(decisionRowDiffers).map((r) => r.key)),
    [rows],
  )

  const handleTogglePriority = (key: DecisionCompareFieldKey) => {
    const result = toggleDecisionPriority(priorities, key)
    setPriorities(result.selected)
    setPriorityNote(result.blocked ? result.message : null)
  }

  if (entries.length < 2) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-5 space-y-2">
        <p className="text-sm font-semibold text-foreground">对比篮里还不够 2 个站</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          再去站详情页把同类站点加入对比篮（2–3 个），这里就会并排对照它们的
          结构化事实字段：是否免费 / 免费档、是否需注册、有无广告、活链状态、
          最后核验时间、适用场景标签。
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <Link href="/compare?basket=1" className="text-primary underline underline-offset-2">
            查看对比篮
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
          <input
            type="checkbox"
            checked={onlyDifferent}
            onChange={(e) => setOnlyDifferent(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          只看不同
        </label>
        <span className="text-muted-foreground">在意点（最多勾 3 个，勾中的行会高亮）：</span>
        {DECISION_COMPARE_FIELDS.map(({ key, label }) => (
          <label key={key} className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
            <input
              type="checkbox"
              checked={priorities.includes(key)}
              onChange={() => handleTogglePriority(key)}
              className="h-3.5 w-3.5 accent-primary"
              aria-label={`在意点：${label}`}
            />
            {label}
          </label>
        ))}
        <span className="font-semibold text-primary">
          已选 {priorities.length}/3
        </span>
        {priorityNote && (
          <span role="alert" className="text-destructive-text">
            {priorityNote}
          </span>
        )}
      </div>

      {shownRows.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            这 {entries.length} 个站在已核实的字段上没有不同。取消“只看不同”可以看到全部字段。
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70">
                <th scope="col" className="w-36 px-3 py-2.5 text-left font-semibold text-foreground">
                  字段
                </th>
                {entries.map((entry) => (
                  <th key={entry.siteId} scope="col" className="px-3 py-2.5 text-left font-semibold">
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {entry.title}
                    </a>
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(entry.siteId)}
                        className="ml-2 cursor-pointer rounded px-1.5 py-0.5 text-xs font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`从对比篮移出${entry.title}`}
                      >
                        移出
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row) => {
                const highlighted = priorities.includes(row.key)
                return (
                  <tr
                    key={row.key}
                    className={
                      highlighted
                        ? 'border-b border-border/50 bg-primary/5'
                        : 'border-b border-border/50 last:border-b-0'
                    }
                  >
                    <th scope="row" className="px-3 py-2.5 text-left font-medium text-foreground">
                      {row.label}
                      {differingKeys.has(row.key) && (
                        <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-normal text-amber-700 dark:text-amber-400">
                          有差异
                        </span>
                      )}
                    </th>
                    {row.cells.map((cell, index) => {
                      const verifiedDate = formatVerifiedDate(cell.verifiedAt)
                      return (
                        <td
                          key={entries[index]?.siteId ?? index}
                          className="px-3 py-2.5 align-top text-foreground"
                        >
                          <span className={cell.text == null ? 'text-muted-foreground' : ''}>
                            {formatDecisionCellValue(cell)}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {cell.verified
                              ? `来源：${cell.source}${verifiedDate ? ` · ${verifiedDate}` : ''}`
                              : `未验证（来源：${cell.source}）`}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        本表只列可核验的结构化事实，不排名、不打分、不设胜者；缺失字段标为“未验证”，
        不凭推断填值。“是否需注册 / 有无广告”本站暂无核实字段，全部标“未验证”。
      </p>
    </div>
  )
}
