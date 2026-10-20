'use client'

/**
 * 网址包「最近一次可达性体检」徽标（P0-1 收尾）。
 *
 * 只读历史、不触发探测：详情页每次打开都跑一遍 30 条外部 URL 既慢又对目标站失礼。
 * 没有体检记录时不渲染任何东西（而不是显示「0%」或「未体检」占位），
 * 避免把一个尚未验证的包暗示成「有问题」。
 *
 * 口径与后端一致：401/403/405/412/418/429 属于「存活但拒绝爬虫」，
 * 已计入可达率 —— 徽标文案用「可达」而不是「健康」，避免过度承诺。
 */

import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { hubGet } from '@/lib/navhub-api'
import { reachabilityTone, relativeTime } from '@/lib/plugins/url-audit-badge'

interface AuditSnapshot {
  checked: boolean
  auditedAt?: number
  declared?: number | null
  sampled?: number | null
  okCount?: number | null
  blockedCount?: number | null
  brokenCount?: number | null
  reachability?: number | null
  caveat?: string
}

export function PluginUrlAuditBadge({ slug, className }: { slug: string; className?: string }) {
  const [snapshot, setSnapshot] = useState<AuditSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    void hubGet<AuditSnapshot>(`/plugins/${encodeURIComponent(slug)}/url-health`)
      .then((res) => {
        if (!cancelled) setSnapshot(res)
      })
      .catch(() => {
        // 徽标是增强信息：接口失败就不显示，不影响详情页任何主流程
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (!snapshot?.checked) return null

  const tone = reachabilityTone(snapshot.reachability)
  const sampled = snapshot.sampled ?? 0
  const declared = snapshot.declared ?? 0
  const broken = snapshot.brokenCount ?? 0
  const blocked = snapshot.blockedCount ?? 0
  const when = snapshot.auditedAt ? relativeTime(snapshot.auditedAt) : ''

  const tooltip =
    `最近一次抽样体检：${sampled}/${declared} 条，本机测得可达率 ${tone.label}` +
    (blocked > 0 ? `；其中 ${blocked} 条拒绝爬虫但站点存活（已计入可达）` : '') +
    (broken > 0 ? `；${broken} 条本机不可达（可能是地域/网络限制，需人工复核）` : '') +
    (when ? `（${when}）` : '')

  return (
    <Badge
      variant="outline"
      className={`text-[10px] font-normal inline-flex items-center gap-1 ${tone.className} ${className ?? ''}`}
      title={tooltip}
    >
      <Gauge className="h-3 w-3" aria-hidden />
      <span>{tone.label}</span>
      {when && <span className="text-muted-foreground/80">· {when}</span>}
    </Badge>
  )
}
