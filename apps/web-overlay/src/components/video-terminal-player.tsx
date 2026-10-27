'use client'

import React, { useMemo, useState, useRef, useEffect } from 'react'
import {
  type TerminalCast,
  getTerminalStateAtTime,
  generateSyntheticTerminalCast,
} from '@/lib/video-terminal-recorder'
import { Terminal, Copy, Check, Download, Maximize2, RotateCcw } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'

interface VideoTerminalPlayerProps {
  cast?: TerminalCast
  commands?: string[]
  title?: string
  currentSec: number
  onSeek?: (timeSec: number) => void
  className?: string
}

export function VideoTerminalPlayer({
  cast: customCast,
  commands = [],
  title = '生产环境终端会话',
  currentSec,
  onSeek,
  className,
}: VideoTerminalPlayerProps) {
  const [copied, setCopied] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const outputRef = useRef<HTMLDivElement>(null)

  const activeCast = useMemo(() => {
    if (customCast) return customCast
    const sampleCmds = commands.length > 0 ? commands : [
      'kubectl get nodes -o wide',
      'docker build -t cloud-native-app:v1 .',
      'helm upgrade --install api-gateway ./charts/gateway',
      'kubectl get pods -n production -w',
    ]
    return generateSyntheticTerminalCast({
      title,
      commands: sampleCmds,
      durationSec: 600,
    })
  }, [customCast, commands, title])

  const terminalState = useMemo(() => {
    return getTerminalStateAtTime(activeCast, currentSec)
  }, [activeCast, currentSec])

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [terminalState, autoScroll])

  const handleCopy = () => {
    void copyText(terminalState.rawOutput).then((result) => {
      if (!result.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleExportCast = () => {
    const raw = JSON.stringify(activeCast.header) + '\n' +
      activeCast.events.map(e => JSON.stringify([e.timeSec, e.type, e.data])).join('\n')
    const blob = new Blob([raw], { type: 'application/x-asciicast' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/\s+/g, '_')}.cast`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl overflow-hidden border border-zinc-800 bg-[#0d1117] text-zinc-100 shadow-2xl",
        className
      )}
    >
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/90 border-b border-zinc-800 text-xs select-none">
        <div className="flex items-center gap-2">
          {/* Traffic light buttons */}
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>

          <div className="flex items-center gap-1.5 ml-2 font-mono text-[11px] text-zinc-300">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>{activeCast.header.title || title}</span>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2 text-zinc-400 hover:text-zinc-200"
            onClick={handleCopy}
            title="复制终端当前所有输出"
          >
            {copied ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check className="w-3 h-3" /> 已复制
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Copy className="w-3 h-3" /> 复制
              </span>
            )}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2 text-zinc-400 hover:text-zinc-200"
            onClick={handleExportCast}
            title="导出 Asciinema .cast 文件"
          >
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Terminal Output Buffer */}
      <div
        ref={outputRef}
        className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed select-text min-h-[180px] max-h-[380px]"
      >
        <pre className="whitespace-pre-wrap break-all">
          {terminalState.tokens.length === 0 ? (
            <span className="text-zinc-500 italic">等待终端指令执行...</span>
          ) : (
            terminalState.tokens.map((tok, idx) => (
              <span
                key={idx}
                style={{ color: tok.color }}
                className={cn(
                  tok.isBold && "font-bold",
                  tok.isDim && "opacity-60"
                )}
              >
                {tok.text}
              </span>
            ))
          )}
          <span className="inline-block w-2 h-3.5 bg-emerald-400 animate-pulse ml-0.5 align-middle" />
        </pre>
      </div>

      {/* Terminal Footer */}
      <div className="flex items-center justify-between px-3 py-1 bg-zinc-950/80 border-t border-zinc-900 text-[10px] text-zinc-500 font-mono">
        <span>bash 5.2 / linux-x64</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="w-3 h-3 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
            />
            <span>自动滚屏</span>
          </label>
          <span>行数: {terminalState.lineCount}</span>
        </div>
      </div>
    </div>
  )
}
