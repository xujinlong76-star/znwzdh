'use client'

import Link from 'next/link'
import { Bot, PlusCircle } from 'lucide-react'
import { openCopilot } from '@/lib/ai-entry'
import { submitPrefillHref } from '@/lib/submit-prefill'

/**
 * /search 零结果区的两个真出口（A11）。
 *
 * search-results.tsx 是刻意保持的纯服务端组件（URL 即状态、无 JS 也能搜），
 * 所以 AI 唤起必须收敛在这个小客户端岛里，页面其余部分不动：
 *
 * - 「让 AI 帮我找」：唤起全局 Copilot 抽屉并把查询词自动发过去
 *   （抽屉在 providers → GlobalAiGateway 全局挂载，任何页都能唤起）；
 * - 「投稿收录这个站」：跳 /submit，查询词按 submit-prefill 规则预填
 *   （网址形进网址栏，其余进网站名称栏）。
 *
 * 查询词为空时什么都不渲染（EmptyResults 也会在 tag-only / 翻页空页时被
 * 调用，那时没有可带走的词，不硬凑出口）。
 */
export function ZeroResultActions({ query }: { query: string }) {
  const q = query.trim()
  if (!q) return null
  return (
    <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
      <button
        type="button"
        onClick={() => openCopilot({ query: q, source: 'programmatic' })}
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-2xs transition-colors hover:bg-primary/90"
      >
        <Bot className="h-3.5 w-3.5" />
        让 AI 帮我找「{q.length > 24 ? `${q.slice(0, 24)}…` : q}」
      </button>
      <Link
        href={submitPrefillHref(q)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <PlusCircle className="h-3.5 w-3.5 text-primary" />
        投稿收录这个站
      </Link>
    </div>
  )
}
