'use client'

/**
 * 管理端：分类树管理。
 *
 * 中枢已提供完整 endpoints（此前只有 API，没有界面）：
 *   - POST   /api/categories                新建（title/parentId/icon/description/sort）
 *   - PATCH  /api/categories/:id            改名/图标/描述/启用/排序
 *   - DELETE /api/categories/:id            删除（站点移入未分类，子类提升到父级）
 *   - POST   /api/categories/:id/move       换父级（anchor 级联）
 *   - POST   /api/categories/merge          源（含后代）并入目标后删源子树
 *
 * 本页只做视图与调用，不复制任何业务规则（anchor 级联、成环检测都在中枢）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hubGet, hubSend } from '@/lib/navhub-api'

interface CategoryRow {
  id: string
  anchor: string
  parentId: string | null
  title: string
  titleEn?: string | null
  description?: string | null
  icon?: string | null
  enabled: boolean
  sort: number
}

interface TreeItem {
  cat: CategoryRow
  depth: number
}

/** 把扁平类目按 parentId 展开成带缩进的前序列表（未知父级按根处理，避免丢行） */
function buildTree(cats: CategoryRow[]): TreeItem[] {
  const byParent = new Map<string | null, CategoryRow[]>()
  const ids = new Set(cats.map((c) => c.id))
  for (const c of cats) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null
    const list = byParent.get(key) ?? []
    list.push(c)
    byParent.set(key, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, 'zh'))
  const out: TreeItem[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ cat: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export default function AdminCategoriesPage() {
  const [cats, setCats] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newParent, setNewParent] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    void hubGet<CategoryRow[]>('/api/categories')
      .then((data) => setCats(Array.isArray(data) ? data : []))
      .catch(() => setCats([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const tree = useMemo(() => buildTree(cats), [cats])
  const options = useMemo(() => tree.map(({ cat, depth }) => ({ id: cat.id, label: '　'.repeat(depth) + cat.title })), [tree])

  const create = async () => {
    const title = newTitle.trim()
    if (!title) return
    setCreating(true)
    try {
      await hubSend('/api/categories', 'POST', {
        title,
        parentId: newParent || null,
      })
      setNewTitle('')
      load()
    } catch (e) {
      window.alert('创建失败：' + String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">分类管理</h1>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-6 p-3 rounded-md border bg-muted/20">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">新类目名称</label>
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="例如：设计资源" className="w-56" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">父类目（可选）</label>
          <select
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm w-56"
          >
            <option value="">（根类目）</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <Button onClick={() => void create()} disabled={creating || !newTitle.trim()}>
          {creating ? '创建中…' : '新建类目'}
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">加载中…</div>
      ) : tree.length === 0 ? (
        <div className="text-muted-foreground text-sm">暂无类目</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">名称</th>
                <th className="text-left px-3 py-2 font-medium">Anchor</th>
                <th className="text-left px-3 py-2 font-medium">排序</th>
                <th className="text-left px-3 py-2 font-medium">状态</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tree.map(({ cat, depth }) => (
                <tr key={cat.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium" style={{ paddingLeft: 12 + depth * 20 }}>
                    {cat.title}
                    {typeof cat.description === 'string' && cat.description ? (
                      <span className="ml-2 text-xs text-muted-foreground">{cat.description}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{cat.anchor}</td>
                  <td className="px-3 py-2">{cat.sort}</td>
                  <td className="px-3 py-2">
                    <span className={cat.enabled ? 'text-green-600' : 'text-muted-foreground'}>
                      {cat.enabled ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                    <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void renameCat(cat, setBusyId, load)}>重命名</Button>
                    <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void moveCat(cat, options, setBusyId, load)}>移动</Button>
                    <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void mergeCat(cat, options, setBusyId, load)}>合并</Button>
                    <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void toggleEnabled(cat, setBusyId, load)}>
                      {cat.enabled ? '停用' : '启用'}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busyId === cat.id} onClick={() => void deleteCat(cat, setBusyId, load)}>删除</Button>
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

async function renameCat(cat: CategoryRow, setBusyId: (id: string | null) => void, load: () => void) {
  const next = window.prompt('重命名类目', cat.title)
  if (!next || !next.trim() || next.trim() === cat.title) return
  setBusyId(cat.id)
  try {
    await hubSend('/api/categories/' + cat.id, 'PATCH', { title: next.trim() })
  } catch (e) {
    window.alert('重命名失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function toggleEnabled(cat: CategoryRow, setBusyId: (id: string | null) => void, load: () => void) {
  setBusyId(cat.id)
  try {
    await hubSend('/api/categories/' + cat.id, 'PATCH', { enabled: !cat.enabled })
  } catch (e) {
    window.alert('操作失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function moveCat(cat: CategoryRow, options: { id: string; label: string }[], setBusyId: (id: string | null) => void, load: () => void) {
  const target = window.prompt(
    '移动到哪个父类目 Id？（留空 = 提升为根类目）\n可用：\n' + options.map((o) => o.id + '  ' + o.label).join('\n'),
    cat.parentId ?? '',
  )
  if (target === null) return
  const parentId = target.trim() || null
  if (parentId === cat.parentId) return
  setBusyId(cat.id)
  try {
    await hubSend('/api/categories/' + cat.id + '/move', 'POST', { parentId })
  } catch (e) {
    // 中枢会拒绝移动到自身后代（成环）
    window.alert('移动失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function mergeCat(cat: CategoryRow, options: { id: string; label: string }[], setBusyId: (id: string | null) => void, load: () => void) {
  const target = window.prompt('将「' + cat.title + '」（含子类）合并到哪个目标类目 Id？', '')
  if (!target || !target.trim() || target.trim() === cat.id) return
  if (!options.find((o) => o.id === target.trim())) {
    window.alert('目标类目不存在')
    return
  }
  setBusyId(cat.id)
  try {
    await hubSend('/api/categories/merge', 'POST', { sourceId: cat.id, targetId: target.trim() })
  } catch (e) {
    window.alert('合并失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

async function deleteCat(cat: CategoryRow, setBusyId: (id: string | null) => void, load: () => void) {
  if (!window.confirm('确认删除类目「' + cat.title + '」？该类目下站点会移入「未分类」，子类目提升到父级。')) return
  setBusyId(cat.id)
  try {
    await hubSend('/api/categories/' + cat.id, 'DELETE')
  } catch (e) {
    window.alert('删除失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}
