'use client'

/**
 * 社区插件发布向导 (Community Plugin Publish Wizard)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md：
 * 1. 引导开发者三步完成 100% 声明式插件清单构建；
 * 2. 客户端与中枢无副作用预检（/api/plugins/validate）硬门禁校验；
 * 3. 提交后自动进入 pending 审核队列，并记录审计日志。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import {
  validatePlugin,
  publishPlugin,
  submitPluginVersion,
  fetchPluginDetail,
  checkPluginUrls,
  fetchPlugins,
  type HubPluginItem,
} from '@/lib/navhub-api'
import {
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_LIMITS,
  type PluginKind,
  type ThemeAccent,
  THEME_ACCENTS,
} from '@/lib/plugins/plugin-manifest'
import {
  BUNDLE_KIND_LABELS,
  BUNDLE_MEMBER_KINDS,
  bundlePayloadJson,
  filterBundleCandidates,
  mergeBundleCandidates,
  parseBundleSelection,
  toggleBundleMember,
  type BundleCandidate,
  type BundleMemberKind,
} from '@/lib/plugins/bundle-builder'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Globe,
  LayoutGrid,
  Palette,
  Boxes,
  Sparkles,
  Send,
  Eye,
  FileCode2,
  Search,
  Activity,
  Check,
  X,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** 默认把补丁位 +1，作者仍可手动改成更高的版本号 */
function nextPatchVersion(version: string | undefined): string {
  const parts = String(version || '1.0.0').split('.').map((n) => Number(n) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] = (parts[2] ?? 0) + 1
  return parts.join('.')
}

export default function PluginPublishPage() {
  const router = useRouter()

  // 编辑模式：/marketplace/publish?from=<slug>（仅作者本人可进入）
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [changelog, setChangelog] = useState('')
  const [loadingExisting, setLoadingExisting] = useState(false)

  // 步骤 1: 类型
  const [kind, setKind] = useState<PluginKind>('site-pack')

  // 步骤 2: 基本元数据
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [author, setAuthor] = useState('')
  const [license, setLicense] = useState('MIT')
  const [homepage, setHomepage] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [icon, setIcon] = useState('')

  // 链接体检状态
  const [checkingUrls, setCheckingUrls] = useState(false)
  const [urlCheckResults, setUrlCheckResults] = useState<{
    total: number
    okCount: number
    failedCount: number
    results: Array<{ url: string; ok: boolean; status: number; error?: string }>
  } | null>(null)

  // 步骤 3: Payload JSON 编辑器
  const [payloadJson, setPayloadJson] = useState(() =>
    JSON.stringify(
      {
        categories: [{ title: '开发工具' }],
        sites: [
          {
            title: 'GitHub',
            url: 'https://github.com',
            description: '全球最大的开源协作平台',
            category: '开发工具',
            tags: ['开源', '代码'],
          },
        ],
      },
      null,
      2
    )
  )

  // 预检校验状态
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    ok: boolean
    errors?: string[]
    summary?: any
  } | null>(null)

  // 提交状态
  const [submitting, setSubmitting] = useState(false)
  const [publishedPlugin, setPublishedPlugin] = useState<HubPluginItem | null>(null)

  // 组合包成员选择器状态（仅 kind === 'bundle' 时启用）
  const [bundleCandidates, setBundleCandidates] = useState<BundleCandidate[]>([])
  const [bundleCandidatesLoading, setBundleCandidatesLoading] = useState(false)
  const [bundleCandidatesLoaded, setBundleCandidatesLoaded] = useState(false)
  const [bundleCandidatesError, setBundleCandidatesError] = useState(false)
  const [bundleQuery, setBundleQuery] = useState('')
  const [bundleKindFilter, setBundleKindFilter] = useState<'all' | BundleMemberKind>('all')
  const [bundlePickerError, setBundlePickerError] = useState<string | null>(null)

  // 单一事实源：成员选择始终从 payload JSON 派生（手改 JSON 后选择器自动跟进）
  const bundleSelection = useMemo(() => parseBundleSelection(payloadJson), [payloadJson])
  const bundleFilteredCandidates = useMemo(
    () => filterBundleCandidates(bundleCandidates, { query: bundleQuery, kind: bundleKindFilter }),
    [bundleCandidates, bundleQuery, bundleKindFilter]
  )
  const bundleSelectedSlugs = useMemo(
    () => new Set(bundleSelection.items.map((item) => item.slug)),
    [bundleSelection]
  )

  // 懒加载候选成员：已上架的网址包 / 搜索引擎包 / 主题各取前 100 条
  const loadBundleCandidates = useCallback(async () => {
    setBundleCandidatesLoading(true)
    setBundleCandidatesError(false)
    let degraded = false
    const markDegraded = () => {
      degraded = true
    }
    const [sites, engines, themes] = await Promise.all([
      fetchPlugins({ kind: 'site-pack', limit: 100 }, markDegraded),
      fetchPlugins({ kind: 'search-pack', limit: 100 }, markDegraded),
      fetchPlugins({ kind: 'theme', limit: 100 }, markDegraded),
    ])
    const merged = mergeBundleCandidates([sites.items, engines.items, themes.items])
    setBundleCandidates(merged)
    setBundleCandidatesError(degraded && merged.length === 0)
    setBundleCandidatesLoaded(true)
    setBundleCandidatesLoading(false)
  }, [])

  useEffect(() => {
    if (kind === 'bundle' && !bundleCandidatesLoaded && !bundleCandidatesLoading) {
      void loadBundleCandidates()
    }
  }, [kind, bundleCandidatesLoaded, bundleCandidatesLoading, loadBundleCandidates])

  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from')
    if (!from) return
    let cancelled = false
    setLoadingExisting(true)
    void (async () => {
      const res = await fetchPluginDetail(from)
      if (cancelled) return
      if (!res?.plugin) {
        toast.error('未找到要更新的插件')
        setLoadingExisting(false)
        return
      }
      if (!res.plugin.isOwner) {
        toast.error('只有插件作者可以发布新版本')
        router.replace(`/marketplace/${encodeURIComponent(from)}`)
        return
      }
      const manifest = res.plugin.manifest ?? {}
      setEditingSlug(from)
      setKind(manifest.kind ?? res.plugin.kind)
      setName(manifest.name ?? res.plugin.name ?? '')
      setDescription(manifest.description ?? res.plugin.description ?? '')
      setVersion(nextPatchVersion(manifest.version ?? res.plugin.version))
      setAuthor(manifest.author ?? res.plugin.author ?? '')
      setLicense(manifest.license ?? '')
      setHomepage(manifest.homepage ?? '')
      setTagsInput((manifest.tags ?? []).join(', '))
      setIcon(manifest.icon ?? '')
      setPayloadJson(JSON.stringify(manifest.payload ?? {}, null, 2))
      setLoadingExisting(false)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  // 切换类型时提供模板
  const handleKindSelect = (k: PluginKind) => {
    setKind(k)
    setValidationResult(null)
    if (k === 'site-pack') {
      setPayloadJson(
        JSON.stringify(
          {
            categories: [{ title: '常用工具' }],
            sites: [
              {
                title: 'NavHub',
                url: 'https://navhub.local',
                description: '现代极客私有化导航中枢',
                category: '常用工具',
                tags: ['开源', '自托管'],
              },
            ],
          },
          null,
          2
        )
      )
    } else if (k === 'workspace-preset') {
      setPayloadJson(
        JSON.stringify(
          {
            boards: [
              {
                name: '极速效率看板',
                widgets: [
                  { type: 'clock', colSpan: 4, rowSpan: 1 },
                  { type: 'search', colSpan: 8, rowSpan: 1 },
                  { type: 'favorites', colSpan: 6, rowSpan: 2 },
                  { type: 'quick-notes', colSpan: 6, rowSpan: 2 },
                ],
              },
            ],
          },
          null,
          2
        )
      )
    } else if (k === 'theme') {
      setPayloadJson(
        JSON.stringify(
          {
            accent: 'violet',
            tokens: {
              '--background': '240 10% 4%',
              '--foreground': '0 0% 98%',
              '--primary': '263.4 70% 50.4%',
              '--card': '240 10% 6%',
              '--border': '240 5% 15%',
            },
          },
          null,
          2
        )
      )
    } else if (k === 'search-pack') {
      setPayloadJson(
        JSON.stringify(
          {
            engines: [
              {
                id: 'github',
                name: 'GitHub',
                prefix: '!gh',
                searchUrl: 'https://github.com/search?q={q}',
                description: '检索开源项目、代码与 Issue',
              },
              {
                id: 'npm',
                name: 'npm',
                prefix: '!npm',
                searchUrl: 'https://www.npmjs.com/search?q={q}',
                description: 'JavaScript / TypeScript 依赖包检索',
              },
            ],
          },
          null,
          2
        )
      )
    } else if (k === 'bundle') {
      // 组合包改由「成员选择器」拼装：从空清单开始，避免占位 slug 干扰预检
      setPayloadJson(bundlePayloadJson([]))
      setBundlePickerError(null)
    }
  }

  // 链接可达性体检
  const handleCheckUrls = async () => {
    setCheckingUrls(true)
    setUrlCheckResults(null)
    try {
      let parsedPayload: any = {}
      try {
        parsedPayload = JSON.parse(payloadJson)
      } catch {
        throw new Error('负载 JSON 格式不合法，请先修正语法')
      }
      const urls: string[] = []
      if (Array.isArray(parsedPayload.sites)) {
        for (const s of parsedPayload.sites) {
          if (typeof s.url === 'string' && s.url.trim()) urls.push(s.url.trim())
        }
      } else if (Array.isArray(parsedPayload.engines)) {
        for (const e of parsedPayload.engines) {
          if (typeof e.searchUrl === 'string' && e.searchUrl.trim()) {
            urls.push(e.searchUrl.replace('{q}', 'NavHub').trim())
          }
        }
      }
      if (urls.length === 0) {
        toast.info('未在负载中检测到可体检的 URL')
        return
      }
      const res = await checkPluginUrls(urls.slice(0, 30))
      setUrlCheckResults(res)
      if (res.okCount === res.total) {
        toast.success(`全部 ${res.total} 个链接健康可用！`)
      } else {
        toast.warning(`检测完成：${res.okCount} 个正常，${res.failedCount} 个异常`)
      }
    } catch (err) {
      toast.error('链接体检失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setCheckingUrls(false)
    }
  }

  // 成员选择器：点选 / 取消成员，实时回写 payload JSON（旧校验结果随即失效）
  const handleToggleBundleMember = (candidate: BundleCandidate) => {
    const { items, error } = toggleBundleMember(bundleSelection.items, candidate, {
      selfSlug: editingSlug,
    })
    if (error) {
      setBundlePickerError(error)
      return
    }
    setBundlePickerError(null)
    setValidationResult(null)
    setPayloadJson(bundlePayloadJson(items))
  }

  // 组合完整 Manifest
  const buildManifest = () => {
    let parsedPayload: any = {}
    try {
      parsedPayload = JSON.parse(payloadJson)
    } catch {
      throw new Error('负载 JSON 格式不合法，请检查标点与括号闭合')
    }

    const tags = tagsInput
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)

    return {
      manifestVersion: PLUGIN_MANIFEST_VERSION,
      kind,
      name: name.trim(),
      description: description.trim(),
      version: version.trim(),
      author: author.trim() || undefined,
      license: license.trim() || undefined,
      homepage: homepage.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      icon: icon.trim() || undefined,
      payload: parsedPayload,
    }
  }

  // 实时预检校验
  const handleValidate = async () => {
    setValidating(true)
    setValidationResult(null)
    try {
      const manifest = buildManifest()
      const res = await validatePlugin(manifest)
      setValidationResult(res)
      if (res.ok) {
        toast.success('预检校验通过！清单合法无误')
      } else {
        toast.error('清单存在格式问题，请对照修改')
      }
    } catch (err) {
      setValidationResult({
        ok: false,
        errors: [err instanceof Error ? err.message : String(err)],
      })
      toast.error('校验失败')
    } finally {
      setValidating(false)
    }
  }

  // 提交发布
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const manifest = buildManifest()
      const plugin = editingSlug
        ? await submitPluginVersion(editingSlug, manifest, changelog)
        : await publishPlugin(manifest)
      setPublishedPlugin(plugin)
      toast.success(editingSlug ? '新版本已提交审核！' : '投稿发布成功！已提交至管理员审核队列')
    } catch (err) {
      toast.error('提交发布失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 返回与导航 */}
        <div className="flex items-center justify-between">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回插件市场</span>
          </Link>
          <div className="text-xs text-muted-foreground">
            投稿须知：所有插件清单均须通过格式校验与管理员上架审核
          </div>
        </div>

        {/* 主界面卡片 */}
        {loadingExisting ? (
          <div className="rounded-3xl border border-border/80 glass-surface p-12 text-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">正在载入当前插件清单…</p>
          </div>
        ) : publishedPlugin ? (
          <div className="rounded-3xl border border-border/80 glass-surface p-8 sm:p-12 text-center space-y-4 max-w-xl mx-auto shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-500">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-foreground">
              {editingSlug ? '新版本已提交审核！' : '投稿发布成功！'}
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              插件「<strong>{publishedPlugin.name}</strong>」的 v{publishedPlugin.version} 已登记至待审队列
              （status: pending）。管理员将在后台审核其安全性与内容规范，审核通过后即全网可见。
            </p>
            <div className="flex items-center justify-center gap-3 pt-4">
              <Link
                href="/marketplace"
                className="px-4 py-2 text-xs font-medium rounded-xl border border-border/80 hover:bg-muted/60 transition-colors"
              >
                浏览市场
              </Link>
              <button
                type="button"
                onClick={() => {
                  setPublishedPlugin(null)
                  setName('')
                  setDescription('')
                  setValidationResult(null)
                }}
                className="px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-all"
              >
                继续投稿新插件
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-3xl border border-border/80 glass-surface p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-medium">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{editingSlug ? '作者更新向导' : '声明式扩展向导'}</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                  {editingSlug ? '发布新版本' : '投稿发布新插件'}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {editingSlug
                    ? '版本号必须大于当前版本，类型不可变；提交后重新进入审核队列，旧语义索引会立即失效。'
                    : '按照声明式 JSON 契约分享您的网址合集、看板配置或个性化配色主题。'}
                </p>
              </div>

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
                      className="w-full text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
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
                      className="w-full text-xs font-mono rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
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
                      className="w-full text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 resize-none"
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
                      className="w-full text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
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
                      className="w-full text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
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
                      className="w-full text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
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
                      className="w-full text-xs rounded-xl border border-border/80 bg-background/80 p-2.5 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
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
                        className="w-full text-xs rounded-xl border border-border/80 bg-background/80 pl-8 pr-3 py-2 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
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

              {/* 步骤 3: 声明式 JSON Payload */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="publish-plugin-payload" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileCode2 className="w-4 h-4 text-primary" />
                    <span>第 3 步：定义内容载荷 (payload JSON)</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">纯声明式 JSON</span>
                </div>
                <textarea
                  id="publish-plugin-payload"
                  aria-label="内容载荷 JSON"
                  value={payloadJson}
                  onChange={(e) => {
                    setPayloadJson(e.target.value)
                    setValidationResult(null)
                  }}
                  rows={10}
                  className="w-full text-xs font-mono rounded-2xl border border-border/80 bg-background/90 p-4 text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 leading-relaxed"
                  required
                />
              </div>

              {/* 预检校验结果反馈 */}
              {validationResult && (
                <div
                  className={cn(
                    'rounded-2xl border p-4 space-y-2 text-xs transition-all',
                    validationResult.ok
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                      : 'border-destructive/30 bg-destructive/5 text-destructive'
                  )}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {validationResult.ok ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>预检校验通过！该清单完全符合 NavHub 规范</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-destructive" />
                        <span>发现以下校验错误：</span>
                      </>
                    )}
                  </div>

                  {!validationResult.ok && validationResult.errors && (
                    <ul className="list-disc list-inside space-y-1 text-xs opacity-90 pl-1">
                      {validationResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  )}

                  {validationResult.ok && validationResult.summary && (
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-4 pt-1">
                      {kind === 'site-pack' && (
                        <span>
                          站点总计: {validationResult.summary.siteCount}，分类: {validationResult.summary.categoryCount}
                        </span>
                      )}
                      {kind === 'workspace-preset' && (
                        <span>
                          看板: {validationResult.summary.boardCount}，组件: {validationResult.summary.widgetCount}
                        </span>
                      )}
                      {kind === 'theme' && (
                        <span>变量数: {validationResult.summary.themeTokenCount}</span>
                      )}
                      {kind === 'search-pack' && (
                        <span>
                          引擎数: {validationResult.summary.engineCount}，前缀: {validationResult.summary.enginePrefixes?.join(', ')}
                        </span>
                      )}
                      {kind === 'bundle' && (
                        <span>
                          成员数: {validationResult.summary.bundleItemCount}，类型:{' '}
                          {(validationResult.summary.bundleKinds ?? []).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 链接健康体检结果展示 */}
              {urlCheckResults && (
                <div
                  className={cn(
                    'p-4 rounded-2xl border text-xs space-y-2 animate-in fade-in',
                    urlCheckResults.failedCount === 0
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                  )}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      <span>
                        URL 可达性体检：共检测 {urlCheckResults.total} 个，
                        {urlCheckResults.failedCount === 0 ? '全部健康' : `${urlCheckResults.failedCount} 个异常`}
                      </span>
                    </div>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1 pt-1">
                    {urlCheckResults.results.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] font-mono gap-2">
                        <span className="truncate max-w-[320px]">{r.url}</span>
                        {r.ok ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                            ✓ {r.status}
                          </span>
                        ) : (
                          <span className="text-destructive font-bold shrink-0">
                            ✕ {r.error || '失败'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {editingSlug && (
                <div className="space-y-1.5">
                  <label htmlFor="plugin-changelog" className="text-xs font-medium text-foreground">
                    变更说明（审核通过后写入版本历史）
                  </label>
                  <textarea
                    id="plugin-changelog"
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="例如：新增 12 个设计工具站点；修复失效链接；调整主题强调色"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs leading-relaxed resize-y"
                  />
                </div>
              )}

              {/* 底部操作条 */}
              <div className="pt-4 border-t border-border/60 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleValidate}
                    disabled={validating || !name.trim() || !description.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-border/80 bg-background hover:bg-muted/60 text-foreground transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{validating ? '预检中…' : '预检校验'}</span>
                  </button>

                  {(kind === 'site-pack' || kind === 'search-pack') && (
                    <button
                      type="button"
                      onClick={handleCheckUrls}
                      disabled={checkingUrls}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-border/80 bg-background hover:bg-muted/60 text-foreground transition-all"
                      title="检测清单中站点的可达性与是否存在死链"
                    >
                      {checkingUrls ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Activity className="w-3.5 h-3.5 text-primary" />
                      )}
                      <span>{checkingUrls ? '嗅探检测中…' : '体检链接可达性'}</span>
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting || !name.trim() || !description.trim()}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? '提交中…' : editingSlug ? '提交新版本审核' : '立即提交审核'}</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* 底部导航 */}
        <Footer />
      </div>
    </Container>
  )
}
