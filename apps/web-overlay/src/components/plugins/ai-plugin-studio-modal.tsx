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

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  generateAiPlugin,
  publishPlugin,
  submitPluginVersion,
  preAuditPlugin,
  autoFixPlugin,
  checkPluginUrls,
  type HubPluginItem,
  type HubPluginAuditReport,
} from '@/lib/navhub-api'
import {
  type PluginKind,
  type PluginManifest,
  type SitePackPayload,
  type ThemePayload,
  type SearchPackPayload,
  type WorkspacePresetPayload,
  type BundlePayload,
  THEME_ACCENTS,
} from '@/lib/plugins/plugin-manifest'
import { copyText } from '@/lib/clipboard'
import {
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  Download,
  Search,
  Globe,
  Palette,
  Layers,
  FileCode2,
  Activity,
  RotateCcw,
  Sliders,
  Wand2,
  Eye,
  ArrowRight,
  ShieldCheck,
  Check,
  Info,
  GitCompare,
  Plus,
  Minus,
  Filter,
  Code2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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
  const [rationale, setRationale] = useState('')
  const [reasoningContent, setReasoningContent] = useState<string | undefined>()
  const [generationModel, setGenerationModel] = useState<string>('agnes-3.0-flash')
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
  const [autoFixLogs, setAutoFixLogs] = useState<string[]>([])

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
      setEditAuthor(manifest.author || 'NavHub 创作者')
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

  // 计算版本前后变更清单 (Diff Inspector)
  const manifestDiff = useMemo(() => {
    if (!manifest || !previousManifest) return null

    const prevSites: Array<{ title: string; url: string; category?: string }> =
      previousManifest.kind === 'site-pack' ? (previousManifest.payload as SitePackPayload).sites || [] : []
    const currSites: Array<{ title: string; url: string; category?: string }> =
      manifest.kind === 'site-pack' ? (manifest.payload as SitePackPayload).sites || [] : []

    const prevSiteMap = new Map(prevSites.map((s) => [s.url.trim().toLowerCase(), s]))
    const currSiteMap = new Map(currSites.map((s) => [s.url.trim().toLowerCase(), s]))

    const addedSites = currSites.filter((s) => !prevSiteMap.has(s.url.trim().toLowerCase()))
    const removedSites = prevSites.filter((s) => !currSiteMap.has(s.url.trim().toLowerCase()))

    const prevEngines =
      previousManifest.kind === 'search-pack' ? (previousManifest.payload as SearchPackPayload).engines || [] : []
    const currEngines =
      manifest.kind === 'search-pack' ? (manifest.payload as SearchPackPayload).engines || [] : []
    const prevEngPrefixes = new Set(prevEngines.map((e) => e.prefix))
    const currEngPrefixes = new Set(currEngines.map((e) => e.prefix))
    const addedEngines = currEngines.filter((e) => !prevEngPrefixes.has(e.prefix))
    const removedEngines = prevEngines.filter((e) => !currEngPrefixes.has(e.prefix))

    const prevTags = new Set(previousManifest.tags || [])
    const currTags = new Set(manifest.tags || [])
    const addedTags = (manifest.tags || []).filter((t) => !prevTags.has(t))
    const removedTags = (previousManifest.tags || []).filter((t) => !currTags.has(t))

    const versionChange =
      previousManifest.version !== manifest.version
        ? { from: previousManifest.version, to: manifest.version }
        : undefined
    const nameChange =
      previousManifest.name !== manifest.name
        ? { from: previousManifest.name, to: manifest.name }
        : undefined

    const hasChanges = Boolean(
      addedSites.length > 0 ||
        removedSites.length > 0 ||
        addedEngines.length > 0 ||
        removedEngines.length > 0 ||
        addedTags.length > 0 ||
        removedTags.length > 0 ||
        versionChange ||
        nameChange
    )

    return {
      hasChanges,
      addedSites,
      removedSites,
      addedEngines,
      removedEngines,
      addedTags,
      removedTags,
      versionChange,
      nameChange,
    }
  }, [manifest, previousManifest])

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
        setGenerationModel(res.model || 'agnes-3.0-flash')
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
    const updated: PluginManifest = {
      ...manifest,
      name: editName.trim() || manifest.name,
      description: editDescription.trim(),
      author: editAuthor.trim() || manifest.author,
      version: editVersion.trim() || manifest.version,
      tags: editTags
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    }
    setManifest(updated)
    toast.success('元数据已更新')
  }

  // 提取清单内所有外部 URL
  const extractedUrls = useMemo(() => {
    if (!manifest) return []
    const urls: string[] = []
    if (manifest.kind === 'site-pack') {
      const payload = manifest.payload as SitePackPayload
      if (Array.isArray(payload.sites)) {
        for (const s of payload.sites) {
          if (s.url) urls.push(s.url)
        }
      }
    } else if (manifest.kind === 'search-pack') {
      const payload = manifest.payload as SearchPackPayload
      if (Array.isArray(payload.engines)) {
        for (const e of payload.engines) {
          if (e.searchUrl) {
            // 将 {q} 替换为测试词后提取域名检测
            urls.push(e.searchUrl.replace(/\{q\}/g, 'navhub'))
          }
        }
      }
    }
    return Array.from(new Set(urls)).slice(0, 30)
  }, [manifest])

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
                  Agnes 3.0 Flash 驱动
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
                      ? 'Agnes 3.0 Flash 正在深度思考规划中（通常需 10~25 秒）...'
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
                        {h.role === 'user' ? '用户需求' : 'Agnes 3.0 Flash 规划'}
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
                    <h4 className="text-sm font-semibold">Agnes 3.0 Flash 正在深度思考规划中...</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      正在根据 NavHub 全站生态知识库严选站点、编排结构并执行 100% 声明式 Schema 校验。
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

              {!generating && manifest && activeTab === 'sandbox' && (
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
                                  href={site.url}
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
                              href={previewUrl}
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
              )}

              {/* Tab 2: 声明式 JSON 检查器 与 演进 Diff */}
              {!generating && manifest && activeTab === 'json' && (
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
                        onClick={() => copyText(JSON.stringify(manifest, null, 2))}
                        className="h-7 text-xs gap-1"
                      >
                        <Copy className="h-3 w-3" />
                        <span>复制 JSON</span>
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
                          <GitCompare className="h-8 w-8 mx-auto text-muted-foreground/60" />
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
                                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                  +{manifestDiff!.addedSites.length} 个
                                </span>
                              </div>
                            )}
                            {manifestDiff!.removedSites.length > 0 && (
                              <div className="p-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-xs">
                                <span className="text-[10px] text-muted-foreground block">移除站点实体</span>
                                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                                  -{manifestDiff!.removedSites.length} 个
                                </span>
                              </div>
                            )}
                            {manifestDiff!.addedEngines.length > 0 && (
                              <div className="p-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs">
                                <span className="text-[10px] text-muted-foreground block">新增搜索引擎</span>
                                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
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
                                <span className="text-emerald-600 font-mono text-[11px] font-medium">+1 site</span>
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
                                <span className="text-rose-600 font-mono text-[11px] font-medium">-1 site</span>
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
              )}

              {/* Tab 3: 自动化体检中心 */}
              {!generating && manifest && activeTab === 'health' && (
                <div className="space-y-4">
                  {/* AI 提交前预检报告雷达面板 */}
                  {preAuditReport && (
                    <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <ShieldCheck className="h-4 w-4 text-primary" />
                          <span className="text-xs font-bold text-foreground">AI 智能预检多维严审评分</span>
                          <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 font-mono">
                            {preAuditReport.score}分 · {preAuditReport.level.toUpperCase()}级
                          </Badge>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          审查模型: {preAuditReport.model}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                          <div className="text-[10px] text-muted-foreground">静态安全 (30%)</div>
                          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            {preAuditReport.dimensionScores?.security}分
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                          <div className="text-[10px] text-muted-foreground">外链探活 (25%)</div>
                          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            {preAuditReport.dimensionScores?.availability}分
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                          <div className="text-[10px] text-muted-foreground">AI 合规 (25%)</div>
                          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            {preAuditReport.dimensionScores?.compliance}分
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                          <div className="text-[10px] text-muted-foreground">语义相关 (20%)</div>
                          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            {preAuditReport.dimensionScores?.relevance}分
                          </div>
                        </div>
                      </div>

                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {preAuditReport.aiRationale}
                      </p>

                      {preAuditReport.suggestions && preAuditReport.suggestions.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] space-y-1">
                          <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              <span>AI 优化整改建议 ({preAuditReport.suggestions.length}条)：</span>
                            </span>
                            <button
                              type="button"
                              onClick={handleAutoFix}
                              disabled={autoFixing}
                              className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-800 dark:text-amber-200 transition-colors font-medium flex items-center gap-1"
                            >
                              <Sparkles className="h-2.5 w-2.5" />
                              <span>点击一键自动修复</span>
                            </button>
                          </div>
                          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground pl-1">
                            {preAuditReport.suggestions.map((s, idx) => (
                              <li key={idx}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-4 rounded-xl border border-border bg-card space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <ShieldCheck className="h-4 w-4 text-emerald-500" />
                          <span>全清单连通性与死链嗅探体检</span>
                        </h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          受限出网安全沙箱并发探活，防止提交失效死链到插件市场。
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={checkingUrls || extractedUrls.length === 0}
                        onClick={handleCheckUrls}
                        className="h-7 text-xs gap-1.5"
                      >
                        {checkingUrls ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>正在并发检测...</span>
                          </>
                        ) : (
                          <>
                            <Activity className="h-3 w-3" />
                            <span>一键开始检测 ({extractedUrls.length}个链接)</span>
                          </>
                        )}
                      </Button>
                    </div>

                    {urlCheckResults && (
                      <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
                        <div className="p-2 rounded-lg bg-muted/50 border border-border">
                          <div className="text-lg font-bold">{urlCheckResults.total}</div>
                          <div className="text-[10px] text-muted-foreground">检测总数</div>
                        </div>
                        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                          <div className="text-lg font-bold">{urlCheckResults.okCount}</div>
                          <div className="text-[10px]">健康正常</div>
                        </div>
                        <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
                          <div className="text-lg font-bold">{urlCheckResults.failedCount}</div>
                          <div className="text-[10px]">异常或超时</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {urlCheckResults && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">详细探活日志：</span>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {urlCheckResults.results.map((r, i) => (
                          <div
                            key={i}
                            className={cn(
                              'px-3 py-1.5 rounded-lg border text-xs flex items-center justify-between font-mono',
                              r.ok
                                ? 'bg-emerald-500/5 border-emerald-500/20 text-foreground'
                                : 'bg-rose-500/5 border-rose-500/20 text-rose-600 dark:text-rose-400'
                            )}
                          >
                            <span className="truncate max-w-[400px]">{r.url}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span>{r.ok ? `HTTP ${r.status || 200}` : (r.error || '失败')}</span>
                              {r.ok ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
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
                        {publishedPlugin.audit?.aiRationale || '所有外链探活正常，声明式规范合规，已自动建立向量与全文双索引。'}
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
                    <div className="p-1.5 rounded-lg bg-background/60 border border-border/50 text-center">
                      <div className="text-[10px] text-muted-foreground">静态安全沙箱</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {publishedPlugin.audit.dimensionScores.security}分
                      </div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-background/60 border border-border/50 text-center">
                      <div className="text-[10px] text-muted-foreground">外链探活可用率</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {publishedPlugin.audit.dimensionScores.availability}分
                      </div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-background/60 border border-border/50 text-center">
                      <div className="text-[10px] text-muted-foreground">AI 合规反欺诈</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {publishedPlugin.audit.dimensionScores.compliance}分
                      </div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-background/60 border border-border/50 text-center">
                      <div className="text-[10px] text-muted-foreground">语义相关性</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {publishedPlugin.audit.dimensionScores.relevance}分
                      </div>
                    </div>
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
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span>{generationModel}</span>
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
