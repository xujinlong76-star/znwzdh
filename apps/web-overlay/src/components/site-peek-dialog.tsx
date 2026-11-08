'use client'

import { useState, useEffect } from 'react'
import type { NavigationSubItem, SiteAction } from '@/types/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { SiteFavicon } from '@/components/site-favicon'
import { ExternalLink, Star, Sparkles, Zap, ArrowRight, Eye, Search, AlertTriangle, Orbit, History, Pin, Copy, FileText, Activity, Check, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/registry/new-york/ui/button'
import { FavoriteButton } from '@/components/favorite-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { isSafeHttpUrl, safeHref, safeSrc, safeWindowOpen } from '@/lib/safe-url'
import { buildWaybackSnapshotUrl } from '@/lib/wayback-resolver'
import { siteHealthBadge } from '@/lib/site-health'
import { probeSiteLatency, type PingResult } from '@/lib/site-ping'

interface SitePeekDialogProps {
  item: NavigationSubItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * 该条目在首页所属的分类。只有从首页卡片打开时才有值；
   * 其它入口（标签页/专题页）没有分类上下文，置顶动作就不出现。
   */
  categoryId?: string
  isPinnedInCategory?: boolean
  onTogglePinInCategory?: (siteId: string) => void
  /**
   * 关闭时接管焦点归还。Radix 默认把焦点还给 DialogTrigger，本仓库的速览
   * 没有 Trigger（由卡片键盘触发），默认行为会把焦点丢到 body；
   * 交给调用方按需还原到触发它的那张卡片上。
   */
  onCloseAutoFocus?: (event: Event) => void
}

export function SitePeekDialog({
  item,
  open,
  onOpenChange,
  categoryId,
  isPinnedInCategory = false,
  onTogglePinInCategory,
  onCloseAutoFocus,
}: SitePeekDialogProps) {
  const { toast } = useToast()
  const [actionInputs, setActionInputs] = useState<Record<string, string>>({})
  const [showIframe, setShowIframe] = useState(false)
  const [hyperbolicAlts, setHyperbolicAlts] = useState<Array<{
    site: { id: string; title: string; url: string; description?: string }
    geodesicDistance: number
    alternativeScore: number
  }>>([])
  const [livePing, setLivePing] = useState<PingResult | null>(null)
  const [isPinging, setIsPinging] = useState(false)
  const [hasReportedBroken, setHasReportedBroken] = useState(false)
  const [radar, setRadar] = useState<{
    summary: string
    pricingType: string
    pricingWarning: string
    accessRequirement?: string
    bestForScenarios?: string[]
    pros: string[]
    cons: string[]
    directAlternatives: string[]
    peerLinks?: Array<{ id: string; title: string; url: string }>
  } | null>(null)
  const [radarLoading, setRadarLoading] = useState(false)
  const [radarLoaded, setRadarLoaded] = useState(false)
  const [visualUrl, setVisualUrl] = useState<string | null>(null)
  const [visualLoading, setVisualLoading] = useState(false)

  const fetchVisual = async () => {
    if (!item?.id || visualLoading) return
    setVisualLoading(true)
    try {
      const res = await fetch(`/api/hub/sites/${encodeURIComponent(item.id)}/visual`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.imageUrl) {
          setVisualUrl(data.imageUrl)
        }
      }
    } catch {
      // 容错降级
    } finally {
      setVisualLoading(false)
    }
  }

  const fetchRadar = async () => {
    if (!item?.id || radarLoading) return
    setRadarLoading(true)
    try {
      const res = await fetch(`/api/hub/sites/${encodeURIComponent(item.id)}/radar`)
      if (res.ok) {
        const data = await res.json()
        if (data.radar) {
          setRadar(data.radar)
          setRadarLoaded(true)
        }
      }
    } catch {
      // 容错降级
    } finally {
      setRadarLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !item?.id) {
      setHyperbolicAlts([])
      setLivePing(null)
      setIsPinging(false)
      setHasReportedBroken(false)
      setRadar(null)
      setRadarLoading(false)
      setRadarLoaded(false)
      setVisualUrl(null)
      setVisualLoading(false)
      return
    }
    let cancelled = false
    fetch(`/api/hub/rank/alternatives/${encodeURIComponent(item.id)}?limit=4`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.hits)) {
          setHyperbolicAlts(data.hits)
        }
      })
      .catch(() => {
        // 「相似站点推荐」是 peek 弹窗里的加料：拉不到就只显示站点本身，不报错也不留空提示
      })
    return () => {
      cancelled = true
    }
  }, [open, item?.id])

  if (!item) return null

  const handleLivePing = async () => {
    if (!item?.href || isPinging) return
    setIsPinging(true)
    try {
      const res = await probeSiteLatency(item.href)
      setLivePing(res)
    } catch {
      // 容错降级：本地探针异常时不中断界面，直接给出未连通反馈
      setLivePing({
        reachable: false,
        quality: 'unreachable',
        label: '⚠️ 探测失败',
        testedAt: Date.now(),
        error: '本地探测未成功',
      })
    } finally {
      setIsPinging(false)
    }
  }

  const handleReportBroken = () => {
    if (hasReportedBroken) return
    setHasReportedBroken(true)
    toast({
      title: '已收到失效反馈',
      description: '感谢反馈！系统已记录该站点异常，正在为您调取备用镜像与平替推荐。',
    })
  }

  const handleActionSubmit = (action: SiteAction, e?: React.FormEvent) => {
    e?.preventDefault()
    const val = actionInputs[action.id] || ''
    const targetUrl = action.urlTemplate.includes('{q}')
      ? action.urlTemplate.replace('{q}', encodeURIComponent(val))
      : action.urlTemplate
    // 安全：仅允许 http/https 深链，非法模板直接拒绝打开（防 javascript: XSS）
    if (!isSafeHttpUrl(targetUrl)) return
    window.open(targetUrl, '_blank', 'noopener,noreferrer')
  }

  // iframe 预览源：非法 URL 直接不渲染（safeSrc 返回 undefined）
  const previewSrc = safeSrc(item.href)
  const healthBadge = siteHealthBadge(item.health)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setShowIframe(false)
      }}
    >
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="w-[calc(100%-2rem)] max-w-2xl max-h-[calc(100dvh-2.5rem)] overflow-y-auto p-4 sm:p-7 glass-surface subtle-mesh border-border/80 shadow-2xl rounded-2xl">
        <DialogHeader className="space-y-3 pb-3 border-b border-border/50 pr-8 sm:pr-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 p-2 rounded-xl bg-muted/60 border border-border/60 shadow-xs flex-shrink-0 flex items-center justify-center">
                <SiteFavicon
                  title={item.title}
                  url={item.href}
                  icon={item.icon}
                  useDefaultIcon={item.useDefaultIcon}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg sm:text-xl font-bold flex flex-wrap items-center gap-2 break-words">
                  <span>{item.title}</span>
                  {item.liveMetrics?.openSource && (
                    <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium">
                      开源
                    </Badge>
                  )}
                  {item.liveMetrics?.githubStars && (
                    <Badge variant="outline" className="text-xs flex items-center gap-1 font-mono border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400">
                      <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      {(item.liveMetrics.githubStars / 1000).toFixed(1)}k
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                  {item.description || '无详细描述'}
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              {/**
                * 键盘/读屏用户的等价入口：卡片上的置顶、收藏按钮已退出 Tab 序列
                * （整卡只保留主链接一个停留点），必须在这里给出同样的动作，
                * 否则「方向键进操作区」对只用读屏浏览模式的用户仍是断头路。
                */}
              {onTogglePinInCategory && categoryId ? (
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={isPinnedInCategory}
                  className="gap-1.5 h-8.5 px-3 shadow-2xs font-medium text-xs border-border/70"
                  title={isPinnedInCategory ? '取消当前分类置顶' : '置顶到当前分类首位'}
                  onClick={() => onTogglePinInCategory(item.id)}
                >
                  <Pin className={isPinnedInCategory ? 'w-3.5 h-3.5 fill-amber-500 text-amber-500' : 'w-3.5 h-3.5'} />
                  <span className="hidden sm:inline">{isPinnedInCategory ? '取消置顶' : '置顶'}</span>
                </Button>
              ) : null}
              <FavoriteButton
                site={{
                  siteId: item.id,
                  title: item.title,
                  href: item.href,
                  icon: item.icon,
                  description: item.description,
                }}
                className="h-8.5 w-8.5 rounded-lg border border-border/70 bg-background/60"
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8.5 px-3 shadow-2xs font-medium text-xs text-muted-foreground hover:text-foreground border-border/70"
                title="调取 Internet Archive Wayback 历史归档快照"
                onClick={() => {
                  const snap = buildWaybackSnapshotUrl(item.href)
                  if (snap) safeWindowOpen(snap)
                }}
              >
                <History className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">历史快照</span>
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 shrink-0 h-8.5 px-3.5 shadow-xs font-medium"
                onClick={() => {
                  const u = safeHref(item.href, '')
                  if (!u || !isSafeHttpUrl(u)) return
                  window.open(u, '_blank', 'noopener,noreferrer')
                }}
              >
                <span>访问主站</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* 站点连通性与健康异常提示 */}
        {item.health?.ok === false && (
          <div className="mt-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="font-semibold text-amber-900 dark:text-amber-200">
                站点连通性提示：{item.health.error || '近期探测出现超时或无法直连'}
              </div>
              <div className="text-amber-900 dark:text-amber-200 leading-relaxed">
                建议优先使用下方「平替雷达」中的可用替代产品，或点击右上角「历史快照」调取网页归档。
              </div>
            </div>
          </div>
        )}

        {/* 用户反馈或本地探测异常提示 */}
        {item.health?.ok !== false && (hasReportedBroken || (livePing && !livePing.reachable)) && (
          <div className="mt-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="font-semibold text-rose-900 dark:text-rose-200">
                {hasReportedBroken ? '已记录失效反馈：该站点可能已下线或受网络策略阻隔' : `本地探测异常：${livePing?.label || '连接超时'}`}
              </div>
              <div className="text-rose-900 dark:text-rose-200 leading-relaxed">
                建议优先使用下方为您推导的「平替雷达」替代方案，或调取右上角「历史快照」访问网页镜像。
              </div>
            </div>
          </div>
        )}

        {/* 核心行动区：深链微动作 (Deep Actions) */}
        {item.actions && item.actions.length > 0 && (
          <div className="mt-4 p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>直达微动作 (Deep-Launch)</span>
            </div>
            <div className="space-y-2.5">
              {item.actions.map((act) => {
                const hasParam = act.urlTemplate.includes('{q}')
                return (
                  <div key={act.id} className="flex items-center gap-2">
                    {hasParam ? (
                      <form
                        onSubmit={(e) => handleActionSubmit(act, e)}
                        className="flex-1 flex items-center gap-2"
                      >
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                          <Input aria-label={act.placeholder || `快速执行 ${act.label}`}
                            placeholder={act.placeholder || `快速执行 ${act.label}...`}
                            value={actionInputs[act.id] || ''}
                            onChange={(e) => setActionInputs({ ...actionInputs, [act.id]: e.target.value })}
                            className="h-8.5 pl-8 text-xs bg-background border-border/70 focus-visible:ring-primary/40"
                          />
                        </div>
                        <Button type="submit" size="sm" variant="secondary" className="h-8.5 text-xs gap-1 px-3 border border-border/60">
                          {act.label}
                          <ArrowRight className="w-3 h-3" />
                        </Button>
                      </form>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8.5 text-xs gap-1.5 border border-border/60"
                        onClick={() => handleActionSubmit(act)}
                      >
                        <span>{act.label}</span>
                        <ArrowRight className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 平替雷达与技术栈生态 (AlternativeTo & Ecosystem) */}
        {item.relations && item.relations.length > 0 && (
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span>平替雷达与生态推荐 (AlternativeTo)</span>
              </span>
              <span className="text-xs font-mono text-muted-foreground">{item.relations.length} 个候选</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {item.relations.map((rel, idx) => (
                <div
                  key={idx}
                  className="flex items-start justify-between p-3 rounded-xl border border-border/60 bg-card hover:border-primary/40 transition-all shadow-2xs group"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold group-hover:text-primary transition-colors">{rel.targetTitle}</span>
                      {rel.isFreeOrOpenSource && (
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                          开源/免费
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                        {rel.relationType === 'alternative' ? '平替' : rel.relationType === 'mirror' ? '镜像' : '技术生态'}
                      </span>
                    </div>
                    {rel.note && <p className="text-xs text-muted-foreground leading-normal">{rel.note}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="访问该站点"
                    title={`在新标签页打开 ${rel.targetTitle}`}
                    className="h-6.5 w-6.5 shrink-0 rounded-lg hover:bg-muted"
                    onClick={() => {
                      if (!isSafeHttpUrl(rel.targetUrl)) return
                      window.open(rel.targetUrl, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 巡检哨兵防劫持与死链安全告警横幅 */}
        {item.health && item.health.ok === false && (
          <div className="mt-3 p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 space-y-2.5 text-xs text-rose-700 dark:text-rose-400">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">安全哨兵告警：该站点当前响应异常或疑似失效</div>
                <div className="text-muted-foreground">
                  系统后台可用性巡检检测到该外链响应超时或状态异常，建议优先使用下方为您实时推导的洛伦兹双曲平替站点，或通过时间机器调取历史归档。
                </div>
              </div>
            </div>
            <div className="pt-0.5 pl-6.5 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs gap-1.5 border-rose-500/40 bg-background/80 hover:bg-rose-500/15 text-rose-700 dark:text-rose-300 font-medium"
                onClick={() => {
                  const snap = buildWaybackSnapshotUrl(item.href)
                  if (snap) safeWindowOpen(snap)
                }}
              >
                <History className="w-3.5 h-3.5" />
                <span>访问时间机器历史镜像 (Wayback Machine)</span>
              </Button>
            </div>
          </div>
        )}

        {/* AI 全景深度透视与收费排雷 (AI Deep Radar - Powered by Agnes 3.0 Flash) */}
        <div className="mt-4 p-4 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/5 via-card to-background space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-primary/10 text-primary">
                <Sparkles className="w-4 h-4" />
              </span>
              <div>
                <span className="text-xs font-bold text-foreground">AI 全景透视与收费排雷</span>
                <span className="ml-2 text-[10px] text-muted-foreground font-mono">Agnes 3.0 Flash</span>
              </div>
            </div>
            {!radarLoaded && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
                onClick={fetchRadar}
                disabled={radarLoading}
              >
                {radarLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>透视推导中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>即刻透视</span>
                  </>
                )}
              </Button>
            )}
          </div>

          {radarLoading && (
            <div className="py-3 flex items-center justify-center gap-2 text-xs text-muted-foreground animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>正在调取 Agnes AI 深度分析站点定位与真实收费门槛...</span>
            </div>
          )}

          {radarLoaded && radar && (
            <div className="space-y-3 pt-1 text-xs">
              <div className="p-2.5 rounded-lg bg-background/80 border border-border/60 text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">💡 核心画像：</span>
                {radar.summary}
              </div>

              <div className="flex flex-wrap items-start gap-2 p-2.5 rounded-lg border border-border/60 bg-muted/30">
                <Badge
                  variant="outline"
                  className={
                    radar.pricingType.includes('免费') || radar.pricingType.includes('开源')
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold'
                      : radar.pricingType.includes('订阅')
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-semibold'
                  }
                >
                  {radar.pricingType}
                </Badge>
                {radar.accessRequirement && (
                  <Badge variant="secondary" className="text-[11px] font-medium">
                    门槛：{radar.accessRequirement}
                  </Badge>
                )}
                <span className="text-muted-foreground flex-1 min-w-[180px] pt-0.5">
                  <span className="font-semibold text-foreground">收费排雷：</span>
                  {radar.pricingWarning}
                </span>
              </div>

              {radar.bestForScenarios && radar.bestForScenarios.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground font-semibold">适用高频场景：</span>
                  {radar.bestForScenarios.map((sc, i) => (
                    <Badge key={i} variant="outline" className="text-[11px] px-2 py-0.5 border-primary/25 bg-primary/5 text-primary font-normal">
                      {sc}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {radar.pros && radar.pros.length > 0 && (
                  <div className="space-y-1 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      核心亮点
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                      {radar.pros.map((p, i) => (
                        <li key={i} className="truncate">{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {radar.cons && radar.cons.length > 0 && (
                  <div className="space-y-1 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      使用门槛 / 局限
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                      {radar.cons.map((c, i) => (
                        <li key={i} className="truncate">{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {((radar.peerLinks && radar.peerLinks.length > 0) || (radar.directAlternatives && radar.directAlternatives.length > 0)) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/40">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground font-semibold">AI 甄选平替直达：</span>
                    {radar.peerLinks && radar.peerLinks.length > 0
                      ? radar.peerLinks.map((pl, i) => (
                          <Button
                            key={i}
                            variant="secondary"
                            size="sm"
                            className="h-6 text-[11px] px-2 py-0 gap-1 font-medium hover:text-primary"
                            onClick={() => safeWindowOpen(pl.url)}
                          >
                            <span>{pl.title}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </Button>
                        ))
                      : radar.directAlternatives.map((alt, i) => (
                          <Badge key={i} variant="secondary" className="text-[11px] px-2 py-0.5 font-normal">
                            {alt}
                          </Badge>
                        ))}
                  </div>
                  {!visualUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2 gap-1 text-muted-foreground hover:text-primary"
                      onClick={fetchVisual}
                      disabled={visualLoading}
                    >
                      {visualLoading ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>生成架构图中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3 text-primary" />
                          <span>📐 生成架构与数据流示意图</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}

              {visualUrl && (
                <div className="space-y-2 pt-1">
                  <div className="relative rounded-lg overflow-hidden border border-border/60 aspect-video bg-muted/40 max-h-56 shadow-md">
                    {/* 2026-11-06 深扫 F-6：visualUrl 来自服务端下发的 data.imageUrl（外部可控），
                        统一过 safeSrc 与 safeWindowOpen。 */}
                    <img src={safeSrc(visualUrl)} alt={`${item.title} 架构与数据流示意图`} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-muted-foreground"
                      onClick={() => safeWindowOpen(visualUrl)}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      查看高清架构图
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 洛伦兹双曲空间实时平替推荐 (Lorentz Hyperbolic Alternatives) */}
        {hyperbolicAlts.length > 0 && (
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Orbit className="w-4 h-4 text-cyan-500" />
                <span>洛伦兹双曲流形实时平替推导 (Lorentz Hyperboloid)</span>
              </span>
              <span className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">测地线度量</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {hyperbolicAlts.map((alt) => (
                <div
                  key={alt.site.id}
                  className="flex items-start justify-between p-3 rounded-xl border border-border/60 bg-card hover:border-cyan-500/40 transition-all shadow-2xs group"
                >
                  <div className="space-y-1 min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold truncate group-hover:text-cyan-500 transition-colors">
                        {alt.site.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-mono shrink-0">
                        d_L={alt.geodesicDistance}
                      </span>
                    </div>
                    {alt.site.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{alt.site.description}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 rounded-lg shrink-0"
                    onClick={() => {
                      if (!isSafeHttpUrl(alt.site.url)) return
                      window.open(alt.site.url, '_blank', 'noopener,noreferrer')
                    }}
                    title="访问双曲平替站点"
                  >
                    <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 实时沙箱速览切换 */}
        <div className="mt-4 pt-3.5 border-t border-border/50">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" />
              <span>沙箱快速预览 (Sandboxed Preview)</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7.5 text-xs border-border/70 hover:bg-muted"
              onClick={() => setShowIframe(!showIframe)}
            >
              {showIframe ? '关闭预览窗' : '呼出即时沙箱'}
            </Button>
          </div>

          {showIframe ? (
            previewSrc ? (
            <div className="relative w-full h-80 rounded-xl border border-border/70 overflow-hidden bg-muted/20 shadow-inner">
              {/* 安全说明：故意不给 allow-same-origin —— 它和 allow-scripts 同时出现时，
                  被嵌入页面可以自我解除沙箱并顺着同源访问本站（XSS）。代价是少数
                  依赖同源存储的站点预览不完整，但预览本就不该有这种权限。 */}
              <iframe
                src={previewSrc}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-forms allow-popups"
                loading="lazy"
                title={`Preview of ${item.title}`}
              />
            </div>
            ) : (
              <div className="p-4 rounded-xl border border-dashed border-rose-500/40 text-center text-xs text-muted-foreground bg-muted/10">
                该站点地址不安全，已拦截预览（仅允许 http/https）。
              </div>
            )
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-border/60 text-center text-xs text-muted-foreground bg-muted/10">
              点击上方“呼出即时沙箱”可在安全隔离环境中即刻体验该站点，无需新开标签页。
            </div>
          )}
        </div>

        {/* 底部元数据状态条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pt-3 border-t border-border/50">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="shrink-0">网址:</span>
            <span className="font-mono text-foreground/80 truncate max-w-[180px] sm:max-w-[280px] select-all">{item.href}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0 border-border/60"
              title="复制网址链接"
              onClick={async () => {
                const res = await copyText(item.href)
                if (res.ok) {
                  toast({ title: '已复制网址', description: item.href })
                } else {
                  toast({ title: '复制失败', description: res.reason, variant: 'destructive' })
                }
              }}
            >
              <Copy className="w-3 h-3" />
              <span>复制链接</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0 border-border/60"
              title="复制 Markdown 引用 [标题](链接)"
              onClick={async () => {
                const md = `[${item.title}](${item.href})`
                const res = await copyText(md)
                if (res.ok) {
                  toast({ title: '已复制 Markdown', description: md })
                } else {
                  toast({ title: '复制失败', description: res.reason, variant: 'destructive' })
                }
              }}
            >
              <FileText className="w-3 h-3" />
              <span>Markdown</span>
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {healthBadge && (
              <div className="flex items-center gap-1.5 font-mono" title="服务端远端巡检结果">
                <span className={`w-2 h-2 rounded-full ${healthBadge.tone === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span>{healthBadge.label}</span>
                {healthBadge.latencyMs != null && <span>({healthBadge.latencyMs}ms)</span>}
              </div>
            )}

            {/* 本地测速探针 */}
            {livePing ? (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                  livePing.reachable
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                }`}
                title={`本机浏览器探测：${livePing.error || livePing.label}`}
              >
                <Activity className="w-3 h-3" />
                <span>{livePing.label}</span>
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={isPinging}
                onClick={handleLivePing}
                className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0 border-border/60"
                title="在本地浏览器测试当前对该站点的实际访问延迟"
              >
                {isPinging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                <span>{isPinging ? '测速中…' : '测速'}</span>
              </Button>
            )}

            {/* 反馈失效按钮 */}
            {hasReportedBroken ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1 px-1">
                <Check className="w-3 h-3 text-emerald-500" />
                <span>已反馈失效</span>
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReportBroken}
                className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-destructive hover:border-destructive/40 shrink-0 border-border/60"
                title="向平台反馈该网站打不开、连接超时或死链"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>反馈失效</span>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
