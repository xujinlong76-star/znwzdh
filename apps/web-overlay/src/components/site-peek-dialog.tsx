'use client'

import { useState } from 'react'
import type { NavigationSubItem, SiteAction, SiteRelation } from '@/types/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { SiteFavicon } from '@/components/site-favicon'
import { ExternalLink, Star, ShieldCheck, Sparkles, Zap, ArrowRight, Eye, Code, Search } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface SitePeekDialogProps {
  item: NavigationSubItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SitePeekDialog({ item, open, onOpenChange }: SitePeekDialogProps) {
  const [actionInputs, setActionInputs] = useState<Record<string, string>>({})
  const [showIframe, setShowIframe] = useState(false)

  if (!item) return null

  const handleActionSubmit = (action: SiteAction, e?: React.FormEvent) => {
    e?.preventDefault()
    const val = actionInputs[action.id] || ''
    const targetUrl = action.urlTemplate.includes('{q}')
      ? action.urlTemplate.replace('{q}', encodeURIComponent(val))
      : action.urlTemplate
    window.open(targetUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setShowIframe(false) }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto p-5 sm:p-7 glass-surface subtle-mesh border-border/80 shadow-2xl rounded-2xl">
        <DialogHeader className="space-y-3 pb-3 border-b border-border/50">
          <div className="flex items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 p-2 rounded-xl bg-muted/60 border border-border/60 shadow-xs flex-shrink-0 flex items-center justify-center">
                <SiteFavicon
                  title={item.title}
                  icon={item.icon}
                  useDefaultIcon={item.useDefaultIcon}
                  className="w-full h-full object-contain"
                />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold flex flex-wrap items-center gap-2">
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
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 shrink-0 h-8.5 px-3.5 shadow-xs font-medium"
              onClick={() => window.open(item.href, '_blank', 'noopener,noreferrer')}
            >
              <span>访问主站</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
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
                          <Input
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
                    className="h-6.5 w-6.5 shrink-0 rounded-lg hover:bg-muted"
                    onClick={() => window.open(rel.targetUrl, '_blank', 'noopener,noreferrer')}
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
            <div className="relative w-full h-80 rounded-xl border border-border/70 overflow-hidden bg-muted/20 shadow-inner">
              <iframe
                src={item.href}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
                loading="lazy"
                title={`Preview of ${item.title}`}
              />
            </div>
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
          {item.health && (
            <div className="flex items-center gap-1.5 font-mono">
              <span className={`w-2 h-2 rounded-full ${item.health.ok ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>SLA: {item.health.ok ? '在线正常' : '响应缓慢'}</span>
              {item.health.latencyMs && <span>({item.health.latencyMs}ms)</span>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
