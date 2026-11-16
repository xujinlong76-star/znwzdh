'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  installPlugin,
  rollbackPlugin,
  fetchPluginDetail,
  fetchPluginVersions,
  fetchPluginVersionDetail,
  type HubPluginVersionItem,
  type HubPluginVersionDetail,
} from '@/lib/navhub-api'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { getActiveTheme, setActiveTheme } from '@/lib/plugins/theme-runtime'
import { registerSearchPackEngines } from '@/lib/plugins/search-pack-runtime'
import { comparePluginVersions, type PluginManifest } from '@/lib/plugins/plugin-manifest'
import { History, GitCommit, ShieldCheck, ChevronRight, FileCode, Check, Copy, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

// 差异面板只在展开版本时出现，静态引入会把整个 diff 渲染器塞进详情页首屏 chunk
const PluginDiffView = dynamic(
  () => import('@/components/plugins/plugin-diff-view').then((m) => m.PluginDiffView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-16 items-center justify-center rounded-lg border border-border/60 bg-muted/20" aria-busy="true">
        <span className="sr-only">正在加载版本差异…</span>
      </div>
    ),
  },
)

interface PluginVersionTimelineProps {
  slug: string
  currentVersion: string
  /** 已安装版本（详情页传入）：用于区分「重装/回滚/安装」与标注已装版本 */
  installedVersion?: string | null
  /** 回滚/安装成功后刷新详情（B-1：已装版本与升级提示随之更新） */
  onChanged?: () => void
}

export function PluginVersionTimeline({ slug, currentVersion, installedVersion, onChanged }: PluginVersionTimelineProps) {
  const [versions, setVersions] = useState<HubPluginVersionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [versionDetail, setVersionDetail] = useState<HubPluginVersionDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [copiedHash, setCopiedHash] = useState<string | null>(null)
  const [installingVersion, setInstallingVersion] = useState<string | null>(null)
  // 加载失败 ≠ 首发版本：旧 catch 静默吞错，失败时照常渲染「当前为首发版本」。
  const [notice, setNotice] = useState<DegradeNotice | null>(null)

  /**
   * 按目标版清单重应用客户端运行时（与安装弹窗同款口径，B-1）：
   * 主题只在它正是当前激活主题时重应用（不替用户换主题）；搜索包重注册
   * 即替换旧版引擎；组合包逐成员重注册搜索包引擎（尽力而为）。
   */
  const reapplyVersionManifest = async (targetVersion: string) => {
    try {
      const detail = await fetchPluginVersionDetail(slug, targetVersion)
      // 版本详情的 manifest 在接口类型里是 any（基线）；按 PluginManifest 接，
      // 再用 kind + payload 字段收窄（payload 是联合类型，in 运算符可收窄）。
      const manifest = detail?.manifest as PluginManifest | null
      if (!manifest) return
      const payload = manifest.payload
      if (manifest.kind === 'theme' && payload && typeof payload === 'object' && 'tokens' in payload) {
        if (getActiveTheme()?.slug === slug) {
          setActiveTheme({
            slug,
            name: manifest.name ?? slug,
            tokens: payload.tokens,
            accent: payload.accent,
          })
        }
      } else if (manifest.kind === 'search-pack' && payload && typeof payload === 'object' && 'engines' in payload) {
        registerSearchPackEngines(slug, payload.engines)
      } else if (manifest.kind === 'bundle' && payload && typeof payload === 'object' && 'items' in payload) {
        const members = payload.items
        await Promise.allSettled(
          members
            .filter((m) => m?.kind === 'search-pack' && m?.slug)
            .map(async (m) => {
              const d = await fetchPluginDetail(m.slug)
              const engines = d?.plugin?.manifest?.payload?.engines
              if (engines) registerSearchPackEngines(m.slug, engines)
            }),
        )
      }
    } catch {
      // 重应用失败不推翻回滚结果：服务端已回滚，客户端运行时下次进已安装页可再同步
    }
  }

  const handleInstallVersion = async (targetVersion: string) => {
    setInstallingVersion(targetVersion)
    try {
      // 目标低于已装版本 = 回滚：走真实回滚接口（服务端先删新版独有站再装旧版清单），
      // 旧代码只调 install(version) 是假回滚——只新增不删除、版本号还写成旧版。
      const isRollback =
        !!installedVersion && comparePluginVersions(targetVersion, installedVersion) < 0
      if (isRollback) {
        const res = await rollbackPlugin(slug, targetVersion)
        if (res.success) {
          await reapplyVersionManifest(targetVersion)
          toast.success(`已回滚到 v${targetVersion}${res.sitesRemoved > 0 ? `，移除了 ${res.sitesRemoved} 个新版独有站点` : ''}`)
          onChanged?.()
        }
      } else {
        const res = await installPlugin(slug, undefined, { version: targetVersion })
        if (res.success) {
          await reapplyVersionManifest(targetVersion)
          toast.success(`已成功生效/回滚至版本 v${targetVersion}`)
          onChanged?.()
        }
      }
    } catch (err: any) {
      toast.error(err?.message || `安装版本 v${targetVersion} 失败`)
    } finally {
      setInstallingVersion(null)
    }
  }

  const loadVersions = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    try {
      const res = await fetchPluginVersions(slug, (err) =>
        setNotice(describeDegrade(err, '版本历史')),
      )
      setVersions(res.versions)
    } catch {
      // 失败事实已由 onDegraded 写入 notice，渲染层据此显示失败态
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void loadVersions()
  }, [loadVersions])

  const handleInspect = async (ver: string) => {
    if (selectedVersion === ver && versionDetail) {
      setSelectedVersion(null)
      setVersionDetail(null)
      return
    }
    setSelectedVersion(ver)
    setLoadingDetail(true)
    try {
      const detail = await fetchPluginVersionDetail(slug, ver)
      setVersionDetail(detail)
    } catch (err: any) {
      toast.error(err?.message || '获取版本快照失败')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleCopyChecksum = async (checksum: string) => {
    const res = await copyText(checksum)
    if (res.ok) {
      setCopiedHash(checksum)
      toast.success('SHA-256 完整哈希已复制到剪贴板')
      setTimeout(() => setCopiedHash(null), 2000)
    } else {
      toast.error('复制失败', { description: res.reason })
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">
        <History className="h-5 w-5 animate-spin mx-auto mb-2 text-muted-foreground" />
        加载版本历史记录中...
      </div>
    )
  }

  if (versions.length === 0) {
    // 加载失败 ≠ 首发版本：notice 非空时渲染失败态（带重试）
    if (notice) {
      return (
        <div className="space-y-3">
          <HubDegradedNotice notice={notice} onRetry={() => void loadVersions()} />
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            未能加载版本历史，可能是网络或中枢服务问题；重试后仍失败请稍后再来。
          </p>
        </div>
      )
    }
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground bg-card/30">
        <History className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
        <p className="font-medium text-foreground">暂无历史版本记录</p>
        <p className="mt-1">该插件由种子数据初始化或当前为首发版本 (v{currentVersion})。</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          版本演进时间轴 ({versions.length})
        </h4>
        <span className="text-[11px] text-muted-foreground">
          所有版本清单均经 SHA-256 签名存证
        </span>
      </div>

      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
        {versions.map((v) => {
          const isCurrent = v.version === currentVersion
          const isExpanded = selectedVersion === v.version

          return (
            <div key={v.id} className="relative group">
              {/* 时间轴节点图标 */}
              <div
                className={`absolute -left-6 top-1 flex h-5 w-5 items-center justify-center rounded-full border bg-background transition-colors ${
                  isCurrent
                    ? 'border-primary text-primary shadow-sm'
                    : 'border-border text-muted-foreground group-hover:border-primary/50'
                }`}
              >
                <GitCommit className="h-3 w-3" />
              </div>

              {/* 版本卡片 */}
              <div
                className={`rounded-xl border p-4 transition-all duration-200 ${
                  isExpanded
                    ? 'border-primary/40 bg-card shadow-sm'
                    : 'border-border/60 bg-card/60 hover:bg-card hover:border-border'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">
                      v{v.version}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        当前最新上架
                      </span>
                    )}
                    {installedVersion === v.version && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                        已安装
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(v.publishedAt).toLocaleDateString()}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyChecksum(v.checksum)}
                      title="点击复制完整哈希校验值"
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/70 hover:bg-muted text-muted-foreground flex items-center gap-1 transition-colors"
                    >
                      <ShieldCheck className="h-3 w-3 text-emerald-500" />
                      {v.checksum.slice(0, 10)}...
                      {copiedHash === v.checksum ? (
                        <Check className="h-2.5 w-2.5 text-emerald-700 dark:text-emerald-400" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Changelog */}
                {v.changelog ? (
                  <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {v.changelog}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground italic">
                    发布者未附带版本更新说明
                  </p>
                )}

                                {/* 查看详情与版本回滚/安装 */}
                <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleInspect(v.version)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <FileCode className="h-3.5 w-3.5 mr-1" />
                      {isExpanded ? '收起快照' : '查看清单差异'}
                      <ChevronRight
                        className={`h-3.5 w-3.5 ml-1 transition-transform ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      />
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={installingVersion === v.version}
                      onClick={() => handleInstallVersion(v.version)}
                      className="h-7 px-2 text-xs text-primary hover:bg-primary/5 border-primary/30"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      {installingVersion === v.version
                        ? '处理中...'
                        : installedVersion === v.version
                        ? '重装此版本'
                        : installedVersion && comparePluginVersions(v.version, installedVersion) < 0
                        ? '回滚到此版本'
                        : '安装此版本'}
                    </Button>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    ID: {v.id.slice(0, 8)}
                  </span>
                </div>

                {/* 展开的清单对比抽屉 */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border/60 space-y-3 animate-in fade-in duration-150">
                    {loadingDetail ? (
                      <p className="text-xs text-muted-foreground">正在加载快照差异数据...</p>
                    ) : versionDetail ? (
                      <div className="space-y-3">
                        <div className="rounded-lg bg-muted/30 p-3 border border-border/50">
                          <h5 className="text-xs font-medium text-foreground mb-1.5">
                            与当前上架版本 (v{currentVersion}) 相比变动：
                          </h5>
                          <PluginDiffView diff={versionDetail.diffAgainstCurrent} />
                        </div>

                        <div>
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer font-medium hover:text-foreground">
                              展开完整清单 JSON 快照
                            </summary>
                            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-background p-3 text-[11px] font-mono text-foreground border border-border/50">
                              {JSON.stringify(versionDetail.manifest, null, 2)}
                            </pre>
                          </details>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-destructive-text">快照数据读取失败</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
