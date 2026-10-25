/**
 * 投稿发布页的步骤 1+2 表单面板（类型选择 + 元数据/组合包成员选择器）。
 *
 * 从 page.tsx 拆出（第五批 A3.3，按「步骤 1+2 先行」的修正方案——步骤 3 与
 * 表单尾部/包裹层闭合纠缠，注释界不自平衡，留壳）。两个步骤块是注释定界的
 * 完整兄弟节点，JSX 原样搬运，状态与处理器仍归壳，props 透传且标识符同名，
 * 保证行为零漂移。行为由 e2e/plugin-market.spec.ts（全链路 UI 驱动 + 组合包
 * 成员选择器 + NextGen 链路）与 e2e/plugin-studio.spec.ts（发布表单 → 工坊）锁定。
 */
'use client'

import { AlertCircle, Boxes, Check, Globe, LayoutGrid, Loader2, Palette, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  BUNDLE_KIND_LABELS,
  BUNDLE_MEMBER_KINDS,
  parseBundleSelection,
  type BundleCandidate,
  type BundleMemberKind,
} from '@/lib/plugins/bundle-builder'
import { PLUGIN_LIMITS, type PluginKind } from '@/lib/plugins/plugin-manifest'

export interface PublishIntroStepsProps {
  kind: PluginKind
  handleKindSelect: (k: PluginKind) => void
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  version: string
  setVersion: (v: string) => void
  author: string
  setAuthor: (v: string) => void
  license: string
  setLicense: (v: string) => void
  homepage: string
  setHomepage: (v: string) => void
  tagsInput: string
  setTagsInput: (v: string) => void
  bundleCandidates: BundleCandidate[]
  bundleCandidatesLoading: boolean
  bundleCandidatesError: boolean
  bundleQuery: string
  setBundleQuery: (v: string) => void
  bundleKindFilter: 'all' | BundleMemberKind
  setBundleKindFilter: (v: 'all' | BundleMemberKind) => void
  bundlePickerError: string | null
  bundleSelection: ReturnType<typeof parseBundleSelection>
  bundleFilteredCandidates: BundleCandidate[]
  bundleSelectedSlugs: Set<string>
  handleToggleBundleMember: (candidate: BundleCandidate) => void
  loadBundleCandidates: () => void
}

export function PublishIntroSteps(props: PublishIntroStepsProps) {
  const {
    kind, handleKindSelect,
    name, setName, description, setDescription, version, setVersion,
    author, setAuthor, license, setLicense, homepage, setHomepage,
    tagsInput, setTagsInput,
    bundleCandidates, bundleCandidatesLoading, bundleCandidatesError,
    bundleQuery, setBundleQuery, bundleKindFilter, setBundleKindFilter,
    bundlePickerError, bundleSelection, bundleFilteredCandidates,
    bundleSelectedSlugs, handleToggleBundleMember, loadBundleCandidates,
  } = props
  return (
    <>
            {/* 步骤 1: 选择插件类型 */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold text-foreground">
                第 1 步：选择插件类型
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <button
                  type="button"
                  onClick={() => handleKindSelect('site-pack')}
                  className={cn(
                    'p-4 rounded-2xl border text-left space-y-2 transition-all',
                    kind === 'site-pack'
                      ? 'border-sky-500 bg-sky-500/10 shadow-xs'
                      : 'border-border/70 hover:border-border hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-xs">
                    <Globe className="w-4 h-4" />
                    <span>网址包 (site-pack)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    分类导航与站点链接合集，一键增量入库并去重。
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleKindSelect('workspace-preset')}
                  className={cn(
                    'p-4 rounded-2xl border text-left space-y-2 transition-all',
                    kind === 'workspace-preset'
                      ? 'border-emerald-500 bg-emerald-500/10 shadow-xs'
                      : 'border-border/70 hover:border-border hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                    <LayoutGrid className="w-4 h-4" />
                    <span>工作台预设 (workspace-preset)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    多看板布局方案与小组件配置模板。
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleKindSelect('theme')}
                  className={cn(
                    'p-4 rounded-2xl border text-left space-y-2 transition-all',
                    kind === 'theme'
                      ? 'border-violet-500 bg-violet-500/10 shadow-xs'
                      : 'border-border/70 hover:border-border hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 font-semibold text-xs">
                    <Palette className="w-4 h-4" />
                    <span>配色主题 (theme)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    CSS 变量色彩定义与强调色，客户端实时渲染。
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleKindSelect('search-pack')}
                  className={cn(
                    'p-4 rounded-2xl border text-left space-y-2 transition-all',
                    kind === 'search-pack'
                      ? 'border-amber-500 bg-amber-500/10 shadow-xs'
                      : 'border-border/70 hover:border-border hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-xs">
                    <Search className="w-4 h-4" />
                    <span>搜索引擎包 (search-pack)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    包含 !前缀 快捷直达规则与检索 URL 占位符。
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleKindSelect('bundle')}
                  className={cn(
                    'p-4 rounded-2xl border text-left space-y-2 transition-all',
                    kind === 'bundle'
                      ? 'border-fuchsia-500 bg-fuchsia-500/10 shadow-xs'
                      : 'border-border/70 hover:border-border hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-center gap-2 text-fuchsia-600 dark:text-fuchsia-400 font-semibold text-xs">
                    <Boxes className="w-4 h-4" />
                    <span>组合包 (bundle)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    引用已上架的网址包/搜索引擎包/主题，一次安装；不支持嵌套与工作台预设。
                  </p>
                </button>
              </div>
            </div>

            {/* 步骤 2: 基本元数据表单 */}
            <div className="space-y-4 pt-2">
              <div className="text-xs font-semibold text-foreground">
                第 2 步：基础元数据
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="publish-plugin-name" className="text-xs font-medium text-foreground">
                    插件名称 <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="publish-plugin-name"
                    aria-label="插件名称"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="如：全栈开发者工具箱"
                    className="w-full text-base sm:text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                    maxLength={60}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="publish-plugin-version" className="text-xs font-medium text-foreground">
                    版本号 (SemVer) <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="publish-plugin-version"
                    aria-label="版本号"
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    className="w-full text-base sm:text-xs font-mono rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                    pattern="^\d{1,4}\.\d{1,4}\.\d{1,4}$"
                    required
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="publish-plugin-description" className="text-xs font-medium text-foreground">
                    详细描述 <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="publish-plugin-description"
                    aria-label="详细描述"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="用 1-2 句话阐明该插件包含的站点类型或设计特色…"
                    rows={2}
                    className="w-full text-base sm:text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 resize-none"
                    maxLength={500}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="publish-plugin-author" className="text-xs font-medium text-foreground">作者称谓</label>
                  <input
                    id="publish-plugin-author"
                    aria-label="作者称谓"
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="您的社区昵称或 GitHub ID"
                    className="w-full text-base sm:text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                    maxLength={60}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="publish-plugin-license" className="text-xs font-medium text-foreground">开源协议</label>
                  <input
                    id="publish-plugin-license"
                    aria-label="开源协议"
                    type="text"
                    value={license}
                    onChange={(e) => setLicense(e.target.value)}
                    placeholder="如：MIT、Apache-2.0"
                    className="w-full text-base sm:text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                    maxLength={40}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="publish-plugin-homepage" className="text-xs font-medium text-foreground">项目主页 (URL)</label>
                  <input
                    id="publish-plugin-homepage"
                    aria-label="项目主页"
                    type="url"
                    value={homepage}
                    onChange={(e) => setHomepage(e.target.value)}
                    placeholder="https://github.com/..."
                    className="w-full text-base sm:text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="publish-plugin-tags" className="text-xs font-medium text-foreground">标签 (逗号分隔)</label>
                  <input
                    id="publish-plugin-tags"
                    aria-label="标签"
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="工具, 效率, 编程"
                    className="w-full text-base sm:text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
            </div>

            {/* 步骤 3（组合包专属）: 成员选择器 */}
            {kind === 'bundle' && (
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Boxes className="w-4 h-4 text-fuchsia-500" />
                    <span>成员选择器（从已上架插件中拼装）</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    已选 {bundleSelection.items.length} / {PLUGIN_LIMITS.maxBundleItems}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  组合包只收纳「网址包 / 搜索引擎包 / 主题」三类成员，不支持嵌套组合包与工作台预设；
                  勾选结果会实时写入下方 payload JSON，也可手动微调。
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      aria-label="搜索候选成员"
                      value={bundleQuery}
                      onChange={(e) => setBundleQuery(e.target.value)}
                      placeholder="搜索名称 / slug / 描述…"
                      className="w-full text-base sm:text-xs rounded-xl border border-border/80 bg-background/80 pl-8 pr-3 py-2 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {(['all', ...BUNDLE_MEMBER_KINDS] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setBundleKindFilter(k)}
                        className={cn(
                          'px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors',
                          bundleKindFilter === k
                            ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                            : 'border-border/70 text-muted-foreground hover:bg-muted/50'
                        )}
                      >
                        {k === 'all' ? '全部' : BUNDLE_KIND_LABELS[k]}
                      </button>
                    ))}
                  </div>
                </div>

                {bundlePickerError && (
                  <p className="text-[11px] text-destructive flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{bundlePickerError}</span>
                  </p>
                )}
                {bundleSelection.dropped > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    手写 JSON 中有 {bundleSelection.dropped} 条非法 / 重复 / 超限成员未被选择器识别（提交前预检同样会拦截）。
                  </p>
                )}

                {/* 候选列表 */}
                <div className="rounded-2xl border border-border/80 bg-background/60 max-h-72 overflow-y-auto divide-y divide-border/50">
                  {bundleCandidatesLoading ? (
                    <div className="p-6 text-center text-xs text-muted-foreground space-y-2">
                      <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary" />
                      <p>正在载入已上架插件…</p>
                    </div>
                  ) : bundleCandidatesError ? (
                    <div className="p-6 text-center text-xs space-y-2">
                      <p className="text-destructive">候选列表载入失败（网络或服务暂不可用）。</p>
                      <button
                        type="button"
                        onClick={() => void loadBundleCandidates()}
                        className="px-3 py-1.5 rounded-lg border border-border/80 hover:bg-muted/60 text-foreground"
                      >
                        重试
                      </button>
                    </div>
                  ) : bundleFilteredCandidates.length === 0 ? (
                    <div className="p-6 text-center text-xs text-muted-foreground">
                      {bundleCandidates.length === 0
                        ? '市场暂无已上架的可用成员（需先发布并过审网址包 / 搜索引擎包 / 主题）。'
                        : '没有符合搜索条件的候选成员。'}
                    </div>
                  ) : (
                    bundleFilteredCandidates.map((candidate) => {
                      const selected = bundleSelectedSlugs.has(candidate.slug)
                      return (
                        <button
                          key={candidate.slug}
                          type="button"
                          onClick={() => handleToggleBundleMember(candidate)}
                          aria-pressed={selected}
                          className={cn(
                            'w-full text-left px-3.5 py-2.5 flex items-center gap-3 transition-colors',
                            selected ? 'bg-primary/5' : 'hover:bg-muted/40'
                          )}
                        >
                          <span
                            className={cn(
                              'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border/80'
                            )}
                          >
                            {selected && <Check className="w-3 h-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="text-xs font-medium text-foreground truncate">
                                {candidate.name || candidate.slug}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/70 text-muted-foreground shrink-0">
                                {BUNDLE_KIND_LABELS[candidate.kind]}
                              </span>
                            </span>
                            <span className="block text-[11px] text-muted-foreground font-mono truncate">
                              {candidate.slug}
                              {(candidate.installCount ?? 0) > 0 ? ` · 安装 ${candidate.installCount}` : ''}
                            </span>
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>

                {/* 已选成员摘要 */}
                {bundleSelection.items.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {bundleSelection.items.map((item) => {
                      const candidate = bundleCandidates.find((c) => c.slug === item.slug)
                      return (
                        <span
                          key={item.slug}
                          className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg border border-border/80 bg-background/80 text-[11px]"
                        >
                          <span className="font-mono">{candidate?.name || item.slug}</span>
                          <button
                            type="button"
                            aria-label={`移除成员 ${item.slug}`}
                            onClick={() => handleToggleBundleMember(candidate ?? { slug: item.slug, kind: item.kind })}
                            className="w-4 h-4 rounded hover:bg-destructive/10 hover:text-destructive flex items-center justify-center"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
    </>
  )
}
