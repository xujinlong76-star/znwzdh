'use client'

/**
 * 「全部高频直达」小窗口（A4）：
 * 当三合一单行坞中收纳的极速置顶 / 常用 / 最近记录超过首行展示数时，
 * 点击「展开全部」在轻量小窗口里集中查看与点击跳转。
 */
import { History, Star, Zap } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { SiteFavicon } from '@/components/site-favicon'
import { safeHref } from '@/lib/safe-url'
import { recordOfflineVisit, type RecentVisit } from '@/lib/offline-recent'
import { getIdentity } from '@/lib/identity'
import { reportClick } from '@/lib/navhub-api'
import type { SpeedDialSite } from '@/lib/speed-dial-order'

export interface QuickDockAllDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  speedSites: SpeedDialSite[]
  frequentVisits: RecentVisit[]
  recentVisits: RecentVisit[]
  dialDigitById?: ReadonlyMap<string, number | string>
  externalTarget?: string
}

export function QuickDockAllDialog({
  open,
  onOpenChange,
  speedSites,
  frequentVisits,
  recentVisits,
  dialDigitById,
  externalTarget = '_blank',
}: QuickDockAllDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] w-[calc(100vw-1.5rem)] max-h-[82vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Zap className="h-4 w-4 text-primary" />
            <span>高频直达全集</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            汇总你的极速置顶、本机高频访问与最近访问足迹。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {speedSites.length > 0 ? (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <span>极速置顶 ({speedSites.length})</span>
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {speedSites.map((site) => {
                  const digit = dialDigitById?.get(site.id)
                  return (
                    <a
                      key={site.id}
                      href={safeHref(site.href)}
                      target={externalTarget}
                      rel="noopener noreferrer"
                      onClick={() => {
                        recordOfflineVisit({
                          id: site.id,
                          title: site.title,
                          href: site.href,
                          icon: site.icon,
                        })
                        reportClick(site.id, getIdentity())
                      }}
                      className="flex min-h-10 items-center gap-2 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1.5 text-xs font-medium hover:border-primary/40 hover:bg-accent/50"
                    >
                      <SiteFavicon
                        icon={site.icon}
                        url={site.href}
                        title={site.title}
                        useDefaultIcon={site.useDefaultIcon}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{site.title}</span>
                      {digit ? (
                        <kbd className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                          {digit}
                        </kbd>
                      ) : null}
                    </a>
                  )
                })}
              </div>
            </section>
          ) : null}

          {frequentVisits.length > 0 ? (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Star className="h-3.5 w-3.5 text-primary" />
                <span>我的常用 ({frequentVisits.length})</span>
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {frequentVisits.map((visit) => (
                  <a
                    key={`freq-${visit.id}`}
                    href={safeHref(visit.href)}
                    target={externalTarget}
                    rel="noopener noreferrer"
                    onClick={() => {
                      recordOfflineVisit(visit)
                      reportClick(visit.id, getIdentity())
                    }}
                    className="flex min-h-10 items-center gap-2 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1.5 text-xs font-medium hover:border-primary/40 hover:bg-accent/50"
                  >
                    <SiteFavicon
                      icon={visit.icon}
                      url={visit.href}
                      title={visit.title}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{visit.title}</span>
                    {visit.count && visit.count > 1 ? (
                      <span className="text-[10px] text-muted-foreground">{visit.count}次</span>
                    ) : null}
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {recentVisits.length > 0 ? (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                <span>最近访问 ({recentVisits.length})</span>
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {recentVisits.map((visit) => (
                  <a
                    key={`recent-${visit.id}`}
                    href={safeHref(visit.href)}
                    target={externalTarget}
                    rel="noopener noreferrer"
                    onClick={() => {
                      recordOfflineVisit(visit)
                      reportClick(visit.id, getIdentity())
                    }}
                    className="flex min-h-10 items-center gap-2 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1.5 text-xs font-medium hover:border-primary/40 hover:bg-accent/50"
                  >
                    <SiteFavicon
                      icon={visit.icon}
                      url={visit.href}
                      title={visit.title}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{visit.title}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
