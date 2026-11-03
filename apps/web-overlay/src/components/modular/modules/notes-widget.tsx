'use client'

import React, { useState, useEffect, useRef } from 'react'
import { FileText, Eye, Edit3, Copy, Check, Plus, Trash2 } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { clearDoneTodos, countTodos, toggleTodoLine } from '@/lib/modular/workbench-utils'

const LEGACY_NOTES_KEY = 'navhub_modular_quick_notes'

interface NotesWidgetProps {
  widgetId?: string
  config?: Record<string, any>
}

export function NotesWidget({ widgetId }: NotesWidgetProps) {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'failed'>('saved')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 按小组件实例隔离持久化 Key，彻底消除多卡片覆盖 Bug
  const storageKey = widgetId ? `navhub_modular_quick_notes_${widgetId}` : LEGACY_NOTES_KEY

  useEffect(() => {
    try {
      let stored = localStorage.getItem(storageKey)
      // 本实例键为空时认领旧版全局便签：写入本实例键并删除旧键，
      // 保证只有一张便签继承旧内容，第二张不会再复制一份
      if (!stored && widgetId) {
        const legacy = localStorage.getItem(LEGACY_NOTES_KEY)
        if (legacy) {
          localStorage.setItem(storageKey, legacy)
          localStorage.removeItem(LEGACY_NOTES_KEY)
          stored = legacy
        }
      }

      if (stored) {
        setContent(stored)
      } else {
        setContent('## 🎯 极客工作台备忘\n- [x] 体验 12 栅格自适应模块化布局\n- [x] 体验主页站点 📌 一键固定到启动坞\n- [ ] 探索 GitHub 提交热力足迹\n- [ ] 尝试 Excalidraw 嵌入画板')
      }
    } catch {
      setSaveStatus('failed')
    }
  }, [storageKey, widgetId])

  // 卸载时清理在途防抖定时器：模块被删除后 600ms 内不应再触发写盘
  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    },
    []
  )

  const handleChange = (val: string) => {
    setContent(val)
    setSaveStatus('saving')

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, val)
        setSaveStatus('saved')
      } catch {
        setSaveStatus('failed')
      }
    }, 600)
  }

  // 复制必须确认真写进去了：曾经写过 navigator.clipboard?.writeText(content).then(...)，写入被拒时静默失败
  const handleCopy = async () => {
    const result = await copyText(content)
    if (!result.ok) {
      setCopied(false)
      setCopyError(result.reason)
      return
    }
    setCopyError(null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // 待办统计（只认行首待办）
  const { total: totalTodos, done: doneTodos } = countTodos(content)

  // 点击待办项目直接切换状态并持久化（无需切回源码手动改 [ ] 为 [x]）
  const toggleTodoAtLine = (lineIndex: number) => {
    const next = toggleTodoLine(content, lineIndex)
    if (next !== content) handleChange(next)
  }

  // 快速插入新待办
  const handleInsertTodo = () => {
    const next = content.trim() ? `${content}\n- [ ] ` : '- [ ] '
    handleChange(next)
    setMode('edit')
  }

  // 清除已完成待办
  const handleClearDone = () => {
    handleChange(clearDoneTodos(content))
  }

  // 极简轻量 Markdown 渲染器（增强待办可点击性）
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n')
    return (
      <div className="space-y-1.5 text-xs text-foreground/90 font-sans leading-relaxed select-text">
        {lines.map((line, index) => {
          const trimmed = line.trim()
          if (!trimmed) return <div key={index} className="h-1" />

          if (trimmed.startsWith('# ')) {
            return (
              <h3 key={index} className="text-sm font-bold text-foreground pt-1 pb-0.5 border-b border-border/40">
                {trimmed.slice(2)}
              </h3>
            )
          }
          if (trimmed.startsWith('## ')) {
            return (
              <h4 key={index} className="text-xs font-bold text-foreground pt-1">
                {trimmed.slice(3)}
              </h4>
            )
          }
          if (trimmed.startsWith('### ')) {
            return (
              <h5 key={index} className="text-xs font-semibold text-primary pt-0.5">
                {trimmed.slice(4)}
              </h5>
            )
          }

          // 待办事项 - [x] 与 - [ ]：支持直接点击切换
          if (trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) {
            return (
              <button
                type="button"
                key={index}
                onClick={() => toggleTodoAtLine(index)}
                className="w-full text-left flex items-center gap-2 text-muted-foreground line-through cursor-pointer select-none py-0.5 hover:text-foreground group/todo"
                title="点击取消勾选"
              >
                <input
                  aria-label="切换待办状态"
                  type="checkbox"
                  checked
                  onChange={() => toggleTodoAtLine(index)}
                  className="rounded text-primary h-3.5 w-3.5 cursor-pointer accent-primary shrink-0 pointer-events-none"
                />
                <span className="flex-1">{trimmed.slice(6)}</span>
              </button>
            )
          }
          if (trimmed.startsWith('- [ ] ')) {
            return (
              <button
                type="button"
                key={index}
                onClick={() => toggleTodoAtLine(index)}
                className="w-full text-left flex items-center gap-2 text-foreground cursor-pointer select-none py-0.5 hover:text-primary group/todo"
                title="点击完成待办"
              >
                <input
                  aria-label="切换待办状态"
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleTodoAtLine(index)}
                  className="rounded text-primary h-3.5 w-3.5 cursor-pointer accent-primary shrink-0 pointer-events-none"
                />
                <span className="flex-1">{trimmed.slice(6)}</span>
              </button>
            )
          }

          // 无序列表
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            return (
              <div key={index} className="flex items-start gap-1.5 pl-1.5">
                <span className="text-primary font-bold">•</span>
                <span>{trimmed.slice(2)}</span>
              </div>
            )
          }

          // 普通文本
          return (
            <p key={index} className="text-foreground/90">
              {trimmed}
            </p>
          )
        })}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none space-y-1.5">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <FileText className="w-3.5 h-3.5 text-emerald-500" />
          <span>随手便签与待办</span>
          {totalTodos > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-mono">
              {doneTodos}/{totalTodos}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* 快捷操作：添加待办 / 清理已完成 */}
          <button
            type="button"
            onClick={handleInsertTodo}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="快捷插入待办事项"
          >
            <Plus className="w-3 h-3" />
          </button>
          {doneTodos > 0 && (
            <button
              type="button"
              onClick={handleClearDone}
              className="p-1 rounded text-muted-foreground hover:text-amber-500 hover:bg-muted transition-colors"
              title="清理已完成待办"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}

          {/* 编辑 / 预览切换 */}
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/40">
            <button
              onClick={() => setMode('edit')}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
                mode === 'edit'
                  ? 'bg-background text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="编辑模式"
            >
              <Edit3 className="w-2.5 h-2.5" />
              <span>编辑</span>
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
                mode === 'preview'
                  ? 'bg-background text-foreground font-semibold shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Markdown 渲染预览 (支持直接点选待办)"
            >
              <Eye className="w-2.5 h-2.5" />
              <span>预览</span>
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="复制全文内容"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* 便签主体内容 */}
      <div className="flex-1 min-h-[90px] overflow-y-auto">
        {mode === 'edit' ? (
          <textarea
            aria-label="笔记内容（支持 Markdown）"
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="支持 Markdown 待办 (- [ ] 事项)、标题 (# )、列表 (- )..."
            className="w-full h-full resize-none bg-muted/20 border border-border/40 rounded-xl p-2.5 text-base sm:text-xs font-mono text-foreground outline-none focus:border-primary/50 transition-colors leading-relaxed"
          />
        ) : (
          <div className="h-full bg-muted/10 border border-border/30 rounded-xl p-2.5 overflow-y-auto">
            {renderMarkdown(content)}
          </div>
        )}
      </div>

      {/* 底部自动保存状态与统计 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/40">
        <div className="flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              saveStatus === 'saved'
                ? 'bg-emerald-500'
                : saveStatus === 'failed'
                  ? 'bg-red-500'
                  : 'bg-amber-500 animate-pulse'
            }`}
          />
          <span
            className="font-mono text-[11px]"
            role={saveStatus === 'failed' ? 'status' : undefined}
            title={saveStatus === 'failed' ? '本地存储不可用，内容只在当前页面有效' : undefined}
          >
            {saveStatus === 'saved' ? '自动已存' : saveStatus === 'failed' ? '未能保存' : '正在保存...'}
          </span>
        </div>
        {copyError && (
          <span role="status" title={copyError} className="text-destructive-text text-[11px]">
            复制失败
          </span>
        )}
        <div className="font-mono text-muted-foreground text-[11px]">
          {totalTodos > 0 ? `${doneTodos}/${totalTodos} 待办 · ` : ''}
          {content.length} 字
        </div>
      </div>
    </div>
  )
}
