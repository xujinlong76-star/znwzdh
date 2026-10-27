/**
 * 插件详情页的六个 tab 面板（preview / diff / impact / raw / history / reviews）。
 * 从 plugin-detail-view.tsx 拆出（第五批 A3.1）：JSX 与交互原样搬运，状态与
 * 处理器仍归壳，props 透传且标识符与壳内同名，保证行为零漂移。
 * 行为由 e2e/plugin-market.spec.ts 七例全链路锁定。
 */
'use client'

import { useState } from 'react'

import { AlertTriangle, Boxes, Copy, ExternalLink, Globe, LayoutGrid, Palette, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { safeHref, safeWindowOpen } from '@/lib/safe-url'
import { PluginDiffView } from '@/components/plugins/plugin-diff-view'
import { PluginReviewSection } from '@/components/plugins/plugin-review-section'
import { PluginVersionTimeline } from '@/components/plugins/plugin-version-timeline'
import type { HubPluginItem } from '@/lib/navhub-api'
import { pluginKindLabel, PLUGIN_MANIFEST_FILE_SUFFIX } from '@/lib/plugins/plugin-manifest'
import { KIND_ICONS, KIND_TONES } from '@/lib/plugins/kind-meta'
import type { DetailTab } from './detail-shared'

/**
 * 引擎图标有两种合法形态：图片 URL（http(s)/站内绝对路径/data:image）或 emoji 短文本
 * （种子数据里的搜索引擎包全部用 emoji，见 packages/core 的清单契约：icon ≤8 字符、禁远程地址）。
 *
 * 历史 bug：直接把 emoji 塞进 `<img src>`，浏览器会按**当前路径**解析成相对地址，
 * 于是在 `/marketplace/code-and-package-search-pack` 上产生
 * `/marketplace/%F0%9F%94%8E` 之类的请求并 404（一次详情页 6 条）。
 */
function isImageIcon(value: string): boolean {
  const v = value.trim()
  return /^(https?:\/\/|\/|data:image\/|blob:)/i.test(v)
}
import type { useCopyFeedback } from '@/hooks/use-copy-feedback'

/* eslint-disable @typescript-eslint/no-explicit-any -- 壳里 summary/manifest/payload 本就是 any（hub 聚合形状逐版本演进），拆分不做形状收紧 */
export interface DetailTabPanelsProps {
  activeTab: DetailTab
  plugin: HubPluginItem
  summary: any
  bundleTotals: any
  payload: any
  rawCopy: ReturnType<typeof useCopyFeedback>
  handleCopyRaw: () => void
}

export function DetailTabPanels(props: DetailTabPanelsProps) {
  const {
    activeTab,
    plugin,
    summary,
    bundleTotals,
    payload,
    rawCopy,
    handleCopyRaw,
  } = props
  const [testSearchQuery, setTestSearchQuery] = useState('山羊胡')
  return (
    <>
          {activeTab === 'preview' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-preview"
              aria-labelledby="plugin-tab-preview"
              className="space-y-6"
            >
              {/* site-pack 网址包明细展示 */}
              {plugin.kind === 'site-pack' && payload?.sites && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Globe className="w-4 h-4 text-sky-500" />
                      <span>包含站点列表 ({payload.sites.length})</span>
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      包含 {payload.categories?.length ?? 0} 个类目
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {payload.sites.map((site: any, idx: number) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2 hover:border-border transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-xs text-foreground truncate">
                            {site.title}
                          </span>
                          {site.category && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                              {site.category}
                            </span>
                          )}
                        </div>
                        <a
                          href={safeHref(site.url)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline truncate block"
                        >
                          {site.url}
                        </a>
                        {site.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-2">
                            {site.description}
                          </p>
                        )}
                        {site.tags && site.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {site.tags.map((t: string) => (
                              <span
                                key={t}
                                className="text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* workspace-preset 看板预设明细展示与 Bento 沙箱 */}
              {plugin.kind === 'workspace-preset' && payload?.boards && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4 text-emerald-500" />
                      <span>预设看板结构与 Bento 空间预览 ({payload.boards.length})</span>
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      基于 12 栅格真实布局比例
                    </span>
                  </div>
                  <div className="space-y-5">
                    {payload.boards.map((b: any, bIdx: number) => (
                      <div
                        key={bIdx}
                        className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-xs text-foreground">{b.name}</h4>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {b.widgets?.length ?? 0} 个小组件
                          </span>
                        </div>

                        {/* 交互式 Mini Bento 沙箱网格 */}
                        <div className="grid grid-cols-12 gap-2.5 p-3.5 rounded-xl bg-muted/20 border border-border/50">
                          {b.widgets?.map((w: any, wIdx: number) => {
                            const colSpan = Math.min(12, Math.max(1, w.colSpan ?? 4))
                            const colClass =
                              colSpan >= 12
                                ? 'col-span-12'
                                : colSpan >= 8
                                ? 'col-span-12 sm:col-span-8'
                                : colSpan >= 6
                                ? 'col-span-12 sm:col-span-6'
                                : colSpan >= 4
                                ? 'col-span-6 sm:col-span-4'
                                : 'col-span-6 sm:col-span-3'

                            return (
                              <div
                                key={wIdx}
                                className={cn(
                                  colClass,
                                  'rounded-xl border border-border/60 bg-background/80 p-3 text-xs space-y-2 shadow-2xs hover:border-emerald-500/50 transition-colors'
                                )}
                              >
                                <div className="flex items-center justify-between text-muted-foreground">
                                  <span className="font-semibold text-foreground truncate">
                                    {w.title || w.type}
                                  </span>
                                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-muted">
                                    {w.type}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                  <span className="px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono">
                                    {colSpan} 列
                                  </span>
                                  <span>×</span>
                                  <span className="px-1 py-0.5 rounded bg-muted font-mono">
                                    {w.rowSpan ?? 1} 行
                                  </span>
                                </div>
                                <div className="h-6 rounded-md bg-muted/40 border border-border/30 flex items-center justify-center text-[10px] text-muted-foreground/60 font-mono">
                                  Mini Bento Preview
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* theme 主题调色板展示 */}
              {plugin.kind === 'theme' && payload && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Palette className="w-4 h-4 text-violet-500" />
                      <span>主题色板与变量定义</span>
                    </h3>
                    {payload.accent && (
                      <Badge variant="outline" className="text-xs">
                        强调色系: {payload.accent}
                      </Badge>
                    )}
                  </div>

                  {payload.tokens && Object.keys(payload.tokens).length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {Object.entries(payload.tokens).map(([k, v]) => (
                        <div
                          key={k}
                          className="rounded-xl border border-border/60 bg-card/60 p-3.5 space-y-2 flex items-center justify-between"
                        >
                          <div className="space-y-0.5">
                            <span className="font-mono text-xs text-foreground block">{k}</span>
                            <span className="font-mono text-[10px] text-muted-foreground block">
                              hsl({String(v)})
                            </span>
                          </div>
                          <div
                            className="w-8 h-8 rounded-lg border border-border/80 shadow-2xs shrink-0"
                            style={{ backgroundColor: `hsl(${String(v)})` }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">未覆盖任何自定义色彩变量</p>
                  )}
                </div>
              )}

              {/* search-pack 搜索引擎配置展示 */}
              {plugin.kind === 'search-pack' && payload?.engines && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Search className="w-4 h-4 text-sky-500" />
                      <span>包含的快捷搜索引擎 ({payload.engines.length})</span>
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground hidden sm:inline">试用测试词:</span>
                      <input
                        type="text"
                        aria-label="试用搜索词"
                        value={testSearchQuery}
                        onChange={(e) => setTestSearchQuery(e.target.value)}
                        placeholder="输入搜索词测试跳转..."
                        className="h-7 px-2.5 rounded-lg border border-border/60 bg-background text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary w-40"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {payload.engines.map((eng: any) => (
                      <div
                        key={eng.prefix}
                        className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-2 hover:border-border transition-all"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {eng.icon && (isImageIcon(eng.icon) ? (
                              <img
                                src={eng.icon}
                                alt={eng.name}
                                width={16}
                                height={16}
                                loading="lazy"
                                decoding="async"
                                className="w-4 h-4 rounded-xs shrink-0 object-contain"
                                onError={(e) => { (e.target as HTMLElement).style.display = 'none' }}
                              />
                            ) : (
                              <span
                                aria-hidden="true"
                                className="w-4 shrink-0 text-center text-sm leading-none"
                              >
                                {eng.icon}
                              </span>
                            ))}
                            <span className="text-sm font-semibold text-foreground truncate">
                              {eng.name}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                            {eng.prefix}
                          </span>
                        </div>
                        {eng.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {eng.description}
                          </p>
                        )}
                        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-xs">
                          <code className="text-[11px] text-muted-foreground font-mono truncate max-w-[200px]">
                            {eng.searchUrl}
                          </code>
                          <button
                            type="button"
                            onClick={() => safeWindowOpen(eng.searchUrl.replace('{q}', encodeURIComponent(testSearchQuery || '山羊胡')))}
                            className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0 font-medium"
                          >
                            测试直达 <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* bundle 组合包成员清单 */}
              {plugin.kind === 'bundle' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Boxes className="w-4 h-4 text-amber-500" />
                      <span>
                        组合包成员 ({summary?.bundleItemCount ?? plugin.bundleItems?.length ?? 0})
                      </span>
                    </h3>
                    <span className="text-xs text-muted-foreground">一次安装，按清单顺序复用市场安装管道</span>
                  </div>

                  {plugin.bundleReady === false && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2 text-xs text-destructive">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        部分成员当前不可用（下架/隔离/删除或类型变更），组合包已暂停安装；卸载仅解除组合关系，不会级联移除成员。
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(plugin.bundleItems ?? []).map((item) => {
                      const MemberIcon = (KIND_ICONS as Record<string, typeof Boxes>)[item.kind] ?? Boxes
                      const memberTone = (KIND_TONES as Record<string, string>)[item.kind] ?? ''
                      const metric = item.summary
                        ? item.kind === 'site-pack'
                          ? `${item.summary.siteCount ?? 0} 个站点 · ${item.summary.categoryCount ?? 0} 个类目`
                          : item.kind === 'search-pack'
                            ? `${item.summary.engineCount ?? 0} 个搜索引擎`
                            : `${item.summary.themeTokenCount ?? 0} 项主题变量`
                        : null
                      const body = (
                        <>
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {item.icon ? (
                                <span className="text-lg shrink-0">{item.icon}</span>
                              ) : (
                                <MemberIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                              )}
                              <span className="text-sm font-semibold text-foreground truncate">
                                {item.name ?? item.slug}
                              </span>
                            </div>
                            <Badge variant="outline" className={cn('text-[10px] shrink-0', memberTone)}>
                              {pluginKindLabel(item.kind as Parameters<typeof pluginKindLabel>[0])}
                            </Badge>
                          </div>
                          {item.available ? (
                            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span className="truncate">{metric}</span>
                              <span className="font-mono shrink-0">v{item.version}</span>
                            </div>
                          ) : (
                            <p className="text-[11px] text-destructive flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>{item.reason ?? '当前不可用'}</span>
                            </p>
                          )}
                        </>
                      )
                      return item.available ? (
                        <Link
                          key={item.slug}
                          href={`/marketplace/${encodeURIComponent(item.slug)}`}
                          className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-2 hover:border-primary/40 hover:bg-card transition-all"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div
                          key={item.slug}
                          className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-2"
                        >
                          {body}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 选项卡：版本变更对比 */}
          {activeTab === 'diff' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-diff"
              aria-labelledby="plugin-tab-diff"
              className="rounded-3xl border border-border/80 glass-surface p-6 sm:p-8 space-y-4 shadow-xs"
            >
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">版本升级变动明细</h3>
                <p className="text-xs text-muted-foreground">
                  详细比对已安装版本与市场最新版本的站点、分类、小组件及主题样式调整。
                </p>
              </div>
              <PluginDiffView diff={plugin.upgradeDiff} />
            </div>
          )}

          {/* 选项卡 2：影响评估 */}
          {activeTab === 'impact' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-impact"
              aria-labelledby="plugin-tab-impact"
              className="rounded-2xl border border-border/70 bg-card/60 p-6 space-y-4"
            >
              <h3 className="text-sm font-semibold text-foreground">安装影响评估</h3>
              {plugin.kind === 'bundle' && bundleTotals ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {summary?.bundleItemCount ?? plugin.bundleItems?.length ?? 0}
                      </span>
                      <span className="text-xs text-muted-foreground">成员插件</span>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {bundleTotals.sites}
                      </span>
                      <span className="text-xs text-muted-foreground">新增站点（可用成员）</span>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {bundleTotals.engines}
                      </span>
                      <span className="text-xs text-muted-foreground">直达引擎（可用成员）</span>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                      <span className="text-xl font-bold text-foreground block font-mono">
                        {bundleTotals.tokens}
                      </span>
                      <span className="text-xs text-muted-foreground">主题变量（需手动启用）</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    组合包不包含可执行代码，也不做级联卸载：站点/搜索引擎按等价 URL 去重增量导入；主题类成员仅登记安装，
                    请在「已安装」页显式启用。
                  </p>
                </>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.siteCount ?? 0}
                  </span>
                  <span className="text-xs text-muted-foreground">新增站点</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.categoryCount ?? 0}
                  </span>
                  <span className="text-xs text-muted-foreground">新增分类</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.boardCount ?? (plugin.kind === 'workspace-preset' ? (Array.isArray(payload?.boards) ? payload.boards.length : 0) : 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">看板数量</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.themeTokenCount ?? (plugin.kind === 'theme' ? Object.keys(payload?.tokens || {}).length : 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">色彩变量</span>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                  <span className="text-xl font-bold text-foreground block font-mono">
                    {summary?.engineCount ?? (plugin.kind === 'search-pack' ? (payload?.engines?.length || 0) : 0)}
                  </span>
                  <span className="text-xs text-muted-foreground">直达引擎</span>
                </div>
              </div>
              )}

              {summary?.enginePrefixes && summary.enginePrefixes.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <h4 className="text-xs font-medium text-foreground">包含的直达前缀：</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.enginePrefixes.map((p: string) => (
                      <span
                        key={p}
                        className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {summary?.hosts && summary.hosts.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <h4 className="text-xs font-medium text-foreground">主要站点域名：</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.hosts.map((h: string) => (
                      <span
                        key={h}
                        className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 选项卡 3：清单源码 */}
          {activeTab === 'raw' && (
            <div
              role="tabpanel"
              id="plugin-tabpanel-raw"
              aria-labelledby="plugin-tab-raw"
              className="relative rounded-2xl border border-border/70 bg-card/60 p-4 space-y-2"
            >
              <div className="flex items-center justify-between pb-2 border-b border-border/50">
                <span className="text-xs font-mono text-muted-foreground">
                  {plugin.slug}{PLUGIN_MANIFEST_FILE_SUFFIX}
                </span>
                <button
                  type="button"
                  onClick={handleCopyRaw}
                  aria-label={
                    rawCopy.copyFeedback.state === 'copied'
                      ? '插件 JSON 已复制'
                      : rawCopy.copyFeedback.state === 'failed'
                        ? '插件 JSON 复制失败'
                        : '复制插件 JSON'
                  }
                  title={
                    rawCopy.copyFeedback.state === 'failed'
                      ? `复制失败：${rawCopy.copyFeedback.reason}`
                      : '复制插件 JSON'
                  }
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border/60 hover:bg-muted text-foreground transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>
                    {rawCopy.copyFeedback.state === 'copied'
                      ? '已复制'
                      : rawCopy.copyFeedback.state === 'failed'
                        ? '复制失败'
                        : '复制代码'}
                  </span>
                  <span role="status" className="sr-only">
                    {rawCopy.copyFeedback.reason ?? ''}
                  </span>
                </button>
              </div>
              <pre className="text-xs font-mono text-foreground/90 overflow-x-auto p-2 leading-relaxed max-h-[500px]">
                {JSON.stringify(plugin.manifest, null, 2)}
              </pre>
            </div>
          )}

          {/* 选项卡 4：版本演进时间轴 */}
          {activeTab === 'history' && (
            <div role="tabpanel" id="plugin-tabpanel-history" aria-labelledby="plugin-tab-history">
              <PluginVersionTimeline slug={plugin.slug} currentVersion={plugin.version} />
            </div>
          )}

          {/* 选项卡 5：真实用户评价 */}
          {activeTab === 'reviews' && (
            <div role="tabpanel" id="plugin-tabpanel-reviews" aria-labelledby="plugin-tab-reviews">
            <PluginReviewSection
              slug={plugin.slug}
              isInstalled={Boolean(plugin.installed)}
              installedVersion={plugin.installedVersion}
              initialReviews={
                plugin.reviewStats
                  ? {
                      slug: plugin.slug,
                      stats: plugin.reviewStats,
                      myReview: plugin.myReview ?? null,
                      items: [],
                      total: plugin.reviewStats.reviewCount,
                      limit: 20,
                      offset: 0,
                    }
                  : null
              }
            />
            </div>
          )}
    </>
  )
}
