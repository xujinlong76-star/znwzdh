'use client'

import { useState } from 'react'
import { Zap, CornerDownLeft, Copy, Check } from 'lucide-react'
import { parseSpeculativeIntent } from '@/lib/speculative'
import { evaluateArithmeticExpression, formatArithmeticResult } from '@/lib/arithmetic'
import { copyText } from '@/lib/clipboard'

export function SpeculativeTerminalWidget() {
  const [expr, setExpr] = useState('2^10 * 8')
  const [output, setOutput] = useState('8192')
  const [badgeText, setBadgeText] = useState('算术即刻计算')
  const [copied, setCopied] = useState(false)

  const evaluateExpr = (input: string) => {
    setExpr(input)
    const trimmed = input.trim()
    if (!trimmed) {
      setOutput('')
      setBadgeText('端侧即时')
      return
    }

    // 1. 优先通过零 eval 的 0-RTT 推测意图引擎解析（支持算式、HEX/RGB、CIDR、UUIDv7、时间戳、字节换算等）
    const intent = parseSpeculativeIntent(trimmed)
    if (intent) {
      setBadgeText(intent.title)
      const firstLine = intent.previewValue.split('\n')[0] || intent.previewValue
      setOutput(firstLine.length > 48 ? firstLine.slice(0, 48) + '...' : firstLine)
      return
    }

    // 2. 纯数字或简单算术表达式兜底（完全基于递归下降解析器，零 Function/eval，严格兼容生产环境 CSP）
    const mathVal = evaluateArithmeticExpression(trimmed)
    if (mathVal !== null) {
      setBadgeText('算术即刻计算')
      setOutput(formatArithmeticResult(mathVal))
      return
    }

    setBadgeText('等待有效表达式')
    setOutput('输入算式、#HEX、CIDR 或时间戳...')
  }

  const handleCopy = () => {
    if (!output) return
    copyText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium truncate">
          <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="truncate">0-RTT 意图即时推断终端</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 truncate max-w-[130px]">
          {badgeText}
        </span>
      </div>

      <div className="flex-1 flex flex-col justify-center py-2 space-y-2">
        <div className="relative">
          <input
            aria-label="输入算式、CIDR、UUID 或 HEX 色值"
            type="text"
            value={expr}
            onChange={(e) => evaluateExpr(e.target.value)}
            placeholder="算式 / #HEX / 192.168.1.0/24 / 16 GB..."
            className="w-full text-base sm:text-xs font-mono px-2.5 py-1.5 rounded-lg border border-border/70 bg-background outline-none pr-7 focus:border-amber-500/50"
          />
          <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
        </div>

        <div className="bg-muted/40 p-2.5 rounded-lg border border-border/50 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground font-mono shrink-0">结果:</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs sm:text-sm font-mono font-bold text-amber-600 dark:text-amber-400 truncate">
              {output || '0'}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              title="复制结果"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1 flex-wrap">
          {['1024 * 768', '192.168.1.0/24', '16 GB', '#3b82f6'].map((demo) => (
            <button
              key={demo}
              type="button"
              onClick={() => evaluateExpr(demo)}
              className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
            >
              {demo}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        零 Eval 安全沙箱 · 0ms 端侧直出
      </div>
    </div>
  )
}
