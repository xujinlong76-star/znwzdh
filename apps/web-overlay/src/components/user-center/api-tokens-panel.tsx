'use client'

/**
 * 个人 API 令牌面板（T20）：自建只读令牌，供扩展 / Raycast / MCP 等外部客户端
 * 以「你的身份」读取收藏 / 历史 / 画像 / 金库。明文只在创建响应里出现一次。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

interface OwnedToken {
  id: string
  name: string
  scopes: string[]
  tokenPrefix: string | null
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
}

function formatDate(ts: number | null): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString('zh-CN')
  } catch {
    return '—'
  }
}

export function ApiTokensPanel() {
  const { toast } = useToast()
  const [tokens, setTokens] = useState<OwnedToken[] | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState<{ raw: string; name: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/tokens', { cache: 'no-store' })
      if (!res.ok) {
        setTokens(null)
        return
      }
      const data = (await res.json()) as { tokens?: OwnedToken[] }
      setTokens(Array.isArray(data.tokens) ? data.tokens : [])
    } catch {
      setTokens(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/me/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!res.ok || !data.token) {
        toast({ title: '创建失败', description: data.error ?? '请稍后重试', variant: 'destructive' })
        return
      }
      setRevealed({ raw: data.token, name: trimmed })
      setName('')
      toast({ title: '令牌已创建', description: '明文只显示这一次，请立即复制保存。' })
      await load()
    } finally {
      setCreating(false)
    }
  }, [creating, load, name, toast])

  const revoke = useCallback(
    async (id: string) => {
      if (busyId) return
      setBusyId(id)
      try {
        const res = await fetch('/api/me/tokens/' + id, { method: 'DELETE', cache: 'no-store' })
        if (!res.ok) {
          toast({ title: '吊销失败', description: '请稍后重试', variant: 'destructive' })
          return
        }
        toast({ title: '令牌已吊销', description: '持有该令牌的客户端将立即失去访问能力。' })
        setConfirmId(null)
        await load()
      } finally {
        setBusyId(null)
      }
    },
    [busyId, load, toast],
  )

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          个人 API 令牌
        </h2>
        <span className="text-[11px] text-muted-foreground">只读权限 · 供扩展等外部客户端读取你的数据</span>
      </div>

      {/* 明文一次性展示 */}
      {revealed && (
        <div role="status" className="mt-3 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <p className="font-semibold">「{revealed.name}」已创建——明文只显示这一次：</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded bg-background/70 px-2 py-1.5 font-mono text-[11px]">{revealed.raw}</code>
            <Button
              size="sm"
              variant="outline"
              className="w-full shrink-0 text-xs sm:w-auto"
              onClick={() => {
                void copyText(revealed.raw).then((r) => {
                  if (r.ok) toast({ title: '已复制到剪贴板' })
                  else toast({ title: '复制失败', description: r.reason ?? '请手动选择复制', variant: 'destructive' })
                })
              }}
            >
              复制
            </Button>
            <Button size="sm" variant="ghost" className="w-full shrink-0 text-xs sm:w-auto" onClick={() => setRevealed(null)}>
              我已保存
            </Button>
          </div>
        </div>
      )}

      {/* 创建 */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="令牌名称"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="令牌名称（如：Raycast 扩展）"
          className="h-9 flex-1 text-xs"
        />
        <Button size="sm" className="w-full text-xs sm:w-auto" disabled={creating || !name.trim()} onClick={() => void create()}>
          {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
          创建令牌
        </Button>
      </div>

      {/* 列表 */}
      {tokens !== null && tokens.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60">
          {tokens.map((t) => {
            const confirming = confirmId === t.id
            return (
              <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">
                      {t.name}
                      {t.tokenPrefix && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{t.tokenPrefix}…</span>}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t.scopes.join(',')} · 创建于 {formatDate(t.createdAt)}
                      {t.lastUsedAt ? ` · 最近使用 ${formatDate(t.lastUsedAt)}` : ' · 从未使用'}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={confirming ? 'destructive' : 'outline'}
                  className="w-full shrink-0 text-xs sm:w-auto"
                  disabled={busyId === t.id}
                  onClick={() => {
                    if (!confirming) {
                      setConfirmId(t.id)
                      return
                    }
                    void revoke(t.id)
                  }}
                >
                  {busyId === t.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                  {confirming ? '确认吊销' : '吊销'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {tokens !== null && tokens.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
          还没有个人令牌。创建后把明文粘贴到扩展 / Raycast 的设置里，即可在这些客户端读取你的收藏与历史。
        </p>
      )}
    </section>
  )
}
