'use client'

import { useState, type FormEvent } from 'react'
import { EXAMS } from '@/lib/exam-calendar'
import { submitExamCorrectionReport } from './exam-correction-actions'

/**
 * 读者报错入口（§9.3）：/exam 页底部常驻“发现错误？点此报错”。
 * 字段：报错节点（下拉，43 个节点）+ 错误描述（必填）+ 错误类型（必填）+
 * 你的来源链接（选填）+ 联系方式（选填）。
 * 提交后写 exam_corrections 草稿行（how_discovered='reader_tip'）；未确认的报错
 * 不直接改节点字段。store 未合流时草稿暂存本机 localStorage（键
 * exam-correction-drafts），不丢报告、不谎称已提交。
 */
const ERROR_TYPE_LABEL: Record<string, string> = {
  factual: '事实错误',
  date: '日期/时刻错误',
  url: '链接错误',
  attribution: '来源标注错误',
  context: '表述/语境错误',
}

const DRAFT_KEY = 'exam-correction-drafts'

export function ExamCorrectionReport() {
  const [status, setStatus] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setStatus(null)
    const formData = new FormData(event.currentTarget)
    const res = await submitExamCorrectionReport(formData)
    if (res.ok) {
      setStatus(res.message)
      event.currentTarget.reset()
    } else if (res.reason === 'store_not_merged') {
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        const drafts: Array<Record<string, string>> = raw ? JSON.parse(raw) : []
        drafts.push({
          examId: String(formData.get('nodeKey') ?? '').split('::')[0] ?? '',
          nodeLabel: String(formData.get('nodeKey') ?? '').split('::')[1] ?? '',
          description: String(formData.get('description') ?? ''),
          errorType: String(formData.get('errorType') ?? ''),
          sourceUrl: String(formData.get('sourceUrl') ?? ''),
          contact: String(formData.get('contact') ?? ''),
          createdAt: new Date().toISOString(),
        })
        localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts))
      } catch {
        // 存储不可用时不阻塞用户看页面，只报 store 未合流。
      }
      setStatus(`${res.message}你的报错已暂存到本机草稿，合流后可重新提交。`)
    } else {
      setStatus(res.message)
    }
    setPending(false)
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-2xl border border-border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-foreground">报错节点 *</span>
          <select
            name="nodeKey"
            required
            defaultValue=""
            className="mt-1 block w-full min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="" disabled>
              选择节点
            </option>
            {EXAMS.map((exam) =>
              exam.nodes.map((node) => (
                <option key={`${exam.id}:${node.label}`} value={`${exam.id}::${node.label}`}>
                  {exam.shortName} · {node.label}
                </option>
              )),
            )}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-foreground">错误类型 *</span>
          <select
            name="errorType"
            required
            defaultValue=""
            className="mt-1 block w-full min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="" disabled>
              选择类型
            </option>
            {Object.entries(ERROR_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        提交后先以“读者指正”建草稿，核查确认后才公开更正；未确认的报错不会直接改节点内容。
      </p>
      <label className="block text-sm">
        <span className="font-medium text-foreground">错误描述 *</span>
        <textarea
          name="description"
          required
          rows={3}
          placeholder="哪里错了、正确应该是什么"
          className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-foreground">你的来源链接（选填）</span>
          <input
            name="sourceUrl"
            type="url"
            inputMode="url"
            placeholder="https://…"
            className="mt-1 block w-full min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-foreground">联系方式（选填）</span>
          <input
            name="contact"
            type="text"
            autoComplete="off"
            placeholder="邮箱或微信（仅用于核实反馈）"
            className="mt-1 block w-full min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-full border border-sky-500/25 bg-sky-500/5 px-4 text-sm font-medium text-sky-700 dark:text-sky-400 disabled:opacity-50"
      >
        {pending ? '提交中…' : '提交报错'}
      </button>
      {status ? (
        <p role="status" className="text-sm leading-relaxed text-muted-foreground">
          {status}
        </p>
      ) : null}
    </form>
  )
}
