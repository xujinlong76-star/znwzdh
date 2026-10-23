'use client'

/**
 * Agnes 3.0 Flash 智能导航伴侣抽屉 (AI Web Copilot Drawer)
 *
 * 核心能力：
 * 1. 全局唤醒：响应 Cmd+J / Ctrl+J 快捷键或 Spotlight 派发的 open-ai-copilot 事件；
 * 2. Agnes 3.0 Flash 统一驱动：基于最新全站现场图谱与分类，提供意图洞察与工具链推荐；
 * 3. 动态行动预设：一键发送极客效率、全站 AI 工具链、离线微工具、自治健康度等探索任务；
 * 4. Markdown 智能渲染：原生解析推荐站点直达超链 [标题](链接)，一键直达生态。
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles,
  X,
  Send,
  RotateCcw,
  Bot,
  User,
  Compass,
  ArrowRight,
  ExternalLink,
  Loader2,
  Wand2,
} from 'lucide-react'
import { sendCopilotChat } from '@/lib/navhub-api'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { AiPluginStudioModal } from '../plugins/ai-plugin-studio-modal'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  model?: string
  suggestions?: string[]
  timestamp: number
}

const PRESET_PROMPTS = [
  { icon: '✨', label: '自然语言生成插件', prompt: '帮我规划并生成一个前沿技术导航插件', action: 'open_studio' },
  { icon: '🚀', label: '前端开发效率神器', prompt: '请根据当前全站收录，推荐最适合现代前端全栈开发的提效工具链。' },
  { icon: '🤖', label: '盘点全站 AI 工具生态', prompt: '帮我盘点全站收录的核心 AI 工具与开源大模型平台，并给出对比建议。' },
  { icon: '🛠️', label: '离线极客微工具推荐', prompt: 'NavHub 有哪些支持断网纯离线运行的实用极客微工具？' },
  { icon: '🩺', label: '全站健康度与死链自愈', prompt: '帮我诊断当前全站有哪些异常或失效站点，并推荐对应的高活跃平替。' },
]

function isSafeMarkdownHref(rawUrl: string): boolean {
  const trimmed = rawUrl.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/')) {
    return !trimmed.startsWith('//')
  }
  return /^https?:\/\//i.test(trimmed)
}

export function AiCopilotDrawer() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [enableThinking, setEnableThinking] = useState(true)
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioPrompt, setStudioPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 滚动至最新消息
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  // 全局事件监听与快捷键
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ query?: string }>
      setIsOpen(true)
      if (customEvent.detail?.query) {
        handleSend(customEvent.detail.query)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    const handleOpenStudio = (e: Event) => {
      const ce = e as CustomEvent<{ prompt?: string }>
      setStudioPrompt(ce.detail?.prompt || '')
      setStudioOpen(true)
    }

    window.addEventListener('open-ai-copilot', handleOpen)
    window.addEventListener('open-ai-plugin-studio', handleOpenStudio)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('open-ai-copilot', handleOpen)
      window.removeEventListener('open-ai-plugin-studio', handleOpenStudio)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // 展开抽屉时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 150)
    }
  }, [isOpen])

  // 发送消息
  const handleSend = async (textToSend?: string) => {
    const content = (textToSend || input).trim()
    if (!content || loading) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await sendCopilotChat(content, history, { thinking: enableThinking })
      if (res.ok && res.reply) {
        const assistantMsg: ChatMessage = {
          id: `bot-${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          reasoningContent: res.reasoningContent,
          model: res.model || 'agnes-3.0-flash',
          suggestions: res.suggestions,
          timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, assistantMsg])
      } else {
        const fallbackMsg: ChatMessage = {
          id: `bot-${Date.now()}`,
          role: 'assistant',
          content: '抱歉，当前中枢智能问答服务无响应，请检查后端服务连接或稍后重试。',
          timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, fallbackMsg])
      }
    } catch {
      const errMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: '网络连接异常，无法连通 Agnes 3.0 Flash 智能中枢。',
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setLoading(false)
    }
  }

  // 安全 Markdown 超链接与排版解析（仅放行 http/https 与站内路径，阻断 javascript:/data: XSS）
  const renderMessageContent = (text: string) => {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g)
    return parts.map((part, idx) => {
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        const [, title, url] = linkMatch
        if (url && isSafeMarkdownHref(url)) {
          return (
            <a
              key={idx}
              href={url.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
            >
              <span>{title}</span>
              <ExternalLink className="h-3 w-3 inline" />
            </a>
          )
        }
        return <span key={idx}>{title}</span>
      }
      return <span key={idx}>{part}</span>
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label="Agnes 3.0 Flash 智能导航伴侣">
      {/* 遮罩背景 */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={() => setIsOpen(false)}
        role="presentation"
        aria-hidden="true"
      />

      {/* 抽屉主面板 */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <aside
          aria-label="Agnes 3.0 Flash 智能导航伴侣"
          className="w-screen max-w-md bg-background/95 backdrop-blur-2xl border-l border-border shadow-2xl flex flex-col transition-all duration-300 ease-in-out"
        >
          {/* Header 标头 */}
          <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/30">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
                <Sparkles className="h-4 w-4 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">
                    Agnes 3.0 Flash
                  </h2>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    系统默认
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">智慧导航伴侣 · 全站意图感知</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEnableThinking((prev) => !prev)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  enableThinking
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                }`}
                title="切换 Agnes 3.0 Flash 深度思考模式 (Native Thinking)"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${enableThinking ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                <span>深度思考</span>
              </button>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => setMessages([])}
                title="清空对话"
                disabled={messages.length === 0 || loading}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => setIsOpen(false)}
                title="关闭抽屉 (Esc)"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 消息滚动区域 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col justify-center items-center text-center px-4 py-8 space-y-6">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-primary/20 via-primary/10 to-transparent border border-primary/20 flex items-center justify-center shadow-inner">
                  <Bot className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-semibold text-foreground">您好，我是 Agnes</h3>
                  <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                    随时向我提问全站收录的工具、技术栈与高效站点。我已融合全站知识星图与实时健康度。
                  </p>
                </div>

                {/* 快捷推荐 Pills */}
                <div className="w-full space-y-2 pt-2">
                  <p className="text-[11px] font-medium text-muted-foreground/80 text-left px-1">
                    快速探索灵感：
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {PRESET_PROMPTS.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          if ((item as any).action === 'open_studio') {
                            setStudioPrompt(item.prompt)
                            setStudioOpen(true)
                          } else {
                            handleSend(item.prompt)
                          }
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-xl border border-border/70 bg-card/60 hover:bg-accent hover:border-primary/30 text-left transition-all duration-200 group text-xs text-foreground"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{item.icon}</span>
                          <span className="font-medium group-hover:text-primary transition-colors">
                            {item.label}
                          </span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' && (
                    <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary mt-0.5">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground font-medium rounded-tr-sm shadow-sm'
                        : 'bg-muted/60 border border-border/80 text-foreground rounded-tl-sm shadow-sm'
                    }`}
                  >
                    {/* Agnes 深度思考过程折叠块 */}
                    {m.reasoningContent && (
                      <details className="mb-2.5 rounded-lg border border-primary/20 bg-primary/5 p-2 text-[11px] overflow-hidden">
                        <summary className="cursor-pointer font-medium text-primary select-none flex items-center gap-1.5 hover:text-primary/80 transition-colors">
                          <span>🧠 思考推演过程</span>
                          <span className="text-[10px] text-muted-foreground font-normal">(点击折叠/展开)</span>
                        </summary>
                        <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground pl-2 border-l-2 border-primary/30">
                          {m.reasoningContent}
                        </div>
                      </details>
                    )}

                    <div className="whitespace-pre-wrap">{renderMessageContent(m.content)}</div>

                    {/* 智能意图：在 AI 插件工坊中打包为插件 */}
                    {m.role === 'assistant' && (m.content.includes('http') || m.content.includes('推荐') || m.content.includes('工具') || m.content.includes('插件')) && (
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setStudioPrompt(`基于上述推荐的工具生态，为我打包规划一个精选插件清单：\n${m.content.slice(0, 180)}...`)
                            setStudioOpen(true)
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gradient-to-r from-primary/10 to-violet-500/10 hover:from-primary/20 hover:to-violet-500/20 text-primary border border-primary/20 transition-all shadow-xs"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>在 AI 插件工坊中一键打包为插件</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    )}

                    {/* 推荐追问建议 */}
                    {m.suggestions && m.suggestions.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-border/60 space-y-1.5">
                        <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                          <Wand2 className="h-2.5 w-2.5" /> 建议探索：
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {m.suggestions.map((s, sIdx) => (
                            <button
                              key={sIdx}
                              onClick={() => handleSend(s)}
                              className="text-[11px] px-2 py-0.5 rounded-md bg-background/80 hover:bg-background border border-border/60 hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {m.role === 'user' && (
                    <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 text-muted-foreground mt-0.5">
                      <User className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              ))
            )}

            {/* 加载中的思考指示器 */}
            {loading && (
              <div className="flex gap-2.5 justify-start">
                <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary mt-0.5">
                  <Sparkles className="h-3.5 w-3.5 animate-spin" />
                </div>
                <div className="bg-muted/60 border border-border/80 rounded-2xl rounded-tl-sm px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>
                    {enableThinking
                      ? 'Agnes 3.0 Flash 正在展开深度思维链推理并检索全站知识库...'
                      : 'Agnes 3.0 Flash 正在组织回答...'}
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 底部输入框 */}
          <div className="p-3 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)] border-t border-border bg-card/50">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSend()
              }}
              className="relative rounded-xl border border-input bg-background/80 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all p-1"
            >
              <textarea
                ref={inputRef}
                aria-label="输入给 Agnes 的问题或需求"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                rows={2}
                placeholder="询问 Agnes 任何工具或需求... (Enter 发送)"
                disabled={loading}
                className="w-full resize-none bg-transparent px-3 py-2 text-base sm:text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
              />
              <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground border-t border-border/40">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEnableThinking((prev) => !prev)}
                    className={`inline-flex items-center gap-1 font-medium px-1.5 py-0.5 rounded transition-colors ${
                      enableThinking
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${enableThinking ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                    <span>深度思考{enableThinking ? '已开' : '关闭'}</span>
                  </button>
                  <span className="hidden sm:inline">·</span>
                  <div className="hidden sm:flex items-center gap-1">
                    <Compass className="h-3 w-3 text-primary" />
                    <span>Cmd/Ctrl+J 唤出</span>
                  </div>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || loading}
                  className="h-6 px-2.5 rounded-lg text-[11px] gap-1 shadow-sm"
                >
                  <span>发送</span>
                  <Send className="h-2.5 w-2.5" />
                </Button>
              </div>
            </form>
          </div>
        </aside>
      </div>

      {/* AI 插件工坊模态沙箱 */}
      <AiPluginStudioModal
        open={studioOpen}
        onOpenChange={setStudioOpen}
        initialPrompt={studioPrompt}
      />
    </div>
  )
}
