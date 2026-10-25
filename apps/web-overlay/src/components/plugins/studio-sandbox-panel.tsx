/**
 * AI 工坊「实时沙箱预览」面板（第五批 A3.2）。
 * 从 ai-plugin-studio-modal.tsx 拆出：JSX 原样搬运，状态与处理器仍归壳，
 * props 透传且标识符同名。行为由 e2e/plugin-studio.spec.ts 与
 * e2e/plugin-market.spec.ts 锁定。
 */
'use client'

import { ExternalLink, Globe, Palette, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'
import { safeHref } from '@/lib/safe-url'
import type { PluginManifest, SearchPackPayload, SitePackPayload, ThemePayload, WorkspacePresetPayload } from '@/lib/plugins/plugin-manifest'

export interface StudioSandboxPanelProps {
  manifest: PluginManifest
  generating: boolean
  liveThemeActive: boolean
  setLiveThemeActive: (v: boolean) => void
  searchTestQuery: string
  setSearchTestQuery: (v: string) => void
  selectedEngineIndex: number
  setSelectedEngineIndex: (v: number) => void
  sitePackCategoryFilter: string
  setSitePackCategoryFilter: (v: string) => void
}

export function StudioSandboxPanel(props: StudioSandboxPanelProps) {
  const {
    manifest,
    generating,
    liveThemeActive,
    setLiveThemeActive,
    searchTestQuery,
    setSearchTestQuery,
    selectedEngineIndex,
    setSelectedEngineIndex,
    sitePackCategoryFilter,
    setSitePackCategoryFilter,
  } = props
  void generating
  return (
    <>
              <div className="space-y-5">
                {/* 插件头部展示卡 */}
                <div className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl p-2 rounded-xl bg-muted/50 border border-border/80">
                        {manifest.icon || '📦'}
                      </span>
                      <div>
                        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                          <span>{manifest.name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {manifest.kind}
                          </Badge>
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {manifest.description}
                        </p>
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-muted-foreground">
                      <div>作者：{manifest.author}</div>
                      <div>许可证：{manifest.license || 'MIT'}</div>
                    </div>
                  </div>

                  {manifest.tags && manifest.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {manifest.tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 1. site-pack 网址包真实卡片网格 */}
                {manifest.kind === 'site-pack' && (() => {
                  const payload = manifest.payload as SitePackPayload
                  const sites = payload.sites || []
                  const categories = payload.categories || []
                  const displaySites =
                    sitePackCategoryFilter === 'all'
                      ? sites
                      : sites.filter((s) => s.category === sitePackCategoryFilter)

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                        <span>包含站点清单 ({sites.length} 个)</span>
                        <span>支持点击直达外链体验</span>
                      </div>

                      {/* 分类快捷筛选 Pills */}
                      {categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pb-0.5">
                          <button
                            type="button"
                            onClick={() => setSitePackCategoryFilter('all')}
                            className={cn(
                              'text-[11px] px-2.5 py-0.5 rounded-full border transition-all cursor-pointer',
                              sitePackCategoryFilter === 'all'
                                ? 'bg-primary text-primary-foreground border-primary font-medium shadow-2xs'
                                : 'bg-muted/50 text-muted-foreground hover:text-foreground border-border/60'
                            )}
                          >
                            全部 ({sites.length})
                          </button>
                          {categories.map((c, ci) => {
                            const count = sites.filter((s) => s.category === c.title).length
                            return (
                              <button
                                key={ci}
                                type="button"
                                onClick={() => setSitePackCategoryFilter(c.title)}
                                className={cn(
                                  'text-[11px] px-2.5 py-0.5 rounded-full border transition-all cursor-pointer',
                                  sitePackCategoryFilter === c.title
                                    ? 'bg-primary text-primary-foreground border-primary font-medium shadow-2xs'
                                    : 'bg-muted/50 text-muted-foreground hover:text-foreground border-border/60'
                                )}
                              >
                                {c.title} ({count})
                              </button>
                            )
                          })}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {displaySites.map((site, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-xl border border-border bg-card/60 hover:border-primary/40 hover:shadow-md transition-all flex flex-col justify-between gap-2"
                          >
                            <div>
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                  <Globe className="h-3.5 w-3.5 text-primary" />
                                  <span>{site.title}</span>
                                </h4>
                                {site.category && (
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                    {site.category}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                                {site.description || '实用网络工具与服务'}
                              </p>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px]">
                              <a
                                href={safeHref(site.url)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline flex items-center gap-1 font-mono truncate max-w-[200px]"
                              >
                                <span>{site.url.replace(/^https?:\/\//, '')}</span>
                                <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                              </a>
                              {site.tags && site.tags.length > 0 && (
                                <div className="flex gap-1">
                                  {site.tags.slice(0, 2).map((t, ti) => (
                                    <span key={ti} className="text-muted-foreground/80">
                                      #{t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* 2. theme 外观主题试衣间 */}
                {manifest.kind === 'theme' && (() => {
                  const payload = manifest.payload as ThemePayload
                  const accent = payload.accent || 'violet'
                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                        <span>主题色卡与实时控件样例预览</span>
                        <Button
                          size="sm"
                          variant={liveThemeActive ? 'default' : 'outline'}
                          onClick={() => setLiveThemeActive(!liveThemeActive)}
                          className="h-7 text-xs gap-1.5 cursor-pointer"
                        >
                          <Palette className="h-3.5 w-3.5" />
                          <span>{liveThemeActive ? '✓ 正在试穿此皮肤 (点击还原)' : '👗 工坊即时试穿此皮肤'}</span>
                        </Button>
                      </div>
                      <div
                        className="p-5 rounded-2xl border border-border bg-card space-y-4 transition-all duration-300"
                        style={liveThemeActive && payload.tokens ? (payload.tokens as unknown as React.CSSProperties) : undefined}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium">主强调色 (Accent)：</span>
                            <Badge className="capitalize font-mono px-2.5 py-1 text-xs">
                              {accent}
                            </Badge>
                          </div>
                          {payload.tokens?.['--radius'] && (
                            <span className="text-xs text-muted-foreground font-mono">
                              圆角设定：{payload.tokens['--radius']}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-2">
                          <div className="p-3 rounded-xl border border-border bg-background space-y-2">
                            <span className="text-[11px] font-medium text-muted-foreground">按钮样例</span>
                            <div className="flex gap-2">
                              <Button size="sm" className="h-7 text-xs">
                                主要操作
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs">
                                次要按钮
                              </Button>
                            </div>
                          </div>

                          <div className="p-3 rounded-xl border border-border bg-background space-y-2">
                            <span className="text-[11px] font-medium text-muted-foreground">输入框与徽章</span>
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <Input readOnly value="样例输入框效果" aria-label="主题预览样例输入框" className="h-7 text-xs" />
                              <Badge variant="secondary" className="h-7 px-2">Tag</Badge>
                            </div>
                          </div>
                        </div>

                        {payload.tokens && (
                          <div className="text-[11px] font-mono text-muted-foreground bg-muted/40 p-2 rounded-lg">
                            CSS Tokens: {JSON.stringify(payload.tokens)}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* 3. search-pack 多引擎搜索栏交互 */}
                {manifest.kind === 'search-pack' && (() => {
                  const payload = manifest.payload as SearchPackPayload
                  const engines = payload.engines || []
                  // 检测用户是否在前缀中直接输入了快捷指令 (例如 !gh react 或 @bilibili vue)
                  const matchedEngineIndex = engines.findIndex(
                    (eng) => eng.prefix && searchTestQuery.trim().toLowerCase().startsWith(eng.prefix.toLowerCase() + ' ')
                  )
                  const activeEngineIdx = matchedEngineIndex !== -1
                    ? matchedEngineIndex
                    : (selectedEngineIndex < engines.length ? selectedEngineIndex : 0)
                  const currentEngine = engines[activeEngineIdx] || engines[0]
                  const actualQuery = matchedEngineIndex !== -1
                    ? searchTestQuery.trim().slice(engines[matchedEngineIndex].prefix.length).trim()
                    : searchTestQuery
                  const previewUrl = currentEngine
                    ? currentEngine.searchUrl.replace(/\{q\}/g, encodeURIComponent(actualQuery || 'navhub'))
                    : ''

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-semibold">多引擎聚合搜索栏交互测试</span>
                        {matchedEngineIndex !== -1 && (
                          <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                            ⚡ 自动识别前缀指令 [{engines[matchedEngineIndex].prefix}]
                          </Badge>
                        )}
                      </div>
                      <div className="p-5 rounded-2xl border border-border bg-card space-y-3 shadow-sm">
                        {/* 引擎切换 Chips */}
                        <div className="flex flex-wrap gap-1.5">
                          {engines.map((eng, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setSelectedEngineIndex(idx)}
                              className={cn(
                                'text-xs px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5',
                                activeEngineIdx === idx
                                  ? 'bg-primary text-primary-foreground border-primary shadow-sm font-medium'
                                  : 'bg-background hover:bg-muted text-foreground border-border'
                              )}
                            >
                              <span>{eng.icon || '🔍'}</span>
                              <span>{eng.name}</span>
                              <span className="text-[10px] opacity-70 font-mono">{eng.prefix}</span>
                            </button>
                          ))}
                        </div>

                        {/* 搜索测试输入 */}
                        <div className="relative">
                          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-2.5" />
                          <Input
                            id="ai-studio-search-test-query"
                            aria-label="实时验证搜索 URL 占位符关键词"
                            value={searchTestQuery}
                            onChange={(e) => setSearchTestQuery(e.target.value)}
                            placeholder={`支持前缀触发 (如: ${engines[0]?.prefix || '!gh'} react) 或直接输入关键词...`}
                            className="pl-9 h-9 text-xs"
                          />
                        </div>

                        {/* 实时生成的跳转目标 */}
                        <div className="text-[11px] p-2.5 rounded-lg bg-muted/60 border border-border flex items-center justify-between">
                          <div className="truncate mr-2 font-mono text-muted-foreground">
                            <span>跳转目标：</span>
                            <span className="text-primary">{previewUrl}</span>
                          </div>
                          <a
                            href={safeHref(previewUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline flex items-center gap-1 font-medium whitespace-nowrap"
                          >
                            <span>试跳</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* 4. workspace-preset 工作台预设 */}
                {manifest.kind === 'workspace-preset' && (() => {
                  const payload = manifest.payload as WorkspacePresetPayload
                  const boards = payload.boards || []
                  return (
                    <div className="space-y-4">
                      <div className="text-xs font-semibold text-muted-foreground">
                        工作台看板与微组件排布
                      </div>
                      {boards.map((b, bi) => (
                        <div key={bi} className="p-4 rounded-xl border border-border bg-card space-y-3">
                          <h4 className="text-xs font-bold text-foreground">看板：{b.name}</h4>
                          <div className="grid grid-cols-12 gap-2">
                            {b.widgets.map((w, wi) => (
                              <div
                                key={wi}
                                style={{ gridColumn: `span ${w.colSpan || 4}` }}
                                className="p-3 rounded-lg border border-border/80 bg-background/80 text-xs space-y-1"
                              >
                                <div className="font-semibold text-primary">{w.customTitle || w.type}</div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {w.colSpan}列 × {w.rowSpan}行
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
    </>
  )
}
