'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  X,
  Send,
  Loader2,
  RotateCcw,
  Bot,
  User,
  Wand2,
  HelpCircle,
  ExternalLink,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { chatWithUserLlm, type HubAiChatMessage } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'

// 时间取值收敛到模块作用域：调用点都在事件处理器/惰性初始化里，
// 直接写在组件体内会被 react-hooks/purity 判为渲染期副作用。
const nowMs = () => Date.now()

interface MessageItem extends HubAiChatMessage {
  id: string
  model?: string
  latencyMs?: number
  timestamp: number
}

const DEFAULT_SUGGESTIONS = [
  '✨ 帮我规划一个现代化前端工程开发工作台',
  '📋 分析我的书签分类并给出智能化归类整理建议',
  '🛠 推荐 5 个好用且现代化的开源 API 测试与调试工具',
  '⚡ 告诉我 NavHub 目前支持的搜索前缀直达规则有哪些',
]

export function AiCopilotDrawer() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<MessageItem[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '你好！我是你的专属 **NavHub Web Copilot**，基于 **Agnes 3.0 Flash** 驱动。\n\n我可以帮你整理书签、规划工作台布局、推荐优质工具或回答任何技术问题。你可以随时按 `Ctrl+J` 或 `⌘J` 呼出我。',
      timestamp: nowMs(),
    },
  ])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 快捷键绑定：Ctrl+J / ⌘J 全局切换呼出
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen])

  // 消息自动滚到底部
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  async function handleSend(textToSend?: string) {
    const query = (textToSend ?? input).trim()
    if (!query || loading) return

    const userMsg: MessageItem = {
      id: `msg-${nowMs()}-u`,
      role: 'user',
      content: query,
      timestamp: nowMs(),
    }

    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)

    try {
      // 提取最近的对话上下文发给服务端（保留最近 10 条历史）
      const apiMessages: HubAiChatMessage[] = nextMessages
        .filter((m) => m.id !== 'welcome')
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))

      const res = await chatWithUserLlm(getIdentity(), apiMessages, 1024, {
        activeTab: typeof window !== 'undefined' ? window.location.pathname : undefined,
      })

      const botMsg: MessageItem = {
        id: `msg-${nowMs()}-a`,
        role: 'assistant',
        content: res.reply,
        model: res.model,
        latencyMs: res.latencyMs,
        timestamp: nowMs(),
      }
      setMessages((prev) => [...prev, botMsg])
    } catch (err) {
      const errorMsg: MessageItem = {
        id: `msg-${nowMs()}-err`,
        role: 'assistant',
        content: `⚠️ 对话失败：${err instanceof Error ? err.message : '网络异常或模型配置无效'}。\n可在「偏好设置 -> AI 模型」中检查配置或测试连通性。`,
        timestamp: nowMs(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: '对话已重置。有什么我可以帮你的？随时输入需求或点击下方建议标签。',
        timestamp: nowMs(),
      },
    ])
  }

  return (
    <>
      {/* 全局悬浮触发胶囊 */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 group flex items-center gap-2 px-3 py-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 border border-primary-foreground/20"
          title="点击或按 Ctrl+J / ⌘J 呼出 AI 智能副驾"
          aria-label="呼出 AI 智能副驾"
        >
          <div className="relative flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary-foreground animate-pulse" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-400" />
          </div>
          <span className="text-xs font-semibold tracking-wide pr-1 hidden sm:inline-block">AI 副驾</span>
          <span className="text-[10px] font-mono opacity-70 px-1 py-0.2 rounded bg-black/20 hidden md:inline-block">
            ⌘J
          </span>
        </button>
      )}

      {/* 浮窗抽屉面板 */}
      {isOpen && (
        <div className="fixed bottom-6 right-4 sm:right-6 z-50 w-[94vw] sm:w-[420px] h-[580px] max-h-[85vh] bg-background/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* 面板顶栏 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/30">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold text-foreground">NavHub Web Copilot</h3>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">Agnes 3.0 Flash 默认模型</span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                title="清空对话"
                onClick={handleReset}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                title="关闭 (Esc / ⌘J)"
                onClick={() => setIsOpen(false)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* 消息滚动流 */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 text-xs">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 leading-relaxed break-words shadow-2xs whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground font-medium rounded-tr-xs'
                      : 'bg-muted/40 border border-border/60 text-foreground rounded-tl-xs'
                  }`}
                >
                  {m.content}
                  {m.latencyMs !== undefined && (
                    <div className="mt-1 pt-1 border-t border-border/30 text-[10px] font-mono text-muted-foreground/75 flex items-center justify-between">
                      <span>{m.model || 'Agnes 3.0'}</span>
                      <span>⚡ {m.latencyMs}ms</span>
                    </div>
                  )}
                </div>

                {m.role === 'user' && (
                  <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs py-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
                <span>Agnes 正在深度思考生成回答…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 快捷引导提示词 */}
          {messages.length <= 2 && (
            <div className="px-3 pb-2 pt-1 border-t border-border/40 bg-muted/10 space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground">推荐提问：</span>
              <div className="flex flex-col gap-1">
                {DEFAULT_SUGGESTIONS.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => void handleSend(s)}
                    className="text-left text-[11px] px-2 py-1 rounded-lg border border-border/60 bg-background/50 hover:bg-background text-muted-foreground hover:text-foreground transition-colors truncate"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 底部输入框 */}
          <div className="p-3 border-t border-border/60 bg-muted/20">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleSend()
              }}
              className="flex items-center gap-1.5"
            >
              <textarea
                ref={inputRef}
                aria-label="给 Agnes 发送指令或提问"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
                placeholder="给 Agnes 发送指令或提问（Enter 发送）…"
                className="flex-1 text-xs px-3 py-2 rounded-xl border border-border/80 bg-background outline-none focus:ring-1 focus:ring-primary resize-none max-h-20"
              />
              <Button
                type="submit"
                size="sm"
                disabled={loading || !input.trim()}
                className="h-8 w-8 p-0 rounded-xl bg-primary text-primary-foreground shrink-0 shadow-xs"
                title="发送"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            </form>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1.5 px-1 font-mono">
              <span>Shift+Enter 换行</span>
              <span>基于 NavHub 统一网关</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
