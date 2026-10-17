'use client'

import React, { useState } from 'react'
import { ExternalLink, RefreshCw, Globe, ShieldCheck, Maximize2 } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'

interface IframeWidgetProps {
  config?: {
    url?: string
    allowFullscreen?: boolean
  }
}

const PRESET_URLS = [
  { label: 'Excalidraw 绘图', url: 'https://excalidraw.com' },
  { label: 'JSON Crack 结构图', url: 'https://jsoncrack.com/editor' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com' },
]

export function IframeWidget({ config }: IframeWidgetProps) {
  // 协议白名单：iframe src 只接受 http/https，阻止 javascript: / data: 等注入形态
  const sanitizeUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined
    try {
      const u = new URL(url)
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined
    } catch {
      return undefined
    }
  }
  const defaultUrl = sanitizeUrl(config?.url) || 'https://excalidraw.com'
  const [currentUrl, setCurrentUrl] = useState(defaultUrl)
  const [key, setKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const handleRefresh = () => {
    setIsLoading(true)
    setKey((prev) => prev + 1)
  }

  return (
    <div className="h-full flex flex-col justify-between p-2.5 select-none space-y-2 min-h-[220px]">
      {/* 顶部嵌入地址栏与快捷控制 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2 px-1">
        <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-muted/40 px-2 py-1 rounded-lg border border-border/40">
          <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate select-all">
            {currentUrl}
          </span>
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 hidden sm:inline-block">
            Sandbox
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* 预设网址快速切换 */}
          <div className="hidden md:flex items-center gap-1">
            {PRESET_URLS.map((preset) => (
              <button
                key={preset.url}
                onClick={() => {
                  setCurrentUrl(preset.url)
                  setIsLoading(true)
                  setKey((k) => k + 1)
                }}
                className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
                  currentUrl === preset.url
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
            onClick={handleRefresh}
            title="刷新内嵌页面"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-md text-muted-foreground hover:text-primary transition-colors"
            title="在新标签页全屏打开"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Iframe 嵌入沙箱容器 */}
      <div className="flex-1 w-full relative rounded-xl overflow-hidden border border-border/40 bg-muted/20 min-h-[160px]">
        {isLoading && (
          <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-xs flex items-center justify-center space-x-2 text-xs text-muted-foreground">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-xs">正在载入外部沙箱...</span>
          </div>
        )}

        <iframe
          key={key}
          src={currentUrl}
          title="嵌入外部应用沙箱"
          onLoad={() => setIsLoading(false)}
          className="w-full h-full border-0 rounded-xl"
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </div>

      {/* 底部安全提示：sandbox 已启用。注意**不能**再加 allow-same-origin ——
          它与 allow-scripts 同时出现时，嵌入页可自我解除沙箱并访问本站存储
          （W3C 明确警告该组合弱化沙箱）。代价是依赖同源存储的站点在沙箱里
          功能受限，这是有意的取舍：预览不该有这种权限。 */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1 pt-0.5">
        <div className="flex items-center gap-1 text-muted-foreground/70">
          <ShieldCheck className="w-3 h-3 text-emerald-500" />
          <span>iframe sandbox 已启用 · 仅嵌入可信来源</span>
        </div>
        <span className="font-mono text-xs opacity-70">支持自由拖拽缩放</span>
      </div>
    </div>
  )
}
