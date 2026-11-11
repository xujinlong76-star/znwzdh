'use client'

/**
 * 「我的站点」管理页：用户自定义网址的增删改与排序。
 *
 * 数据走 BFF `/api/me/custom-sites`（会话派生身份 → 中枢按账号存储），
 * 未登录时 BFF 回 401，这里显示登录提示而不是假装能存。
 * 链接渲染统一过 safeHref：服务端已只收 http(s)，这里是第二道防线。
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { safeHref } from '@/lib/safe-url'
import { recordCustomSiteAddedAction } from '@/lib/growth'

interface CustomSite {
  id: string
  title: string
  url: string
  note: string | null
  sortOrder: number
}

type LoadState = 'loading' | 'ready' | 'anonymous' | 'error'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  if (res.status === 401) throw new Error('ANON')
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

export function CustomSitesView() {
  const [state, setState] = useState<LoadState>('loading')
  const [items, setItems] = useState<CustomSite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '', url: '', note: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', url: '', note: '' })

  const load = useCallback(async () => {
    try {
      const data = await api<{ items: CustomSite[] }>('/api/me/custom-sites')
      setItems(data.items)
      setState('ready')
    } catch (err) {
      if (err instanceof Error && err.message === 'ANON') setState('anonymous')
      else {
        setState('error')
        setError(err instanceof Error ? err.message : '加载失败')
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      const data = await api<{ item: CustomSite }>('/api/me/custom-sites', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          url: form.url.trim(),
          note: form.note.trim() || null,
        }),
      })
      setItems((cur) => [...cur, data.item])
      setForm({ title: '', url: '', note: '' })
      // 成长沉淀槽信号：新增了 1 个自己的站（只记账，任务达标由引擎结算）
      recordCustomSiteAddedAction()
    })

  const saveEdit = (id: string) =>
    run(async () => {
      const data = await api<{ item: CustomSite }>(`/api/me/custom-sites/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editForm.title.trim(),
          url: editForm.url.trim(),
          note: editForm.note.trim() || null,
        }),
      })
      setItems((cur) => cur.map((s) => (s.id === id ? data.item : s)))
      setEditingId(null)
    })

  const remove = (id: string) =>
    run(async () => {
      await api(`/api/me/custom-sites/${id}`, { method: 'DELETE' })
      setItems((cur) => cur.filter((s) => s.id !== id))
    })

  const move = (index: number, dir: -1 | 1) =>
    run(async () => {
      const next = [...items]
      const target = index + dir
      if (target < 0 || target >= next.length) return
      ;[next[index], next[target]] = [next[target], next[index]]
      setItems(next)
      const data = await api<{ items: CustomSite[] }>('/api/me/custom-sites/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids: next.map((s) => s.id) }),
      })
      setItems(data.items)
    })

  return (
    <div className="flex min-h-screen flex-col">
      <Container as="main" id="main-content" className="flex-1 py-6">
        <h1 className="text-lg font-bold">我的站点</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把你自己的常用网址存在这里，登录后跨设备同步。收藏页存的是站内目录的站点，这里存的是你的网址，两边互不影响。
        </p>

        {state === 'loading' && (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载…
          </p>
        )}

        {state === 'anonymous' && (
          <div className="mt-8 rounded-xl border border-border p-4 text-sm">
            自定义站点按账号保存，请先登录；登录后在任何设备打开都能看到同一份清单。
          </div>
        )}

        {state === 'error' && (
          <div className="mt-8 rounded-xl border border-destructive/40 p-4 text-sm">
            加载失败：{error}
            <Button variant="outline" size="sm" className="ml-3" onClick={() => void load()}>
              重试
            </Button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <div className="mt-6 grid gap-2 rounded-xl border border-border p-4 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
              <Input
                placeholder="名称，如：公司内网"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                aria-label="站点名称"
              />
              <Input
                placeholder="网址，如：https://example.com"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                aria-label="站点网址"
              />
              <Input
                placeholder="备注（可选）"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                aria-label="备注"
              />
              <Button onClick={() => void add()} disabled={busy || !form.title.trim() || !form.url.trim()}>
                <Plus className="mr-1 h-4 w-4" /> 添加
              </Button>
            </div>

            {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}

            <ul className="mt-6 space-y-2">
              {items.map((site, idx) => {
                const href = safeHref(site.url, '')
                return (
                  <li key={site.id} className="rounded-xl border border-border p-3">
                    {editingId === site.id ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_1fr_auto_auto]">
                        <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} aria-label="名称" />
                        <Input value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} aria-label="网址" />
                        <Input value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} aria-label="备注" placeholder="备注（可选）" />
                        <Button size="sm" onClick={() => void saveEdit(site.id)} disabled={busy}>
                          保存
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{site.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {site.url}
                            {site.note ? ` · ${site.note}` : ''}
                          </p>
                        </div>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            打开 <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void move(idx, -1)} aria-label="上移">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void move(idx, 1)} aria-label="下移">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(site.id)
                            setEditForm({ title: site.title, url: site.url, note: site.note ?? '' })
                          }}
                        >
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(site.id)} aria-label="删除">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {items.length === 0 && (
              <p className="mt-6 text-sm text-muted-foreground">还没有自定义站点，用上面的表单加第一个。</p>
            )}
          </>
        )}
      </Container>
      <Footer />
    </div>
  )
}
