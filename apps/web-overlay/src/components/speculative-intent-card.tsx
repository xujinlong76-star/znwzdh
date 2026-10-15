'use client'

import { useState } from 'react'
import { Check, Copy, Sparkles, Calculator, Clock, Palette, FileCode, Hash, Timer, KeyRound, Terminal, Code2, GitCompare, Globe } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import type { SpeculativeIntentResult } from '@/lib/speculative'

interface SpeculativeIntentCardProps {
  result: SpeculativeIntentResult
}

export function SpeculativeIntentCard({ result }: SpeculativeIntentCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const textToCopy = result.copyValue || result.previewValue
    if (textToCopy) {
      void navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const getIcon = () => {
    switch (result.type) {
      case 'cron':
        return <Timer className="w-4 h-4 text-emerald-500" />
      case 'jwt':
        return <KeyRound className="w-4 h-4 text-amber-500" />
      case 'curl_to_fetch':
        return <Terminal className="w-4 h-4 text-sky-500" />
      case 'regex':
        return <Code2 className="w-4 h-4 text-purple-500" />
      case 'semver':
        return <GitCompare className="w-4 h-4 text-blue-500" />
      case 'http_status':
        return <Globe className="w-4 h-4 text-amber-500" />
      case 'color':
        return <Palette className="w-4 h-4 text-pink-500" />
      case 'math':
        return <Calculator className="w-4 h-4 text-emerald-500" />
      case 'timestamp':
        return <Clock className="w-4 h-4 text-blue-500" />
      case 'json_format':
        return <FileCode className="w-4 h-4 text-amber-500" />
      case 'hash_detect':
        return <Hash className="w-4 h-4 text-violet-500" />
      default:
        return <Sparkles className="w-4 h-4 text-primary" />
    }
  }

  return (
    <div className="mx-2 mb-2 p-3.5 rounded-xl border border-primary/30 bg-primary/5 subtle-mesh shadow-xs space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-lg bg-background/90 border border-border/70 shadow-2xs flex-shrink-0">
            {getIcon()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground truncate">{result.title}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono font-medium">
                0-RTT 推测执行
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{result.subtitle}</p>
          </div>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleCopy}
          className="h-7.5 px-3 text-xs flex items-center gap-1.5 font-mono flex-shrink-0 border border-border/60 hover:bg-background shadow-2xs"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? '已复制' : result.actionLabel}</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {result.type === 'color' && (
          <div
            className="w-6 h-6 rounded-md border border-border/70 shadow-inner flex-shrink-0"
            style={{ backgroundColor: result.previewValue }}
          />
        )}
        <div className="flex-1 px-3 py-1.5 rounded-lg bg-background/90 border border-border/70 text-xs font-mono break-all max-h-24 overflow-y-auto select-all shadow-2xs">
          {result.previewValue}
        </div>
      </div>

      {result.details && (
        <div className="pt-2 border-t border-border/40 grid grid-cols-2 gap-1.5 text-xs">
          {Object.entries(result.details).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-muted-foreground px-1 py-0.5 rounded bg-background/50 border border-border/30 font-mono">
              <span>{k}:</span>
              <span className="text-foreground font-semibold">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
