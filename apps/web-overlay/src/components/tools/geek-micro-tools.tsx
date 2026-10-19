'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Code2,
  Copy,
  Check,
  KeyRound,
  Clock,
  Fingerprint,
  Hash,
  Link2,
  FileJson,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { copyText, copyFailureToast } from '@/lib/clipboard'

interface GeekMicroToolsProps {
  query: string
  onSelectSample?: (sample: string) => void
}

export function GeekMicroTools({ query, onSelectSample }: GeekMicroToolsProps) {
  // 解析命令及参数，如 "> b64 hello world" -> cmd="b64", rawArgs="hello world"
  const parsed = useMemo(() => {
    const raw = query.startsWith('>') ? query.slice(1).trim() : query.trim()
    const spaceIdx = raw.indexOf(' ')
    if (spaceIdx === -1) {
      return { cmd: raw.toLowerCase(), args: '' }
    }
    return {
      cmd: raw.slice(0, spaceIdx).toLowerCase(),
      args: raw.slice(spaceIdx + 1).trim(),
    }
  }, [query])

  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const handleCopy = useCallback(async (text: string, key: string) => {
    if (!text) return
    const res = await copyText(text)
    if (!res.ok) {
      const note = copyFailureToast(res)
      toast.error(note.title, { description: note.description })
      return
    }
    setCopiedKey(key)
    toast.success('已复制到剪贴板')
    setTimeout(() => setCopiedKey(null), 1800)
  }, [])

  // 1. Base64 编解码
  const renderBase64 = () => {
    const input = parsed.args
    let encoded = ''
    let decoded = ''
    let isDecodeError = false

    if (input) {
      try {
        // UTF-8 编码安全
        encoded = btoa(unescape(encodeURIComponent(input)))
      } catch {
        encoded = '编码失败'
      }

      try {
        decoded = decodeURIComponent(escape(atob(input)))
      } catch {
        isDecodeError = true
      }
    }

    return (
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Code2 className="w-4 h-4 text-primary" />
            <span>Base64 极速编解码</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">100% 本地运算·保护隐私</span>
        </div>

        {!input ? (
          <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
            在上方继续输入要编码/解码的文本，例如：<button type="button" onClick={() => onSelectSample?.('> b64 Hello NavHub 2026')} className="text-primary underline font-mono">Hello NavHub 2026</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                <span>Base64 编码 (Encode)</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] gap-1"
                  onClick={() => handleCopy(encoded, 'b64-enc')}
                >
                  {copiedKey === 'b64-enc' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>复制</span>
                </Button>
              </div>
              <div className="font-mono text-xs break-all select-all bg-background/50 p-2 rounded border border-border/40 max-h-24 overflow-y-auto">
                {encoded || '-'}
              </div>
            </div>

            <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                <span>Base64 解码 (Decode)</span>
                {!isDecodeError && decoded && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[10px] gap-1"
                    onClick={() => handleCopy(decoded, 'b64-dec')}
                  >
                    {copiedKey === 'b64-dec' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>复制</span>
                  </Button>
                )}
              </div>
              <div className="font-mono text-xs break-all select-all bg-background/50 p-2 rounded border border-border/40 max-h-24 overflow-y-auto">
                {isDecodeError ? (
                  <span className="text-muted-foreground italic text-[11px]">当前输入不是合法的 Base64 字符串</span>
                ) : (
                  decoded || '-'
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 2. JWT 解析
  const renderJwt = () => {
    const token = parsed.args.trim()
    let headerObj: Record<string, unknown> | null = null
    let payloadObj: Record<string, unknown> | null = null
    let error: string | null = null
    let isExpired: boolean | null = null
    let expFormatted: string | null = null

    if (token) {
      const parts = token.split('.')
      if (parts.length < 2) {
        error = 'JWT 格式不正确（必须包含由点号分隔的 Header 与 Payload）'
      } else {
        try {
          const headerJson = decodeURIComponent(escape(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))))
          headerObj = JSON.parse(headerJson)
        } catch {
          error = 'Header 解密解析失败'
        }

        try {
          const payloadJson = decodeURIComponent(escape(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))))
          payloadObj = JSON.parse(payloadJson)
          if (typeof payloadObj?.exp === 'number') {
            const expSec = payloadObj.exp
            const nowSec = Math.floor(Date.now() / 1000)
            isExpired = nowSec > expSec
            expFormatted = new Date(expSec * 1000).toLocaleString()
          }
        } catch {
          error = 'Payload 解密解析失败'
        }
      }
    }

    return (
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <KeyRound className="w-4 h-4 text-primary" />
            <span>JWT 结构与声明解析</span>
          </div>
          {isExpired !== null && (
            <Badge variant={isExpired ? 'destructive' : 'secondary'} className="text-[10px] gap-1 font-normal">
              {isExpired ? <AlertCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
              <span>{isExpired ? `已过期 (${expFormatted})` : `有效 (到期: ${expFormatted})`}</span>
            </Badge>
          )}
        </div>

        {!token ? (
          <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
            在上方粘贴 JWT Token，例如：
            <button
              type="button"
              onClick={() => onSelectSample?.('> jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik5hdkh1YiBVc2VyIiwiYWRtaW4iOnRydWUsImV4cCI6MTk5OTk5OTk5OX0.dummy')}
              className="text-primary underline font-mono block mt-1"
            >
              加载测试 JWT
            </button>
          </div>
        ) : error ? (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-2 font-mono">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30 space-y-1">
              <div className="text-[11px] text-muted-foreground font-semibold flex items-center justify-between">
                <span>HEADER: 算法与令牌类型</span>
                <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => handleCopy(JSON.stringify(headerObj, null, 2), 'jwt-hdr')}>
                  <Copy className="w-2.5 h-2.5 mr-1" />复制
                </Button>
              </div>
              <pre className="text-[11px] bg-background/50 p-2 rounded border border-border/40 overflow-x-auto max-h-36">
                {JSON.stringify(headerObj, null, 2)}
              </pre>
            </div>

            <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30 space-y-1">
              <div className="text-[11px] text-muted-foreground font-semibold flex items-center justify-between">
                <span>PAYLOAD: 数据声明</span>
                <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => handleCopy(JSON.stringify(payloadObj, null, 2), 'jwt-pld')}>
                  <Copy className="w-2.5 h-2.5 mr-1" />复制
                </Button>
              </div>
              <pre className="text-[11px] bg-background/50 p-2 rounded border border-border/40 overflow-x-auto max-h-36">
                {JSON.stringify(payloadObj, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 3. 时间戳转换
  const renderTime = () => {
    const raw = parsed.args.trim()
    const now = Date.now()
    let parsedDate: Date = new Date(now)

    if (raw && raw !== 'now') {
      const num = Number(raw)
      if (!isNaN(num)) {
        // 10 位为秒，13 位为毫秒
        parsedDate = new Date(raw.length <= 10 ? num * 1000 : num)
      } else {
        const parsedMs = Date.parse(raw)
        if (!isNaN(parsedMs)) {
          parsedDate = new Date(parsedMs)
        }
      }
    }

    const sec = Math.floor(parsedDate.getTime() / 1000)
    const ms = parsedDate.getTime()
    const iso = parsedDate.toISOString()
    const local = parsedDate.toLocaleString()
    const diffSec = Math.floor((now - ms) / 1000)
    const relative =
      Math.abs(diffSec) < 60
        ? '刚刚'
        : diffSec > 0
        ? `${Math.floor(diffSec / 60)} 分钟前`
        : `${Math.floor(-diffSec / 60)} 分钟后`

    return (
      <div className="space-y-3 p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Clock className="w-4 h-4 text-primary" />
            <span>Unix 时间戳与日期换算</span>
          </div>
          <Badge variant="outline" className="text-[10px] font-normal">
            相对：{relative}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
          <div className="p-2 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground font-sans">秒级时间戳 (Unix Seconds)</div>
              <div className="text-xs font-semibold text-foreground">{sec}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => handleCopy(String(sec), 't-sec')}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>

          <div className="p-2 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground font-sans">毫秒级时间戳 (Unix Milliseconds)</div>
              <div className="text-xs font-semibold text-foreground">{ms}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => handleCopy(String(ms), 't-ms')}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>

          <div className="p-2 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground font-sans">本地标准时间 (Local Datetime)</div>
              <div className="text-xs font-medium text-foreground">{local}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => handleCopy(local, 't-loc')}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>

          <div className="p-2 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground font-sans">UTC / ISO-8601 标准字符串</div>
              <div className="text-xs font-medium text-foreground truncate max-w-[180px]">{iso}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => handleCopy(iso, 't-iso')}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // 4. UUID 批量生成
  const [uuidCount, setUuidCount] = useState<number>(1)
  const [uuids, setUuids] = useState<string[]>([])

  const generateUuids = useCallback((count: number) => {
    const list: string[] = []
    for (let i = 0; i < count; i++) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        list.push(crypto.randomUUID())
      } else {
        list.push(
          'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0
            const v = c === 'x' ? r : (r & 0x3) | 0x8
            return v.toString(16)
          })
        )
      }
    }
    setUuids(list)
  }, [])

  useEffect(() => {
    if (parsed.cmd === 'uuid') {
      const cnt = Math.min(Math.max(Number(parsed.args) || 1, 1), 10)
      setUuidCount(cnt)
      generateUuids(cnt)
    }
  }, [parsed.cmd, parsed.args, generateUuids])

  const renderUuid = () => {
    return (
      <div className="space-y-3 p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Fingerprint className="w-4 h-4 text-primary" />
            <span>UUID v4 安全随机生成器</span>
          </div>
          <div className="flex items-center gap-1.5">
            {[1, 3, 5].map((cnt) => (
              <Button
                key={cnt}
                size="sm"
                variant={uuidCount === cnt ? 'default' : 'outline'}
                className="h-6 px-2 text-[10px]"
                onClick={() => {
                  setUuidCount(cnt)
                  generateUuids(cnt)
                }}
              >
                {cnt} 条
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => generateUuids(uuidCount)}>
              <RotateCcw className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="space-y-1.5 font-mono">
          {uuids.map((id, idx) => (
            <div key={idx} className="p-2 rounded-lg border border-border/60 bg-muted/30 flex items-center justify-between">
              <span className="text-xs text-foreground select-all">{id}</span>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => handleCopy(id, `uuid-${idx}`)}>
                {copiedKey === `uuid-${idx}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 5. Hash 计算 (WebCrypto)
  const [hashes, setHashes] = useState<{ sha256: string; sha1: string; sha512: string }>({ sha256: '', sha1: '', sha512: '' })

  useEffect(() => {
    if (parsed.cmd === 'hash' && parsed.args) {
      const text = parsed.args
      const enc = new TextEncoder()
      const data = enc.encode(text)

      const toHex = (buf: ArrayBuffer) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')

      Promise.all([
        crypto.subtle.digest('SHA-256', data).then(toHex),
        crypto.subtle.digest('SHA-1', data).then(toHex),
        crypto.subtle.digest('SHA-512', data).then(toHex),
      ]).then(([sha256, sha1, sha512]) => {
        setHashes({ sha256, sha1, sha512 })
      }).catch(() => {
        // ignore
      })
    }
  }, [parsed.cmd, parsed.args])

  const renderHash = () => {
    return (
      <div className="space-y-3 p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Hash className="w-4 h-4 text-primary" />
            <span>WebCrypto 哈希摘要计算</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">SHA-256 / SHA-1 / SHA-512</span>
        </div>

        {!parsed.args ? (
          <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
            在上方输入要计算 Hash 的文本，例如：<button type="button" onClick={() => onSelectSample?.('> hash NavHub2026')} className="text-primary underline font-mono">NavHub2026</button>
          </div>
        ) : (
          <div className="space-y-2 font-mono">
            <div className="p-2 rounded-lg border border-border/60 bg-muted/20 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-sans">
                <span>SHA-256</span>
                <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => handleCopy(hashes.sha256, 'h-256')}>
                  <Copy className="w-2.5 h-2.5 mr-1" />复制
                </Button>
              </div>
              <div className="text-[11px] break-all select-all font-medium text-foreground">{hashes.sha256 || '计算中...'}</div>
            </div>

            <div className="p-2 rounded-lg border border-border/60 bg-muted/20 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-sans">
                <span>SHA-1</span>
                <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => handleCopy(hashes.sha1, 'h-1')}>
                  <Copy className="w-2.5 h-2.5 mr-1" />复制
                </Button>
              </div>
              <div className="text-[11px] break-all select-all font-medium text-foreground">{hashes.sha1 || '计算中...'}</div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 6. JSON 美化与压缩
  const renderJson = () => {
    const raw = parsed.args.trim()
    let formatted = ''
    let minified = ''
    let error: string | null = null

    if (raw) {
      try {
        const obj = JSON.parse(raw)
        formatted = JSON.stringify(obj, null, 2)
        minified = JSON.stringify(obj)
      } catch (e: any) {
        error = e?.message || 'JSON 语法错误'
      }
    }

    return (
      <div className="space-y-3 p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <FileJson className="w-4 h-4 text-primary" />
            <span>JSON 校验与结构美化</span>
          </div>
          {raw && !error && (
            <Badge variant="secondary" className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3 mr-1" />JSON 有效
            </Badge>
          )}
        </div>

        {!raw ? (
          <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
            在上方粘贴 JSON 字符串，例如：
            <button
              type="button"
              onClick={() => onSelectSample?.('> json {"name":"NavHub","version":"2.5.0","features":["AI","CRDT"]}')}
              className="text-primary underline font-mono block mt-1"
            >
              载入测试 JSON
            </button>
          </div>
        ) : error ? (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-2 font-mono">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-end gap-1.5">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => handleCopy(formatted, 'j-fmt')}>
                <Copy className="w-2.5 h-2.5 mr-1" />复制美化版
              </Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => handleCopy(minified, 'j-min')}>
                <Copy className="w-2.5 h-2.5 mr-1" />复制单行压缩版
              </Button>
            </div>
            <pre className="font-mono text-[11px] p-2.5 rounded-lg border border-border/60 bg-muted/30 overflow-x-auto max-h-48 select-all">
              {formatted}
            </pre>
          </div>
        )}
      </div>
    )
  }

  // 7. URL 编解码
  const renderUrl = () => {
    const raw = parsed.args
    let encoded = ''
    let decoded = ''
    if (raw) {
      try {
        encoded = encodeURIComponent(raw)
      } catch {
        encoded = '编码错误'
      }
      try {
        decoded = decodeURIComponent(raw)
      } catch {
        decoded = '解码错误'
      }
    }

    return (
      <div className="space-y-3 p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Link2 className="w-4 h-4 text-primary" />
            <span>URL Component 编解码</span>
          </div>
        </div>

        {!raw ? (
          <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
            在上方输入要转换的 URL 字符串，例如：<button type="button" onClick={() => onSelectSample?.('> url https://navhub.io/search?q=极客 工具')} className="text-primary underline font-mono">https://navhub.io/search?q=极客 工具</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
            <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-sans">
                <span>URL 编码 (encodeURIComponent)</span>
                <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => handleCopy(encoded, 'u-enc')}>
                  <Copy className="w-2.5 h-2.5 mr-1" />复制
                </Button>
              </div>
              <div className="text-[11px] break-all select-all">{encoded}</div>
            </div>

            <div className="p-2.5 rounded-lg border border-border/60 bg-muted/30 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-sans">
                <span>URL 解码 (decodeURIComponent)</span>
                <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => handleCopy(decoded, 'u-dec')}>
                  <Copy className="w-2.5 h-2.5 mr-1" />复制
                </Button>
              </div>
              <div className="text-[11px] break-all select-all">{decoded}</div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 路由分发
  switch (parsed.cmd) {
    case 'b64':
    case 'base64':
      return renderBase64()
    case 'jwt':
      return renderJwt()
    case 'time':
    case 'timestamp':
      return renderTime()
    case 'uuid':
      return renderUuid()
    case 'hash':
    case 'sha256':
      return renderHash()
    case 'json':
      return renderJson()
    case 'url':
      return renderUrl()
    default:
      return null
  }
}
