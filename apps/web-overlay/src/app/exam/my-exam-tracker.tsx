'use client'

import { useEffect, useState } from 'react'
import {
  EXAM_NODE_STATUS_LABEL,
  examNodeStatus,
  type ExamInfo,
} from '@/lib/exam-calendar'
import {
  MY_EXAMS_STORAGE_KEY,
  checkedCount,
  isFollowed,
  parseMyExams,
  toggleFollow,
  toggleNodeCheck,
  type MyExamsState,
} from '@/lib/my-exams'

const NODE_DOT_CLASS: Record<string, string> = {
  done: 'bg-muted-foreground/40',
  today: 'bg-emerald-500',
  active: 'bg-emerald-500',
  upcoming: 'bg-sky-500/60',
  estimated: 'bg-amber-500/70',
}

/**
 * 「我的考试」关注 + 考前清单客户端岛（/exam 每场卡片内）。
 *
 * 模式照抄 ExamCountdown：挂载前渲染与服务端一致的未关注视图（只读
 * 时间轴 + 「关注」按钮），挂载后才读 localStorage——关注与勾选只存在
 * 本机，SSR 与水合结果不会打架；存储不可用（满了或被禁）时静默放弃，
 * 不阻塞用户看时间轴。
 */
export function MyExamTracker({ exam }: { exam: ExamInfo }) {
  const [state, setState] = useState<MyExamsState | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MY_EXAMS_STORAGE_KEY)
      setState(parseMyExams(raw === null ? null : JSON.parse(raw)))
    } catch {
      setState({ followed: [], checked: {} })
    }
  }, [])

  const followed = state !== null && isFollowed(state, exam.id)
  const done = state === null ? 0 : checkedCount(state, exam)
  const checkedLabels = state === null ? [] : (state.checked[exam.id] ?? [])

  function persist(next: MyExamsState) {
    setState(next)
    try {
      localStorage.setItem(MY_EXAMS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 存储满或被禁就静默放弃，不阻塞使用
    }
  }

  function handleFollow() {
    if (state === null) return
    persist(toggleFollow(state, exam.id))
  }

  function handleCheck(nodeLabel: string) {
    if (state === null) return
    persist(toggleNodeCheck(state, exam.id, nodeLabel))
  }

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {followed
            ? `我的考试 · 已完成 ${done} / ${exam.nodes.length}`
            : '关注后可逐项勾选考前清单'}
        </p>
        <button
          type="button"
          onClick={handleFollow}
          aria-pressed={followed}
          aria-label={followed ? `取消关注${exam.shortName}` : `关注${exam.shortName}`}
          className="inline-flex min-h-11 items-center rounded-full border border-sky-500/25 bg-sky-500/5 px-3 py-1 text-sm font-medium text-sky-700 dark:text-sky-400"
        >
          {followed ? '已关注' : '关注这场考试'}
        </button>
      </div>
      <ol className="mt-3 space-y-2.5">
        {exam.nodes.map((node) => {
          const status = examNodeStatus(node)
          const checked = followed && checkedLabels.includes(node.label)
          return (
            <li key={node.label} className="flex items-start gap-2.5 text-sm">
              {followed ? (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleCheck(node.label)}
                  aria-label={`${node.label}已完成`}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
              ) : (
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${NODE_DOT_CLASS[status]}`}
                />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={`font-medium ${checked ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                >
                  {node.label}
                </span>
                <span className="text-muted-foreground"> · {node.detail}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {EXAM_NODE_STATUS_LABEL[status]}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
