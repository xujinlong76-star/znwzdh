'use client'

/**
 * 外部应用嵌入沙箱。
 *
 * 三处以前做不到的事，现在补齐：
 *  1. 齿轮里改 `url` 真的会重新加载（以前只喂给 useState 初值，改完没反应）；
 *  2. `allowFullscreen` 这个配置项以前只是写在 props 里，压根没传给 iframe；
 *  3. 外部站点用 X-Frame-Options / CSP frame-ancestors 拒绝内嵌时不会触发任何
 *     事件，转圈会永远停在「正在载入」——现在超时后给出可见解释和新标签出口。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, Globe, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { safeHref, safeSrc } from '@/lib/safe-url'

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

const DEFAULT_URL = PRESET_URLS[0].url

/** 被拒绝内嵌时浏览器不会给 load 事件，超时后必须给解释，而不是无限转圈 */
const STALL_MS = 12000

export function IframeWidget({ config }: IframeWidgetProps) {
  // 协议白名单走公共 safeSrc：只接受干净的 http(s)（伪协议、协议相对、
  // 控制字符与 userinfo 伪装域都在库内拒绝），组件自己不再维护第二套判定。
  const configuredUrl = safeSrc(config?.url) ?? DEFAULT_URL
  const allowFullscreen = config?.allowFullscreen !== false
  const invalidConfigUrl = Boolean(config?.url?.trim()) && !safeSrc(config?.url)

  const [currentUrl, setCurrentUrl] = useState(configuredUrl)
  const [frameKey, setFrameKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [stalled, setStalled] = useState(false)

  const reloadWith = useCallback((url: string) => {
    setCurrentUrl(url)
    setIsLoading(true)
    setStalled(false)
    setFrameKey((k) => k + 1)
  }, [])

  const appliedConfigUrl = useRef(configuredUrl)
  useEffect(() => {
    if (appliedConfigUrl.current === configuredUrl) return
    appliedConfigUrl.current = configuredUrl
    reloadWith(configuredUrl)
  }, [configuredUrl, reloadWith])

  useEffect(() => {
    if (!isLoading) return
    const timer = setTimeout(() => setStalled(true), STALL_MS)
    return () => clearTimeout(timer)
  }, [isLoading, frameKey])

  const isTemporary = currentUrl !== configuredUrl

  return (
    <div className="h-full flex flex-col justify-between p-2.5 select-none space-y-2 min-h-[220px]">
      {/* 顶部嵌入地址栏与快捷控制 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2 px-1">
        <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-muted/40 px-2 py-1 rounded-lg border border-border/40">
          <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate select-all" title={currentUrl}>
            {currentUrl}
          </span>
          {isTemporary && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 shrink-0"
              title="预设只是临时预览，刷新后回到配置里的地址。要长期固定请在齿轮里填 URL。"
            >
              临时
            </span>
          )}
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 hidden sm:inline-block">
            Sandbox
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* 预设网址快速切换（临时预览，不落配置） */}
          <div className="hidden md:flex items-center gap-1">
            {PRESET_URLS.map((preset) => (
              <button
                key={preset.url}
                onClick={() => reloadWith(preset.url)}
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
            onClick={() => reloadWith(currentUrl)}
            title="重新载入内嵌页面"
            aria-label="重新载入内嵌页面"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          <a
            href={safeHref(currentUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-md text-muted-foreground hover:text-primary transition-colors"
            title="在新标签页打开"
            aria-label="在新标签页打开"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Iframe 嵌入沙箱容器 */}
      <div className="flex-1 w-full relative rounded-xl overflow-hidden border border-border/40 bg-muted/20 min-h-[160px]">
        {invalidConfigUrl && (
          <div className="absolute top-2 left-2 right-2 z-20 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive leading-relaxed">
            配置里的地址不是合法 http(s)，已拒绝内嵌：{String(config?.url).slice(0, 80)}
          </div>
        )}
        {isLoading && !stalled && (
          <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-xs flex items-center justify-center space-x-2 text-xs text-muted-foreground">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-xs">正在载入外部沙箱...</span>
          </div>
        )}
        {stalled && (
          <div className="absolute inset-0 z-10 bg-background/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px]">
              仍未载入。多数站点用 X-Frame-Options 或 CSP frame-ancestors 明确拒绝被内嵌
              （Google、GitHub、B 站等），这种情况浏览器不会报错，也不会触发载入完成。
            </p>
            <div className="flex items-center gap-1.5">
              <a
                href={safeHref(currentUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] border border-border/60 hover:bg-muted"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                新标签打开
              </a>
              <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => reloadWith(currentUrl)}>
                <RefreshCw className="mr-1 w-2.5 h-2.5" />
                再试一次
              </Button>
            </div>
          </div>
        )}

        <iframe
          key={frameKey}
          src={currentUrl}
          title="嵌入外部应用沙箱"
          onLoad={() => {
            setIsLoading(false)
            setStalled(false)
          }}
          className="w-full h-full border-0 rounded-xl"
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
          allowFullScreen={allowFullscreen}
        />
      </div>

      {/* 底部安全提示：sandbox 已启用。注意**不能**再加 allow-same-origin ——
          它与 allow-scripts 同时出现时，嵌入页可自我解除沙箱并访问本站存储
          （W3C 明确警告该组合弱化沙箱）。代价是依赖同源存储的站点在沙箱里
          功能受限，这是有意的取舍：预览不该有这种权限。 */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground px-1 pt-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
          <span className="truncate">iframe sandbox 已启用 · 未开放同源与顶层跳转</span>
        </div>
        <span className="shrink-0 text-[11px]">
          {allowFullscreen ? '允许嵌入页全屏' : '已关闭全屏'}
        </span>
      </div>
    </div>
  )
}
