'use client'

/**
 * 对照快照面板（Batch 4 Phase 2 P2-3）。
 *
 * 只做三件事，全部走服务端快照接口（写操作只发 siteIds，格子由服务端
 * 现算后冻结，调用方编不出假格子）：
 *   - “保存快照”：POST /api/compare/snapshots，把当前对照表冻结存下；
 *   - “历史快照”：GET /api/compare/snapshots，列出本人的快照（最新在前）；
 *   - “变化对比”：任选两张快照，GET /api/compare/snapshots/:id/diff?against=，
 *     只高亮变了的行（值变了 / 新增了验证 / 从未验证变成已验证），不标谁赢、
 *     不打分、不排名、不生成结论句。
 *
 * 快照是冻结的事实记录：面板里没有任何改写快照的入口（无 PUT/PATCH/DELETE），
 * 变化只通过“新快照 vs 旧快照”的逐格 diff 呈现。
 *
 * 本组件由 app/compare/page.tsx 经 next/dynamic + { ssr: false } 懒加载，
 * 不进 /compare 首屏 chunk（照抄 CompareView 的范式）。
 */

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { getApiToken, hubUrl } from '@/lib/navhub-api'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SHAREABLE_COMPARE_FIELDS,
  SHAREABLE_COMPARE_FIELD_LABELS,
  compareShareUrl,
  publishCompareShare,
  setCompareShareStatus,
  type CompareShareSummary,
  type ShareableCompareField,
} from '@/lib/compare-share'
import {
  COMPARE_DIMENSIONS,
  normalizeComparisonItem,
  type CompareDimensionKey,
  type ComparisonItem,
} from '@/lib/compare'

/** 快照对外形态（与服务端 snapshotView 同形；不含 owner 身份）。 */
export interface ComparisonSnapshotSummary {
  id: string
  siteIds: string[]
  items: ComparisonItem[]
  createdAt: number
}

/** diff 只标的三种事实变化（与服务端 SnapshotDiffKind 同源）。 */
export type SnapshotDiffKind = 'value_changed' | 'became_verified' | 'verification_added'

export interface SnapshotDiffChange {
  siteId: string
  title: string
  dimension: CompareDimensionKey
  kind: SnapshotDiffKind
  oldValue: string | null
  newValue: string | null
  oldVerified: boolean
  newVerified: boolean
}

/** 三种变化的人话标签：只陈述事实，不作评价。 */
export const SNAPSHOT_DIFF_KIND_LABELS: Record<SnapshotDiffKind, string> = {
  value_changed: '值变了',
  became_verified: '从未验证变成已验证',
  verification_added: '新增了验证',
}

const DIMENSION_LABELS: Record<CompareDimensionKey, string> = Object.fromEntries(
  COMPARE_DIMENSIONS.map((d) => [d.key, d.label]),
) as Record<CompareDimensionKey, string>

class SnapshotFetchError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  const token = getApiToken()
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).message === 'string') {
      return (body as Record<string, unknown>).message as string
    }
  } catch {
    // 非 JSON 错误体：用兜底文案
  }
  return fallback
}

async function fetchSnapshots(): Promise<ComparisonSnapshotSummary[]> {
  const res = await fetch(hubUrl('/api/compare/snapshots'), { headers: authHeaders() })
  if (!res.ok) {
    if (res.status === 401) {
      throw new SnapshotFetchError(401, await readErrorMessage(res, '对照快照只对登录用户开放，请先登录后再查看。'))
    }
    throw new SnapshotFetchError(res.status, await readErrorMessage(res, `快照列表返回 HTTP ${res.status}，请稍后重试。`))
  }
  const data: unknown = await res.json()
  if (!data || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>).snapshots)) return []
  const out: ComparisonSnapshotSummary[] = []
  for (const raw of (data as Record<string, unknown>).snapshots as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    if (typeof record.id !== 'string' || !Array.isArray(record.siteIds) || !Array.isArray(record.items)) continue
    const items = (record.items as unknown[])
      .map((item) => normalizeComparisonItem(item))
      .filter((item): item is ComparisonItem => item !== null)
    out.push({
      id: record.id,
      siteIds: (record.siteIds as unknown[]).map((s) => String(s)),
      items,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    })
  }
  return out
}

async function saveSnapshot(siteIds: string[]): Promise<ComparisonSnapshotSummary> {
  const res = await fetch(hubUrl('/api/compare/snapshots'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteIds }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new SnapshotFetchError(401, await readErrorMessage(res, '对照快照只对登录用户开放，请先登录后再保存。'))
    }
    if (res.status === 404) {
      throw new SnapshotFetchError(404, await readErrorMessage(res, '其中有站点不在你的收藏里，或已不在可对比状态。'))
    }
    if (res.status === 400) {
      throw new SnapshotFetchError(400, await readErrorMessage(res, '请勾选 2–4 个已收藏站点进行保存。'))
    }
    throw new SnapshotFetchError(res.status, await readErrorMessage(res, `保存快照返回 HTTP ${res.status}，请稍后重试。`))
  }
  const data: unknown = await res.json()
  const snapshot = (data as Record<string, unknown>)?.snapshot as Record<string, unknown> | undefined
  if (!snapshot || typeof snapshot.id !== 'string' || !Array.isArray(snapshot.items)) {
    throw new SnapshotFetchError(200, '服务端没有返回可用的快照，请稍后重试。')
  }
  return {
    id: snapshot.id,
    siteIds: Array.isArray(snapshot.siteIds) ? (snapshot.siteIds as unknown[]).map((s) => String(s)) : [...siteIds],
    items: (snapshot.items as unknown[])
      .map((item) => normalizeComparisonItem(item))
      .filter((item): item is ComparisonItem => item !== null),
    createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : Date.now(),
  }
}

async function fetchDiff(baseId: string, againstId: string): Promise<SnapshotDiffChange[]> {
  const res = await fetch(
    hubUrl(`/api/compare/snapshots/${encodeURIComponent(baseId)}/diff?against=${encodeURIComponent(againstId)}`),
    { headers: authHeaders() },
  )
  if (!res.ok) {
    if (res.status === 401) {
      throw new SnapshotFetchError(401, await readErrorMessage(res, '对照快照只对登录用户开放，请先登录后再查看。'))
    }
    if (res.status === 404) {
      throw new SnapshotFetchError(404, await readErrorMessage(res, '快照不存在或不属于你。'))
    }
    throw new SnapshotFetchError(res.status, await readErrorMessage(res, `变化对比返回 HTTP ${res.status}，请稍后重试。`))
  }
  const data: unknown = await res.json()
  const changes = (data as Record<string, unknown>)?.diff as Record<string, unknown> | undefined
  if (!changes || !Array.isArray(changes.changes)) return []
  return (changes.changes as unknown[]).filter((c): c is SnapshotDiffChange => {
    if (!c || typeof c !== 'object') return false
    const change = c as Record<string, unknown>
    return (
      typeof change.siteId === 'string' &&
      typeof change.dimension === 'string' &&
      (change.kind === 'value_changed' || change.kind === 'became_verified' || change.kind === 'verification_added')
    )
  })
}

function formatSnapshotDate(createdAt: number): string {
  if (!createdAt || !Number.isFinite(createdAt)) return '时间未知'
  return new Date(createdAt).toLocaleString('zh-CN')
}

function formatDiffValue(value: string | null): string {
  return value == null || value === '' ? '未验证' : value
}

export function SnapshotPanel({ siteIds }: { siteIds: string[] }) {
  const [snapshots, setSnapshots] = useState<ComparisonSnapshotSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [baseId, setBaseId] = useState('')
  const [againstId, setAgainstId] = useState('')
  const [changes, setChanges] = useState<SnapshotDiffChange[] | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  // 对照表分享（Batch 4 Phase 2 P2-4）：每张快照行挂“分享”按钮 → 弹窗勾选
  // 白名单字段（默认全不选）→ 发布成功显示 /pub/compare/<slug> 链接 +
  // 复制按钮 + “下线”按钮。分享的是冻结副本，不是活数据；备注与迁移
  // 成本永不公开，服务端白名单外请求即 400。
  const [sharingId, setSharingId] = useState('')
  const [selectedFields, setSelectedFields] = useState<ShareableCompareField[]>([])
  const [publishing, setPublishing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareBySnapshot, setShareBySnapshot] = useState<Record<string, CompareShareSummary>>({})
  const [unpublishing, setUnpublishing] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchSnapshots()
      .then((list) => {
        if (!cancelled) setSnapshots(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSnapshots([])
          setListError(err instanceof SnapshotFetchError ? err.message : '网络出了问题，请检查连接后重试。')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 两张都选好且不同 → 取 diff；只取一次，选票变了才重取。
  useEffect(() => {
    if (!baseId || !againstId || baseId === againstId) {
      setChanges(null)
      setDiffError(null)
      return
    }
    let cancelled = false
    setDiffLoading(true)
    setDiffError(null)
    fetchDiff(baseId, againstId)
      .then((list) => {
        if (!cancelled) setChanges(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setChanges(null)
          setDiffError(err instanceof SnapshotFetchError ? err.message : '网络出了问题，请检查连接后重试。')
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [baseId, againstId])

  async function handleSave() {
    setSaving(true)
    setSaveMessage(null)
    try {
      const snapshot = await saveSnapshot(siteIds)
      setSnapshots((prev) => [snapshot, ...(prev ?? [])])
      setSaveMessage(`已保存快照（${formatSnapshotDate(snapshot.createdAt)}，${snapshot.siteIds.length} 个站点）。`)
    } catch (err: unknown) {
      setSaveMessage(err instanceof SnapshotFetchError ? err.message : '网络出了问题，请检查连接后重试。')
    } finally {
      setSaving(false)
    }
  }

  function handleShareOpen(snapshotId: string) {
    // 打开哪张快照的分享弹窗，勾选就从全不选开始（默认全不选，不勾不公开）。
    setSharingId(snapshotId)
    setSelectedFields([])
    setShareError(null)
    setCopied(false)
  }

  function toggleShareField(field: ShareableCompareField) {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    )
  }

  async function handlePublish(snapshotId: string) {
    if (selectedFields.length === 0 || publishing) return
    setPublishing(true)
    setShareError(null)
    try {
      const share = await publishCompareShare(snapshotId, selectedFields)
      setShareBySnapshot((prev) => ({ ...prev, [snapshotId]: share }))
      setCopied(false)
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : '网络出了问题，请检查连接后重试。')
    } finally {
      setPublishing(false)
    }
  }

  async function handleUnpublish(snapshotId: string) {
    const share = shareBySnapshot[snapshotId]
    if (!share || unpublishing) return
    setUnpublishing(true)
    setShareError(null)
    try {
      await setCompareShareStatus(share.slug, 'unpublished')
      // 下线后链接区消失：源站立即 404，共享缓存最多残留 60 秒，旧 slug 不再可用。
      setShareBySnapshot((prev) => {
        const next = { ...prev }
        delete next[snapshotId]
        return next
      })
      setCopied(false)
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : '网络出了问题，请检查连接后重试。')
    } finally {
      setUnpublishing(false)
    }
  }

  async function handleCopyShareLink(snapshotId: string) {
    const share = shareBySnapshot[snapshotId]
    if (!share) return
    const result = await copyText(compareShareUrl(share.slug))
    setCopied(result.ok)
    if (result.ok) {
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  const baseSnapshot = snapshots?.find((s) => s.id === baseId)
  const againstSnapshot = snapshots?.find((s) => s.id === againstId)

  return (
    <section aria-label="对照快照" className="rounded-xl border border-border/70 bg-card p-5 space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">对照快照</h2>
        <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground">
          快照是保存那一刻的对照表，冻结后不再改动；变化对比只标事实（值变了 / 新增了验证 /
          从未验证变成已验证），不作评价、不排名。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm" className="min-h-11 text-xs">
          {saving ? '正在保存…' : '保存快照'}
        </Button>
        {saveMessage ? <p className="text-xs text-muted-foreground">{saveMessage}</p> : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">历史快照</h3>
        {listError ? <p className="text-sm text-destructive-text">{listError}</p> : null}
        {snapshots === null ? (
          <p className="text-sm text-muted-foreground">正在加载历史快照…</p>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有快照。点“保存快照”，把今天的对照表留下来，下次再比就能看出谁变了。</p>
        ) : (
          <ul className="space-y-2">
            {snapshots.map((snapshot) => {
              const titles = snapshot.items.map((item) => item.title).join('、') || snapshot.siteIds.join('、')
              return (
                <li
                  key={snapshot.id}
                  className={cn(
                    'rounded-lg border border-border/60 p-3 space-y-2',
                    (snapshot.id === baseId || snapshot.id === againstId) && 'border-primary/40 bg-primary/5',
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground break-words">{titles}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatSnapshotDate(snapshot.createdAt)} · {snapshot.siteIds.length} 个站点
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={snapshot.id === baseId ? 'default' : 'outline'}
                      className="h-8 text-xs"
                      onClick={() => setBaseId(snapshot.id)}
                      aria-pressed={snapshot.id === baseId}
                    >
                      {snapshot.id === baseId ? '已选为基准' : '设为基准'}
                    </Button>
                    <Button
                      size="sm"
                      variant={snapshot.id === againstId ? 'default' : 'outline'}
                      className="h-8 text-xs"
                      onClick={() => setAgainstId(snapshot.id)}
                      aria-pressed={snapshot.id === againstId}
                    >
                      {snapshot.id === againstId ? '已选为对照' : '设为对照'}
                    </Button>
                    <Button
                      size="sm"
                      variant={sharingId === snapshot.id ? 'default' : 'outline'}
                      className="h-8 text-xs"
                      onClick={() => handleShareOpen(snapshot.id)}
                      aria-pressed={sharingId === snapshot.id}
                    >
                      分享
                    </Button>
                  </div>
                  {sharingId === snapshot.id ? (
                    <div className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-3">
                      <p className="text-sm font-medium text-foreground">分享这张快照</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        公开后任何人可见，备注与标签永不公开。分享的是这张快照的冻结副本，
                        发布后内容不再更新。
                      </p>
                      <fieldset className="space-y-2">
                        <legend className="text-xs font-medium text-foreground">选择要公开的字段（默认全不选）</legend>
                        {SHAREABLE_COMPARE_FIELDS.map((field) => (
                          <label key={field} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              checked={selectedFields.includes(field)}
                              onChange={() => toggleShareField(field)}
                              className="size-4 accent-primary"
                            />
                            {SHAREABLE_COMPARE_FIELD_LABELS[field]}
                          </label>
                        ))}
                      </fieldset>
                      {shareError ? <p className="text-sm text-destructive-text">{shareError}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => handlePublish(snapshot.id)}
                          disabled={publishing || selectedFields.length === 0}
                        >
                          {publishing ? '正在发布…' : '发布分享'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => setSharingId('')}
                        >
                          取消
                        </Button>
                      </div>
                      {shareBySnapshot[snapshot.id] ? (
                        <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
                          <p className="text-xs text-muted-foreground">已发布，任何人打开下面的链接都能看这张冻结对照表：</p>
                          <p className="text-sm font-medium text-foreground break-all">
                            {compareShareUrl(shareBySnapshot[snapshot.id].slug)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCopyShareLink(snapshot.id)}
                              className="min-h-11"
                            >
                              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                              {copied ? '链接已复制' : '复制链接'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUnpublish(snapshot.id)}
                              disabled={unpublishing}
                              className="min-h-11"
                            >
                              {unpublishing ? '正在下线…' : '下线'}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {baseId && againstId && baseId !== againstId ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">变化对比</h3>
          <p className="text-xs text-muted-foreground">
            基准：{baseSnapshot ? formatSnapshotDate(baseSnapshot.createdAt) : baseId}
            {' → '}对照：{againstSnapshot ? formatSnapshotDate(againstSnapshot.createdAt) : againstId}
          </p>
          {diffLoading ? <p className="text-sm text-muted-foreground">正在对比两张快照…</p> : null}
          {diffError ? <p className="text-sm text-destructive-text">{diffError}</p> : null}
          {!diffLoading && !diffError && changes !== null ? (
            changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">这两张快照逐格一致，没有变化。</p>
            ) : (
              <ul className="space-y-2">
                {changes.map((change, index) => (
                  <li
                    key={`${change.siteId}-${change.dimension}-${index}`}
                    className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-1"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {change.title} · {DIMENSION_LABELS[change.dimension] ?? change.dimension}
                    </p>
                    <p className="text-xs text-muted-foreground">{SNAPSHOT_DIFF_KIND_LABELS[change.kind]}</p>
                    <p className="text-sm text-foreground break-words">
                      {formatDiffValue(change.oldValue)}
                      {' → '}
                      {formatDiffValue(change.newValue)}
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
