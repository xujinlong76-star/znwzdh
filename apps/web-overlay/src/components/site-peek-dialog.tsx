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
import { ExternalLink, Star, Sparkles, Zap, ArrowRight, Eye, Search, AlertTriangle, Orbit, History, Pin } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { FavoriteButton } from '@/components/favorite-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { isSafeHttpUrl, safeHref, safeSrc, safeWindowOpen } from '@/lib/safe-url'
import { buildWaybackSnapshotUrl } from '@/lib/wayback-resolver'
import { siteHealthBadge } from '@/lib/site-health'

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
  const [actionInputs, setActionInputs] = useState<Record<string, string>>({})
  const [showIframe, setShowIframe] = useState(false)
  const [hyperbolicAlts, setHyperbolicAlts] = useState<Array<{
    site: { id: string; title: string; url: string; description?: string }
    geodesicDistance: number
    alternativeScore: number
  }>>([])

  useEffect(() => {
    if (!open || !item?.id) {
      setHyperbolicAlts([])
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
                    <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-medium">
                      开源
                    </Badge>
                  )}
                  {item.liveMetrics?.githubStars && (
                    <Badge variant="outline" className="text-xs flex items-center gap-1 font-mono border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400">
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
              <span className="text-xs font-mono text-muted-foreground/80">{item.relations.length} 个候选</span>
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
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
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
          <div className="mt-3 p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 space-y-2.5 text-xs text-rose-600 dark:text-rose-400">
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
        <div className="flex flex-wrap items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border/50">
          <div className="flex items-center gap-2">
            <span>网址:</span>
            <span className="font-mono text-foreground/80 truncate max-w-[280px]">{item.href}</span>
          </div>
          {healthBadge && (
            <div className="flex items-center gap-1.5 font-mono">
              <span className={`w-2 h-2 rounded-full ${healthBadge.tone === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{healthBadge.label}</span>
              {healthBadge.latencyMs != null && <span>({healthBadge.latencyMs}ms)</span>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
