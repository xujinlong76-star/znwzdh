'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  type HubPluginItem,
  starPlugin,
  unstarPlugin,
  installPlugin,
} from '@/lib/navhub-api'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { resolveInstallAction } from '@/lib/plugins/install-state'
import { Badge } from '@/components/ui/badge'
import {
  Globe,
  LayoutGrid,
  Palette,
  Star,
  Download,
  Check,
  ArrowUpCircle,
  ExternalLink,
  Layers,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface PluginCardProps {
  plugin: HubPluginItem
  identity?: string
  onStatusChange?: (updated: HubPluginItem) => void
  onOpenInstallModal?: (plugin: HubPluginItem) => void
}

export function PluginCard({
  plugin,
  identity,
  onStatusChange,
  onOpenInstallModal,
}: PluginCardProps) {
  const [starred, setStarred] = useState(Boolean(plugin.starred))
  const [starCount, setStarCount] = useState(plugin.starCount || 0)
  const [starLoading, setStarLoading] = useState(false)
  const [installed, setInstalled] = useState(Boolean(plugin.installed))
  const [installing, setInstalling] = useState(false)

  // D1 更新链路：本地升级成功后不等父级刷新即切换为「已安装」
  const [upgradedTo, setUpgradedTo] = useState<string | null>(null)
  const needsUpdate =
    installed &&
    upgradedTo !== plugin.version &&
    resolveInstallAction(plugin.installedVersion, plugin.version) === 'update'

  const handleStarToggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (starLoading) return
    setStarLoading(true)

    const prevStarred = starred
    const prevCount = starCount
    const nextStarred = !starred
    setStarred(nextStarred)
    setStarCount(nextStarred ? prevCount + 1 : Math.max(0, prevCount - 1))

    try {
      if (nextStarred) {
        const res = await starPlugin(plugin.slug, identity)
        setStarCount(res.starCount)
      } else {
        const res = await unstarPlugin(plugin.slug, identity)
        setStarCount(res.starCount)
      }
      onStatusChange?.({
        ...plugin,
        starred: nextStarred,
        starCount: nextStarred ? prevCount + 1 : Math.max(0, prevCount - 1),
      })
    } catch (err) {
      setStarred(prevStarred)
      setStarCount(prevCount)
      toast.error('星标更新失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStarLoading(false)
    }
  }

  const handleQuickInstall = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // 有确认弹窗时统一走弹窗：site-pack 可预演将写入的站点数，
    // workspace-preset / theme 必须在客户端消费 payload（暂存/激活），
    // 快装直连 API 会跳过这两步，造成"已安装但没生效"的静默半安装
    if (onOpenInstallModal) {
      onOpenInstallModal(plugin)
      return
    }

    if (installing) return
    setInstalling(true)
    try {
      const res = await installPlugin(plugin.slug, identity)
      const wasUpdate = needsUpdate
      setInstalled(true)
      if (wasUpdate) setUpgradedTo(plugin.version)
      toast.success(
        wasUpdate
          ? `已更新到 v${plugin.version}！`
          : res.alreadyInstalled
            ? '插件已处于安装状态'
            : '插件安装成功！'
      )
      onStatusChange?.({
        ...plugin,
        installed: true,
        installedVersion: plugin.version,
        installCount: res.plugin?.installCount ?? plugin.installCount + (res.alreadyInstalled ? 0 : 1),
      })
    } catch (err) {
      toast.error('安装失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setInstalling(false)
    }
  }

  const renderKindIcon = () => {
    switch (plugin.kind) {
      case 'site-pack':
        return <Globe className="w-4 h-4 text-sky-500" />
      case 'workspace-preset':
        return <LayoutGrid className="w-4 h-4 text-emerald-500" />
      case 'theme':
        return <Palette className="w-4 h-4 text-violet-500" />
      default:
        return <Layers className="w-4 h-4 text-muted-foreground" />
    }
  }

  const summary = plugin.summary
  const renderSummaryMetrics = () => {
    if (!summary) return null
    if (plugin.kind === 'site-pack') {
      return (
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Globe className="w-3 h-3 text-sky-500/70" />
          <span>{summary.siteCount ?? 0} 个站点</span>
          <span>·</span>
          <span>{summary.categoryCount ?? 0} 个类目</span>
        </span>
      )
    }
    if (plugin.kind === 'workspace-preset') {
      return (
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <LayoutGrid className="w-3 h-3 text-emerald-500/70" />
          <span>{summary.boardCount ?? 0} 个看板</span>
          <span>·</span>
          <span>{summary.widgetCount ?? 0} 个组件</span>
        </span>
      )
    }
    if (plugin.kind === 'theme') {
      return (
        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Palette className="w-3 h-3 text-violet-500/70" />
          <span>{summary.accent ? `强调色: ${summary.accent}` : '调色板主题'}</span>
          <span>·</span>
          <span>{summary.themeTokenCount ?? 0} 项变量</span>
        </span>
      )
    }
    return null
  }

  return (
    <div className="group relative flex flex-col justify-between rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs p-5 transition-all duration-300 hover:border-border hover:bg-card hover:shadow-md">
      <div className="space-y-3">
        {/* 头部：类型标签与版本 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="p-1.5 rounded-lg bg-muted/60 border border-border/40 flex items-center justify-center">
              {renderKindIcon()}
            </span>
            <Badge
              variant="outline"
              className={cn(
                'text-[11px] font-medium px-2 py-0.5 border-border/60',
                plugin.kind === 'site-pack' && 'text-sky-600 dark:text-sky-400 bg-sky-500/5',
                plugin.kind === 'workspace-preset' && 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5',
                plugin.kind === 'theme' && 'text-violet-600 dark:text-violet-400 bg-violet-500/5'
              )}
            >
              {pluginKindLabel(plugin.kind)}
            </Badge>
            {plugin.source === 'import' && (
              <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-500/5 border-amber-500/20">
                本地导入
              </Badge>
            )}
          </div>
          <span className="text-[11px] font-mono text-muted-foreground/80">v{plugin.version}</span>
        </div>

        {/* 插件标题与描述 */}
        <div className="space-y-1.5">
          <Link
            href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
            className="group/title inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary transition-colors text-base"
          >
            <span>{plugin.name}</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-0 -translate-x-1 transition-all group-hover/title:opacity-100 group-hover/title:translate-x-0" />
          </Link>
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed min-h-[32px]">
            {plugin.description || '暂无描述'}
          </p>
        </div>

        {/* 指标摘要 */}
        <div className="pt-1">{renderSummaryMetrics()}</div>

        {/* 标签列表 */}
        {plugin.tags && plugin.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {plugin.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/50 text-muted-foreground border border-border/30"
              >
                #{tag}
              </span>
            ))}
            {plugin.tags.length > 4 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{plugin.tags.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 底部操作与统计栏 */}
      <div className="mt-5 pt-3 border-t border-border/50 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleStarToggle}
            disabled={starLoading}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors border',
              starred
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-muted/60'
            )}
            title={starred ? '取消星标' : '点亮星标'}
          >
            <Star className={cn('w-3.5 h-3.5', starred && 'fill-current text-amber-500')} />
            <span className="font-mono text-[11px]">{starCount}</span>
          </button>

          <span className="text-muted-foreground flex items-center gap-1 font-mono text-[11px]">
            <Download className="w-3.5 h-3.5 text-muted-foreground/60" />
            {plugin.installCount || 0}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
            className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground font-medium rounded-lg hover:bg-muted/60 transition-colors"
          >
            详情
          </Link>
          <button
            type="button"
            onClick={handleQuickInstall}
            disabled={installing}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-all shadow-2xs',
              needsUpdate
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40 hover:bg-amber-500/25'
                : installed
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95'
            )}
          >
            {needsUpdate ? (
              <>
                <ArrowUpCircle className="w-3 h-3" />
                <span>{installing ? '更新中…' : `更新到 v${plugin.version}`}</span>
              </>
            ) : installed ? (
              <>
                <Check className="w-3 h-3" />
                <span>已安装</span>
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                <span>{installing ? '安装中…' : '安装'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
