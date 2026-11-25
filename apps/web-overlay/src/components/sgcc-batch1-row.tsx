'use client'

import { useEffect, useState } from 'react'
import { sgccBatch1Copy } from '@/lib/exam-calendar'

/**
 * N1：/exam 国考卡片内国家电网 2027 第一批接力行（客户端岛）。
 *
 * 模式照抄 GuokaoAdmissionReminderIsland：挂载前渲染 null（倒计时/提醒
 * 依赖客户端时间，SSR 直出会在午夜边界与水合结果差一天）；挂载后按当前
 * 时刻算相位，窗口内渲染文案行，窗口外渲染 nothing。11-26 0:00 的
 * 草稿 A→B 切换是时刻级边界，服务端页 revalidate 1 小时、直出最多迟
 * 1 小时，故走客户端岛（60 秒 tick、最长迟 1 分钟切换）。
 *
 * 链接门禁：zhaopin.sgcc.com.cn 抓取端 HTTP 412，真人浏览器可达性未核实，
 * 行内只留文字、不挂链（见 exam-calendar.ts 内 sgccBatch1Copy 注释）。
 */
export function SgccBatch1Row() {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) return null
  const copy = sgccBatch1Copy(now)
  if (!copy) return null
  return <p className="mt-3 text-sm leading-relaxed text-foreground">{copy.line}</p>
}
