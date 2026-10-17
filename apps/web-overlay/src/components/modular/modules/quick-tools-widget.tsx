'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, Wrench, RefreshCw } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { copyText } from '@/lib/clipboard'

export function QuickToolsWidget() {
  const [activeTab, setActiveTab] = useState<'uuid' | 'timestamp' | 'b64'>('uuid')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [b64Input, setB64Input] = useState('')
  const [b64Output, setB64Output] = useState('')
  // 水合安全：SSR 与客户端的 Date.now()/randomUUID() 必然不同，直接做初始值会导致
  // 文本水合不匹配（控制台报错）。挂载后再生成。
  const [currentTs, setCurrentTs] = useState(0)
  const [uuid, setUuid] = useState('')
  useEffect(() => {
    setCurrentTs(Math.floor(Date.now() / 1000))
    setUuid(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'unsupported')
  }, [])

  // 复制必须**先确认真写进去了**：原来失败分支是 `() => {}`，
  // 环境不支持（非安全上下文）时 `?.` 还会让整条链短路 —— 点了复制毫无反应，
  // 用户只能自己猜。现在失败会把原因显示出来。
  const handleCopy = async (text: string) => {
    const result = await copyText(text)
    if (!result.ok) {
      setCopied(false)
      setCopyError(result.reason)
      return
    }
    setCopyError(null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const generateUuid = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      setUuid(crypto.randomUUID())
    }
  }

  const b64EncodeUnicode = (str: string) => {
    if (typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(str)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      return btoa(binary)
    }
    return btoa(unescape(encodeURIComponent(str)))
  }

  const b64DecodeUnicode = (str: string) => {
    const clean = str.trim()
    const binary = atob(clean)
    if (typeof TextDecoder !== 'undefined') {
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const decoded = new TextDecoder().decode(bytes)
      if (decoded.includes('%')) {
        try {
          return decodeURIComponent(decoded)
        } catch {
          // not percent-encoded
        }
      }
      return decoded
    }
    try {
      return decodeURIComponent(escape(binary))
    } catch {
      return decodeURIComponent(binary)
    }
  }

  const handleB64Encode = () => {
    try {
      setB64Output(b64EncodeUnicode(b64Input))
    } catch {
      setB64Output('编码失败')
    }
  }

  const handleB64Decode = () => {
    try {
      setB64Output(b64DecodeUnicode(b64Input))
    } catch {
      setB64Output('解码失败')
    }
  }

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Wrench className="w-3.5 h-3.5 text-indigo-500" />
          <span>极客快捷工具箱</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('uuid')}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'uuid' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'
            }`}
          >
            UUID
          </button>
          <button
            onClick={() => { setActiveTab('timestamp'); setCurrentTs(Math.floor(Date.now() / 1000)) }}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'timestamp' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'
            }`}
          >
            时间戳
          </button>
          <button
            onClick={() => setActiveTab('b64')}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'b64' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'
            }`}
          >
            Base64
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center py-2 min-h-0">
        {activeTab === 'uuid' && (
          <div className="space-y-2">
            <div className="bg-muted/40 border border-border/60 rounded-lg p-2 font-mono text-xs text-foreground break-all text-center select-all">
              {uuid}
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs rounded-md gap-1" onClick={generateUuid}>
                <RefreshCw className="w-3 h-3" />
                <span>重新生成</span>
              </Button>
              <Button size="sm" className="h-7 text-xs rounded-md gap-1" onClick={() => handleCopy(uuid)}>
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? '已复制' : '复制 UUID'}</span>
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'timestamp' && (
          <div className="space-y-2 text-center">
            <div className="text-xl font-mono font-bold text-foreground">
              {currentTs || '—'}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {currentTs ? new Date(currentTs * 1000).toLocaleString('zh-CN') : '—'}
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs rounded-md"
                onClick={() => setCurrentTs(Math.floor(Date.now() / 1000))}
              >
                刷新当前秒
              </Button>
              <Button size="sm" className="h-7 text-xs rounded-md gap-1" onClick={() => handleCopy(String(currentTs))}>
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>复制时间戳</span>
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'b64' && (
          <div className="space-y-1.5">
            <input
              type="text"
              placeholder="输入待编/解码文本..."
              value={b64Input}
              onChange={(e) => setB64Input(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border border-border/70 bg-background outline-none font-mono"
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 flex-1" onClick={handleB64Encode}>
                编码 Encode
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 flex-1" onClick={handleB64Decode}>
                解码 Decode
              </Button>
            </div>
            {b64Output && (
              <button
                type="button"
                onClick={() => handleCopy(b64Output)}
                className="w-full text-left bg-muted/50 p-1.5 rounded text-xs font-mono break-all cursor-pointer hover:bg-muted/80 text-foreground"
                title="点击复制"
              >
                {b64Output}
              </button>
            )}
          </div>
        )}
      </div>

      {copyError && (
        <div role="status" title={copyError} className="text-xs text-destructive leading-tight">
          复制失败：{copyError}
        </div>
      )}

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        纯前端本地即时转换 · 零网络往返
      </div>
    </div>
  )
}
