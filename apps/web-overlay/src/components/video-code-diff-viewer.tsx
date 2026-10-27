'use client'

import React, { useState } from 'react'
import {
  GitCommit,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Check,
  FileCode,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  computeUnifiedDiff,
  type VideoCodeMilestone,
} from '@/lib/video-code-diff'
import { formatDuration } from '@/lib/video-format'
import { copyText } from '@/lib/clipboard'

interface VideoCodeDiffViewerProps {
  milestones: VideoCodeMilestone[]
  currentSec?: number
  onSeek?: (timeSec: number) => void
}

export function VideoCodeDiffViewer({
  milestones,
  currentSec = 0,
  onSeek,
}: VideoCodeDiffViewerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copied, setCopied] = useState(false)

  if (!milestones || milestones.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-muted-foreground">
        暂无代码演进变更记录
      </div>
    )
  }

  const activeMilestone = milestones[selectedIndex] || milestones[0]
  const diffLines = computeUnifiedDiff(activeMilestone.beforeCode, activeMilestone.afterCode)

  const handleCopy = () => {
    // 剪贴板写入经常失败（非安全上下文 / 页面失焦 / 权限被拒），只有真的成功才显示「已复制」
    void copyText(activeMilestone.afterCode).then((result) => {
      if (!result.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden text-xs">
      {/* Top Milestone Navigation Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <GitCommit className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold text-zinc-100 truncate">
            {activeMilestone.title}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 font-mono">
            {activeMilestone.filePath}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onSeek && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSeek(activeMilestone.timeSec)}
              className="h-7 px-2 text-[11px] gap-1 bg-zinc-800 text-zinc-300 hover:text-white border-zinc-700"
            >
              <Clock className="w-3 h-3 text-primary" />
              <span>{formatDuration(activeMilestone.timeSec)}</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCopy}
            className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100"
            title="复制演进代码"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
          <div className="flex items-center gap-1 ml-1 pl-1 border-l border-zinc-800">
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedIndex <= 0}
              onClick={() => setSelectedIndex(prev => prev - 1)}
              className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
              title="上一步演进"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-[11px] font-mono text-zinc-400">
              {selectedIndex + 1}/{milestones.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedIndex >= milestones.length - 1}
              onClick={() => setSelectedIndex(prev => prev + 1)}
              className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
              title="下一步演进"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Explanation Banner */}
      {activeMilestone.explanation && (
        <div className="px-3 py-1.5 bg-zinc-900/40 border-b border-zinc-800/60 text-[11px] text-zinc-400">
          💡 {activeMilestone.explanation}
        </div>
      )}

      {/* Diff Code Container */}
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed select-text p-2">
        <table className="w-full border-collapse">
          <tbody>
            {diffLines.map((line, idx) => {
              const isAdd = line.type === 'add'
              const isRemove = line.type === 'remove' || line.type === 'del'
              return (
                <tr
                  key={idx}
                  className={`${
                    isAdd
                      ? 'bg-emerald-950/40 text-emerald-300'
                      : isRemove
                      ? 'bg-red-950/40 text-red-400 line-through opacity-75'
                      : 'text-zinc-400'
                  }`}
                >
                  <td className="w-8 pr-2 text-right select-none text-zinc-600 text-[10px]">
                    {line.oldLineNumber || ''}
                  </td>
                  <td className="w-8 pr-2 text-right select-none text-zinc-600 text-[10px]">
                    {line.newLineNumber || ''}
                  </td>
                  <td className="w-4 select-none text-center font-bold">
                    {isAdd ? '+' : isRemove ? '-' : ' '}
                  </td>
                  <td className="whitespace-pre-wrap pl-1">{line.content}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
