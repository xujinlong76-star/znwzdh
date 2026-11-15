'use client'

/**
 * 收藏回收站（/favorites/trash，用户侧）。
 *
 * 不要复用 /admin/trash——那是站点管理端（admin scope），这里是用户自己的
 * 收藏回收站。列表按 deletedAt 倒序；删除的收藏保留 30 天。
 *
 * 数据源：
 *  - 登录态：以后端墓碑列表为准（GET /api/me/favorites/trash）。本地回收站
 *    里"云端没有对应墓碑"的条目，在一次成功同步后按 siteId 对齐丢弃
 *    （删除不是新增，不上推；匿名期只在本地的删除，登录同步成功后云端
 *    自然有了墓碑——对齐只发生在有成功同步记录时，没同步过不丢本地条目，
 *    只是视图里标"仅本机"）；
 *  - 匿名态：只有本地回收站（lib/favorites-trash）。
 *
 * 恢复：先调云端恢复（add 复活分支；原站点已硬删时 404，不谎报成功，
 * 条目留在回收站并标注"原站点已不存在，无法恢复"），成功后再恢复本地
 * 并清掉本地快照。彻底删除 / 清空回收站是物理删行，必须二次确认。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFavorites, readSyncStatus, type LocalFavorite } from '@/hooks/useFavorites'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import {
  formatTrashRemaining,
  pruneExpiredTrash,
  readTrash,
  writeTrash,
  type TrashedFavorite,
} from '@/lib/favorites-trash'
import {
  clearFavoriteTrash,
  listFavoriteTrash,
  purgeFavoriteTrash,
  restoreFavoriteTrash,
  restoreFavoriteTrashBatch,
  type HubFavoriteTrashItem,
} from '@/lib/navhub-api'
import { UserCenterNav } from '@/components/user-center/user-center-nav'
import { Search, Trash2, Undo2 } from 'lucide-react'

interface TrashRow {
  siteId: string
  title: string
  href: string
  note?: string
  folderName?: string | null
  folderId?: string | null
  createdAt: number
  deletedAt: number
  source: 'cloud' | 'local'
  /** 原站点已被硬删：恢复会 404，按钮置灰并标注 */
  siteGone: boolean
  localItem?: TrashedFavorite
}

function cloudRow(item: HubFavoriteTrashItem): TrashRow {
  return {
    siteId: item.siteId,
    title: item.site?.title ?? item.siteId,
    href: item.site?.url ?? '',
    note: item.note ?? undefined,
    folderName: item.folderName,
    folderId: item.folderId,
    createdAt: item.createdAt,
    deletedAt: item.deletedAt ?? item.updatedAt,
    source: 'cloud',
    siteGone: item.site === null,
  }
}

function localRow(item: TrashedFavorite): TrashRow {
  return {
    siteId: item.siteId,
    title: item.title,
    href: item.href,
    note: item.note,
    folderName: item.folderName ?? null,
    folderId: item.folderId,
    createdAt: item.createdAt,
    deletedAt: item.deletedAt,
    source: 'local',
    siteGone: false,
    localItem: item,
  }
}

/** 云端行恢复成本地收藏的完整字段（site join 里有标题与地址） */
function cloudRowToFavorite(row: TrashRow, site: HubFavoriteTrashItem['site']): LocalFavorite {
  return {
    siteId: row.siteId,
    title: site?.title ?? row.title,
    href: site?.url ?? row.href,
    description: site?.description ?? undefined,
    note: row.note,
    folderId: row.folderId,
    createdAt: row.createdAt,
  }
}

export default function FavoritesTrashPage() {
  const favorites = useFavorites()
  const identityReady = useIdentityReady()
  const [localState, setLocalState] = useState(() =>
    typeof window === 'undefined' ? { items: [], folders: [] } : readTrash(),
  )
  const [cloudItems, setCloudItems] = useState<HubFavoriteTrashItem[] | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loggedIn =
    identityReady.ready &&
    typeof identityReady.identity === 'string' &&
    !identityReady.identity.startsWith('anon-')

  const refreshLocal = useCallback(() => {
    const pruned = pruneExpiredTrash(readTrash())
    setLocalState(pruned)
  }, [])

  const refreshCloud = useCallback(async () => {
    if (!loggedIn) {
      setCloudItems(null)
      return
    }
    const list = await listFavoriteTrash(200, (error) => {
      setCloudError(error instanceof Error ? error.message : '云端回收站拉取失败')
    })
    if (!list) return
    setCloudItems(list.items)
    setCloudError(null)
    // 对齐：只有"成功同步过"才按 siteId 丢弃本地多余条目。没同步过时
    // 匿名期删的收藏在云端还没有墓碑，丢了就找不回来——先留着，视图里标"仅本机"。
    const lastSync = readSyncStatus()
    if (lastSync?.ok) {
      const cloudIds = new Set(list.items.map((i) => i.siteId))
      const current = readTrash()
      const aligned = current.items.filter((i) => cloudIds.has(i.siteId))
      if (aligned.length !== current.items.length) {
        const dropped = current.items.length - aligned.length
        writeTrash({ items: aligned, folders: current.folders })
        setLocalState({ items: aligned, folders: current.folders })
        setNotice(`已按云端回收站对齐，本地多余的 ${dropped} 条已移除（它们没有云端删除记录）`)
      }
    }
  }, [loggedIn])

  useEffect(() => {
    // 打开时剪枝一次（写回即删，不弹确认；只剪本地视图）
    const trash = readTrash()
    const pruned = pruneExpiredTrash(trash)
    if (pruned.items.length !== trash.items.length || pruned.folders.length !== trash.folders.length) {
      writeTrash(pruned)
    }
    setLocalState(pruned)
    void refreshCloud()
    const onTrashUpdated = () => refreshLocal()
    window.addEventListener('navhub_trash_updated', onTrashUpdated)
    window.addEventListener('storage', onTrashUpdated)
    return () => {
      window.removeEventListener('navhub_trash_updated', onTrashUpdated)
      window.removeEventListener('storage', onTrashUpdated)
    }
  }, [refreshCloud, refreshLocal])

  /** 视图行：登录态以云端为准（本地多余的只在没同步过时才并进来标"仅本机"） */
  const rows = useMemo<TrashRow[]>(() => {
    if (!loggedIn || cloudItems === null) {
      return localState.items.map(localRow).sort((a, b) => b.deletedAt - a.deletedAt)
    }
    const cloudRows = cloudItems.map(cloudRow)
    const cloudIds = new Set(cloudItems.map((i) => i.siteId))
    const localOnly = localState.items
      .filter((i) => !cloudIds.has(i.siteId))
      .map(localRow)
    return [...cloudRows, ...localOnly].sort((a, b) => b.deletedAt - a.deletedAt)
  }, [loggedIn, cloudItems, localState])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.note ?? '').toLowerCase().includes(q),
    )
  }, [rows, query])

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.siteId)),
    [filtered, selected],
  )

  const toggleSelect = (siteId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((r) => r.siteId)))
    }
  }

  /** 本地恢复 + 清本地快照（云端恢复成功后才调；匿名直接调） */
  const restoreLocally = useCallback(
    (rowsToRestore: TrashRow[]): { restored: string[]; skipped: string[] } => {
      const items: Array<LocalFavorite & { index?: number }> = rowsToRestore.map((row) => {
        if (row.localItem) return { ...row.localItem }
        const cloudItem = cloudItems?.find((i) => i.siteId === row.siteId)
        return cloudRowToFavorite(row, cloudItem?.site ?? null)
      })
      const result = favorites.restoreFavorites(items)
      if (result.restored.length > 0) {
        const state = readTrash()
        const remaining = state.items.filter((i) => !result.restored.includes(i.siteId))
        writeTrash({ items: remaining, folders: state.folders })
        setLocalState({ items: remaining, folders: state.folders })
      }
      return result
    },
    [cloudItems, favorites],
  )

  const handleRestore = useCallback(
    async (row: TrashRow) => {
      if (row.siteGone) {
        setNotice(`「${row.title}」原站点已不存在，无法恢复`)
        return
      }
      setBusy(true)
      try {
        if (loggedIn) {
          const result = await restoreFavoriteTrash(row.siteId)
          if (!result.ok) {
            setNotice(
              result.siteGone
                ? `「${row.title}」原站点已不存在，无法恢复`
                : `恢复失败：${result.message}`,
            )
            return
          }
          restoreLocally([row])
          setNotice(
            result.folderLost
              ? `已恢复「${row.title}」（原收藏夹已不存在，已恢复到未分组）`
              : `已恢复「${row.title}」`,
          )
        } else {
          const result = restoreLocally([row])
          setNotice(
            result.restored.length > 0
              ? `已恢复「${row.title}」`
              : `恢复失败：「${row.title}」已在收藏里或本机存储写不进去`,
          )
        }
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(row.siteId)
          return next
        })
      } finally {
        setBusy(false)
      }
    },
    [loggedIn, restoreLocally],
  )

  const handleRestoreSelected = useCallback(async () => {
    const targets = selectedRows.filter((r) => !r.siteGone)
    if (targets.length === 0) return
    setBusy(true)
    try {
      if (loggedIn) {
        const batch = await restoreFavoriteTrashBatch(targets.map((r) => r.siteId))
        if (!batch) {
          setNotice('恢复失败：云端暂不可用，稍后再试')
          return
        }
        const restoredRows = targets.filter((r) => batch.restored.includes(r.siteId))
        restoreLocally(restoredRows)
        const failedNote =
          batch.failed.length > 0
            ? `；${batch.failed.length} 条没能恢复：${batch.failed.map((f) => f.error).slice(0, 2).join('、')}`
            : ''
        setNotice(`已恢复 ${batch.restored.length} 条${failedNote}`)
      } else {
        const result = restoreLocally(targets)
        setNotice(
          result.restored.length > 0
            ? `已恢复 ${result.restored.length} 条`
            : '恢复失败：本机存储写不进去',
        )
      }
      setSelected(new Set())
      await refreshCloud()
    } finally {
      setBusy(false)
    }
  }, [loggedIn, restoreLocally, selectedRows, refreshCloud])

  const handleRestoreAll = useCallback(async () => {
    const targets = rows.filter((r) => !r.siteGone)
    if (targets.length === 0) return
    setBusy(true)
    try {
      if (loggedIn) {
        const batch = await restoreFavoriteTrashBatch(targets.map((r) => r.siteId))
        if (!batch) {
          setNotice('恢复失败：云端暂不可用，稍后再试')
          return
        }
        const restoredRows = targets.filter((r) => batch.restored.includes(r.siteId))
        restoreLocally(restoredRows)
        const failedNote =
          batch.failed.length > 0 ? `；${batch.failed.length} 条没能恢复（原站点已不存在等）` : ''
        setNotice(`已恢复 ${batch.restored.length} 条${failedNote}`)
      } else {
        const result = restoreLocally(targets)
        setNotice(
          result.restored.length > 0
            ? `已恢复 ${result.restored.length} 条`
            : '恢复失败：本机存储写不进去',
        )
      }
      setSelected(new Set())
      await refreshCloud()
    } finally {
      setBusy(false)
    }
  }, [loggedIn, restoreLocally, rows, refreshCloud])

  const handlePurge = useCallback(
    async (row: TrashRow) => {
      if (!window.confirm(`确定要彻底删除「${row.title}」吗？彻底删除后无法恢复。`)) return
      setBusy(true)
      try {
        if (loggedIn) {
          const ok = await purgeFavoriteTrash(row.siteId)
          if (!ok) {
            setNotice('彻底删除失败：云端暂不可用，稍后再试')
            return
          }
        }
        const state = readTrash()
        const remaining = state.items.filter((i) => i.siteId !== row.siteId)
        writeTrash({ items: remaining, folders: state.folders })
        setLocalState({ items: remaining, folders: state.folders })
        setCloudItems((prev) => (prev ? prev.filter((i) => i.siteId !== row.siteId) : prev))
        setNotice(`已彻底删除「${row.title}」`)
      } finally {
        setBusy(false)
      }
    },
    [loggedIn],
  )

  const handleClearTrash = useCallback(async () => {
    if (rows.length === 0) return
    if (
      !window.confirm(
        `确定要清空回收站吗？回收站里的 ${rows.length} 条收藏将被彻底删除，无法恢复。`,
      )
    )
      return
    setBusy(true)
    try {
      if (loggedIn) {
        const result = await clearFavoriteTrash()
        if (!result) {
          setNotice('清空回收站失败：云端暂不可用，稍后再试')
          return
        }
      }
      writeTrash({ items: [], folders: [] })
      setLocalState({ items: [], folders: [] })
      setCloudItems([])
      setSelected(new Set())
      setNotice('回收站已清空')
    } finally {
      setBusy(false)
    }
  }, [loggedIn, rows.length])

  const loaded = favorites.ready && identityReady.ready

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <UserCenterNav />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Trash2 className="h-6 w-6 text-muted-foreground" aria-hidden />
            回收站
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            删除的收藏会在这里保留 30 天，期间随时可以恢复。8
            秒撤销条消失后，这里是唯一的后悔药。
          </p>
        </div>

        {notice ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{notice}</p>
        ) : null}
        {cloudError ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            云端回收站拉取失败，当前只显示本机回收站：{cloudError}
          </p>
        ) : null}

        {!loaded ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border bg-card/50" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Trash2}
            iconTone="muted"
            title="回收站是空的"
            description="删除的收藏会在这里保留 30 天，期间随时可以恢复。"
            action={
              <Button asChild size="sm" variant="outline" className="text-xs">
                <Link href="/favorites">回我的收藏</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="按标题 / 备注搜索回收站"
                  aria-label="搜索回收站"
                  className="pl-8"
                />
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  aria-label="全选"
                />
                全选
              </label>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={busy || selectedRows.length === 0}
                onClick={() => void handleRestoreSelected()}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                恢复选中 ({selectedRows.length})
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={busy || rows.length === 0}
                onClick={() => void handleRestoreAll()}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                恢复全部
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 text-xs"
                disabled={busy || rows.length === 0}
                onClick={() => void handleClearTrash()}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                清空回收站
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              共 {rows.length} 条{query.trim() ? `，筛选出 ${filtered.length} 条` : ''}
              {loggedIn ? '' : '（仅本机：登录后以云端回收站为准）'}
            </p>

            <ul className="space-y-2">
              {filtered.map((row) => (
                <li
                  key={row.siteId}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(row.siteId)}
                    onChange={() => toggleSelect(row.siteId)}
                    aria-label={`选中「${row.title}」`}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.folderName ? `原分类：${row.folderName}` : '未分组'}
                      {' · '}
                      删除于 {new Date(row.deletedAt).toLocaleDateString('zh-CN')}
                      {' · '}
                      {formatTrashRemaining(row.deletedAt)}
                      {row.source === 'local' && loggedIn ? ' · 仅本机' : ''}
                      {row.siteGone ? ' · 原站点已不存在，无法恢复' : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs"
                    disabled={busy || row.siteGone}
                    onClick={() => void handleRestore(row)}
                  >
                    <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                    恢复
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 text-xs text-destructive-text hover:text-destructive-text"
                    disabled={busy}
                    onClick={() => void handlePurge(row)}
                  >
                    彻底删除
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}
