'use client'

/**
 * 全网热榜卡片副行客户端小岛（/brief SourceColumn 副行）。
 *
 * 首帧沿用 SSR 下发的文案（ssrText），挂载后每 60 秒按 prop 传入的
 * fetchedAt 重算一次，不发任何请求（数据每小时才变，轮询无收益）。
 * 禁止首帧重算：服务端 now 与客户端 now 在分钟边界可能差 1 分钟，
 * 首帧重算会造成 hydration 文案闪变。
 */
import { useEffect, useState } from 'react'
import { formatHotlistSubline, type HotlistSourceStatus } from '@/lib/relative-time'

export default function HotlistFreshness({
  status,
  fetchedAt,
  clock,
  ssrText,
}: {
  status: HotlistSourceStatus
  fetchedAt: number | null
  clock: string | null
  ssrText: string
}) {
  const [text, setText] = useState(ssrText)
  useEffect(() => {
    const id = setInterval(() => {
      setText(formatHotlistSubline(status, fetchedAt, Date.now()))
    }, 60_000)
    return () => clearInterval(id)
  }, [status, fetchedAt])
  return (
    <p
      className="mb-2 text-[11px] text-muted-foreground"
      title={clock ? `更新于 ${clock}` : undefined}
    >
      {text}
    </p>
  )
}
