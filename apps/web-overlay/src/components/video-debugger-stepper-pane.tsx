'use client'

import React, { useState, useMemo } from 'react'
import {
  InteractiveCodeDebugger,
  type DebugFrameState,
  type DebugBreakpoint,
} from '@/lib/video-breakpoint-debugger'
import { Button } from '@/registry/new-york/ui/button'
import { Play, StepForward, RotateCcw, Bug, Terminal, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VideoDebuggerStepperPaneProps {
  initialCode?: string
}

const DEFAULT_CODE = `# 演示交互式断点调试器
service = "ingress-controller"
replicas = 3
is_production = True

print(service)
print(replicas)
print(is_production)
`

export function VideoDebuggerStepperPane({
  initialCode = DEFAULT_CODE,
}: VideoDebuggerStepperPaneProps) {
  const debuggerInstance = useMemo(() => new InteractiveCodeDebugger(initialCode), [initialCode])
  const [frameState, setFrameState] = useState<DebugFrameState>(() => debuggerInstance.getCurrentState())
  const [breakpoints, setBreakpoints] = useState<DebugBreakpoint[]>([])

  const lines = useMemo(() => initialCode.split('\n'), [initialCode])

  const handleToggleBp = (lineNum: number) => {
    debuggerInstance.toggleBreakpoint(lineNum)
    setBreakpoints(debuggerInstance.getBreakpoints())
  }

  const handleStepOver = () => {
    const next = debuggerInstance.stepOver()
    setFrameState({ ...next })
  }

  const handleStepBack = () => {
    const prev = debuggerInstance.stepBack()
    setFrameState({ ...prev })
  }

  const handleContinue = () => {
    const { state } = debuggerInstance.continueToNextBreakpoint()
    setFrameState({ ...state })
  }

  const handleReset = () => {
    debuggerInstance.loadSource(initialCode)
    setFrameState(debuggerInstance.getCurrentState())
  }

  const isBreakpointOnLine = (lineNum: number) => {
    return breakpoints.some(b => b.lineNumber === lineNum && b.enabled)
  }

  const varList = Object.values(frameState.variables)

  return (
    <div className="space-y-3 p-3 rounded-lg border bg-card text-xs">
      {/* Top Controls Toolbar */}
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Bug className="w-4 h-4 text-amber-500" />
          <span>代码断点与时间旅行步进器</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={handleStepBack}>
            <RotateCcw className="w-3 h-3" /> 步退
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={handleStepOver}>
            <StepForward className="w-3 h-3" /> 单步 (Step Over)
          </Button>
          <Button size="sm" className="h-7 text-xs px-2 gap-1" onClick={handleContinue}>
            <Play className="w-3 h-3" /> 继续运行
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {/* Source Code View with Breakpoints */}
        <div className="col-span-3 rounded-lg bg-zinc-950 font-mono text-[11px] p-2 border border-zinc-800 text-zinc-200 overflow-x-auto max-h-56">
          {lines.map((line, idx) => {
            const lineNum = idx + 1
            const isCurrent = frameState.currentLine === lineNum
            const hasBp = isBreakpointOnLine(lineNum)

            return (
              <div
                key={lineNum}
                className={cn(
                  "flex items-center gap-2 px-1 rounded transition-colors group",
                  isCurrent && "bg-amber-500/20 text-amber-300 font-semibold"
                )}
              >
                {/* Breakpoint Dot */}
                <button
                  onClick={() => handleToggleBp(lineNum)}
                  className="w-3 h-3 flex items-center justify-center shrink-0 cursor-pointer"
                  title="点击切换断点"
                >
                  <Circle
                    className={cn(
                      "w-2.5 h-2.5 transition-all",
                      hasBp ? "text-red-500 fill-red-500" : "text-zinc-700 opacity-0 group-hover:opacity-100"
                    )}
                  />
                </button>
                <span className="w-4 text-right text-zinc-600 select-none text-[10px]">
                  {lineNum}
                </span>
                <span className="whitespace-pre flex-1">{line || ' '}</span>
              </div>
            )
          })}
        </div>

        {/* Variables Watch & CallStack */}
        <div className="col-span-2 space-y-2">
          <div className="border rounded-lg p-2 bg-muted/30 space-y-1">
            <div className="font-semibold text-foreground text-[10px] uppercase">
              作用域变量 ({varList.length})
            </div>
            {varList.length === 0 ? (
              <p className="text-[10px] text-muted-foreground py-2 text-center">暂无活动变量</p>
            ) : (
              <div className="space-y-1 max-h-24 overflow-y-auto font-mono text-[10px]">
                {varList.map((v) => (
                  <div key={v.name} className="flex justify-between border-b border-border/40 pb-0.5">
                    <span className="text-primary">{v.name}:</span>
                    <span className="text-foreground truncate max-w-[90px]">{String(v.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border rounded-lg p-2 bg-zinc-950 font-mono text-[10px] text-zinc-300 space-y-1 max-h-24 overflow-y-auto">
            <div className="flex items-center gap-1 text-zinc-500 text-[9px] uppercase">
              <Terminal className="w-3 h-3" /> Console Output
            </div>
            {frameState.output.length === 0 ? (
              <div className="text-zinc-600">无输出</div>
            ) : (
              frameState.output.map((out, idx) => (
                <div key={idx} className="text-emerald-400">&gt; {out}</div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
