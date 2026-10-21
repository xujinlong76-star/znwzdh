'use client'

import { useState } from 'react'
import { Zap, CornerDownLeft } from 'lucide-react'

export function SpeculativeTerminalWidget() {
  const [expr, setExpr] = useState('2^10 * 8')
  const [output, setOutput] = useState('8192')

  const evaluateExpr = (input: string) => {
    setExpr(input)
    const trimmed = input.trim()
    if (!trimmed) {
      setOutput('')
      return
    }

    // 1. 色彩解析 #ffffff / rgb
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
      setOutput(`RGB 转换: 16进制色彩有效`)
      return
    }

    // 2. 数学公式 (支持 ^ 换算为 **)
    try {
      const sanitized = trimmed.replace(/\^/g, '**').replace(/[^-()\d/*+.]/g, '')
      if (sanitized) {
        // eslint-disable-next-line no-eval
        const res = Function(`'use strict'; return (${sanitized})`)()
        setOutput(String(res))
      }
    } catch {
      setOutput('计算中...')
    }
  }

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span>0-RTT 意图即时推断终端</span>
        </div>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          端侧即时
        </span>
      </div>

      <div className="flex-1 flex flex-col justify-center py-2 space-y-2">
        <div className="relative">
          <input aria-label="输入算式或 HEX 色值"
            type="text"
            value={expr}
            onChange={(e) => evaluateExpr(e.target.value)}
            placeholder="输入算式 (如 1024 * 8) 或 HEX 色值..."
            className="w-full text-base sm:text-xs font-mono px-2.5 py-1.5 rounded-lg border border-border/70 bg-background outline-none pr-7 focus:border-amber-500/50"
          />
          <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
        </div>

        <div className="bg-muted/40 p-2.5 rounded-lg border border-border/50 flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-mono">推测执行结果:</span>
          <span className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400">
            {output || '0'}
          </span>
        </div>

        <div className="flex items-center justify-center gap-1">
          {['1024 * 768', '2^16', '#3b82f6'].map((demo) => (
            <button
              key={demo}
              onClick={() => evaluateExpr(demo)}
              className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
            >
              {demo}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        按键输入驱动 · 0ms 网络延迟
      </div>
    </div>
  )
}
