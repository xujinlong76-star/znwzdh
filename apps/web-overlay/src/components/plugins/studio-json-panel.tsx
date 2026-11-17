/**
 * AI 工坊「声明式 JSON / 版本演进 Diff」面板（第五批 A3.2）。
 * 拆分说明同 sandbox 面板；diff 计算已抽到 lib/plugins/studio-derived（可单测）。
 */
'use client'

import { Check, CheckCircle2, Code2, Copy, GitCompare, Minus, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'
import type { PluginManifest } from '@/lib/plugins/plugin-manifest'
import { toast } from 'sonner'

import { copyFailureToast, copyText } from '@/lib/clipboard'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import type { ManifestDiff } from '@/lib/plugins/studio-derived'

export interface StudioJsonPanelProps {
  manifest: PluginManifest
  manifestDiff: ManifestDiff | null
  previousManifest: PluginManifest | null
  activeJsonSubTab: 'source' | 'diff'
  setActiveJsonSubTab: (v: 'source' | 'diff') => void
  generating: boolean
}

export function StudioJsonPanel(props: StudioJsonPanelProps) {
  const {
    manifest,
    manifestDiff,
    previousManifest,
    activeJsonSubTab,
    setActiveJsonSubTab,
    generating,
  } = props
  void generating
  // Phase 2 批 C：复制反馈复用 use-copy-feedback——按钮文案同步变（已复制/复制失败），
  // 失败原因回到按钮 title 与 sr-only，toast 只作第二通道（不能是唯一通道）。
  const jsonCopy = useCopyFeedback()
  return (
    <>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
                  <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setActiveJsonSubTab('source')}
                      className={cn(
                        'px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5',
                        activeJsonSubTab === 'source'
                          ? 'bg-background text-foreground shadow-xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      <span>清单源码 (JSON)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveJsonSubTab('diff')}
                      className={cn(
                        'px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5',
                        activeJsonSubTab === 'diff'
                          ? 'bg-background text-foreground shadow-xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <GitCompare className="h-3.5 w-3.5" />
                      <span>版本演进对比 (Diff)</span>
                      {manifestDiff?.hasChanges && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      )}
                    </button>
                  </div>

                  {activeJsonSubTab === 'source' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={
                        jsonCopy.copyFeedback.state === 'copied'
                          ? '清单 JSON 已复制'
                          : jsonCopy.copyFeedback.state === 'failed'
                            ? '清单 JSON 复制失败'
                            : '复制清单 JSON'
                      }
                      title={
                        jsonCopy.copyFeedback.state === 'failed'
                          ? `复制失败：${jsonCopy.copyFeedback.reason}`
                          : '复制清单 JSON'
                      }
                      onClick={async () => {
                        const result = await copyText(JSON.stringify(manifest, null, 2))
                        jsonCopy.reportCopy(result)
                        if (result.ok) toast.success('已复制清单 JSON')
                        else {
                          const failure = copyFailureToast(result)
                          toast.error(failure.title, { description: failure.description })
                        }
                      }}
                      className="h-7 text-xs gap-1"
                    >
                      {jsonCopy.copyFeedback.state === 'copied' ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>已复制</span>
                        </>
                      ) : jsonCopy.copyFeedback.state === 'failed' ? (
                        <>
                          <X className="h-3 w-3" />
                          <span>复制失败</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>复制 JSON</span>
                        </>
                      )}
                      <span role="status" className="sr-only">
                        {jsonCopy.copyFeedback.reason ?? ''}
                      </span>
                    </Button>
                  ) : (
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {previousManifest ? `对比: v${previousManifest.version} ➔ v${manifest.version}` : '首次生成版本'}
                    </div>
                  )}
                </div>

                {activeJsonSubTab === 'source' && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      100% 声明式清单规范 (PluginManifest Schema v1.0)
                    </div>
                    <pre className="p-4 rounded-xl border border-border bg-muted/40 font-mono text-[11px] leading-relaxed text-foreground overflow-x-auto max-h-[500px]">
                      {JSON.stringify(manifest, null, 2)}
                    </pre>
                  </div>
                )}

                {activeJsonSubTab === 'diff' && (
                  <div className="space-y-3">
                    {!previousManifest ? (
                      <div className="p-6 rounded-2xl border border-dashed border-border text-center space-y-2 bg-muted/20">
                        <GitCompare className="h-8 w-8 mx-auto text-muted-foreground" />
                        <div className="text-xs font-bold text-foreground">
                          当前为首个生成版本 (v{manifest.version})
                        </div>
                        <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
                          当您在工坊右下角进行自然语言增量补充（例如“追加 2 个 AI 工具”）、编辑元数据或执行 AI 一键智能修复后，此处将自动为您精确比对出实体与属性的增删改动差量！
                        </p>
                      </div>
                    ) : !manifestDiff!.hasChanges ? (
                      <div className="p-6 rounded-2xl border border-dashed border-border text-center space-y-2 bg-muted/20">
                        <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500" />
                        <div className="text-xs font-bold text-foreground">
                          清单内容与上一版本一致（无实体增删差异）
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* 变更汇总统计卡片 */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {manifestDiff!.versionChange && (
                            <div className="p-2.5 rounded-xl border border-primary/20 bg-primary/5 text-xs">
                              <span className="text-[10px] text-muted-foreground block">版本递增</span>
                              <span className="font-mono font-bold text-primary">
                                {manifestDiff!.versionChange!.from} ➔ {manifestDiff!.versionChange!.to}
                              </span>
                            </div>
                          )}
                          {manifestDiff!.addedSites.length > 0 && (
                            <div className="p-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs">
                              <span className="text-[10px] text-muted-foreground block">新增站点实体</span>
                              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                +{manifestDiff!.addedSites.length} 个
                              </span>
                            </div>
                          )}
                          {manifestDiff!.removedSites.length > 0 && (
                            <div className="p-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-xs">
                              <span className="text-[10px] text-muted-foreground block">移除站点实体</span>
                              <span className="font-mono font-bold text-rose-700 dark:text-rose-400">
                                -{manifestDiff!.removedSites.length} 个
                              </span>
                            </div>
                          )}
                          {manifestDiff!.addedEngines.length > 0 && (
                            <div className="p-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs">
                              <span className="text-[10px] text-muted-foreground block">新增搜索引擎</span>
                              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                +{manifestDiff!.addedEngines.length} 个
                              </span>
                            </div>
                          )}
                          {manifestDiff!.addedTags.length > 0 && (
                            <div className="p-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5 text-xs">
                              <span className="text-[10px] text-muted-foreground block">新增标签</span>
                              <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                                +{manifestDiff!.addedTags.length} 个
                              </span>
                            </div>
                          )}
                        </div>

                        {/* 详细增删列表 */}
                        <div className="space-y-2">
                          {manifestDiff!.addedSites.map((site, sIdx) => (
                            <div
                              key={sIdx}
                              className="p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex items-start justify-between text-xs"
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                  <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] px-1.5 py-0 h-4 flex items-center gap-0.5">
                                    <Plus className="h-2.5 w-2.5" /> 新增
                                  </Badge>
                                  <span className="font-semibold text-foreground">{site.title}</span>
                                  {site.category && (
                                    <span className="text-[10px] text-muted-foreground font-medium">
                                      [{site.category}]
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[450px]">
                                  {site.url}
                                </div>
                              </div>
                              <span className="text-emerald-700 dark:text-emerald-400 font-mono text-[11px] font-medium">+1 site</span>
                            </div>
                          ))}

                          {manifestDiff!.removedSites.map((site, sIdx) => (
                            <div
                              key={sIdx}
                              className="p-2.5 rounded-xl border border-rose-500/30 bg-rose-500/5 flex items-start justify-between text-xs opacity-75"
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 flex items-center gap-0.5">
                                    <Minus className="h-2.5 w-2.5" /> 移除
                                  </Badge>
                                  <span className="line-through text-muted-foreground">{site.title}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground line-through font-mono truncate max-w-[450px]">
                                  {site.url}
                                </div>
                              </div>
                              <span className="text-rose-700 dark:text-rose-400 font-mono text-[11px] font-medium">-1 site</span>
                            </div>
                          ))}

                          {manifestDiff!.addedEngines.map((eng, eIdx) => (
                            <div
                              key={eIdx}
                              className="p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 flex items-start justify-between text-xs"
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                  <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] px-1.5 py-0 h-4">
                                    + 引擎
                                  </Badge>
                                  <span className="font-semibold text-foreground">{eng.name}</span>
                                  <span className="text-[10px] font-mono text-muted-foreground">{eng.prefix}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[450px]">
                                  {eng.searchUrl}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
    </>
  )
}
