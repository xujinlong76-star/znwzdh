'use client'

/**
 * 管理台插件市场审核与治理页面 (Admin Plugin Review & Governance Console)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md：
 * 1. 状态机闭环：支持管理员对待审插件 approve 上架、reject 驳回并附带理由、delist 违规下架；
 * 2. 状态标签联动：即时呈现 pending 待审计数与举报告警；
 * 3. 审计留痕：所有审核动作均调用 /api/plugins/:slug/review 并落入审计日志。
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import {
  fetchAdminPlugins,
  reviewPlugin,
  type HubPluginItem,
} from '@/lib/navhub-api'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { EmptyState } from '@/components/ui/empty-state'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  ArrowLeft,
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
  Globe,
  LayoutGrid,
  Palette,
  ExternalLink,
  Flag,
  Search,
  PackageCheck,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const STATUS_TABS = [
  { key: 'pending', label: '待审核' },
  { key: 'published', label: '已上架' },
  { key: 'rejected', label: '已驳回' },
  { key: 'delisted', label: '已下架' },
] as const

export default function AdminPluginsPage() {
  const [plugins, setPlugins] = useState<HubPluginItem[]>([])
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<DegradeNotice | null>(null)

  const [activeStatus, setActiveStatus] = useState<string>('pending')
  const [search, setSearch] = useState('')

  // 驳回弹窗
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectPluginItem, setRejectPluginItem] = useState<HubPluginItem | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    try {
      const res = await fetchAdminPlugins(
        {
          status: activeStatus,
          q: search.trim() || undefined,
          limit: 100,
        },
        (err) => setNotice(describeDegrade(err, '管理台插件数据'))
      )
      setPlugins(res.items)
      if (res.pending !== undefined) {
        setPendingCount(res.pending)
      }
    } catch {
      setPlugins([])
    } finally {
      setLoading(false)
    }
  }, [activeStatus, search])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // 通过审核 (上架)
  const handleApprove = async (plugin: HubPluginItem) => {
    setActionLoading(true)
    try {
      await reviewPlugin(plugin.slug, 'approve')
      toast.success(`已通过审核并上架「${plugin.name}」！`)
      void loadList()
    } catch (err) {
      toast.error('操作失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  // 下架
  const handleDelist = async (plugin: HubPluginItem) => {
    if (!confirm(`确定要下架插件「${plugin.name}」吗？下架后市场公开列表将不再展示。`)) {
      return
    }
    setActionLoading(true)
    try {
      await reviewPlugin(plugin.slug, 'delist')
      toast.success(`已下架「${plugin.name}」`)
      void loadList()
    } catch (err) {
      toast.error('下架失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  // 提交驳回
  const handleConfirmReject = async () => {
    if (!rejectPluginItem) return
    setActionLoading(true)
    try {
      await reviewPlugin(rejectPluginItem.slug, 'reject', rejectNote.trim() || '未达到上架标准')
      toast.success(`已驳回「${rejectPluginItem.name}」`)
      setRejectModalOpen(false)
      setRejectNote('')
      setRejectPluginItem(null)
      void loadList()
    } catch (err) {
      toast.error('驳回失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionLoading(false)
    }
  }

  const renderKindIcon = (k: string) => {
    switch (k) {
      case 'site-pack':
        return <Globe className="w-3.5 h-3.5 text-sky-500" />
      case 'workspace-preset':
        return <LayoutGrid className="w-3.5 h-3.5 text-emerald-500" />
      case 'theme':
        return <Palette className="w-3.5 h-3.5 text-violet-500" />
      default:
        return null
    }
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 顶部返回导航 */}
        <div className="flex items-center justify-between">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回管理后台</span>
          </Link>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <span>访问插件市场前端</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* 头部面板 */}
        <div className="rounded-3xl border border-border/80 glass-surface p-6 sm:p-8 space-y-4 shadow-xs">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>管理面 · 扩展生态治理</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              插件市场审核管理
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              统一管理社区投稿与本地导入的插件。审核上架、驳回存疑项目或响应社区违规举报。
            </p>
          </div>

          {/* 状态 Tab 切换栏 */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
            {STATUS_TABS.map((tab) => {
              const isActive = activeStatus === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveStatus(tab.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border border-border/40'
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.key === 'pending' && pendingCount > 0 && (
                    <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-bold">
                      {pendingCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* 降级提示 */}
        {notice && <HubDegradedNotice notice={notice} onRetry={loadList} />}

        {/* 列表渲染 */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-2xl border border-border/40 bg-muted/20 animate-pulse"
              />
            ))}
          </div>
        ) : plugins.length > 0 ? (
          <div className="space-y-3">
            {plugins.map((item) => (
              <div
                key={item.slug}
                className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-border hover:bg-card"
              >
                <div className="space-y-1.5 max-w-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="p-1 rounded-md bg-muted/60 border border-border/40">
                      {renderKindIcon(item.kind)}
                    </span>
                    <Badge variant="outline" className="text-[11px] font-medium">
                      {pluginKindLabel(item.kind)}
                    </Badge>
                    <span className="font-semibold text-sm text-foreground">
                      {item.name}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      v{item.version}
                    </span>
                    {item.reportCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/30">
                        <Flag className="w-3 h-3" />
                        <span>举报 {item.reportCount}</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.description || '暂无描述'}
                  </p>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground/80">
                    <span>
                      作者: <strong className="text-foreground">{item.author || '匿名'}</strong>
                    </span>
                    <span>·</span>
                    <span>安装量: {item.installCount || 0}</span>
                    <span>·</span>
                    <span>星标: {item.starCount || 0}</span>
                    <span>·</span>
                    <span>提交时间: {new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                </div>

                {/* 审核操作动作栏 */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <Link
                    href={`/marketplace/${encodeURIComponent(item.slug)}`}
                    target="_blank"
                    className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground font-medium rounded-lg hover:bg-muted/60 border border-border/60 transition-colors inline-flex items-center gap-1"
                  >
                    <span>预览详情</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>

                  {item.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectPluginItem(item)
                          setRejectNote('')
                          setRejectModalOpen(true)
                        }}
                        disabled={actionLoading}
                        className="px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg border border-destructive/30 transition-colors"
                      >
                        驳回
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(item)}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:opacity-90 rounded-lg transition-all shadow-2xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>通过并上架</span>
                      </button>
                    </>
                  )}

                  {item.status === 'published' && (
                    <button
                      type="button"
                      onClick={() => handleDelist(item)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-lg border border-amber-500/30 transition-colors"
                    >
                      下架
                    </button>
                  )}

                  {(item.status === 'rejected' || item.status === 'delisted') && (
                    <button
                      type="button"
                      onClick={() => handleApprove(item)}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 rounded-lg border border-emerald-500/30 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>重新上架</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={PackageCheck}
            title={`暂无「${STATUS_TABS.find((t) => t.key === activeStatus)?.label}」的插件`}
            description="当前队列为空，所有插件已处理完毕。"
          />
        )}

        {/* 驳回理由输入弹窗 */}
        <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-foreground">
                驳回插件「{rejectPluginItem?.name}」
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground pt-1">
                请向作者说明驳回原因（如：格式错误、包含死链、类目不合理等）。
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 space-y-1.5">
              <label htmlFor="admin-reject-note" className="text-xs font-medium text-foreground block">
                驳回备注（可选，最多 500 字）：
              </label>
              <textarea
                id="admin-reject-note"
                aria-label="驳回备注"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="请填写驳回原因以指导作者修改…"
                rows={4}
                className="w-full text-xs rounded-lg border border-border/80 bg-background p-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-2 focus:ring-primary/40 resize-none"
                maxLength={500}
              />
            </div>

            <DialogFooter className="flex sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border/60 hover:bg-muted/60 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 transition-all"
              >
                {actionLoading ? '提交中…' : '确认驳回'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 底部导航 */}
        <Footer />
      </div>
    </Container>
  )
}
