'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Play,
  RotateCcw,
  Copy,
  Check,
  Code2,
  Terminal,
  ExternalLink,
  X,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { copyText } from '@/lib/clipboard'

interface VideoCodeSandboxProps {
  initialCode?: string
  initialLanguage?: string
  title?: string
  onClose?: () => void
}

export function VideoCodeSandbox({
  initialCode = '// 在此编写 JavaScript / HTML 代码\nconsole.log("Hello from DevOps Sandbox!");',
  initialLanguage = 'javascript',
  title = '代码演练沙箱',
  onClose,
}: VideoCodeSandboxProps) {
  const [code, setCode] = useState(initialCode)
  const [logs, setLogs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'preview' | 'console'>('console')
  const [isCopied, setIsCopied] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode)
    }
  }, [initialCode])

  const runCode = () => {
    setLogs([])
    const iframe = iframeRef.current
    if (!iframe) return

    // Sandboxed execution harness intercepting console.log and errors
    const srcDoc = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 12px; margin: 0; background: #0f172a; color: #f8fafc; font-size: 13px; }
            pre { font-family: monospace; background: #1e293b; padding: 8px; border-radius: 6px; }
          </style>
        </head>
        <body>
          <div id="root"></div>
          <script>
            const originalLog = console.log;
            const originalError = console.error;
            function send(type, message) {
              window.parent.postMessage({ type: 'SANDBOX_LOG', level: type, message: String(message) }, '*');
            }
            console.log = function(...args) {
              send('log', args.join(' '));
              originalLog.apply(console, args);
            };
            console.error = function(...args) {
              send('error', args.join(' '));
              originalError.apply(console, args);
            };
            window.onerror = function(msg, url, line) {
              send('error', msg + ' (Line ' + line + ')');
              return true;
            };
            try {
              ${code.includes('<html') || code.includes('<div') ? '' : code}
            } catch (err) {
              send('error', err.message);
            }
          </script>
          ${code.includes('<html') || code.includes('<div') ? code : ''}
        </body>
      </html>
    `
    iframe.srcdoc = srcDoc
  }

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'SANDBOX_LOG') {
        const prefix = e.data.level === 'error' ? '❌ ' : '❯ '
        setLogs(prev => [...prev, `${prefix}${e.data.message}`])
        if (e.data.level === 'error') {
          setActiveTab('console')
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleCopy = () => {
    // 失败时不显示「已复制」
    void copyText(code).then((result) => {
      if (!result.ok) return
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    })
  }

  return (
    <div
      className={`flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl transition-all ${
        isFullscreen ? 'fixed inset-4 z-50' : 'w-full h-full min-h-[360px]'
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-primary" />
          <span className="font-semibold text-zinc-200">{title}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 font-mono">
            {initialLanguage}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={runCode}
            className="h-7 px-2.5 text-xs gap-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
          >
            <Play className="w-3 h-3 fill-current" />
            运行
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
            title="复制代码"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsFullscreen(prev => !prev)}
            className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
            title={isFullscreen ? '还原' : '全屏'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>
          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
              title="关闭沙箱"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Editor & Runner Split View */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800 min-h-0">
        {/* Code Input */}
        <div className="flex flex-col h-full bg-zinc-950 p-2">
          <textarea aria-label="代码编辑器内容"
            value={code}
            onChange={e => setCode(e.target.value)}
            spellCheck={false}
            className="w-full flex-1 bg-transparent text-zinc-200 font-mono text-xs p-2 resize-none focus:outline-none leading-relaxed selection:bg-primary/30"
            placeholder="// 输入要测试的代码..."
          />
        </div>

        {/* Output Area */}
        <div className="flex flex-col h-full bg-zinc-900/60">
          {/* Sub tabs */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[11px]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('console')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  activeTab === 'console' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                控制台 ({logs.length})
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  activeTab === 'preview' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                DOM 预览
              </button>
            </div>
            <button
              onClick={() => setLogs([])}
              className="text-zinc-500 hover:text-zinc-300 text-[10px]"
            >
              清空输出
            </button>
          </div>

          <div className="flex-1 relative overflow-auto p-2">
            {activeTab === 'console' ? (
              <div className="font-mono text-xs space-y-1 text-zinc-300">
                {logs.length === 0 ? (
                  <p className="text-zinc-500 italic py-6 text-center">点击「运行」查看执行输出...</p>
                ) : (
                  logs.map((log, index) => (
                    <div
                      key={index}
                      className={`break-words ${
                        log.startsWith('❌') ? 'text-red-400' : 'text-emerald-400'
                      }`}
                    >
                      {log}
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <iframe
              ref={iframeRef}
              sandbox="allow-scripts"
              className={`w-full h-full border-0 rounded bg-zinc-950 ${
                activeTab === 'preview' ? 'block' : 'hidden'
              }`}
              title="Sandbox Runner"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
