'use client'

/**
 * 管理端：精选专题管理。
 *
 * 中枢 endpoints（本轮新增 CRUD + 条目管理）：
 *   - GET    /api/collections?all=1            全部（含停用）
 *   - GET    /api/collections/by-id/:id        详情 + 条目
 *   - POST   /api/collections                   新建（slug 唯一）
 *   - PATCH  /api/collections/:id               改字段
 *   - DELETE /api/collections/:id               删除（站点不受影响）
 *   - POST   /api/collections/:id/items         加站点（siteId）
 *   - DELETE /api/collections/:id/items/:siteId 移除站点
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Library, ListX } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadErrorNotice } from '@/components/admin/load-error-notice'
import { describeLoadFailure, emptyStateText } from '@/lib/admin-load-failure'
import { newRequestGate, settleLatest, type RequestGate } from '@/lib/latest-request'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface CollectionRow {
  id: string
  slug: string
  title: string
  description?: string | null
  kind: 'topic' | 'geo' | 'roadmap'
  icon?: string | null
  sort: number
  enabled: boolean
}

interface CollectionItem {
  siteId: string
  sort: number
  note: string | null
}

const KIND_LABELS: Record<string, string> = {
  topic: '主题',
  geo: '地域',
  roadmap: '路线图',
}

export default function AdminCollectionsPage() {
  const [cols, setCols] = useState<CollectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [items, setItems] = useState<CollectionItem[]>([])
  const [busy, setBusy] = useState(false)
  // 「没拉到」和「真的没有」必须分开，否则失败会被渲染成「暂无专题」（见 lib/admin-load-failure.ts）
  const [loadError, setLoadError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  // 详情请求的闸门：连点两个专题时，先发的那次就算后到，也不许覆盖后发那次的结果
  const detailGateRef = useRef<RequestGate | null>(null)
  if (detailGateRef.current === null) detailGateRef.current = newRequestGate()
  const detailGate = detailGateRef.current

  // 新建表单
  const [newSlug, setNewSlug] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState('topic')
  const [creating, setCreating] = useState(false)

  // 加条目
  const [newSiteRef, setNewSiteRef] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    void hubGet<CollectionRow[]>('/api/collections?all=1')
      .then((data) => setCols(Array.isArray(data) ? data : []))
      .catch((err) => {
        // 失败仍然回落到空列表，但必须留下错误态：显示成「暂无专题」会让管理员
        // 以为数据被删了
        setCols([])
        setLoadError(describeLoadFailure(err, '专题列表'))
      })
      .finally(() => setLoading(false))
  }, [])

  const loadDetail = useCallback((id: string) => {
    setSelectedId(id)
    setDetailError(null)
    // 先清空：否则切换专题时，上一份条目会挂在新专题下面
    setItems([])
    void (async () => {
      const out = await settleLatest(detailGate, () =>
        hubGet<{ collection: CollectionRow; items: CollectionItem[] }>('/api/collections/by-id/' + id),
      )
      // 过期（用户已经点了别的专题 / 已经删掉这个专题）：一个字都不要写
      if (out.status === 'stale') return
      if (out.status === 'value') {
        setItems(out.value.items ?? [])
        return
      }
      // 同 load()：条目加载失败不能显示成「暂无条目」
      setItems([])
      setDetailError(describeLoadFailure(out.error, '专题条目'))
    })()
  }, [detailGate])

  useEffect(() => { load() }, [load])

  const selected = cols.find((c) => c.id === selectedId) ?? null

  const create = async () => {
    if (!newSlug.trim() || !newTitle.trim()) return
    setCreating(true)
    try {
      const col = await hubSend<CollectionRow>('/api/collections', 'POST', {
        slug: newSlug.trim().toLowerCase(),
        title: newTitle.trim(),
        kind: newKind,
      })
      setNewSlug('')
      setNewTitle('')
      load()
      if (col?.id) loadDetail(col.id)
    } catch (e) {
      window.alert('创建失败：' + String(e))
    } finally {
      setCreating(false)
    }
  }

  const patchSelected = async (patch: Partial<CollectionRow>) => {
    if (!selected) return
    setBusy(true)
    try {
      await hubSend('/api/collections/' + selected.id, 'PATCH', patch)
      load()
      loadDetail(selected.id)
    } catch (e) {
      window.alert('保存失败：' + String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeSelected = async () => {
    if (!selected) return
    if (!window.confirm('确认删除专题「' + selected.title + '」？专题内站点不受影响。')) return
    setBusy(true)
    try {
      await hubSend('/api/collections/' + selected.id, 'DELETE')
      detailGate.invalidate()
      setSelectedId(null)
      setItems([])
      load()
    } catch (e) {
      window.alert('删除失败：' + String(e))
    } finally {
      setBusy(false)
    }
  }

  /** 支持填站点 id 或完整 URL（URL 会先解析成 id） */
  const addItem = async () => {
    if (!selected || !newSiteRef.trim()) return
    setBusy(true)
    try {
      let siteId = newSiteRef.trim()
      if (/^https?:\/\//i.test(siteId)) {
        const site = await hubGet<{ id: string }>('/api/sites/' + encodeURIComponent(siteId))
        siteId = site.id
      }
      await hubSend('/api/collections/' + selected.id + '/items', 'POST', { siteId })
      setNewSiteRef('')
      loadDetail(selected.id)
    } catch (e) {
      window.alert('添加失败（确认站点 id/URL 在库中）：' + String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeItem = async (siteId: string) => {
    if (!selected) return
    setBusy(true)
    try {
      await hubSend('/api/collections/' + selected.id + '/items/' + siteId, 'DELETE')
      loadDetail(selected.id)
    } catch (e) {
      window.alert('移除失败：' + String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">精选专题</h1>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-6 p-3 rounded-md border bg-muted/20">
        <div className="space-y-1">
          <label htmlFor="collection-new-slug" className="text-xs text-muted-foreground">Slug（唯一）</label>
          <Input id="collection-new-slug" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="ai-starter" className="w-full sm:w-44" />
        </div>
        <div className="space-y-1">
          <label htmlFor="collection-new-title" className="text-xs text-muted-foreground">标题</label>
          <Input id="collection-new-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="AI 入门必备" className="w-full sm:w-56" />
        </div>
        <div className="space-y-1">
          <label htmlFor="collection-new-kind" className="text-xs text-muted-foreground">类型</label>
          <select id="collection-new-kind"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-base sm:text-sm w-full sm:w-32"
          >
            <option value="topic">主题</option>
            <option value="geo">地域</option>
            <option value="roadmap">路线图</option>
          </select>
        </div>
        <Button onClick={() => void create()} disabled={creating || !newSlug.trim() || !newTitle.trim()}>
          {creating ? '创建中…' : '新建专题'}
        </Button>
      </div>

      {loadError && <LoadErrorNotice message={loadError} onRetry={() => load()} retrying={loading} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <h2 className="text-base font-medium mb-3">全部专题（{cols.length}）</h2>
          {loading ? (
            <div className="text-muted-foreground text-sm">加载中…</div>
          ) : cols.length === 0 ? (
            <EmptyState
              icon={Library}
              title={emptyStateText(loadError, '暂无专题')}
              description={loadError ? '拉取失败时列表为空，请重试。' : '把相关站点汇成一个专题，便于成套分享与维护。'}
            />
          ) : (
            <div className="rounded-md border divide-y">
              {cols.map((c) => (
                <button
                  key={c.id}
                  onClick={() => loadDetail(c.id)}
                  className={'w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ' + (c.id === selectedId ? 'bg-accent/60' : 'hover:bg-accent/30')}
                >
                  <span className="truncate">
                    <span className="font-medium">{c.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{c.slug} · {KIND_LABELS[c.kind] ?? c.kind}</span>
                  </span>
                  <span className={'text-xs ' + (c.enabled ? 'text-green-600' : 'text-muted-foreground')}>
                    {c.enabled ? '启用' : '停用'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-base font-medium mb-3">专题详情</h2>
          {!selected ? (
            <div className="text-muted-foreground text-sm">左侧选择一个专题进行编辑</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">{selected.title}</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void patchSelected({ enabled: !selected.enabled })}>
                    {selected.enabled ? '停用' : '启用'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt('重命名专题', selected.title)
                      if (next && next.trim() && next.trim() !== selected.title) void patchSelected({ title: next.trim() })
                    }}
                  >
                    重命名
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt('修改描述', selected.description ?? '')
                      if (next !== null) void patchSelected({ description: next })
                    }}
                  >
                    改描述
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void removeSelected()}>
                    删除专题
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">站点条目（{items.length}）</div>
                <div className="flex gap-2 mb-3">
                  <Input aria-label="站点 id 或完整 URL"
                    value={newSiteRef}
                    onChange={(e) => setNewSiteRef(e.target.value)}
                    placeholder="站点 id 或完整 URL"
                    className="flex-1"
                  />
                  <Button size="sm" disabled={busy || !newSiteRef.trim()} onClick={() => void addItem()}>添加</Button>
                </div>
                {detailError && (
                  <LoadErrorNotice message={detailError} onRetry={() => selected && loadDetail(selected.id)} />
                )}
                {items.length === 0 ? (
                  <EmptyState
                    icon={ListX}
                    title={emptyStateText(detailError, '暂无条目')}
                    description={detailError ? '拉取失败时列表为空，请重试。' : '这个专题还没有收录任何站点。'}
                  />
                ) : (
                  <div className="rounded-md border divide-y">
                    {items.map((it) => (
                      <div key={it.siteId} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="truncate text-xs text-muted-foreground">{it.siteId}</span>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeItem(it.siteId)}>
                          移除
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
