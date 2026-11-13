'use client'

/**
 * 智能整理面板（P1 #6）：按意思建议分组，用户确认后才建夹、才移动。
 *
 * 交互铁律：建议 → 用户确认 → 应用，绝不自动应用。
 *  - 面板平时只露一个入口（标题 + 说明 +「开始智能整理」按钮），
 *    不在收藏页打开时就自动发探测请求——每个候选要发一次语义请求，
 *    自动跑等于用户一打开收藏页就刷几十个请求；
 *  - 每组建议各有「采用此分组」与「忽略」：采用才调 onCreateFolder 建夹、
 *    再逐条调 onMoveToFolder 移动成员；忽略后把建议 id 写进 localStorage，
 *    同一批成员不再重复出现；
 *  - 语义通道不可用时不给建议、不编分组，只说"暂不可用"并给重试。
 *
 * 探测做法（见 lib/smart-collections 的注释）：取最近最多 30 个未分组
 * 收藏，以各自标题向中枢发 mode=semantic 探测（不传身份——这只是本地
 * 收藏的整理，不该把查询写进服务端搜索历史），命中里的其它未分组收藏
 * 就是语义近邻。4 路并发、进行中显示进度、可取消（卸载时 abort）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Check, X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { searchSites } from '@/lib/navhub-api'
import {
  MEANING_SEARCH_POOL_LIMIT,
  semanticSiteScores,
} from '@/lib/favorites-semantic-search'
import {
  SMART_COLLECTIONS_DISMISSED_KEY,
  SMART_COLLECTIONS_MIN_CANDIDATES,
  SMART_COLLECTIONS_PROBE_LIMIT,
  addDismissedId,
  describeNoSmartCollections,
  describeSmartCollectionsUnavailable,
  describeTooFewForSmartCollections,
  filterDismissedSuggestions,
  parseDismissedIds,
  serializeDismissedIds,
  suggestSmartCollections,
  type SuggestedCollection,
} from '@/lib/smart-collections'
import type { LocalFavorite } from '@/hooks/useFavorites'

/** 探测并发数：语义请求是轻量 GET，4 路并行够快又不至于刷爆中枢 */
const PROBE_BATCH_SIZE = 4

type PanelPhase = 'idle' | 'analyzing' | 'done' | 'unavailable'

export interface SmartCollectionsPanelProps {
  /** 全部收藏（面板自己挑未分组的候选） */
  items: readonly LocalFavorite[]
  /** 建夹（已有同名夹时返回既有夹 id——成员直接并入，不另建重名夹） */
  onCreateFolder: (name: string) => Promise<string | null>
  /** 移动一条收藏到夹（本机 + 云端 best-effort，复用收藏页的 assignFolder） */
  onMoveToFolder: (siteId: string, folderId: string | null) => Promise<void>
}

function readDismissedIds(): string[] {
  try {
    return parseDismissedIds(window.localStorage.getItem(SMART_COLLECTIONS_DISMISSED_KEY))
  } catch {
    return []
  }
}

function writeDismissedIds(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(SMART_COLLECTIONS_DISMISSED_KEY, serializeDismissedIds(ids))
  } catch {
    // 写不进去只丢"不再提示"，不影响收藏本身
  }
}

export function SmartCollectionsPanel({ items, onCreateFolder, onMoveToFolder }: SmartCollectionsPanelProps) {
  const [phase, setPhase] = useState<PanelPhase>('idle')
  const [groups, setGroups] = useState<SuggestedCollection[]>([])
  const [dismissedIds, setDismissedIds] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readDismissedIds(),
  )
  const [progress, setProgress] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 卸载时取消进行中的探测：过期响应不写回已卸载的面板
  useEffect(() => () => abortRef.current?.abort(), [])

  /** 未分组的候选：按收藏时间倒序取最近 30 个（探测请求数封顶） */
  const candidates = useMemo(
    () =>
      items
        .filter((item) => !item.folderId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, SMART_COLLECTIONS_PROBE_LIMIT),
    [items],
  )
  const capped = items.filter((item) => !item.folderId).length > SMART_COLLECTIONS_PROBE_LIMIT
  const visibleGroups = useMemo(
    () => filterDismissedSuggestions(groups, dismissedIds),
    [groups, dismissedIds],
  )
  const bySiteId = useMemo(() => new Map(items.map((item) => [item.siteId, item])), [items])

  async function runAnalysis(): Promise<void> {
    if (phase === 'analyzing') return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('analyzing')
    setNote(null)
    setGroups([])
    setProgress(0)

    const candidateIds = new Set(candidates.map((item) => item.siteId))
    const neighbors = new Map<string, Set<string>>()
    let sawSemanticAvailable = false
    for (let i = 0; i < candidates.length; i += PROBE_BATCH_SIZE) {
      if (controller.signal.aborted) return
      const batch = candidates.slice(i, i + PROBE_BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (item) => {
          // 空标题发出去也没有意义：它不参与语义近邻，只留给标签边
          if (!item.title.trim()) return { item, res: null }
          try {
            const res = await searchSites(
              { q: item.title, mode: 'semantic', limit: MEANING_SEARCH_POOL_LIMIT },
              controller.signal,
            )
            return { item, res }
          } catch {
            return { item, res: null }
          }
        }),
      )
      for (const { item, res } of results) {
        if (!res) continue
        if (res.semanticAvailable === true) sawSemanticAvailable = true
        const scores = semanticSiteScores(res.hits)
        const near = new Set<string>()
        for (const id of scores.keys()) {
          if (id !== item.siteId && candidateIds.has(id)) near.add(id)
        }
        neighbors.set(item.siteId, near)
      }
      setProgress(Math.min(i + PROBE_BATCH_SIZE, candidates.length))
      if (controller.signal.aborted) return
    }
    if (controller.signal.aborted) return
    // 语义通道全程不可用（模型未就绪 / 未配置 / 中枢不可达）：不给建议，
    // 如实报"暂不可用"——标签边再真也不能替语义背书"按意思分组"。
    if (!sawSemanticAvailable) {
      setPhase('unavailable')
      return
    }
    setGroups(suggestSmartCollections(candidates, neighbors))
    setPhase('done')
  }

  async function applyGroup(group: SuggestedCollection): Promise<void> {
    if (applyingId) return
    setApplyingId(group.id)
    setNote(null)
    const folderId = await onCreateFolder(group.name)
    if (!folderId) {
      setNote(`创建「${group.name}」失败，收藏没有移动，稍后再试。`)
      setApplyingId(null)
      return
    }
    for (const siteId of group.memberIds) {
      await onMoveToFolder(siteId, folderId)
    }
    setApplyingId(null)
    // 成员已有 folderId：下次分析自动排除；本次直接从列表里拿掉
    setGroups((prev) => prev.filter((g) => g.id !== group.id))
    setNote(`已将 ${group.memberIds.length} 项移入「${group.name}」。`)
  }

  function dismissGroup(group: SuggestedCollection): void {
    // 只记 id、不从 groups 里删：渲染时 filterDismissedSuggestions 负责隐藏；
    // "重新查看已忽略的建议"要能把同一批建议拿回来，删了 state 就拿不回来了
    const next = addDismissedId(dismissedIds, group.id)
    setDismissedIds(next)
    writeDismissedIds(next)
  }

  function showDismissedAgain(): void {
    setDismissedIds([])
    writeDismissedIds([])
    setNote('已恢复之前忽略的建议。')
  }

  if (items.length === 0) return null

  return (
    <section
      aria-label="智能整理"
      className="mb-4 rounded-xl border border-border/70 bg-card/50 p-3 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          智能整理
        </span>
        <span className="text-[11px] text-muted-foreground">
          按内容意思把未分组的收藏自动归组——只给建议，你确认后才建文件夹、才移动收藏。
        </span>
        <span className="ml-auto" />
        {phase !== 'analyzing' && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={candidates.length === 0}
            onClick={() => void runAnalysis()}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {phase === 'idle' ? '开始智能整理' : '重新分析'}
          </Button>
        )}
      </div>

      {phase === 'idle' && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground">全部收藏都已有分组，暂时没有可整理的内容。</p>
      )}
      {phase === 'idle' && candidates.length > 0 && candidates.length < SMART_COLLECTIONS_MIN_CANDIDATES && (
        <p className="text-xs text-muted-foreground">{describeTooFewForSmartCollections(candidates.length)}</p>
      )}

      {phase === 'analyzing' && (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          正在按意思分析收藏 {progress} / {candidates.length}…
        </p>
      )}

      {phase === 'unavailable' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{describeSmartCollectionsUnavailable()}</p>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void runAnalysis()}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      )}

      {phase === 'done' && visibleGroups.length === 0 && groups.length === 0 && (
        <p className="text-xs text-muted-foreground">{describeNoSmartCollections()}</p>
      )}
      {phase === 'done' && visibleGroups.length === 0 && groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">已忽略全部建议。</p>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={showDismissedAgain}>
            重新查看已忽略的建议
          </Button>
        </div>
      )}

      {phase === 'done' && visibleGroups.length > 0 && (
        <ul className="space-y-2">
          {visibleGroups.map((group) => (
            <li
              key={group.id}
              className="rounded-lg border border-border/60 bg-background/60 p-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{group.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {group.memberIds.length} 个收藏 · {group.reason}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    disabled={applyingId !== null}
                    onClick={() => void applyGroup(group)}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {applyingId === group.id ? '正在移动…' : '采用此分组'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    disabled={applyingId !== null}
                    onClick={() => dismissGroup(group)}
                    aria-label={`忽略分组 ${group.name}`}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    忽略
                  </Button>
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {group.memberIds
                  .map((id) => bySiteId.get(id)?.title || id)
                  .filter(Boolean)
                  .join('、')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {capped && phase !== 'idle' && (
        <p className="text-[11px] text-muted-foreground">
          仅分析最近 {SMART_COLLECTIONS_PROBE_LIMIT} 个未分组收藏；先把这些整理好，再分析其余的。
        </p>
      )}
      {note && (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {note}
        </p>
      )}
    </section>
  )
}
