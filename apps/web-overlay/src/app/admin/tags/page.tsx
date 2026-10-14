'use client'

/**
 * 管理端：标签管理。
 *
 * 对应中枢已有的 endpoints：
 *   - GET    /api/tags               标签云（含计数，minCount 可筛）
 *   - PATCH  /api/tags/:id           重命名（slug 同步）
 *   - DELETE /api/tags/:id           解除关联后删除
 *   - POST   /api/tags/merge         源标签并入目标标签
 *
 * 这里只做「 thin UI」——所有业务逻辑（计数 / slugify / merge 事务）仍在中枢。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface TagRow {
  id: string
  name: string
  slug: string
  count: number
}

export default function AdminTagsPage() {
  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    void hubGet<TagRow[]>('/api/tags?minCount=1')
      .then((t) => setTags(Array.isArray(t) ? t : []))
      .catch(() => setTags([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = tags.filter((t) =>
    filter.trim() === '' ||
    t.name.includes(filter.trim()) ||
    t.slug.includes(filter.trim().toLowerCase())
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">标签管理</h1>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="按名称 / slug 过滤"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm">暂无标签</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">名称</th>
                <th className="text-left px-3 py-2 font-medium">Slug</th>
                <th className="text-left px-3 py-2 font-medium">引用数</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t.slug}</td>
                  <td className="px-3 py-2">{t.count}</td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === t.id}
                      onClick={() => void renameTag(t, setBusyId, load)}
                    >
                      重命名
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
                      className="text-destructive"
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
