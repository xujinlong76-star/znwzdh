'use client'

/**
 * 管理端：标签管理 (Tag & Taxonomy Management).
 *
 * 对应中枢 endpoints：
 *   - GET    /api/tags               标签云（含计数、维度分组与 SKOS 别名）
 *   - PATCH  /api/tags/:id           重命名或更新属性 (name, group, color, description)
 *   - DELETE /api/tags/:id           解除关联后删除
 *   - POST   /api/tags/merge         源标签并入目标标签 (自动迁移并收录别名)
 *   - POST   /api/tags/:id/aliases   绑定概念别名 (SKOS altLabel)
 *   - DELETE /api/tags/:id/aliases/:a 解除别名绑定
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadErrorNotice } from '@/components/admin/load-error-notice'
import { describeLoadFailure, emptyStateText } from '@/lib/admin-load-failure'
import { newRequestGate, settleLatest, type RequestGate } from '@/lib/latest-request'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface TagRow {
  id: string
  name: string
  slug: string
  count: number
  group: string
  color?: string | null
  description?: string | null
  aliases: string[]
}

const COMMON_GROUPS = [
  { key: 'all', label: '全部' },
  { key: 'topic', label: '领域 (Topic)' },
  { key: 'platform', label: '平台 (Platform)' },
  { key: 'pricing', label: '付费 (Pricing)' },
  { key: 'scene', label: '场景 (Scene)' },
  { key: 'form', label: '形态 (Form)' },
]

export default function AdminTagsPage() {
  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  // 「没拉到」和「真的没有」必须分开（见 lib/admin-load-failure.ts）
  const [loadError, setLoadError] = useState<string | null>(null)

  // 分组切换也要过闸：连点「领域」「平台」时，先发那次就算后到也不许覆盖后发那次
  const groupGateRef = useRef<RequestGate | null>(null)
  if (groupGateRef.current === null) groupGateRef.current = newRequestGate()
  const groupGate = groupGateRef.current

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    const url = selectedGroup === 'all' ? '/api/tags?minCount=1' : `/api/tags?minCount=1&group=${selectedGroup}`
    void (async () => {
      const out = await settleLatest(groupGate, () => hubGet<TagRow[]>(url))
      // 过期（用户已经点了别的分组）：一个字都不要写，连 loading 都别动
      if (out.status === 'stale') return
      if (out.status === 'value') {
        setTags(Array.isArray(out.value) ? out.value : [])
      } else {
        // 失败仍然回落到空列表，但必须留下错误态（见 lib/admin-load-failure.ts）
        setTags([])
        setLoadError(describeLoadFailure(out.error, '标签列表'))
      }
      setLoading(false)
    })()
  }, [groupGate, selectedGroup])

  useEffect(() => { load() }, [load])

  const filtered = tags.filter((t) => {
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return (
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      (t.aliases && t.aliases.some((a) => a.toLowerCase().includes(q))) ||
      t.group.toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">多维标签与词表治理</h1>
          <p className="text-xs text-muted-foreground mt-1">
            支持正交维度分组（Topic / Platform / Pricing / Scene）与 SKOS 规范别名归一化（altLabels）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="text-xs">
            <Link href="/admin/facets">
              分面属性治理 →
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="按名称 / slug / 别名 / 分组过滤"
          placeholder="按名称 / slug / 别名 / 分组过滤"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center gap-1.5 flex-wrap">
          {COMMON_GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => setSelectedGroup(g.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedGroup === g.key
                  ? 'bg-primary text-primary-foreground border-primary font-medium'
                  : 'bg-background hover:bg-muted text-muted-foreground border-border'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {loadError && <LoadErrorNotice message={loadError} onRetry={() => load()} retrying={loading} />}

      {loading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">{emptyStateText(loadError, '暂无匹配标签')}</div>
      ) : (
        <div className="rounded-md border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">标签名与 Slug</th>
                <th className="text-left px-3 py-2 font-medium">维度分组</th>
                <th className="text-left px-3 py-2 font-medium">概念别名 (altLabels)</th>
                <th className="text-center px-3 py-2 font-medium">引用数</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {t.color && (
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: t.color }}
                        />
                      )}
                      <div>
                        <div className="font-medium text-foreground">{t.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{t.slug}</div>
                      </div>
                    </div>
                    {t.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-block px-2 py-0.5 text-xs rounded-md bg-muted text-muted-foreground border font-mono">
                      {t.group || 'topic'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 max-w-sm">
                      {t.aliases && t.aliases.length > 0 ? (
                        t.aliases.map((alias) => (
                          <span
                            key={alias}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-secondary text-secondary-foreground rounded border group"
                          >
                            <span>{alias}</span>
                            <button
                              type="button"
                              onClick={() => void removeAlias(t, alias, setBusyId, load)}
                              className="text-muted-foreground hover:text-destructive text-[10px] ml-0.5 font-bold"
                              title="移除此别名"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground/60 italic">无别名</span>
                      )}
                      <button
                        type="button"
                        onClick={() => void addAlias(t, setBusyId, load)}
                        className="text-xs text-primary hover:underline px-1 py-0.5"
                        title="添加概念别名"
                      >
                        +别名
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono">{t.count}</td>
                  <td className="px-3 py-2.5 text-right space-x-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === t.id}
                      onClick={() => void editTagAttributes(t, setBusyId, load)}
                    >
                      属性
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === t.id}
                      onClick={() => void renameTag(t, setBusyId, load)}
                    >
                      更名
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === t.id}
                      onClick={() => void mergeTag(t, tags, setBusyId, load)}
                    >
                      合并
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busyId === t.id}
                      onClick={() => void deleteTag(t, setBusyId, load)}
                    >
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ----------------------------- helpers ----------------------------- */

async function editTagAttributes(tag: TagRow, setBusyId: (id: string | null) => void, load: () => void) {
  const currentGroup = tag.group || 'topic'
  const nextGroup = window.prompt(
    '设置标签维度分组 (如: topic / platform / pricing / scene / form)',
    currentGroup,
  )
  if (nextGroup === null) return

  const currentColor = tag.color || ''
  const nextColor = window.prompt('设置颜色 Hex 值 (可选，例如: #3b82f6，留空清除)', currentColor)
  if (nextColor === null) return

  setBusyId(tag.id)
  try {
    await hubSend('/api/tags/' + tag.id, 'PATCH', {
      group: nextGroup.trim() || 'topic',
      color: nextColor.trim() || null,
    })
  } catch (e) {
    window.alert('更新属性失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function addAlias(tag: TagRow, setBusyId: (id: string | null) => void, load: () => void) {
  const alias = window.prompt(`为标签「${tag.name}」添加概念别名 (例如: 缩写/英文名/同义词):`, '')
  if (!alias || !alias.trim()) return
  setBusyId(tag.id)
  try {
    await hubSend(`/api/tags/${tag.id}/aliases`, 'POST', { alias: alias.trim() })
  } catch (e) {
    window.alert('添加别名失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function removeAlias(tag: TagRow, alias: string, setBusyId: (id: string | null) => void, load: () => void) {
  if (!window.confirm(`确认解除别名「${alias}」与标签「${tag.name}」的绑定？`)) return
  setBusyId(tag.id)
  try {
    await hubSend(`/api/tags/${tag.id}/aliases/${encodeURIComponent(alias)}`, 'DELETE')
  } catch (e) {
    window.alert('移除别名失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function renameTag(tag: TagRow, setBusyId: (id: string | null) => void, load: () => void) {
  const next = window.prompt('重命名标签', tag.name)
  if (!next || next.trim() === tag.name || next.trim() === '') return
  setBusyId(tag.id)
  try {
    await hubSend('/api/tags/' + tag.id, 'PATCH', { name: next.trim() })
  } catch (e) {
    window.alert('重命名失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function deleteTag(tag: TagRow, setBusyId: (id: string | null) => void, load: () => void) {
  if (!window.confirm('确认删除标签「' + tag.name + '」？将解除所有引用，不影响站点。')) return
  setBusyId(tag.id)
  try {
    await hubSend('/api/tags/' + tag.id, 'DELETE')
  } catch (e) {
    window.alert('删除失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function mergeTag(tag: TagRow, tags: TagRow[], setBusyId: (id: string | null) => void, load: () => void) {
  const target = window.prompt('将「' + tag.name + '」合并到哪个目标标签 Id？（填目标 id）', '')
  if (!target || target.trim() === '' || target.trim() === tag.id) return
  if (!tags.find((t) => t.id === target.trim())) {
    window.alert('目标标签不存在')
    return
  }
  setBusyId(tag.id)
  try {
    await hubSend('/api/tags/merge', 'POST', { sourceId: tag.id, targetId: target.trim() })
  } catch (e) {
    window.alert('合并失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}
