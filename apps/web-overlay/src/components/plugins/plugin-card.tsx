'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  type HubPluginItem,
  starPlugin,
  unstarPlugin,
  installPlugin,
  uninstallPlugin,
  createPluginShortLink,
  trackPluginEvent,
} from '@/lib/navhub-api'
import { pluginKindLabel, resolvePluginDescription } from '@/lib/plugins/plugin-manifest'
import { resolveInstallAction } from '@/lib/plugins/install-state'
import { cardTitle } from '@/lib/plugins/display-title'
import { Badge } from '@/components/ui/badge'
import dynamic from 'next/dynamic'

const PluginAuditModal = dynamic(
  () => import('./plugin-audit-modal').then((m) => m.PluginAuditModal),
  { ssr: false }
)
import { copyText } from '@/lib/clipboard'
import {
  Globe,
  LayoutGrid,
  Palette,
  Search,
  Boxes,
  Star,
  Download,
  Check,
  ArrowUpCircle,
  ExternalLink,
  Layers,
  Sparkles,
  Share2,
  Loader2,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface PluginCardProps {
  plugin: HubPluginItem
  identity?: string
  onStatusChange?: (updated: HubPluginItem) => void
  onOpenInstallModal?: (plugin: HubPluginItem, mode: 'install' | 'uninstall' | 'upgrade') => void
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
  const [sharing, setSharing] = useState(false)
  const [auditModalOpen, setAuditModalOpen] = useState(false)

  // D1 更新链路：本地升级成功后不等父级刷新即切换为「已安装」
  const [upgradedTo, setUpgradedTo] = useState<string | null>(null)

  // 父级数据刷新后 prop 会变（如弹窗安装成功后列表重取），本地态必须跟上：
  // 同一 key 的卡片实例不会因 prop 变化重建，useState 只取初值，装完按钮会
  // 一直停在「安装」上，用户可能重复点安装。星标/星数同理（父级重取后回落）。
  // 乐观更新不受影响：本地先改、随后 onStatusChange 补丁回来的 prop 是同一值。
  useEffect(() => {
    setInstalled(Boolean(plugin.installed))
  }, [plugin.installed])
  useEffect(() => {
    setStarred(Boolean(plugin.starred))
    setStarCount(plugin.starCount || 0)
  }, [plugin.starred, plugin.starCount])
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

  const targetMode: 'install' | 'uninstall' | 'upgrade' = needsUpdate
    ? 'upgrade'
    : installed
      ? 'uninstall'
      : 'install'

  const handleAction = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // 有确认弹窗时统一走弹窗，并精确传递当前动作语义（升级 / 卸载 / 安装），
    // 彻底解决已安装状态下重复弹出安装确认框的交互 BUG
    if (onOpenInstallModal) {
      onOpenInstallModal(plugin, targetMode)
      return
    }

    if (installing) return
    setInstalling(true)
    try {
      if (targetMode === 'uninstall') {
        const res = await uninstallPlugin(plugin.slug, identity, true)
        setInstalled(false)
        setUpgradedTo(null)
        toast.success(`已卸载「${plugin.name}」`, {
          description: res.sitesRemoved > 0 ? `已清理 ${res.sitesRemoved} 个关联站点` : undefined,
        })
        onStatusChange?.({
          ...plugin,
          installed: false,
          installedVersion: undefined,
          installCount: Math.max(0, (plugin.installCount ?? 1) - 1),
        })
        return
      }

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
      toast.error(targetMode === 'uninstall' ? '卸载失败' : '安装失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setInstalling(false)
    }
  }

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (sharing) return
    setSharing(true)
    trackPluginEvent('plugin_share', plugin.slug)

    // 与详情页同口径：优先站内短链，失败回退完整安装深链，分享不因后端故障中断
    let path = `/marketplace/${encodeURIComponent(plugin.slug)}?install=1`
    try {
      const short = await createPluginShortLink(plugin.slug, { install: true })
      if (short.path) path = short.path
    } catch {
      // 保留长链兜底
    }

    const link = `${window.location.origin}${path}`
    const result = await copyText(link)
    if (result.ok) {
      toast.success('分享链接已复制', { description: '打开即可进入安装确认' })
    } else {
      toast.error('复制失败', { description: result.reason })
    }
    setSharing(false)
  }

  /** 与图标同色系：头部小瓷砖的渐变底座，让 5 类插件远看就能区分 */
  const kindTileClass = () => {
    switch (plugin.kind) {
      case 'site-pack':
        return 'bg-sky-500/10 border-sky-500/30'
      case 'workspace-preset':
        return 'bg-emerald-500/10 border-emerald-500/30'
      case 'theme':
        return 'bg-violet-500/10 border-violet-500/30'
      case 'search-pack':
        return 'bg-sky-500/10 border-sky-500/30'
      case 'bundle':
        return 'bg-amber-500/10 border-amber-500/30'
      default:
        return 'bg-muted/60 border-border/40'
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
      case 'search-pack':
        return <Search className="w-4 h-4 text-sky-500" />
      case 'bundle':
        return <Boxes className="w-4 h-4 text-amber-500" />
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
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <LayoutGrid className="w-3 h-3 text-emerald-500/70" />
            <span>{summary.boardCount ?? 0} 个看板</span>
            <span>·</span>
            <span>{summary.widgetCount ?? 0} 个组件</span>
          </span>
          {Array.isArray(summary.widgetTypes) && summary.widgetTypes.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {summary.widgetTypes.slice(0, 3).map((wType: string) => (
                <span
                  key={wType}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-mono"
                >
                  {wType}
                </span>
              ))}
              {summary.widgetTypes.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{summary.widgetTypes.length - 3}</span>
              )}
            </div>
          )}
        </div>
      )
    }
    if (plugin.kind === 'theme') {
      const ACCENT_LABELS: Record<string, string> = {
        violet: '紫罗兰',
        emerald: '极光青 / 墨绿',
        amber: '琥珀暖橙',
        rose: '霓虹粉紫 / 胭脂粉',
        ocean: '海面蓝',
        sky: '天空蓝 / 冰蓝',
        'system-blue': '活力系统天蓝',
        latte: '拿铁暖棕',
      }
      const displayAccent = summary.accent ? (ACCENT_LABELS[summary.accent] || summary.accent) : '调色板主题'
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Palette className="w-3 h-3 text-violet-500/70" />
            <span>{summary.accent ? `强调色: ${displayAccent}` : '调色板主题'}</span>
            <span>·</span>
            <span>{summary.themeTokenCount ?? 0} 项变量</span>
          </span>
          {Array.isArray(summary.palettePreview) && summary.palettePreview.length > 0 && (
            <div className="flex items-center gap-1.5 py-0.5" title="主题 5 色调色板实时预览">
              {summary.palettePreview.slice(0, 5).map((color: string, idx: number) => (
                <span
                  key={idx}
                  data-theme-swatch={color}
                  aria-hidden="true"
                  className="w-3.5 h-3.5 rounded-full border border-black/15 dark:border-white/20 shadow-2xs shrink-0 transition-transform hover:scale-110"
                  style={{ backgroundColor: `hsl(${color})` }}
                />
              ))}
              <span className="text-[10px] text-muted-foreground font-mono ml-0.5">色板预览</span>
            </div>
          )}
        </div>
      )
    }
    if (plugin.kind === 'search-pack') {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Search className="w-3 h-3 text-sky-500/70" />
            <span>{summary.engineCount ?? 0} 个搜索引擎</span>
          </span>
          {Array.isArray(summary.enginePrefixes) && summary.enginePrefixes.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-muted-foreground">快捷指令:</span>
              {summary.enginePrefixes.slice(0, 4).map((prefix: string) => (
                <kbd
                  key={prefix}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted/80 text-foreground border border-border/80 shadow-2xs"
                >
                  {prefix.startsWith('!') ? prefix : `!${prefix}`}
                </kbd>
              ))}
              {summary.enginePrefixes.length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{summary.enginePrefixes.length - 4}</span>
              )}
            </div>
          )}
        </div>
      )
    }
    if (plugin.kind === 'bundle') {
      const kinds: string[] = Array.isArray(summary.bundleKinds) ? summary.bundleKinds : []
      const kindLabels: Record<string, string> = {
        'site-pack': '网址包',
        'search-pack': '搜索包',
        theme: '主题',
      }
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Boxes className="w-3 h-3 text-amber-500/70" />
            <span>{summary.bundleItemCount ?? 0} 个成员</span>
            {kinds.length > 0 && (
              <>
                <span>·</span>
                <span>{kinds.map((k) => kindLabels[k] ?? k).join(' + ')}</span>
              </>
            )}
          </span>
          {kinds.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {kinds.map((k) => (
                <span
                  key={k}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                >
                  {kindLabels[k] ?? k}
                </span>
              ))}
            </div>
          )}
        </div>
      )
    }
    return null
  }

  return (
    <div
      className={cn(
        'nav-card-glow group relative flex flex-col justify-between rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs p-4 sm:p-5 transition-all duration-300 hover:border-primary/30 hover:bg-card hover:shadow-md hover:-translate-y-0.5',
        plugin.featured && 'border-amber-500/30'
      )}
    >
      <div className="space-y-3">
        {/* 头部：类型标签与版本 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className={cn('p-1.5 rounded-lg border flex items-center justify-center', kindTileClass())}>
              {renderKindIcon()}
            </span>
            <Badge
              variant="outline"
              className={cn(
                'text-[11px] font-medium px-2 py-0.5 border-border/60',
                plugin.kind === 'site-pack' && 'text-sky-600 dark:text-sky-400 bg-sky-500/5',
                plugin.kind === 'workspace-preset' && 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5',
                plugin.kind === 'theme' && 'text-violet-600 dark:text-violet-400 bg-violet-500/5',
                plugin.kind === 'search-pack' && 'text-sky-600 dark:text-sky-400 bg-sky-500/5',
                plugin.kind === 'bundle' && 'text-amber-600 dark:text-amber-400 bg-amber-500/5'
              )}
            >
              {pluginKindLabel(plugin.kind)}
            </Badge>
            {plugin.featured && (
              <Badge variant="outline" className="text-[10px] text-amber-700 bg-amber-500/10 border-amber-500/30">
                精选
              </Badge>
            )}
            {plugin.source === 'import' && (
              <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-500/5 border-amber-500/20">
                本地导入
              </Badge>
            )}
            {plugin.aiAudit && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setAuditModalOpen(true)
                }}
                className="cursor-pointer inline-flex items-center"
              >
                <Badge
                  variant="outline"
                  className="text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 inline-flex items-center gap-1 font-mono transition-colors"
                  title="点击查看 AI 智能四维审查认证详情报告"
                >
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  <span>AI 严审 · {plugin.aiAudit.score}分</span>
                </Badge>
              </button>
            )}
          </div>
          <span className="text-[11px] font-mono text-muted-foreground">v{plugin.version}</span>
        </div>

        {/* 插件标题与描述 */}
        <div className="space-y-1.5">
          <Link
            href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
            // 标题在卡片里可能被裁行，全称放 title + aria-label，不因展示收敛而丢信息
            title={plugin.name}
            aria-label={plugin.name}
            className="group/title inline-flex min-w-0 items-center gap-1.5 font-semibold text-foreground hover:text-primary transition-colors text-base"
          >
            <span className="min-w-0 break-words">{cardTitle(plugin.name)}</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-40 sm:opacity-0 -translate-x-1 transition-all group-hover/title:opacity-100 group-hover/title:translate-x-0" />
          </Link>
          <p className="text-[13px] text-muted-foreground line-clamp-2 leading-relaxed min-h-[38px] break-words">
            {/* 描述里的统计数字用 summary 派生值覆盖：卡片上文案与徽章必须同源（SSOT） */}
            {resolvePluginDescription(plugin.description || '', summary) || '暂无描述'}
          </p>
        </div>

        {/* 指标摘要 */}
        <div className="pt-1">
          {summary ? (
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              {renderSummaryMetrics()}
            </div>
          ) : null}
        </div>

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
      <div className="mt-5 pt-3 border-t border-border/50 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={handleStarToggle}
            disabled={starLoading}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1.5 min-h-[32px] rounded-md transition-colors border',
              starred
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
                : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-muted/60'
            )}
            title={starred ? '取消星标' : '点亮星标'}
          >
            <Star className={cn('w-3.5 h-3.5', starred && 'fill-current text-amber-500')} />
            <span className="font-mono text-[11px]">{starCount}</span>
          </button>

          <span className="text-muted-foreground flex items-center gap-1 font-mono text-[11px]">
            <Download className="w-3.5 h-3.5 text-muted-foreground" />
            {plugin.installCount || 0}
          </span>
          {(plugin.reviewCount ?? 0) > 0 && (
            <span className="text-muted-foreground flex items-center gap-1 font-mono text-[11px]" title={`${plugin.reviewCount} 条评价`}>
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
              {(plugin.ratingAvg ?? 0).toFixed(1)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            aria-label="复制安装分享链接"
            title="复制带安装引导的分享链接"
            className="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
          </button>
          <Link
            href={`/marketplace/${encodeURIComponent(plugin.slug)}`}
            className="h-8 px-2.5 inline-flex items-center text-xs whitespace-nowrap text-muted-foreground hover:text-foreground font-medium rounded-lg hover:bg-muted/60 transition-colors"
          >
            详情
          </Link>
          <button
            type="button"
            onClick={handleAction}
            disabled={installing}
            title={needsUpdate ? `更新到 v${plugin.version}` : installed ? '已安装（点击管理或卸载）' : '安装插件'}
            aria-label={needsUpdate ? `更新到 v${plugin.version}` : installed ? `已安装「${plugin.name}」，点击管理或卸载` : `安装「${plugin.name}」`}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg whitespace-nowrap transition-all shadow-2xs',
              needsUpdate
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40 hover:bg-amber-500/25'
                : installed
                  ? 'group/btn bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-destructive/15 hover:text-destructive-text hover:border-destructive/30'
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
                <Check className="w-3 h-3 group-hover/btn:hidden" />
                <RotateCcw className="w-3 h-3 hidden group-hover/btn:inline-block" />
                <span className="group-hover/btn:hidden">已安装</span>
                <span className="hidden group-hover/btn:inline">管理 / 卸载</span>
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

      {/* AI 严审安全认证模态框 */}
      {auditModalOpen && (
        <PluginAuditModal
          open={auditModalOpen}
          onOpenChange={setAuditModalOpen}
          plugin={plugin}
        />
      )}
    </div>
  )
}
