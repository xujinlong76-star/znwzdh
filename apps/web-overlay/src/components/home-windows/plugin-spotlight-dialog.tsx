'use client'

/**
 * 「插件市场精选」按需小窗口（A4）：
 * 首页仅保留 1 行紧凑微胶囊入口，点击打开精选清单与安装入口。
 */
import Link from 'next/link'
import { ExternalLink, Puzzle, Store } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import {
  MARKETPLACE_CATEGORIES_PATH,
  MARKETPLACE_KIND_LABELS,
} from '@/lib/plugins/marketplace-categories'
import type { HubPluginItem } from '@/lib/navhub-api'

export interface PluginSpotlightDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: HubPluginItem[] | null
}

export function PluginSpotlightDialog({
  open,
  onOpenChange,
  items,
}: PluginSpotlightDialogProps) {
  const list = items?.slice(0, 8) ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[580px] w-[calc(100vw-1.5rem)] max-h-[80vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Puzzle className="h-4 w-4 text-primary" />
              <span>插件市场精选</span>
            </DialogTitle>
            <div className="ml-auto flex items-center gap-2">
              <Link
                href={MARKETPLACE_CATEGORIES_PATH}
                className="inline-flex min-h-9 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                全部分类
              </Link>
              <Link
                href="/marketplace"
                className="inline-flex min-h-9 items-center gap-1 rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/15"
              >
                <Store className="h-3.5 w-3.5" />
                <span>进入市场</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            一键安装主题皮肤、效率微件、AI 指令源与数据扩展，按需弹出不占首页篇幅。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {list.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {list.map((plugin) => (
                <Link
                  key={plugin.slug}
                  href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
                  onClick={() => onOpenChange(false)}
                  className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card/70 p-3 transition-colors hover:border-primary/40 hover:bg-accent/50"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                        {plugin.icon ? `${plugin.icon} ` : ''}
                        {plugin.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {MARKETPLACE_KIND_LABELS[plugin.kind]}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {plugin.description || '点击查看插件详情与一键安装'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              当前暂无预装精选快照，请前往{' '}
              <Link href="/marketplace" className="font-medium text-primary underline underline-offset-4">
                插件市场
              </Link>{' '}
              浏览最新上架。
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
