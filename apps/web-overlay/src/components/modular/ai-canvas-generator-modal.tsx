'use client'

import React, { useState } from 'react'
import { X, Sparkles, Wand2, Loader2, Check, ArrowRight, Layers, LayoutGrid, Info } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { useOverlayBehavior } from '@/components/ui/overlay'
import { generateAiCanvas, type HubAiCanvasGenerateResult } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { WIDGET_REGISTRY } from '@/lib/modular/registry'
import type { ModularPageLayout } from '@/types/modular'

interface AiCanvasGeneratorModalProps {
  isOpen: boolean
  onClose: () => void
  onApplyLayout: (layout: ModularPageLayout, mode: 'replace' | 'new-board') => void
  availableCategories?: string[]
}

const PRESET_PROMPTS = [
  {
    tag: '全栈开发',
    title: '全栈工程师工作站',
    prompt: '为全栈开发者规划一个看板：包含技术全网搜索、常用工具收藏底座、GitHub代码贡献热力图、随手便签与热门趋势。',
  },
  {
    tag: 'SRE运维',
    title: 'SRE 与云原生监控屏',
    prompt: '规划一个针对系统运维与SRE工程师的仪表盘：包含站点指标、即时快捷小工具、RSS运维资讯与核心监控控制台。',
  },
  {
    tag: 'AI 研究',
    title: 'AI 极客与论文研究室',
    prompt: '专为人工智能研究员设计：包含学术模型搜索、精选AI工具导航、技术雷达与深度笔记便签。',
  },
  {
    tag: '极简日常',
    title: '极简专注生产力',
    prompt: '极简风格日常工作台：包含翻页时钟、当地实时天气、常用高频书签底座与每日轻量待办。',
  },
]

export function AiCanvasGeneratorModal({
  isOpen,
  onClose,
  onApplyLayout,
  availableCategories,
}: AiCanvasGeneratorModalProps) {
  const { containerProps, scrim } = useOverlayBehavior({ open: isOpen, onClose })
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].prompt)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<HubAiCanvasGenerateResult | null>(null)

  if (!isOpen) return null

  async function handleGenerate() {
    if (!prompt.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await generateAiCanvas(getIdentity(), prompt.trim(), availableCategories)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 规划工作台失败，请确认模型配置或网络连接')
    } finally {
      setLoading(false)
    }
  }

  function handleApply(mode: 'replace' | 'new-board') {
    if (!result?.layout) return
    onApplyLayout(result.layout, mode)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {scrim}
      <div
        {...containerProps}
        className="relative w-full max-w-2xl bg-background border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88dvh] outline-none"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">一句话 AI 生成工作台</h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  Agnes 3.0 Flash 智能规划
                </span>
              </div>
              <p className="text-xs text-muted-foreground">输入工作场景或需求，由大模型为您量身编排 12 栅格微组件组合</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="关闭" title="关闭" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* 内容区 */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* 预设情境快捷选择 */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">情境灵感推荐：</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_PROMPTS.map((p) => (
                <button
                  key={p.tag}
                  type="button"
                  onClick={() => setPrompt(p.prompt)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                    prompt === p.prompt
                      ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-300 font-medium'
                      : 'border-border/70 bg-card/60 hover:bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.tag}
                </button>
              ))}
            </div>
          </div>

          {/* 需求描述输入框 */}
          <div className="space-y-1.5">
            <label htmlFor="ai-canvas-prompt" className="text-xs font-semibold text-foreground">
              请描述您期望的工作台目标或角色：
            </label>
            <textarea
              id="ai-canvas-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：我是一名独立出海开发者，需要包含跨国搜索、外汇时钟、GitHub热力图与便签..."
              className="w-full text-xs p-3 rounded-xl border border-border bg-background/50 focus:bg-background focus:ring-1 focus:ring-purple-500 outline-none resize-none transition-all leading-relaxed"
            />
          </div>

          {/* 生成动作 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 text-purple-500" />
              <span>智能根据 12 栅格排版规律合理分配组件尺寸与位置</span>
            </div>
            <Button
              type="button"
              disabled={loading || !prompt.trim()}
              onClick={() => void handleGenerate()}
              className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs h-8 px-4 gap-1.5 shadow-xs"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>正在深度规划布局…</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>立即生成工作台</span>
                </>
              )}
            </Button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 text-xs">
              {error}
            </div>
          )}

          {/* 生成结果展示卡片 */}
          {result && (
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-start justify-between gap-3 border-b border-border/40 pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground">{result.layout.title}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300">
                      {result.layout.widgets.length} 个规划组件 · {result.latencyMs}ms
                    </span>
                  </div>
                  {result.layout.description && (
                    <p className="text-xs text-muted-foreground">{result.layout.description}</p>
                  )}
                </div>
              </div>

              {result.layout.rationale && (
                <div className="p-2.5 rounded-lg bg-background/60 border border-border/50 text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">💡 规划思路：</span>
                  {result.layout.rationale}
                </div>
              )}

              {/* 组件矩阵预览 */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-foreground">包含组件清单：</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {result.layout.widgets.map((w, idx) => {
                    const reg = WIDGET_REGISTRY[w.type]
                    return (
                      <div
                        key={w.id || idx}
                        className="p-2.5 rounded-lg border border-border/60 bg-background/80 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-300 flex items-center justify-center text-[10px] font-mono">
                            #{idx + 1}
                          </span>
                          <div className="truncate">
                            <span className="font-medium text-foreground">{w.customTitle || reg?.title || w.type}</span>
                            <span className="text-muted-foreground text-[10px] ml-1.5 font-mono">
                              ({reg?.title || w.type})
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap">
                          宽 {w.colSpan}/12 · 高 {w.rowSpan}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 应用操作按钮组 */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs h-8 px-3 gap-1"
                  onClick={() => handleApply('new-board')}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>添加为新看板标签</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs h-8 px-3 gap-1 shadow-xs"
                  onClick={() => handleApply('replace')}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>覆盖当前看板</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
