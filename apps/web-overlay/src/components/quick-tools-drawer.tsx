'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Input } from '@/components/ui/input'
import { Wrench, Copy, Check, RefreshCw, Braces, Binary, Clock, Link2 } from 'lucide-react'

interface QuickToolsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ToolTab = 'json' | 'base64' | 'uuid-time' | 'url'

export function QuickToolsDrawer({ open, onOpenChange }: QuickToolsDrawerProps) {
  const [activeTab, setActiveTab] = useState<ToolTab>('json')
  const [copied, setCopied] = useState<string | null>(null)

  // JSON 工具状态
  const [jsonInput, setJsonInput] = useState('')
  const [jsonOutput, setJsonOutput] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Base64 工具状态
  const [b64Input, setB64Input] = useState('')
  const [b64Output, setB64Output] = useState('')

  // UUID & 时间戳工具状态
  const [uuid, setUuid] = useState('')
  // 水合安全：Date.now() 在 SSR 与客户端必然不同，不能做 useState 初始值（文本水合不匹配）
  const [currentTs, setCurrentTs] = useState(0)
  const [tsInput, setTsInput] = useState('')
  const [tsResult, setTsResult] = useState('')
  useEffect(() => { setCurrentTs(Date.now()) }, [])

  // URL 工具状态
  const [urlInput, setUrlInput] = useState('')
  const [urlOutput, setUrlOutput] = useState('')

  const copyToClipboard = async (text: string, id: string) => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  // JSON 操作
  const handleFormatJson = () => {
    try {
      if (!jsonInput.trim()) return
      const parsed = JSON.parse(jsonInput)
      setJsonOutput(JSON.stringify(parsed, null, 2))
      setJsonError(null)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleMinifyJson = () => {
    try {
      if (!jsonInput.trim()) return
      const parsed = JSON.parse(jsonInput)
      setJsonOutput(JSON.stringify(parsed))
      setJsonError(null)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err))
    }
  }

  // Base64 操作
  const handleEncodeBase64 = () => {
    try {
      setB64Output(btoa(unescape(encodeURIComponent(b64Input))))
    } catch (e) {
      setB64Output('编码失败: ' + String(e))
    }
  }

  const handleDecodeBase64 = () => {
    try {
      setB64Output(decodeURIComponent(escape(atob(b64Input))))
    } catch (e) {
      setB64Output('解码失败（非有效 Base64）')
    }
  }

  // UUID 生成
  const handleGenUuid = () => {
    const newId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
    setUuid(newId)
  }

  // 时间戳转换
  const handleConvertTimestamp = (val: string) => {
    setTsInput(val)
    const n = Number(val)
    if (!n || isNaN(n)) {
      setTsResult('')
      return
    }
    const ms = val.length === 10 ? n * 1000 : n
    const d = new Date(ms)
    setTsResult(isNaN(d.getTime()) ? '无效时间戳' : d.toLocaleString('zh-CN', { hour12: false }))
  }

  // URL 编解码
  const handleEncodeUrl = () => {
    try {
      setUrlOutput(encodeURIComponent(urlInput))
    } catch {
      setUrlOutput('编码失败')
    }
  }

  const handleDecodeUrl = () => {
    try {
      setUrlOutput(decodeURIComponent(urlInput))
    } catch {
      setUrlOutput('解码失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-7 glass-surface subtle-mesh border-border/80 shadow-2xl rounded-2xl">
        <DialogHeader className="pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 text-lg sm:text-xl font-bold">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
              <Wrench className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <span>开发者极速微工具箱</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-1">
            端侧零延迟运行高频微工具，无需离开导航站即可极速格式化与编解码。
          </DialogDescription>
        </DialogHeader>

        {/* 顶部 Tab 栏 */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/50 mt-1 overflow-x-auto">
          <Button
            size="sm"
            variant={activeTab === 'json' ? 'default' : 'ghost'}
            className="h-8 text-xs gap-1.5 rounded-lg font-medium transition-all"
            onClick={() => setActiveTab('json')}
          >
            <Braces className="w-3.5 h-3.5" />
            <span>JSON 格式化</span>
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'base64' ? 'default' : 'ghost'}
            className="h-8 text-xs gap-1.5 rounded-lg font-medium transition-all"
            onClick={() => setActiveTab('base64')}
          >
            <Binary className="w-3.5 h-3.5" />
            <span>Base64 编解码</span>
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'uuid-time' ? 'default' : 'ghost'}
            className="h-8 text-xs gap-1.5 rounded-lg font-medium transition-all"
            onClick={() => setActiveTab('uuid-time')}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>UUID & 时间戳</span>
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'url' ? 'default' : 'ghost'}
            className="h-8 text-xs gap-1.5 rounded-lg font-medium transition-all"
            onClick={() => setActiveTab('url')}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>URL 编解码</span>
          </Button>
        </div>

        {/* Tab 1: JSON */}
        {activeTab === 'json' && (
          <div className="space-y-3.5 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" className="h-8 text-xs px-3 border border-border/60" onClick={handleFormatJson}>
                格式化美化
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs px-3 border border-border/60" onClick={handleMinifyJson}>
                压缩成一行
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 ml-auto border-border/60"
                onClick={() => copyToClipboard(jsonOutput, 'json')}
                disabled={!jsonOutput}
              >
                {copied === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied === 'json' ? '已复制' : '复制结果'}</span>
              </Button>
            </div>
            {jsonError && (
              <p className="text-xs text-red-500 bg-red-500/10 p-2.5 rounded-xl border border-red-500/20 font-mono shadow-2xs">
                {jsonError}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground font-mono">输入原始 JSON:</span>
                <textarea
                  placeholder="在此粘贴原始 JSON 文本..."
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  className="w-full h-64 p-3.5 text-xs font-mono rounded-xl border border-border/70 bg-background/90 resize-none focus:outline-hidden focus:ring-1 focus:ring-primary/50 shadow-2xs"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground font-mono">格式化结果输出:</span>
                <textarea
                  readOnly
                  placeholder="格式化结果输出..."
                  value={jsonOutput}
                  className="w-full h-64 p-3.5 text-xs font-mono rounded-xl border border-border/60 bg-muted/40 resize-none focus:outline-hidden shadow-2xs select-all"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Base64 */}
        {activeTab === 'base64' && (
          <div className="space-y-3.5 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" className="h-8 text-xs px-3 border border-border/60" onClick={handleEncodeBase64}>
                编码为 Base64
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs px-3 border border-border/60" onClick={handleDecodeBase64}>
                还原解码
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 ml-auto border-border/60"
                onClick={() => copyToClipboard(b64Output, 'b64')}
                disabled={!b64Output}
              >
                {copied === 'b64' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied === 'b64' ? '已复制' : '复制结果'}</span>
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground font-mono">输入待转换文本:</span>
                <textarea
                  placeholder="在此输入待编码或解码的文本..."
                  value={b64Input}
                  onChange={(e) => setB64Input(e.target.value)}
                  className="w-full h-56 p-3.5 text-xs font-mono rounded-xl border border-border/70 bg-background/90 resize-none focus:outline-hidden focus:ring-1 focus:ring-primary/50 shadow-2xs"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground font-mono">输出结果:</span>
                <textarea
                  readOnly
                  placeholder="结果输出..."
                  value={b64Output}
                  className="w-full h-56 p-3.5 text-xs font-mono rounded-xl border border-border/60 bg-muted/40 resize-none focus:outline-hidden shadow-2xs select-all"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: UUID & Timestamp */}
        {activeTab === 'uuid-time' && (
          <div className="space-y-4 pt-2">
            {/* UUID 生成 */}
            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Binary className="w-3.5 h-3.5 text-indigo-500" />
                  <span>UUID (v4) 随机器</span>
                </span>
                <Button size="sm" variant="outline" className="h-7.5 text-xs gap-1.5 border-border/60" onClick={handleGenUuid}>
                  <RefreshCw className="w-3 h-3" />
                  <span>立即生成</span>
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={uuid || '点击生成按钮创建 UUID'} className="font-mono text-xs h-9 bg-background/90 border-border/70" />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-9 text-xs shrink-0 border border-border/60"
                  onClick={() => copyToClipboard(uuid, 'uuid')}
                  disabled={!uuid}
                >
                  {copied === 'uuid' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>

            {/* 当前时间戳 */}
            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  <span>当前本地与网络时间戳</span>
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-xs hover:bg-muted" onClick={() => setCurrentTs(Date.now())}>
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 flex items-center justify-between">
                  <span className="text-muted-foreground">秒级 (10位): <strong className="text-foreground">{Math.floor(currentTs / 1000)}</strong></span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-background" onClick={() => copyToClipboard(String(Math.floor(currentTs / 1000)), 'ts10')}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 flex items-center justify-between">
                  <span className="text-muted-foreground">毫秒级 (13位): <strong className="text-foreground">{currentTs}</strong></span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:bg-background" onClick={() => copyToClipboard(String(currentTs), 'ts13')}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>

            {/* 时间戳互转 */}
            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2.5 shadow-2xs">
              <span className="text-xs font-bold">时间戳转可读时间字符串</span>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Input
                  placeholder="输入 10 位或 13 位时间戳..."
                  value={tsInput}
                  onChange={(e) => handleConvertTimestamp(e.target.value)}
                  className="font-mono text-xs h-9 bg-background/90 border-border/70 flex-1"
                />
                <div className="text-xs font-mono font-medium px-3.5 py-2 bg-muted/50 rounded-lg border border-border/60 min-w-[180px] text-center">
                  {tsResult || '等待输入...'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: URL */}
        {activeTab === 'url' && (
          <div className="space-y-3.5 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" className="h-8 text-xs px-3 border border-border/60" onClick={handleEncodeUrl}>
                URL 编码 (encodeURI)
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs px-3 border border-border/60" onClick={handleDecodeUrl}>
                URL 解码 (decodeURI)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 ml-auto border-border/60"
                onClick={() => copyToClipboard(urlOutput, 'url')}
                disabled={!urlOutput}
              >
                {copied === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied === 'url' ? '已复制' : '复制结果'}</span>
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground font-mono">输入 URL 串:</span>
                <textarea
                  placeholder="在此输入待编码或解码的 URL 或参数..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="w-full h-56 p-3.5 text-xs font-mono rounded-xl border border-border/70 bg-background/90 resize-none focus:outline-hidden focus:ring-1 focus:ring-primary/50 shadow-2xs"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground font-mono">输出转换结果:</span>
                <textarea
                  readOnly
                  placeholder="结果输出..."
                  value={urlOutput}
                  className="w-full h-56 p-3.5 text-xs font-mono rounded-xl border border-border/60 bg-muted/40 resize-none focus:outline-hidden shadow-2xs select-all"
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
