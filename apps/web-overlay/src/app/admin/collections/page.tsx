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
import { Library, ListX, ExternalLink, MessageSquareText, Layers, Compass, MapPin, Route, ArrowUp, ArrowDown } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadErrorNotice } from '@/components/admin/load-error-notice'
import { describeLoadFailure, emptyStateText } from '@/lib/admin-load-failure'
import { newRequestGate, settleLatest, type RequestGate } from '@/lib/latest-request'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import { Badge } from '@/components/ui/badge'

interface CollectionRow {
  id: string
  slug: string
  title: string
  description?: string | null
  kind: 'topic' | 'geo' | 'roadmap'
  icon?: string | null
  sort: number
  enabled: boolean
  siteCount?: number
}

interface CollectionItem {
  siteId: string
  sort: number
  note: string | null
  title?: string | null
  url?: string | null
  iconKey?: string | null
  enabled?: boolean
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
  const [newSiteNote, setNewSiteNote] = useState('')

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

  /** 支持填站点 id 或完整 URL（URL 会先解析成 id），支持附带推荐理由 */
  const addItem = async () => {
    if (!selected || !newSiteRef.trim()) return
    setBusy(true)
    try {
      let siteId = newSiteRef.trim()
      if (/^https?:\/\//i.test(siteId)) {
        const site = await hubGet<{ id: string }>('/api/sites/' + encodeURIComponent(siteId))
        siteId = site.id
      }
      await hubSend('/api/collections/' + selected.id + '/items', 'POST', {
        siteId,
        note: newSiteNote.trim() || null,
      })
      setNewSiteRef('')
      setNewSiteNote('')
      loadDetail(selected.id)
      load()
    } catch (e) {
      window.alert('添加失败（确认站点 id/URL 在库中）：' + String(e))
    } finally {
      setBusy(false)
    }
  }

  const patchItem = async (siteId: string, patch: { note?: string | null; sort?: number }) => {
    if (!selected) return
    setBusy(true)
    try {
      await hubSend('/api/collections/' + selected.id + '/items/' + siteId, 'PATCH', patch)
      loadDetail(selected.id)
    } catch (e) {
      window.alert('更新条目失败：' + String(e))
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
      load()
    } catch (e) {
      window.alert('移除失败：' + String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-violet-500" />
            精选专题
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            策划主题路线与场景方案，支持为每个收录站点编写策展人推荐理由（Note）。
          </p>
        </div>
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
            <option value="roadmap">路线图</option>
            <option value="geo">地域</option>
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
                  className={'w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-2 ' + (c.id === selectedId ? 'bg-accent/60' : 'hover:bg-accent/30')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{c.title}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                        {KIND_LABELS[c.kind] ?? c.kind}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {c.slug} · {c.siteCount !== undefined ? `${c.siteCount} 个站点` : '计算中…'}
                    </div>
                  </div>
                  <span className={'text-xs shrink-0 ' + (c.enabled ? 'text-green-600 font-medium' : 'text-muted-foreground')}>
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
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{selected.title}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">/{selected.slug}</div>
                  </div>
                  <Badge variant={selected.enabled ? 'default' : 'secondary'} className="text-xs">
                    {selected.enabled ? '已发布' : '草稿/下架'}
                  </Badge>
                </div>
                {selected.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {selected.description}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t text-xs">
                  <span className="text-muted-foreground">类型：</span>
                  <select
                    value={selected.kind}
                    onChange={(e) => void patchSelected({ kind: e.target.value as any })}
                    disabled={busy}
                    aria-label="切换专题类型"
                    className="h-7 rounded border bg-background px-2 text-xs"
                  >
                    <option value="topic">主题</option>
                    <option value="roadmap">路线图</option>
                    <option value="geo">地域</option>
                  </select>

                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void patchSelected({ enabled: !selected.enabled })}>
                    {selected.enabled ? '下架' : '发布'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
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
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt('修改描述', selected.description ?? '')
                      if (next !== null) void patchSelected({ description: next.trim() || null })
                    }}
                  >
                    改描述
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10 ml-auto" disabled={busy} onClick={() => void removeSelected()}>
                    删除专题
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2 flex items-center justify-between">
                  <span>收录站点（{items.length}）</span>
                  <span className="text-xs text-muted-foreground font-normal">支持附带策展理由</span>
                </div>
                <div className="space-y-2 mb-3">
                  <div className="flex gap-2">
                    <Input aria-label="站点 id 或完整 URL"
                      value={newSiteRef}
                      onChange={(e) => setNewSiteRef(e.target.value)}
                      placeholder="站点 id 或完整 URL"
                      className="flex-1"
                    />
                    <Button size="sm" disabled={busy || !newSiteRef.trim()} onClick={() => void addItem()}>添加</Button>
                  </div>
                  <Input aria-label="策展人推荐理由或批注（选填）"
                    value={newSiteNote}
                    onChange={(e) => setNewSiteNote(e.target.value)}
                    placeholder="选填：策展人推荐理由（如：入门必读、适合快速原型）"
                    className="text-xs"
                  />
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
                  <div className="rounded-md border divide-y max-h-96 overflow-y-auto">
                    {items.map((it, idx) => (
                      <div key={it.siteId} className="p-3 text-sm space-y-2 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-xs flex items-center gap-1.5 truncate">
                              <span className="w-5 h-5 rounded bg-muted flex items-center justify-center font-mono text-[10px] shrink-0 text-muted-foreground">
                                {idx + 1}
                              </span>
                              <span className="truncate">{it.title || it.siteId}</span>
                              {it.url && (
                                <a href={safeHref(it.url)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" title="新标签页打开">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            {it.url && <div className="text-[11px] text-muted-foreground truncate font-mono ml-6.5">{it.url}</div>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={busy || idx === 0}
                              title="上移"
                              onClick={() => {
                                const prev = items[idx - 1]
                                if (!prev) return
                                void patchItem(it.siteId, { sort: prev.sort - 1 })
                              }}
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={busy || idx === items.length - 1}
                              title="下移"
                              onClick={() => {
                                const next = items[idx + 1]
                                if (!next) return
                                void patchItem(it.siteId, { sort: next.sort + 1 })
                              }}
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:bg-destructive/10"
                              disabled={busy}
                              onClick={() => void removeItem(it.siteId)}
                            >
                              移除
                            </Button>
                          </div>
                        </div>
                        {/* 策展理由 (Note) 展示与内联编辑 */}
                        <div className="ml-6.5 flex items-start gap-1.5 text-xs bg-muted/40 rounded p-1.5 border border-border/50">
                          <MessageSquareText className="w-3.5 h-3.5 text-violet-500 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            {it.note ? (
                              <span className="text-foreground/90">{it.note}</span>
                            ) : (
                              <span className="text-muted-foreground/70 italic">未填推荐理由</span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const next = window.prompt('编辑站点推荐理由（留空清除）', it.note ?? '')
                              if (next !== null) void patchItem(it.siteId, { note: next.trim() || null })
                            }}
                            className="text-[11px] text-primary hover:underline shrink-0"
                          >
                            {it.note ? '修改' : '+ 写推荐'}
                          </button>
                        </div>
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
