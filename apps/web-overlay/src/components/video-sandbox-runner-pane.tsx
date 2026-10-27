'use client'

import React, { useState } from 'react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Play,
  Terminal,
  FileCode,
  FolderCode,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Eye,
  Code2,
} from 'lucide-react'
import {
  SandboxRuntime,
  VirtualFileSystem,
  type SandboxExecutionResult,
} from '@/lib/video-code-sandbox-runtime'

interface VideoSandboxRunnerPaneProps {
  initialCode?: string
}

export function VideoSandboxRunnerPane({ initialCode }: VideoSandboxRunnerPaneProps) {
  const [runtime] = useState<SandboxRuntime>(() => {
    const vfs = new VirtualFileSystem()
    if (initialCode) {
      vfs.writeFile('/index.ts', initialCode)
    }
    return new SandboxRuntime(vfs)
  })

  const [activeFile, setActiveFile] = useState<string>('/index.ts')
  const [fileContent, setFileContent] = useState<string>(
    () => runtime.getVFS().readFile('/index.ts') || ''
  )
  const [executionResult, setExecutionResult] = useState<SandboxExecutionResult | null>(null)
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [previewTab, setPreviewTab] = useState<'console' | 'dom'>('console')

  const handleRun = async () => {
    setIsRunning(true)
    runtime.getVFS().writeFile(activeFile, fileContent)
    const result = await runtime.execute('/index.ts')
    setExecutionResult(result)
    setIsRunning(false)
  }

  const handleSwitchFile = (path: string) => {
    runtime.getVFS().writeFile(activeFile, fileContent)
    setActiveFile(path)
    setFileContent(runtime.getVFS().readFile(path) || '')
  }

  const files = runtime.getVFS().listFiles()

  return (
    <div className="flex flex-col h-full bg-card rounded-lg border border-border/50 overflow-hidden text-xs">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between p-2.5 bg-muted/40 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <FolderCode className="w-4 h-4 text-primary" />
          <span>轻量级浏览器 Node/TS 即时联调沙盒</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleRun}
            disabled={isRunning}
            className="h-7 px-3 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{isRunning ? '执行中...' : '运行工程'}</span>
          </Button>
        </div>
      </div>

      {/* File Tabs */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/20 border-b border-border/40 shrink-0 overflow-x-auto">
        {files.map(f => (
          <button
            key={f.path}
            type="button"
            onClick={() => handleSwitchFile(f.path)}
            className={`px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 transition-colors ${
              activeFile === f.path
                ? 'bg-background text-primary border border-border font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileCode className="w-3 h-3" />
            <span>{f.path.replace('/', '')}</span>
          </button>
        ))}
      </div>

      {/* Editor Main */}
      <div className="flex-1 min-h-[160px] relative">
        <textarea aria-label="沙箱文件内容"
          value={fileContent}
          onChange={e => setFileContent(e.target.value)}
          spellCheck={false}
          className="w-full h-full p-3 bg-zinc-950 font-mono text-[11px] text-zinc-100 resize-none focus:outline-none leading-relaxed"
        />
      </div>

      {/* Output Console / Preview */}
      <div className="h-44 bg-zinc-950 border-t border-border/60 flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40">
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => setPreviewTab('console')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                previewTab === 'console' ? 'text-primary font-bold' : 'text-muted-foreground'
              }`}
            >
              <Terminal className="w-3 h-3" />
              <span>控制台输出</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab('dom')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                previewTab === 'dom' ? 'text-primary font-bold' : 'text-muted-foreground'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>DOM 预览</span>
            </button>
          </div>
          {executionResult && (
            <span className="text-[10px] font-mono text-muted-foreground">
              耗时 {executionResult.executionTimeMs}ms
            </span>
          )}
        </div>

        <div className="flex-1 p-2.5 overflow-y-auto font-mono text-[11px] leading-relaxed">
          {previewTab === 'console' ? (
            !executionResult ? (
              <p className="text-zinc-500">// 点击上方“运行工程”执行代码并查看输出日志</p>
            ) : executionResult.success ? (
              <div className="space-y-1">
                {executionResult.logs.map((log, idx) => (
                  <div key={idx} className="text-emerald-400">
                    &gt; {log.text}
                  </div>
                ))}
                {executionResult.returnValue !== undefined && (
                  <div className="text-cyan-400 pt-1 border-t border-zinc-800">
                    &lt; 返回值: {JSON.stringify(executionResult.returnValue)}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-rose-400">
                ❌ 执行异常: {executionResult.errorMessage}
              </div>
            )
          ) : (
            <div className="w-full h-full bg-background rounded border border-border/40 p-2 text-foreground font-sans text-xs">
              <p className="font-semibold text-primary">DOM Preview Container</p>
              <p className="text-muted-foreground text-[11px] mt-1">
                沙盒环境已隔离，可支持组件挂载与交互测试。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
