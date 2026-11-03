'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, Wrench, RefreshCw, Clock, Code, FileCode, Hash } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { copyText } from '@/lib/clipboard'

export function QuickToolsWidget() {
  const [activeTab, setActiveTab] = useState<'timestamp' | 'json' | 'b64' | 'uuid'>('timestamp')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  // 1. 时间戳工具状态
  const [currentTs, setCurrentTs] = useState(0)
  const [tsInput, setTsInput] = useState('')
  const [tsResult, setTsResult] = useState<{ local: string; utc: string; epoch: string } | null>(null)

  // 2. JSON 格式化与校验状态
  const [jsonInput, setJsonInput] = useState('{"name":"navhub","mode":"modular","active":true}')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // 3. Base64 & URL 编解码状态
  const [b64Mode, setB64Mode] = useState<'base64' | 'url'>('base64')
  const [b64Input, setB64Input] = useState('')
  const [b64Output, setB64Output] = useState('')

  // 4. UUID 状态
  const [uuid, setUuid] = useState('')

  useEffect(() => {
    setCurrentTs(Math.floor(Date.now() / 1000))
    setUuid(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'unsupported')
  }, [])

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

  // 时间戳双向转换：支持输入秒/毫秒时间戳，或输入日期字符串
  const handleConvertTimestamp = (val: string) => {
    setTsInput(val)
    const trimmed = val.trim()
    if (!trimmed) {
      setTsResult(null)
      return
    }

    // 纯数字判断（秒或毫秒）
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed)
      const ms = trimmed.length <= 10 ? num * 1000 : num
      const d = new Date(ms)
      if (isNaN(d.getTime())) {
        setTsResult(null)
        return
      }
      setTsResult({
        local: d.toLocaleString('zh-CN', { hour12: false }),
        utc: d.toUTCString(),
        epoch: `${Math.floor(ms / 1000)} 秒`,
      })
      return
    }

    // 尝试解析日期文本
    const parsed = Date.parse(trimmed)
    if (!isNaN(parsed)) {
      const d = new Date(parsed)
      setTsResult({
        local: d.toLocaleString('zh-CN', { hour12: false }),
        utc: d.toUTCString(),
        epoch: `${Math.floor(parsed / 1000)} 秒 (${parsed} 毫秒)`,
      })
    } else {
      setTsResult(null)
    }
  }

  // JSON 格式化与压缩
  const handleFormatJson = (indent: number) => {
    setJsonError(null)
    try {
      const parsed = JSON.parse(jsonInput)
      setJsonInput(JSON.stringify(parsed, null, indent))
    } catch (err: any) {
      setJsonError(err?.message || 'JSON 语法错误')
    }
  }

  // Base64 编解码安全实现
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
          // 解不开只说明这串不是百分号转义，保留原串交给下面的兜底路径再试一次——不是失败路径
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
      if (b64Mode === 'base64') {
        setB64Output(b64EncodeUnicode(b64Input))
      } else {
        setB64Output(encodeURIComponent(b64Input))
      }
    } catch {
      setB64Output('编码失败')
    }
  }

  const handleB64Decode = () => {
    try {
      if (b64Mode === 'base64') {
        setB64Output(b64DecodeUnicode(b64Input))
      } else {
        setB64Output(decodeURIComponent(b64Input))
      }
    } catch {
      setB64Output('解码失败')
    }
  }

  const generateUuid = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      setUuid(crypto.randomUUID())
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
            onClick={() => setActiveTab('timestamp')}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'timestamp' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'
            }`}
          >
            时间戳
          </button>
          <button
            onClick={() => setActiveTab('json')}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'json' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'
            }`}
          >
            JSON
          </button>
          <button
            onClick={() => setActiveTab('b64')}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'b64' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'
            }`}
          >
            编解码
          </button>
          <button
            onClick={() => setActiveTab('uuid')}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'uuid' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'
            }`}
          >
            UUID
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center py-2 min-h-0">
        {/* 1. 时间戳双向转换 */}
        {activeTab === 'timestamp' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-muted/40 p-2 rounded-lg border border-border/50">
              <div>
                <span className="text-[10px] text-muted-foreground block font-mono">当前 Unix 时间戳 (秒):</span>
                <span className="text-sm font-mono font-bold text-foreground">{currentTs || '—'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setCurrentTs(Math.floor(Date.now() / 1000))}
                  title="刷新当前时间"
                >
                  <RefreshCw className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleCopy(String(currentTs))}
                  title="复制当前秒级时间戳"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>复制</span>
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <input
                type="text"
                aria-label="时间戳或标准日期"
                placeholder="粘贴时间戳 (10/13位) 或标准日期 (如 2026-11-03 12:00)..."
                value={tsInput}
                onChange={(e) => handleConvertTimestamp(e.target.value)}
                className="w-full text-base sm:text-xs px-2 py-1 rounded border border-border/70 bg-background outline-none font-mono"
              />
              {tsResult ? (
                <div className="p-1.5 rounded bg-muted/30 border border-border/40 text-xs font-mono space-y-0.5 text-foreground">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">本地时间:</span>
                    <span className="font-semibold">{tsResult.local}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">时间戳:</span>
                    <span>{tsResult.epoch}</span>
                  </div>
                </div>
              ) : tsInput.trim() ? (
                <p className="text-[10px] text-amber-500">无法识别该时间格式，请检查格式</p>
              ) : null}
            </div>
          </div>
        )}

        {/* 2. JSON 格式化与压缩校验 */}
        {activeTab === 'json' && (
          <div className="space-y-1.5 h-full flex flex-col justify-between">
            <textarea
              aria-label="JSON 格式化输入"
              value={jsonInput}
              onChange={(e) => {
                setJsonInput(e.target.value)
                setJsonError(null)
              }}
              placeholder="在此粘贴或输入待格式化的 JSON 字符串..."
              className="w-full flex-1 min-h-[65px] resize-none text-base sm:text-xs px-2 py-1 rounded border border-border/70 bg-background outline-none font-mono leading-relaxed"
            />
            {jsonError && (
              <p className="text-[10px] text-destructive-text font-mono truncate" title={jsonError}>
                {jsonError}
              </p>
            )}
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 flex-1" onClick={() => handleFormatJson(2)}>
                美化 2空格
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 flex-1" onClick={() => handleFormatJson(0)}>
                压缩单行
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => handleCopy(jsonInput)}>
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        )}

        {/* 3. Base64 & URL 编解码 */}
        {activeTab === 'b64' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded">
                <button
                  type="button"
                  onClick={() => setB64Mode('base64')}
                  className={`px-1.5 py-0.5 rounded text-xs transition-colors ${b64Mode === 'base64' ? 'bg-background font-semibold text-foreground shadow-2xs' : 'text-muted-foreground'}`}
                >
                  Base64
                </button>
                <button
                  type="button"
                  onClick={() => setB64Mode('url')}
                  className={`px-1.5 py-0.5 rounded text-xs transition-colors ${b64Mode === 'url' ? 'bg-background font-semibold text-foreground shadow-2xs' : 'text-muted-foreground'}`}
                >
                  URL 编码
                </button>
              </div>
              <span>{b64Mode === 'base64' ? 'UTF-8 字符集' : 'encodeURIComponent'}</span>
            </div>

            <input
              aria-label="输入待编/解码文本"
              type="text"
              placeholder="输入待编/解码文本..."
              value={b64Input}
              onChange={(e) => setB64Input(e.target.value)}
              className="w-full text-base sm:text-xs px-2 py-1 rounded border border-border/70 bg-background outline-none font-mono"
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

        {/* 4. UUID 生成器 */}
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
      </div>

      {copyError && (
        <div role="status" title={copyError} className="text-xs text-destructive-text leading-tight">
          复制失败：{copyError}
        </div>
      )}

      <div className="pt-1 text-xs text-muted-foreground text-center font-mono">
        纯前端本地即时运算 · 零网络往返
      </div>
    </div>
  )
}
