'use client'

import { useState } from 'react'
import { safeHref } from '@/lib/safe-url'
import {
  verificationBadgeProps,
  type ExamNodeVerificationInput,
} from '@/lib/exam-verification'

/**
 * 核验级别徽标（01-verification-workflow §7.1 / §9.1 / §9.4）。
 *
 * 三态均为真实文本，不得只用颜色区分：
 *  - official：实底「官方原文已核实 · {日期}」
 *  - reprint：描边「转载级 · 未直读官方原文」（与 official 同等醒目，不得弱化）
 *  - unverified：灰态「待核实」
 * 点击展开核查信息：来源 URL（外链）+ 存档 URL（Wayback 外链）+ 核查时间 + 置信度。
 */
const TONE_CLASS: Record<string, string> = {
  solid:
    'border-sky-700 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-600',
  outline:
    'border-amber-700 bg-amber-500/10 text-amber-800 dark:border-amber-500 dark:bg-amber-500/10 dark:text-amber-300',
  muted: 'border-border bg-muted text-muted-foreground',
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

export function ExamVerificationBadge({
  node,
}: {
  node: ExamNodeVerificationInput
}) {
  const [open, setOpen] = useState(false)
  const props = verificationBadgeProps(node)
  const hasSource = node.source_url !== undefined && node.source_url !== ''
  const hasArchive = node.archived_url !== undefined && node.archived_url !== ''
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${props.text}，点击查看核查信息`}
        title="点击查看核查信息"
        className={`inline-flex min-h-6 shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[props.tone]}`}
      >
        {props.text}
      </button>
      {open ? (
        <span className="max-w-full text-xs leading-relaxed text-muted-foreground">
          {hasSource ? (
            <a
              href={safeHref(node.source_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sky-700 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400"
            >
              来源
            </a>
          ) : (
            <span>来源：暂无（未核实）</span>
          )}
          {hasArchive ? (
            <>
              {' · '}
              <a
                href={safeHref(node.archived_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sky-700 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400"
              >
                存档
              </a>
            </>
          ) : null}
          {' · '}
          <span>核查时间：{props.checkedLabel ?? '—'}</span>
          {' · '}
          <span>置信度：{CONFIDENCE_LABEL[node.confidence] ?? node.confidence}</span>
        </span>
      ) : null}
    </span>
  )
}
