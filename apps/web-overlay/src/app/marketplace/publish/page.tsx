'use client'

/**
 * 社区插件发布向导 (Community Plugin Publish Wizard)
 *
 * 遵循 docs/PLUGIN-MARKET-DESIGN-2026-10-19.md：
 * 1. 引导开发者三步完成 100% 声明式插件清单构建；
 * 2. 客户端与中枢无副作用预检（/api/plugins/validate）硬门禁校验；
 * 3. 提交后自动进入 pending 审核队列，并记录审计日志。
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import {
  validatePlugin,
  publishPlugin,
  type HubPluginItem,
} from '@/lib/navhub-api'
import {
  PLUGIN_MANIFEST_VERSION,
  type PluginKind,
  type ThemeAccent,
  THEME_ACCENTS,
} from '@/lib/plugins/plugin-manifest'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Globe,
  LayoutGrid,
  Palette,
  Sparkles,
  Send,
  Eye,
  FileCode2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function PluginPublishPage() {
  const router = useRouter()

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
    }
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
      const plugin = await publishPlugin(manifest)
      setPublishedPlugin(plugin)
      toast.success('投稿发布成功！已提交至管理员审核队列')
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
        {publishedPlugin ? (
          <div className="rounded-3xl border border-border/80 glass-surface p-8 sm:p-12 text-center space-y-4 max-w-xl mx-auto shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-500">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-foreground">投稿发布成功！</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              插件「<strong>{publishedPlugin.name}</strong>」已登记至待审队列（status: pending）。
              管理员将在后台审核其安全性与内容规范，审核通过后即全网可见。
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
                  <span>声明式扩展向导</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                  投稿发布新插件
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  按照声明式 JSON 契约分享您的网址合集、看板配置或个性化配色主题。
                </p>
              </div>

              {/* 步骤 1: 选择插件类型 */}
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-foreground">
                  第 1 步：选择插件类型
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    </div>
                  )}
                </div>
              )}

              {/* 底部操作条 */}
              <div className="pt-4 border-t border-border/60 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={validating || !name.trim() || !description.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-border/80 bg-background hover:bg-muted/60 text-foreground transition-all"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{validating ? '预检中…' : '预检校验'}</span>
                </button>

                <button
                  type="submit"
                  disabled={submitting || !name.trim() || !description.trim()}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? '提交中…' : '立即提交审核'}</span>
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
