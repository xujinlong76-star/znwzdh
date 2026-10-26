'use client'

/**
 * AI 智能插件工坊 (AI Plugin Studio Modal)
 *
 * 核心能力：
 * 1. 自然语言提示词一键驱动生成 100% 声明式插件清单（支持 site-pack / theme / search-pack / workspace-preset / bundle）；
 * 2. 交互式多类型实装沙箱预览（Live Sandbox Preview）：真实卡片网格、主题色卡试衣间、多引擎搜索栏、工作台缩略图；
 * 3. 多轮自然语言增量微调（“修改好后”）：支持连续对话式微调扩充与修饰；
 * 4. 自动化预检与死链探测：调用中枢 /api/plugins/check-urls 实时并发探活；
 * 5. 一键直通插件市场：调用 /api/plugins 自动建立作者归属并提交上架审核。
 */

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  generateAiPlugin,
  publishPlugin,
  submitPluginVersion,
  preAuditPlugin,
  autoFixPlugin,
  checkPluginUrls,
  type HubPluginItem,
  type HubPluginAuditReport
} from '@/lib/navhub-api'
import { AuditDimensionTile } from './audit-dimension-tile'
import { type PluginKind, type PluginManifest } from '@/lib/plugins/plugin-manifest'
import {
  Sparkles,
  Send,
  Loader2,
  Download,
  FileCode2,
  Activity,
  Sliders,
  Wand2,
  Eye,
  ArrowRight,
  ShieldCheck,
  Check
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { applyMetaEdits, computeManifestDiff, extractManifestUrls } from '@/lib/plugins/studio-derived'
import { StudioSandboxPanel } from './studio-sandbox-panel'
import { StudioJsonPanel } from './studio-json-panel'
import { StudioHealthPanel } from './studio-health-panel'

export interface AiPluginStudioModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPrompt?: string
  initialKind?: PluginKind | 'auto'
  initialManifest?: PluginManifest
  initialSlug?: string
  onPublished?: (plugin: HubPluginItem) => void
}

const PRESET_IDEAS = [
  { icon: '🌐', label: 'Web3 极客工具箱', kind: 'site-pack' as const, prompt: '整理一个面向 Web3 与区块链开发者的网址包，包含以太坊浏览器、Foundry/Hardhat 开发框架与主流测试网水龙头。' },
  { icon: '🎨', label: '赛博极客深紫主题', kind: 'theme' as const, prompt: '设计一款深色赛博霓虹风格的极客主题包，使用 violet 紫色作为主强调色，圆角为 0.75rem。' },
  { icon: '📚', label: '学术论文聚合搜索', kind: 'search-pack' as const, prompt: '生成一套学术研究聚合搜索引擎包，包含 arXiv (!arxiv)、Google Scholar (!scholar) 和 GitHub (!gh)。' },
  { icon: '⚡', label: '前端全栈生产力看板', kind: 'workspace-preset' as const, prompt: '规划一个前端全栈工程师专属的工作台预设，包含聚合多引擎搜索框、常用工具底座和 GitHub 贡献热力图。' },
  { icon: '🛠️', label: '离线极客微工具集合', kind: 'site-pack' as const, prompt: '收录支持断网离线运行的开发者轻量微工具（Base64 编解码、JSON 格式化、JWT 验签与色彩取色器）。' },
]

export function AiPluginStudioModal({
  open,
  onOpenChange,
  initialPrompt = '',
  initialKind = 'auto',
  initialManifest,
  initialSlug,
  onPublished,
}: AiPluginStudioModalProps) {
  const router = useRouter()

  // 基础输入状态
  const [prompt, setPrompt] = useState(initialPrompt)
  const [kind, setKind] = useState<PluginKind | 'auto'>(initialKind)
  const [enableThinking, setEnableThinking] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState<'sandbox' | 'json' | 'health'>('sandbox')

  // 生成产物与思维链状态
  const [manifest, setManifest] = useState<PluginManifest | null>(initialManifest || null)
  const [, setRationale] = useState('')
  const [reasoningContent, setReasoningContent] = useState<string | undefined>()
  const [generationModel, setGenerationModel] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>>([])

  // 表单双向编辑状态
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const [editVersion, setEditVersion] = useState('1.0.0')
  const [editTags, setEditTags] = useState('')
  const [showMetaEditor, setShowMetaEditor] = useState(false)

  // 模拟搜索栏交互测试
  const [searchTestQuery, setSearchTestQuery] = useState('react')
  const [selectedEngineIndex, setSelectedEngineIndex] = useState(0)

  // 自动化死链体检与预检/修复状态
  const [checkingUrls, setCheckingUrls] = useState(false)
  const [urlCheckResults, setUrlCheckResults] = useState<{
    total: number
    okCount: number
    failedCount: number
    results: Array<{ url: string; ok: boolean; status: number; error?: string }>
  } | null>(null)
  const [preAuditing, setPreAuditing] = useState(false)
  const [preAuditReport, setPreAuditReport] = useState<HubPluginAuditReport | null>(null)
  const [autoFixing, setAutoFixing] = useState(false)
  const [, setAutoFixLogs] = useState<string[]>([])

  // 提交发布状态
  const [publishing, setPublishing] = useState(false)
  const [publishedPlugin, setPublishedPlugin] = useState<(HubPluginItem & { audit?: HubPluginAuditReport }) | null>(null)

  // 变更版本对比与沙箱体验增强状态
  const [previousManifest, setPreviousManifest] = useState<PluginManifest | null>(initialManifest || null)
  const [activeJsonSubTab, setActiveJsonSubTab] = useState<'source' | 'diff'>('source')
  const [liveThemeActive, setLiveThemeActive] = useState(false)
  const [sitePackCategoryFilter, setSitePackCategoryFilter] = useState('all')

  // 打开时初始化
  useEffect(() => {
    if (open) {
      if (initialPrompt && !manifest) {
        setPrompt(initialPrompt)
      }
      if (initialKind) {
        setKind(initialKind)
      }
      if (initialManifest && !manifest) {
        setManifest(initialManifest)
        setPreviousManifest(initialManifest)
        setRationale(`已为您载入插件「${initialManifest.name}」，输入指令即可让 AI 进行增量修改并一键发布新版本。`)
      }
      setPublishedPlugin(null)
    }
  }, [open, initialPrompt, initialKind, initialManifest, manifest])

  // 当 manifest 更新时同步表单编辑字段
  useEffect(() => {
    if (manifest) {
      setEditName(manifest.name)
      setEditDescription(manifest.description || '')
      setEditAuthor(manifest.author || '山羊胡创作者')
      setEditVersion(manifest.version || '1.0.0')
      setEditTags((manifest.tags || []).join(', '))
    }
  }, [manifest])

  // 智能提示词润色
  const handlePolishPrompt = () => {
    const current = prompt.trim()
    if (!current) {
      setPrompt('生成一个专注于全栈 AI 开发者的高质量网址包，划分为模型 API、代码生成、开发框架、向量数据库与微调部署 5 大分类，收录至少 15 个主流官方站点，要求带真实可用链接与专业描述标签。')
      toast.info('已为您填入高质量示例提示词，可直接点击「规划生成」！')
      return
    }

    let polished = current
    if (kind === 'theme' || current.includes('主题') || current.includes('皮肤')) {
      polished = `设计一套专业级高质量主题皮肤：基于【${current}】的视觉风格，搭配和谐舒适的高对比前景与低饱和背景色，主强调色匹配专业调色板（支持 violet/sky/emerald/amber/rose 之一），圆角设定为 0.75rem，全站卡片、弹窗与聚焦环视觉层次分明。`
    } else if (kind === 'search-pack' || current.includes('搜索') || current.includes('引擎')) {
      polished = `生成一套针对【${current}】的高效搜索引擎包：收录不少于 10 个权威检索源，每个引擎配置以叹号开头的全局唯一前缀（如 !gh、!npm、!so 等），searchUrl 严格包含 {q} 占位符，配置专属 emoji 图标与检索场景说明。`
    } else {
      polished = `生成一份商用级【${current}】网址导航插件：合理划分 4~6 个垂直分类，严选至少 15 个具有代表性、高可用性的权威官方站点；每个站点提供规范的 HTTPS 链接、精准的中文说明（15~35字）与2~3个专业标签；配置醒目的单字符 emoji 图标，遵循 MIT 免费开源协议。`
    }
    setPrompt(polished)
    toast.success('✨ 提示词已优化扩写！结构、分类与规范已全方位补强。')
  }

  // 计算版本前后变更清单 (Diff Inspector)：纯逻辑已抽到 studio-derived（可单测）
  const manifestDiff = useMemo(
    () => computeManifestDiff(previousManifest, manifest),
    [manifest, previousManifest],
  )

  // 执行生成（首次或多轮增量）
  const handleGenerate = async (customPrompt?: string, targetKind?: PluginKind | 'auto') => {
    const text = (customPrompt || prompt).trim()
    if (!text || generating) return

    setGenerating(true)
    setUrlCheckResults(null)
    setPublishedPlugin(null)

    if (manifest) {
      setPreviousManifest(manifest)
    }

    const isIncremental = Boolean(manifest)
    const newHistoryTurn = { role: 'user' as const, content: text, timestamp: Date.now() }
    setHistory((prev) => [...prev, newHistoryTurn])

    try {
      const res = await generateAiPlugin({
        prompt: text,
        kind: targetKind || kind,
        thinking: enableThinking,
        existingManifest: isIncremental ? manifest : undefined,
      })

      if (res.success && res.manifest) {
        setManifest(res.manifest)
        setRationale(res.rationale || '已根据您的需求规划完成')
        setReasoningContent(res.reasoningContent)
        setGenerationModel(res.model?.trim() || null)
        setLatencyMs(res.latencyMs || null)
        setHistory((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            content: res.rationale || '插件清单生成完成',
            timestamp: Date.now(),
          },
        ])
        setPrompt('') // 清空输入框，方便下一轮微调
        toast.success(isIncremental ? '插件清单增量修改完成！' : 'AI 插件清单规划生成完成！')
      } else {
        const errMsg = res.error || (res.errors ? res.errors.join('；') : '生成失败')
        toast.error(`生成失败: ${errMsg}`)
      }
    } catch (err) {
      console.error('[AI Studio] generate error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('超时') || msg.includes('timeout') || msg.includes('504')) {
        toast.error('模型规划响应超时。已自动放宽时限，建议重试；亦可关闭“深度思考”以获得秒级极速响应！')
      } else {
        toast.error(`请求失败：${msg || '请检查模型配置或重试'}`)
      }
    } finally {
      setGenerating(false)
    }
  }

  // 同步元数据编辑回 manifest
  const handleApplyMetaEdits = () => {
    if (!manifest) return
    setPreviousManifest(manifest)
    setManifest(
      applyMetaEdits(manifest, {
        name: editName,
        description: editDescription,
        author: editAuthor,
        version: editVersion,
        tags: editTags,
      }),
    )
    toast.success('元数据已更新')
  }

  // 探活目标提取：纯逻辑已抽到 studio-derived（去重、{q} 替换、30 条封顶）
  const extractedUrls = useMemo(() => extractManifestUrls(manifest), [manifest])

  // 执行一键死链体检
  const handleCheckUrls = async () => {
    if (extractedUrls.length === 0) {
      toast.info('当前插件不包含需要探活的外部 URL')
      return
    }
    setCheckingUrls(true)
    try {
      const res = await checkPluginUrls(extractedUrls)
      setUrlCheckResults(res)
      if (res.failedCount === 0) {
        toast.success(`体检完毕：${res.okCount} 个站点全部 100% 健康连通！`)
      } else {
        toast.warning(`体检完毕：发现 ${res.failedCount} 个站点存在异常或超时`)
      }
    } catch (err) {
      console.error('[AI Studio] check urls error:', err)
      toast.error('站点探活检测失败')
    } finally {
      setCheckingUrls(false)
    }
  }

  // 导出离线清单 JSON
  const handleDownloadJson = () => {
    if (!manifest) return
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${manifest.name || 'plugin'}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('离线清单已下载')
  }

  // 执行提交前 AI 预检
  const handlePreAudit = async () => {
    if (!manifest || preAuditing) return
    setPreAuditing(true)
    try {
      const res = await preAuditPlugin(manifest)
      if (res.ok) {
        setPreAuditReport(res.audit)
        setActiveTab('health')
        const score = res.audit.score
        if (score >= 80) {
          toast.success(`AI 预检完成：综合评分 ${score}分 (${res.audit.level} 级) · 符合一键上架标准！`)
        } else {
          toast.warning(`AI 预检评分 ${score}分：建议点击「✨ 一键智能修复」优化后提交`)
        }
      }
    } catch (err) {
      console.error('[AI Studio] pre-audit error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`预检失败: ${msg}`)
    } finally {
      setPreAuditing(false)
    }
  }

  // 执行 AI 一键智能修复
  const handleAutoFix = async () => {
    if (!manifest || autoFixing) return
    setAutoFixing(true)
    try {
      const res = await autoFixPlugin(manifest)
      if (res.ok) {
        setPreviousManifest(manifest)
        setManifest(res.manifest)
        setPreAuditReport(res.audit)
        setAutoFixLogs(res.changes)
        setActiveTab('health')
        if (res.changes.length > 0) {
          toast.success(`✨ 已自动完成 ${res.changes.length} 项规范优化！综合评分升至 ${res.audit.score}分`, {
            description: res.changes.slice(0, 3).join('；') + (res.changes.length > 3 ? ' 等' : ''),
          })
        } else {
          toast.info(`当前插件规范度极高，无需自动修正 (评分: ${res.audit.score}分)`)
        }
      }
    } catch (err) {
      console.error('[AI Studio] auto-fix error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`自动修复失败: ${msg}`)
    } finally {
      setAutoFixing(false)
    }
  }

  // 一键直接提交到插件市场 (带 AI 智能多维审查与即时上架)
  const handlePublishToMarketplace = async () => {
    if (!manifest || publishing) return
    setPublishing(true)

    try {
      let res: HubPluginItem & { audit?: HubPluginAuditReport }
      if (initialSlug) {
        // 版本升级模式
        res = await submitPluginVersion(
          initialSlug,
          manifest,
          `AI 智能工坊升级发布新版本 v${manifest.version || '1.1.0'}`,
          undefined,
          { autoAudit: true }
        )
      } else {
        // 全新发布模式
        res = await publishPlugin(manifest, undefined, { autoAudit: true })
      }
      setPublishedPlugin(res)
      if (res.status === 'published' || res.audit?.decision === 'approve') {
        const score = res.audit?.score ? ` (AI 质量综合分: ${res.audit.score}分)` : ''
        toast.success(`🎉 插件「${res.name}」已由 AI 模型自动严审通过，即时上架市场！${score}`)
      } else {
        toast.success(`🚀 插件「${res.name}」已提交审核队列！`)
      }
      if (onPublished) {
        onPublished(res)
      }
    } catch (err) {
      console.error('[AI Studio] publish error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`提交市场失败: ${msg}`)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[88vh] sm:h-[88vh] max-h-[92dvh] p-0 flex flex-col gap-0 overflow-hidden bg-background border-border shadow-2xl">
        {/* 顶部标题栏 */}
        <DialogHeader className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-border bg-card/60 backdrop-blur-md flex-shrink-0 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-primary/30 to-violet-500/20 border border-primary/40 flex items-center justify-center text-primary shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <DialogTitle className="text-base font-semibold tracking-tight">
                  AI 智能插件工坊 (AI Plugin Studio)
                </DialogTitle>
                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary bg-primary/5">
                  {generationModel ? `${generationModel} 驱动` : 'AI 驱动 · 模型以中枢回报为准'}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                自然语言规划 · 100% 声明式沙箱预览 · 多轮自然语言微调 · 一键提交插件市场
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 主体工作台：左右双栏布局 */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* 左栏：控制与对话交互区 (40%) */}
          <div className="w-full md:w-[42%] max-h-[42vh] md:max-h-none border-b md:border-b-0 md:border-r border-border bg-muted/10 flex flex-col overflow-y-auto p-3.5 sm:p-4 gap-3 sm:gap-4 shrink-0">
            {/* 灵感快捷预设 */}
            {!manifest && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Wand2 className="h-3 w-3 text-primary" />
                  <span>快捷灵感预设：</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_IDEAS.map((idea, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setPrompt(idea.prompt)
                        setKind(idea.kind)
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-border/70 bg-card hover:bg-accent/40 text-foreground transition-all flex items-center gap-1 text-left"
                    >
                      <span>{idea.icon}</span>
                      <span>{idea.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 输入指令卡片 */}
            <div className="space-y-2 p-3 rounded-xl border border-border bg-card/80 shadow-sm">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="ai-plugin-prompt-textarea" className="font-medium flex items-center gap-1 text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>{manifest ? '多轮增量微调指令' : '插件需求描述'}</span>
                </label>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <select
                    id="ai-plugin-kind-select"
                    aria-label="选择插件类型"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    className="text-[11px] bg-background border border-input rounded-md px-1.5 py-0.5 text-foreground focus:outline-none"
                    disabled={generating}
                  >
                    <option value="auto">🤖 智能判断类型</option>
                    <option value="site-pack">🌐 网址导航包 (site-pack)</option>
                    <option value="theme">🎨 外观主题包 (theme)</option>
                    <option value="search-pack">🔍 搜索引擎包 (search-pack)</option>
                    <option value="workspace-preset">⚡ 工作台预设 (workspace)</option>
                  </select>
                </div>
              </div>

              <Textarea
                id="ai-plugin-prompt-textarea"
                aria-label="插件需求或增量微调描述"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  manifest
                    ? '输入增量调整指令（例如：再加上3个Solidity工具、把强调色改成 emerald、版本设为 1.1.0）...'
                    : '输入您想创建的插件描述（例如：帮我整理一套 Web3 与智能合约开发者工具导航包，包含常用的测试网水龙头与区块链浏览器）...'
                }
                rows={3}
                disabled={generating}
                className="text-xs resize-none bg-background/90"
              />

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEnableThinking((prev) => !prev)}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                      enableThinking
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${enableThinking ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                    <span>深度思考{enableThinking ? '开启' : '关闭'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePolishPrompt}
                    disabled={generating}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md text-primary bg-primary/10 hover:bg-primary/20 transition-colors cursor-pointer font-medium"
                    title="由 AI 架构师优化与结构化提示词"
                  >
                    <Wand2 className="h-3 w-3" />
                    <span>智能润色</span>
                  </button>
                </div>

                <Button
                  size="sm"
                  disabled={!prompt.trim() || generating}
                  onClick={() => handleGenerate()}
                  className="h-7 px-3 text-xs gap-1 shadow-sm font-medium"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>{enableThinking ? '深度推理中...' : '极速生成中...'}</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3 w-3" />
                      <span>{manifest ? '发送增量指令' : 'AI 开始规划'}</span>
                    </>
                  )}
                </Button>
              </div>

              {generating && (
                <div className="text-[10px] text-muted-foreground/80 flex items-center justify-center gap-1.5 pt-0.5 animate-pulse">
                  <Sparkles className="h-3 w-3 text-primary animate-spin" />
                  <span>
                    {enableThinking
                      ? '正在深度思考规划中（通常需 10~25 秒）...'
                      : '正在极速生成插件清单（通常仅需 1~3 秒）...'}
                  </span>
                </div>
              )}
            </div>

            {/* 历史对话与推理阐述 */}
            {history.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-between">
                  <span>多轮对话历史 ({history.length} 轮)</span>
                  {reasoningContent && (
                    <details className="text-[10px] text-emerald-600 dark:text-emerald-400 cursor-pointer">
                      <summary>查看 Agnes 深度思考链</summary>
                      <div className="p-2 mt-1 rounded bg-muted/60 border border-border text-foreground/80 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {reasoningContent}
                      </div>
                    </details>
                  )}
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-xs">
                  {history.map((h, i) => (
                    <div
                      key={i}
                      className={cn(
                        'p-2 rounded-lg border text-xs leading-relaxed',
                        h.role === 'user'
                          ? 'bg-primary/5 border-primary/20 text-foreground ml-4'
                          : 'bg-card border-border text-foreground/90 mr-4'
                      )}
                    >
                      <div className="text-[10px] text-muted-foreground font-mono mb-0.5">
                        {h.role === 'user' ? '用户需求' : 'AI 规划'}
                      </div>
                      <p>{h.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 基础元数据快速表单（可折叠） */}
            {manifest && (
              <div className="border border-border/80 rounded-xl p-3 bg-card/60 space-y-2 text-xs">
                <button
                  type="button"
                  className="w-full flex items-center justify-between cursor-pointer select-none text-left"
                  onClick={() => setShowMetaEditor((prev) => !prev)}
                >
                  <span className="font-medium flex items-center gap-1">
                    <Sliders className="h-3.5 w-3.5 text-primary" />
                    <span>清单元数据微调</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {showMetaEditor ? '收起' : '展开修改'}
                  </span>
                </button>

                {showMetaEditor && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="ai-studio-meta-name" className="text-[10px] text-muted-foreground">插件名称</label>
                        <Input
                          id="ai-studio-meta-name"
                          aria-label="插件名称"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 text-xs mt-0.5"
                        />
                      </div>
                      <div>
                        <label htmlFor="ai-studio-meta-version" className="text-[10px] text-muted-foreground">版本号</label>
                        <Input
                          id="ai-studio-meta-version"
                          aria-label="版本号"
                          value={editVersion}
                          onChange={(e) => setEditVersion(e.target.value)}
                          className="h-7 text-xs mt-0.5"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="ai-studio-meta-author" className="text-[10px] text-muted-foreground">作者昵称</label>
                      <Input
                        id="ai-studio-meta-author"
                        aria-label="作者昵称"
                        value={editAuthor}
                        onChange={(e) => setEditAuthor(e.target.value)}
                        className="h-7 text-xs mt-0.5"
                      />
                    </div>

                    <div>
                      <label htmlFor="ai-studio-meta-description" className="text-[10px] text-muted-foreground">插件描述</label>
                      <Textarea
                        id="ai-studio-meta-description"
                        aria-label="插件描述"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        className="text-xs resize-none mt-0.5"
                      />
                    </div>

                    <div>
                      <label htmlFor="ai-studio-meta-tags" className="text-[10px] text-muted-foreground">标签 (逗号分隔)</label>
                      <Input
                        id="ai-studio-meta-tags"
                        aria-label="标签 (逗号分隔)"
                        value={editTags}
                        onChange={(e) => setEditTags(e.target.value)}
                        className="h-7 text-xs mt-0.5"
                      />
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleApplyMetaEdits}
                      className="w-full h-7 text-xs mt-1"
                    >
                      应用元数据修改
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右栏：实时沙箱预览与体检区 (58%) */}
          <div className="flex-1 flex flex-col bg-background overflow-hidden min-h-0">
            <div className="px-4 py-2 border-b border-border bg-card/40 flex items-center justify-between">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                <div className="flex items-center justify-between">
                  <TabsList className="h-8 bg-muted/60 p-0.5 rounded-lg flex items-center overflow-x-auto no-scrollbar touch-pan-x">
                    <TabsTrigger value="sandbox" className="h-7 text-xs gap-1.5 px-2.5 sm:px-3 whitespace-nowrap shrink-0">
                      <Eye className="h-3.5 w-3.5" />
                      <span>实时沙箱预览</span>
                    </TabsTrigger>
                    <TabsTrigger value="json" className="h-7 text-xs gap-1.5 px-2.5 sm:px-3 whitespace-nowrap shrink-0">
                      <FileCode2 className="h-3.5 w-3.5" />
                      <span>声明式 JSON</span>
                    </TabsTrigger>
                    <TabsTrigger value="health" className="h-7 text-xs gap-1.5 px-2.5 sm:px-3 whitespace-nowrap shrink-0">
                      <Activity className="h-3.5 w-3.5" />
                      <span>自动化体检</span>
                      {extractedUrls.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.2 rounded-full bg-primary/10 text-[10px] text-primary">
                          {extractedUrls.length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  {manifest && (
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {manifest.kind}
                      </Badge>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        v{manifest.version}
                      </span>
                    </div>
                  )}
                </div>
              </Tabs>
            </div>

            {/* 沙箱主体展示 */}
            <div className="flex-1 overflow-y-auto p-5">
              {generating && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                  <div className="relative">
                    <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary animate-pulse">
                      <Sparkles className="h-6 w-6" />
                    </div>
                    <Loader2 className="h-5 w-5 text-primary animate-spin absolute -bottom-1 -right-1" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">AI 正在深度思考规划中...</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      正在根据山羊胡全站生态知识库严选站点、编排结构并执行 100% 声明式 Schema 校验。
                    </p>
                  </div>
                </div>
              )}

              {!generating && !manifest && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                  <div className="h-12 w-12 rounded-2xl bg-muted/50 border border-border flex items-center justify-center text-muted-foreground">
                    <Wand2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">暂无生成产物</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      请在左侧输入您的插件构想，或点击快捷灵感预设，由 AI 瞬间为您生成实装沙箱。
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 1-3：三个面板已拆出（见 ./studio-*-panel.tsx），门控条件保持不变 */}
              {!generating && manifest && activeTab === 'sandbox' && (
                <StudioSandboxPanel
                  manifest={manifest}
                  generating={generating}
                  liveThemeActive={liveThemeActive}
                  setLiveThemeActive={setLiveThemeActive}
                  searchTestQuery={searchTestQuery}
                  setSearchTestQuery={setSearchTestQuery}
                  selectedEngineIndex={selectedEngineIndex}
                  setSelectedEngineIndex={setSelectedEngineIndex}
                  sitePackCategoryFilter={sitePackCategoryFilter}
                  setSitePackCategoryFilter={setSitePackCategoryFilter}
                />
              )}
              {!generating && manifest && activeTab === 'json' && (
                <StudioJsonPanel
                  manifest={manifest}
                  manifestDiff={manifestDiff}
                  previousManifest={previousManifest}
                  activeJsonSubTab={activeJsonSubTab}
                  setActiveJsonSubTab={setActiveJsonSubTab}
                  generating={generating}
                />
              )}
              {!generating && manifest && activeTab === 'health' && (
                <StudioHealthPanel
                  extractedUrls={extractedUrls}
                  urlCheckResults={urlCheckResults}
                  checkingUrls={checkingUrls}
                  handleCheckUrls={handleCheckUrls}
                  preAuditReport={preAuditReport}
                  autoFixing={autoFixing}
                  handleAutoFix={handleAutoFix}
                />
              )}
            </div>

            {/* 成功发布状态卡（AI 严审通过与四维指标证书） */}
            {publishedPlugin && (
              <div className="p-4 mx-4 mb-3 rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-primary/10 shadow-sm space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="text-xs font-bold text-foreground">
                          {publishedPlugin.status === 'published'
                            ? '🎉 AI 专业级审查认证通过 · 即时全网上架'
                            : '🚀 插件已成功提交至审核队列'}
                        </span>
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-medium">
                          {publishedPlugin.status === 'published' ? '已上架' : '待审核'}
                        </Badge>
                        {publishedPlugin.audit?.score && (
                          <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 font-mono">
                            综合分: {publishedPlugin.audit.score}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xl">
                        {/* 审理缺席时不能再补一句「外链全部正常、双索引已建立」：那是替没人确认的事签字 */}
                        {publishedPlugin.audit?.aiRationale ??
                          (publishedPlugin.audit
                            ? '本次审理未返回文字结论；下方显示「未测」的维度代表本次没有测量，不是低分。'
                            : '上架结果已提交，审计结论以插件详情页为准。')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onOpenChange(false)
                        router.push('/marketplace/mine')
                      }}
                      className="h-7 text-xs gap-1 bg-background"
                    >
                      <span>作者中心</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        onOpenChange(false)
                        router.push(`/marketplace/${encodeURIComponent(publishedPlugin.slug)}`)
                      }}
                      className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    >
                      <span>在市场中查看</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {publishedPlugin.audit?.dimensionScores && (
                  <div className="grid grid-cols-2 min-[420px]:grid-cols-4 gap-2 pt-1 border-t border-emerald-500/20 text-[11px]">
                    <AuditDimensionTile label="静态安全沙箱" value={publishedPlugin.audit.dimensionScores.security} className="p-1.5 text-center bg-background/60" />
                    <AuditDimensionTile label="外链探活可用率" value={publishedPlugin.audit.dimensionScores.availability} className="p-1.5 text-center bg-background/60" />
                    <AuditDimensionTile label="AI 合规反欺诈" value={publishedPlugin.audit.dimensionScores.compliance} className="p-1.5 text-center bg-background/60" />
                    <AuditDimensionTile label="语义相关性" value={publishedPlugin.audit.dimensionScores.relevance} className="p-1.5 text-center bg-background/60" />
                  </div>
                )}
              </div>
            )}

            {/* 底部操作工具栏 */}
            <div className="px-3.5 sm:px-5 py-2.5 sm:py-3 border-t border-border bg-card/60 flex flex-wrap gap-2 items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {manifest && (
                  <>
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <span
                        className={
                          generationModel
                            ? 'h-1.5 w-1.5 rounded-full bg-emerald-500'
                            : 'h-1.5 w-1.5 rounded-full bg-muted-foreground/40'
                        }
                      />
                      {/* 中枢没回报模型名时不许顶一个默认厂商名：那等于替别人认领这份产物的出处 */}
                      <span>{generationModel ?? '中枢未回报模型名'}</span>
                    </span>
                    {latencyMs && <span>· 耗时 {latencyMs}ms</span>}
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {manifest && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={preAuditing}
                      onClick={handlePreAudit}
                      className="h-8 text-xs gap-1.5"
                    >
                      {preAuditing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>预检中...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                          <span>AI 提交前预检</span>
                        </>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={autoFixing}
                      onClick={handleAutoFix}
                      className="h-8 text-xs gap-1.5 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    >
                      {autoFixing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>智能优化中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>✨ 一键自动修复</span>
                        </>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleDownloadJson}
                      className="h-8 text-xs gap-1.5"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>下载清单 (.json)</span>
                    </Button>

                    <Button
                      size="sm"
                      disabled={publishing || Boolean(publishedPlugin)}
                      onClick={handlePublishToMarketplace}
                      className="h-8 text-xs gap-1.5 bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-700 text-primary-foreground font-medium shadow-md"
                    >
                      {publishing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>AI 正在执行专业级严审...</span>
                        </>
                      ) : publishedPlugin ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>AI 严审通过 · 已上架市场</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">
                            {initialSlug ? '🚀 提交新版本到插件市场 (AI 自动审核)' : '🚀 直接提交到插件市场 (AI 智能免审即发)'}
                          </span>
                          <span className="sm:hidden">
                            {initialSlug ? '🚀 提交新版本' : '🚀 提交发布'}
                          </span>
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
