'use client'

/**
 * 管理端：分类树与 SKOS 语义知识图谱治理 (Category & Semantic Taxonomy Governance)
 *
 * 端点支持：
 *   - GET    /api/categories                全量类目
 *   - GET    /api/categories/skos           W3C SKOS 概念模型导出
 *   - GET    /api/categories/:id/related    获取语义关联类目与站点统计
 *   - POST   /api/categories                新建（含 altLabels/relatedCategories）
 *   - PATCH  /api/categories/:id            改名/状态/排序/同义别名/跨类关联
 *   - DELETE /api/categories/:id            安全级联删除（站点移入未分类，子类提升）
 *   - POST   /api/categories/:id/move       换父级（anchor 级联）
 *   - POST   /api/categories/merge          源合并至目标
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
  altLabels?: string[]
  relatedCategories?: string[]
}

interface TreeItem {
  cat: CategoryRow
  depth: number
}

/** 把扁平类目按 parentId 展开成带缩进的前序列表 */
function buildTree(cats: CategoryRow[]): TreeItem[] {
  const byParent = new Map<string | null, CategoryRow[]>()
  const ids = new Set(cats.map((c) => c.id))
  for (const c of cats) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null
    const list = byParent.get(key) ?? []
    list.push(c)
    byParent.set(key, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, 'zh'))
  }
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
  const [newAltLabels, setNewAltLabels] = useState('')
  const [creating, setCreating] = useState(false)
  const [exportingSkos, setExportingSkos] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    void hubGet<CategoryRow[]>('/api/categories')
      .then((data) => setCats(Array.isArray(data) ? data : []))
      .catch(() => setCats([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const tree = useMemo(() => buildTree(cats), [cats])
  const catMap = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])
  const options = useMemo(
    () => tree.map(({ cat, depth }) => ({ id: cat.id, label: '　'.repeat(depth) + cat.title })),
    [tree]
  )

  const create = async () => {
    const title = newTitle.trim()
    if (!title) return
    setCreating(true)
    try {
      const altLabels = newAltLabels
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean)

      await hubSend('/api/categories', 'POST', {
        title,
        parentId: newParent || null,
        altLabels: altLabels.length > 0 ? altLabels : undefined,
      })
      setNewTitle('')
      setNewAltLabels('')
      load()
    } catch (e) {
      window.alert('创建失败：' + String(e))
    } finally {
      setCreating(false)
    }
  }

  const exportSkos = async () => {
    setExportingSkos(true)
    try {
      const concepts = await hubGet('/api/categories/skos')
      const blob = new Blob([JSON.stringify(concepts, null, 2)], { type: 'application/ld+json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `navhub-categories-skos-${new Date().toISOString().slice(0, 10)}.jsonld`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      window.alert('导出 SKOS 失败：' + String(e))
    } finally {
      setExportingSkos(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">分类与 SKOS 概念治理</h1>
          <p className="text-xs text-muted-foreground mt-1">
            支持主树物化路径（Anchor）、SKOS 概念同义别名（altLabel）与跨树相关分类（skos:related）关联。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void exportSkos()} disabled={exportingSkos || loading}>
            {exportingSkos ? '导出中…' : '导出 SKOS 概念'}
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-6 p-3 rounded-md border bg-muted/20">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">新类目名称</label>
          <Input aria-label="分类名称"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="例如：设计资源"
            className="w-48"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">父类目（可选）</label>
          <select aria-label="父分类"
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm w-48"
          >
            <option value="">（根类目）</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">同义别名（逗号分隔）</label>
          <Input aria-label="别名（逗号分隔）"
            value={newAltLabels}
            onChange={(e) => setNewAltLabels(e.target.value)}
            placeholder="如: UI, 素材, 灵感"
            className="w-48"
          />
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
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">类目名称与描述</th>
                <th className="text-left px-3 py-2 font-medium">SKOS 概念模型 (别名/关联)</th>
                <th className="text-left px-3 py-2 font-medium">Anchor</th>
                <th className="text-left px-3 py-2 font-medium">排序</th>
                <th className="text-left px-3 py-2 font-medium">状态</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tree.map(({ cat, depth }) => {
                const hasAlt = Array.isArray(cat.altLabels) && cat.altLabels.length > 0
                const hasRel = Array.isArray(cat.relatedCategories) && cat.relatedCategories.length > 0
                return (
                  <tr key={cat.id} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2 font-medium" style={{ paddingLeft: 12 + depth * 20 }}>
                      <div className="flex items-center gap-1.5">
                        <span>{cat.title}</span>
                        {cat.titleEn ? (
                          <span className="text-xs text-muted-foreground">({cat.titleEn})</span>
                        ) : null}
                      </div>
                      {typeof cat.description === 'string' && cat.description ? (
                        <p className="text-xs text-muted-foreground line-clamp-1">{cat.description}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-col gap-1 max-w-xs">
                        {hasAlt ? (
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="text-muted-foreground text-[10px]">别名:</span>
                            {cat.altLabels!.map((tag) => (
                              <span key={tag} className="px-1.5 py-0.2 bg-muted rounded text-[11px]">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {hasRel ? (
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="text-muted-foreground text-[10px]">关联:</span>
                            {cat.relatedCategories!.map((relId) => {
                              const relCat = catMap.get(relId)
                              return (
                                <span key={relId} className="px-1.5 py-0.2 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 rounded text-[11px]">
                                  {relCat ? relCat.title : relId}
                                </span>
                              )
                            })}
                          </div>
                        ) : null}
                        {!hasAlt && !hasRel ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{cat.anchor}</td>
                    <td className="px-3 py-2 text-xs">{cat.sort}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={cat.enabled ? 'text-green-600 font-medium' : 'text-muted-foreground'}>
                        {cat.enabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                      <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void editSemantic(cat, setBusyId, load, cats)}>
                        语义配置
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void renameCat(cat, setBusyId, load)}>
                        重命名
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void moveCat(cat, options, setBusyId, load)}>
                        移动
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void mergeCat(cat, options, setBusyId, load)}>
                        合并
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === cat.id} onClick={() => void toggleEnabled(cat, setBusyId, load)}>
                        {cat.enabled ? '停用' : '启用'}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busyId === cat.id} onClick={() => void deleteCat(cat, setBusyId, load)}>
                        删除
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ----------------------------- helpers ----------------------------- */

async function editSemantic(
  cat: CategoryRow,
  setBusyId: (id: string | null) => void,
  load: () => void,
  allCats: CategoryRow[]
) {
  const currentAlts = (cat.altLabels ?? []).join(', ')
  const altPrompt = window.prompt(
    `配置「${cat.title}」的 SKOS 同义词/备选标签（逗号分隔）：`,
    currentAlts
  )
  if (altPrompt === null) return

  const newAlts = altPrompt
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)

  const otherCats = allCats.filter((c) => c.id !== cat.id)
  const relPrompt = window.prompt(
    `配置「${cat.title}」的相关概念分类 ID（逗号分隔）：\n候选类目：\n` +
      otherCats.map((c) => `${c.id} (${c.title})`).join('\n'),
    (cat.relatedCategories ?? []).join(', ')
  )
  if (relPrompt === null) return

  const newRels = relPrompt
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((id) => otherCats.some((c) => c.id === id))

  setBusyId(cat.id)
  try {
    await hubSend('/api/categories/' + cat.id, 'PATCH', {
      altLabels: newAlts,
      relatedCategories: newRels,
    })
  } catch (e) {
    window.alert('配置失败：' + String(e))
  } finally {
    setBusyId(null)
    load()
  }
}

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
