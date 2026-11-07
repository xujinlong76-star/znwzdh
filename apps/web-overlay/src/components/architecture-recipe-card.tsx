'use client'

import { useState, useEffect } from 'react'
import { safeHref } from '@/lib/safe-url'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/registry/new-york/ui/button'
import {
  Layers,
  ExternalLink,
  Copy,
  Check,
  Terminal,
  X,
  Sparkles,
  Loader2,
  Code2,
  KeyRound,
  ListChecks,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  CheckCircle2,
} from 'lucide-react'
import type { ArchitectureRecipe } from '@/lib/architecture-recipe'
import { copyText } from '@/lib/clipboard'

interface ArchitectureRecipeCardProps {
  recipe: ArchitectureRecipe
}

interface RecipeScaffoldData {
  recipeType: 'coding_tech' | 'creator_business'
  envTemplate?: string
  glueCodeSnippet?: {
    filename: string
    language: string
    content: string
    explanation: string
  }
  cliQuickStart?: string
  sopChecklist: Array<{
    step: number
    title: string
    toolName: string
    action: string
    pitfallWarning: string
  }>
  model?: string
}

export function ArchitectureRecipeCard({ recipe }: ArchitectureRecipeCardProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [scaffoldOpen, setScaffoldOpen] = useState(false)
  const [scaffoldLoading, setScaffoldLoading] = useState(false)
  const [scaffoldData, setScaffoldData] = useState<RecipeScaffoldData | null>(null)
  const [scaffoldError, setScaffoldError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'env' | 'glue' | 'sop'>('env')
  const [copyEnvState, setCopyEnvState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [copyGlueState, setCopyGlueState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [copyPlaybookState, setCopyPlaybookState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [completedSteps, setCompletedSteps] = useState<number[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`navhub_recipe_sop_${recipe.id}`)
      if (stored) {
        setCompletedSteps(JSON.parse(stored))
      }
    } catch {
      // ignore
    }
  }, [recipe.id])

  const toggleStep = (stepNum: number) => {
    setCompletedSteps((prev) => {
      const next = prev.includes(stepNum) ? prev.filter((s) => s !== stepNum) : [...prev, stepNum]
      try {
        localStorage.setItem(`navhub_recipe_sop_${recipe.id}`, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const handleCopy = async () => {
    if (!recipe.quickStartSnippet) return
    const result = await copyText(recipe.quickStartSnippet)
    setCopyState(result.ok ? 'copied' : 'failed')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  const handleCopyEnv = async () => {
    if (!scaffoldData?.envTemplate) return
    const result = await copyText(scaffoldData.envTemplate)
    setCopyEnvState(result.ok ? 'copied' : 'failed')
    setTimeout(() => setCopyEnvState('idle'), 2000)
  }

  const handleCopyGlue = async () => {
    if (!scaffoldData?.glueCodeSnippet?.content) return
    const result = await copyText(scaffoldData.glueCodeSnippet.content)
    setCopyGlueState(result.ok ? 'copied' : 'failed')
    setTimeout(() => setCopyGlueState('idle'), 2000)
  }

  const generatePlaybookMarkdown = () => {
    if (!scaffoldData) return ''
    const parts = [
      `# ${recipe.title} - 实战开工 Playbook`,
      `> 目标场景: ${recipe.targetGoal}`,
      '',
      '## 一、核心工具链矩阵',
      ...recipe.layers.map(
        (l, i) =>
          `${i + 1}. **[${l.layerName}] ${l.recommended.title}** - ${l.recommended.description || ''} (${l.recommended.url || ''})`
      ),
      '',
    ]

    if (scaffoldData.cliQuickStart) {
      parts.push('## 二、一键快速启动命令', '```bash', scaffoldData.cliQuickStart, '```', '')
    }

    if (scaffoldData.envTemplate) {
      parts.push('## 三、环境变量配置模板 (.env)', '```bash', scaffoldData.envTemplate, '```', '')
    }

    if (scaffoldData.glueCodeSnippet) {
      parts.push(
        `## 四、跨工具核心粘合代码 (${scaffoldData.glueCodeSnippet.filename})`,
        `> 说明: ${scaffoldData.glueCodeSnippet.explanation}`,
        '```' + (scaffoldData.glueCodeSnippet.language || 'typescript'),
        scaffoldData.glueCodeSnippet.content,
        '```',
        ''
      )
    }

    if (scaffoldData.sopChecklist && scaffoldData.sopChecklist.length > 0) {
      parts.push(
        '## 五、保姆级实战执行 SOP',
        ...scaffoldData.sopChecklist.map(
          (s) =>
            `${s.step}. [ ] **${s.title}** (${s.toolName}): ${s.action}\n   - ⚠️ 避坑提醒: ${s.pitfallWarning}`
        ),
        ''
      )
    }

    return parts.join('\n')
  }

  const handleCopyPlaybook = async () => {
    const md = generatePlaybookMarkdown()
    if (!md) return
    const res = await copyText(md)
    setCopyPlaybookState(res.ok ? 'copied' : 'failed')
    setTimeout(() => setCopyPlaybookState('idle'), 2000)
  }

  const handleDownloadPlaybook = () => {
    const md = generatePlaybookMarkdown()
    if (!md) return
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Playbook-${recipe.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleFetchScaffold = async () => {
    if (scaffoldData) {
      setScaffoldOpen((prev) => !prev)
      return
    }
    setScaffoldOpen(true)
    setScaffoldLoading(true)
    setScaffoldError(null)

    try {
      const res = await fetch('/api/hub/recipes/scaffold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipeTitle: recipe.title,
          targetGoal: recipe.targetGoal,
          layers: recipe.layers,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `请求失败 (${res.status})`)
      }
      setScaffoldData(json)
      if (json.envTemplate) {
        setActiveTab('env')
      } else if (json.glueCodeSnippet) {
        setActiveTab('glue')
      } else {
        setActiveTab('sop')
      }
    } catch (err: unknown) {
      setScaffoldError(err instanceof Error ? err.message : String(err))
    } finally {
      setScaffoldLoading(false)
    }
  }

  return (
    <div className="mx-2 mb-2 p-3.5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-primary/[0.02] to-transparent shadow-sm space-y-3">
      {/* 头部标题与描述 */}
      <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground">{recipe.title}</span>
              <Badge variant="outline" className="text-xs text-primary border-primary/30">
                Graph-RAG 架构配方
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{recipe.targetGoal}</p>
          </div>
        </div>
      </div>

      {/* 分层技术链条 */}
      <div className="space-y-2">
        {recipe.layers.map((layer, idx) => (
          <div
            key={idx}
            className="p-2 rounded-lg border bg-background/80 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">{layer.layerName}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {layer.category}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={safeHref(layer.recommended.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-primary hover:underline flex items-center gap-1"
                >
                  {layer.recommended.title}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span className="text-xs text-muted-foreground line-clamp-1">
                  - {layer.recommended.description}
                </span>
              </div>
            </div>

            {/* 可替代项 */}
            {layer.alternatives.length > 0 && (
              <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-muted-foreground">
                <span>平替:</span>
                {layer.alternatives.map((alt) => (
                  <a
                    key={alt.id}
                    href={safeHref(alt.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground underline decoration-dotted"
                  >
                    {alt.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 快速初始化命令 */}
      {recipe.quickStartSnippet && (
        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/60 border font-mono text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="truncate text-muted-foreground select-all">{recipe.quickStartSnippet}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="h-6.5 px-2 text-xs flex items-center gap-1 flex-shrink-0"
          >
            {copyState === 'copied' ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : copyState === 'failed' ? (
              <X className="w-3 h-3 text-destructive-text" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            <span>
              {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制命令'}
            </span>
          </Button>
        </div>
      )}

      {/* 📦 一键生成实战开工脚手架与 SOP 清单 (解决知行断层真实痛点) */}
      <div className="pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={handleFetchScaffold}
          className="w-full h-8 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
        >
          {scaffoldLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          )}
          <span>
            {scaffoldData
              ? scaffoldOpen
                ? '收起实战开工清单与配置 (Playbook)'
                : '展开实战开工清单与配置 (Playbook)'
              : '📦 ✨ AI 一键生成实战开工脚手架与 SOP 清单'}
          </span>
          {scaffoldData &&
            (scaffoldOpen ? (
              <ChevronUp className="w-3.5 h-3.5 ml-1" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 ml-1" />
            ))}
        </Button>

        {scaffoldError && (
          <div className="mt-2 p-2 rounded-lg bg-destructive/15 border border-destructive/20 text-xs text-destructive-text flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{scaffoldError}</span>
          </div>
        )}

        {scaffoldOpen && scaffoldData && (
          <div className="mt-2.5 p-3 rounded-xl border border-primary/20 bg-background/95 space-y-3 shadow-xs">
            {/* Tab 导航与全套导出 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <div className="flex items-center gap-1.5">
                {scaffoldData.envTemplate && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('env')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeTab === 'env'
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <KeyRound className="w-3 h-3" />
                    <span>环境变量 (.env)</span>
                  </button>
                )}

                {scaffoldData.glueCodeSnippet && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('glue')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeTab === 'glue'
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Code2 className="w-3 h-3" />
                    <span>最小粘合代码</span>
                  </button>
                )}

                {scaffoldData.sopChecklist && scaffoldData.sopChecklist.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('sop')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeTab === 'sop'
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <ListChecks className="w-3 h-3" />
                    <span>保姆级执行 SOP</span>
                    {completedSteps.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.2 rounded-full bg-primary/20 text-primary text-[10px]">
                        {completedSteps.length}/{scaffoldData.sopChecklist.length}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* 全套导出入口 */}
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopyPlaybook}
                  className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  title="复制完整 Markdown 格式实战手册"
                >
                  {copyPlaybookState === 'copied' ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : copyPlaybookState === 'failed' ? (
                    <X className="w-3 h-3 text-destructive-text" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copyPlaybookState === 'copied' ? '已复制 Playbook' : '复制全套 Playbook'}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDownloadPlaybook}
                  className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  title="下载 Markdown 文件至本地工程"
                >
                  <Download className="w-3 h-3" />
                  <span>导出 .md</span>
                </Button>
              </div>
            </div>

            {/* Tab 1: 环境变量模板 */}
            {activeTab === 'env' && scaffoldData.envTemplate && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>跨工具整合所需环境变量（带获取菜单路径说明）：</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleCopyEnv}
                    className="h-6 px-2 text-xs flex items-center gap-1 font-mono cursor-pointer"
                  >
                    {copyEnvState === 'copied' ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : copyEnvState === 'failed' ? (
                      <X className="w-3 h-3 text-destructive-text" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copyEnvState === 'copied' ? '已复制' : '复制 .env'}</span>
                  </Button>
                </div>
                <pre className="p-2.5 rounded-lg bg-muted/80 border font-mono text-[11px] leading-relaxed max-h-48 overflow-y-auto select-all text-foreground whitespace-pre-wrap">
                  {scaffoldData.envTemplate}
                </pre>
              </div>
            )}

            {/* Tab 2: 最小粘合代码 */}
            {activeTab === 'glue' && scaffoldData.glueCodeSnippet && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono font-bold text-foreground">
                      {scaffoldData.glueCodeSnippet.filename}
                    </span>
                    <span className="text-muted-foreground text-[11px] truncate">
                      ({scaffoldData.glueCodeSnippet.explanation})
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleCopyGlue}
                    className="h-6 px-2 text-xs flex items-center gap-1 font-mono flex-shrink-0 cursor-pointer"
                  >
                    {copyGlueState === 'copied' ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : copyGlueState === 'failed' ? (
                      <X className="w-3 h-3 text-destructive-text" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copyGlueState === 'copied' ? '已复制' : '复制代码'}</span>
                  </Button>
                </div>
                <pre className="p-2.5 rounded-lg bg-muted/80 border font-mono text-[11px] leading-relaxed max-h-56 overflow-y-auto select-all text-foreground whitespace-pre-wrap">
                  {scaffoldData.glueCodeSnippet.content}
                </pre>
              </div>
            )}

            {/* Tab 3: 保姆级执行 SOP */}
            {activeTab === 'sop' && scaffoldData.sopChecklist && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>勾选确认每一步实操进度（状态自动本地保存）：</span>
                  {completedSteps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCompletedSteps([])
                        try {
                          localStorage.removeItem(`navhub_recipe_sop_${recipe.id}`)
                        } catch {
                          // 本地存储不可用时静默降级
                        }
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                    >
                      清空勾选
                    </button>
                  )}
                </div>

                {completedSteps.length === scaffoldData.sopChecklist.length &&
                  scaffoldData.sopChecklist.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs flex items-center justify-between gap-2 shadow-2xs">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>🎉 恭喜！本配方的所有实战步骤已全部勾选就绪，可立即上线验证！</span>
                      </div>
                    </div>
                  )}

                <div className="space-y-2">
                  {scaffoldData.sopChecklist.map((step) => {
                    const isDone = completedSteps.includes(step.step)
                    return (
                      <div
                        key={step.step}
                        className={`p-2.5 rounded-lg border text-xs transition-colors space-y-1 ${
                          isDone
                            ? 'bg-primary/5 border-primary/30 opacity-70'
                            : 'bg-background hover:bg-muted/50 border-border/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isDone}
                              onChange={() => toggleStep(step.step)}
                              aria-label={`标记步骤完成：${step.step}`}
                              className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                            />
                            <span
                              className={`font-semibold ${
                                isDone ? 'line-through text-muted-foreground' : 'text-foreground'
                              }`}
                            >
                              第 {step.step} 步: {step.title}
                            </span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                            {step.toolName}
                          </span>
                        </div>
                        <p
                          className={`pl-5 text-[11px] leading-relaxed ${
                            isDone ? 'line-through text-muted-foreground' : 'text-foreground'
                          }`}
                        >
                          👉 {step.action}
                        </p>
                        {step.pitfallWarning && (
                          <p className="pl-5 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                            <span>避坑: {step.pitfallWarning}</span>
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
