'use client'

import React, { useState, useEffect, useRef } from 'react'
import { FileText, Eye, Edit3, Copy, Check } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

export function NotesWidget() {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('navhub_modular_quick_notes')
      if (stored) {
        setContent(stored)
      } else {
        setContent('## 🎯 极客工作台备忘\n- [x] 体验 12 栅格自适应模块化布局\n- [x] 体验主页站点 📌 一键固定到启动坞\n- [ ] 探索 GitHub 提交热力足迹\n- [ ] 尝试 Excalidraw 嵌入画板')
      }
    } catch {}
  }, [])

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
        localStorage.setItem('navhub_modular_quick_notes', val)
        setSaveStatus('saved')
      } catch {}
    }, 600)
  }

  // 复制必须**先确认真写进去了**。原来写的是
  //   navigator.clipboard?.writeText(content).then(成功, () => setSaveStatus('saved'))
  // —— 环境不支持时 `?.` 让整条链短路，写入被拒时失败分支只是把「自动已存」重设一遍：
  // 两种情况下用户点了复制都毫无反应，也得不到任何原因。
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

  // 极简轻量 Markdown 渲染器
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

          // 待办事项 - [x] 与 - [ ]
          if (trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) {
            return (
              <div key={index} className="flex items-center gap-2 text-muted-foreground line-through">
                <input aria-hidden="true" type="checkbox" checked readOnly className="rounded text-primary h-3 w-3 pointer-events-none" />
                <span>{trimmed.slice(6)}</span>
              </div>
            )
          }
          if (trimmed.startsWith('- [ ] ')) {
            return (
              <div key={index} className="flex items-center gap-2 text-foreground">
                <input aria-hidden="true" type="checkbox" checked={false} readOnly className="rounded text-primary h-3 w-3 pointer-events-none" />
                <span>{trimmed.slice(6)}</span>
              </div>
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
        </div>

        <div className="flex items-center gap-1">
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
              title="Markdown 渲染预览"
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
          <textarea aria-label="笔记内容（支持 Markdown）"
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="支持 Markdown 待办 (- [ ] 事项)、标题 (# )、列表 (- )..."
            className="w-full h-full resize-none bg-muted/20 border border-border/40 rounded-xl p-2.5 text-xs font-mono text-foreground outline-none focus:border-primary/50 transition-colors leading-relaxed"
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
              saveStatus === 'saved' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
            }`}
          />
          <span className="font-mono">{saveStatus === 'saved' ? '自动已存' : '正在保存...'}</span>
        </div>
        {copyError && (
          <span role="status" title={copyError} className="text-destructive">
            复制失败
          </span>
        )}
        <div className="font-mono text-muted-foreground/70">
          {content.length} 字符 · {content.split('\n').filter(Boolean).length} 行
        </div>
      </div>
    </div>
  )
}
