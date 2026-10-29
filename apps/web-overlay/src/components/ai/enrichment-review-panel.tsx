'use client'

/**
 * 富化结果字段级审核（AI-4c）。
 *
 * 旧流程是「点一下自动获取 → 整包回填表单」：模型给的标题、页面抓的描述、
 * 规则猜的标签一起写进草稿，运营要么全收、要么逐项手改；页面没有 description
 * 时还会拿空占位覆盖已经写好的文案。这个面板把富化结果拆到字段级：
 * 每项显示来源（模型归纳 / 页面抓取 / 规则推测 / 未获取）与不可用原因，
 * 逐项勾选后**直接按审核结果建站**（走普通 POST /api/sites，不再二次富化）。
 *
 * 为什么不在建站时带 enrichFields 让中枢再富化一次：模型输出不是确定性的，
 * 二次富化的值可能和审核时看到的不一样——审核就失去意义。这里宁可多一次
 * 人工确认，也不做「审 A 写 B」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  FileSearch,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import {
  createSiteFromReview,
  enrichSitePreview,
  fetchCategories,
  type HubCategoryLite,
  type HubEnrichPreview,
} from '@/lib/navhub-api'
import {
  ENRICH_REVIEW_FIELDS,
  SOURCE_BADGE,
  buildEnrichReviewRows,
  buildReviewedSiteDraft,
  defaultEnrichSelection,
  leafCategories,
  matchSuggestedCategory,
  type EnrichReviewRow,
  type EnrichSelection,
} from '@/lib/enrich-review'

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function FieldValue({ row }: { row: EnrichReviewRow }) {
  if (!row.available) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  if (Array.isArray(row.value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {row.value.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-[11px] font-normal">
            {tag}
          </Badge>
        ))}
      </div>
    )
  }
  if (row.key === 'icon' && typeof row.value === 'string') {
    return (
      <div className="flex items-center gap-2">
        {/* 图标预览走普通 img：后台只允许管理员访问，不用 next/image 的远程域名白名单 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={row.value}
          alt="富化图标预览"
          className="h-6 w-6 rounded border object-contain"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.visibility = 'hidden'
          }}
        />
        <code className="break-all text-[11px] text-muted-foreground">{row.value}</code>
      </div>
    )
  }
  return <span className="break-words text-sm">{row.value ?? '—'}</span>
}

export function EnrichmentReviewPanel() {
  const { toast } = useToast()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<HubEnrichPreview | null>(null)
  const [rows, setRows] = useState<EnrichReviewRow[]>([])
  const [selected, setSelected] = useState<EnrichSelection>({})
  const [titleOverride, setTitleOverride] = useState('')
  const [categories, setCategories] = useState<HubCategoryLite[] | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ id: string; title: string; url: string } | null>(null)

  useEffect(() => {
    let alive = true
    void fetchCategories().then((list) => {
      if (alive) setCategories(list)
    })
    return () => {
      alive = false
    }
  }, [])

  const leaves = useMemo(() => (categories ? leafCategories(categories) : []), [categories])

  const reset = useCallback(() => {
    setPreview(null)
    setRows([])
    setSelected({})
    setTitleOverride('')
    setCategoryId('')
    setError(null)
    setCreated(null)
  }, [])

  async function handlePreview() {
    const target = url.trim()
    if (!isHttpUrl(target)) {
      setError('请输入完整的 http(s) 地址')
      return
    }
    reset()
    setLoading(true)
    try {
      const result = await enrichSitePreview(target)
      const nextRows = buildEnrichReviewRows(result.fields)
      setPreview(result)
      setRows(nextRows)
      setSelected(defaultEnrichSelection(nextRows))
      const match = matchSuggestedCategory(result.suggestedCategory ?? '', categories ?? [])
      if (match.kind === 'unique') setCategoryId(match.id)
      if (match.kind === 'ambiguous') {
        toast({
          title: '类目建议有歧义',
          description: `「${result.suggestedCategory}」在站内对应多个类目，请手动选择。`,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!preview) return
    const built = buildReviewedSiteDraft({
      url: preview.url,
      fields: preview.fields,
      selected,
      categoryId,
      titleOverride,
    })
    if (!built.ok) {
      setError(built.error)
      return
    }
    setError(null)
    setCreating(true)
    try {
      const site = await createSiteFromReview(built.draft)
      setCreated({ id: site.id, title: site.title, url: site.url })
      if (built.notes.length > 0) {
        toast({ title: '站点已创建（部分字段未采用）', description: built.notes.join('；') })
      } else {
        toast({ title: '站点已创建', description: site.title })
      }
      setPreview(null)
      setRows([])
      setSelected({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const toggle = (key: EnrichReviewRow['key']) => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const suggestion = preview?.suggestedCategory?.trim() ?? ''
  const suggestedMatched = preview ? matchSuggestedCategory(suggestion, categories ?? []) : { kind: 'none' as const }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            富化结果字段级审核
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            解析一个网址，逐项核对标题、描述、标签、类目与图标的来源，只采用你确认的字段。
            建站按审核结果直接写入，不会再次调用模型。
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="富化审核网址"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={loading || creating}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) void handlePreview()
            }}
          />
          <Button onClick={() => void handlePreview()} disabled={loading || creating || !url.trim()} className="sm:w-auto">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSearch className="mr-2 h-4 w-4" />}
            {loading ? '解析中…' : '解析并审核'}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {created && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              已创建：<strong>{created.title}</strong>（{created.id}）· {created.url}
            </span>
          </div>
        )}
      </div>

      {preview && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">
              结果来源：{preview.provenance === 'llm' ? '模型归纳' : '启发式规则'}
            </Badge>
            {preview.aiSkipped === 'quota' && (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                额度已用完：本次只有抓取结果
              </Badge>
            )}
            {preview.httpStatus !== null && <Badge variant="outline">HTTP {preview.httpStatus}</Badge>}
            <span className="text-muted-foreground">
              最终地址：<code className="break-all">{preview.url}</code>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={reset}
              disabled={creating}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              放弃本次审核
            </Button>
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-amber-700 dark:text-amber-400">
              {preview.warnings.map((w) => (
                <div key={w}>· {w}</div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {rows.map((row) => {
              const badge = SOURCE_BADGE[row.source]
              const meta = ENRICH_REVIEW_FIELDS.find((m) => m.key === row.key)!
              const checked = Boolean(selected[row.key])
              return (
                <div
                  key={row.key}
                  className={`grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_7rem_1fr] ${
                    row.available ? '' : 'bg-muted/30'
                  }`}
                >
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`采用${row.label}`}
                      className="h-4 w-4"
                      checked={checked}
                      disabled={!row.available || creating}
                      onChange={() => toggle(row.key)}
                    />
                    <span className="font-medium">{row.label}</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
                      {badge.label}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {row.key === 'title' && (
                      <Input
                        aria-label="标题（可改写）"
                        value={titleOverride}
                        placeholder={String(row.value ?? '富化没有拿到标题，请手动填写')}
                        onChange={(e) => setTitleOverride(e.target.value)}
                        disabled={creating}
                        className="h-8"
                      />
                    )}
                    <FieldValue row={row} />
                    {row.note && (
                      <div className="text-[11px] text-amber-600 dark:text-amber-400">{row.note}</div>
                    )}
                    {row.key !== 'title' && <div className="text-[11px] text-muted-foreground">{meta.hint}</div>}
                    {row.key === 'title' && titleOverride.trim() && (
                      <div className="text-[11px] text-muted-foreground">将采用你改写的标题</div>
                    )}
                    {!row.available && row.reason && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CircleSlash className="h-3 w-3" />
                        {row.reason}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:items-center">
            <label htmlFor="enrich-review-category" className="text-sm font-medium">
              挂载类目 *
            </label>
            <div className="space-y-1">
              <select
                id="enrich-review-category"
                aria-label="挂载类目"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={creating || categories === null}
              >
                <option value="">{categories === null ? '类目加载失败或不可用' : '请选择叶子类目'}</option>
                {leaves.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              {suggestion && (
                <p className="text-[11px] text-muted-foreground">
                  富化建议：{suggestion}
                  {suggestedMatched.kind === 'unique'
                    ? '（已匹配并预选同名叶子类目）'
                    : suggestedMatched.kind === 'ambiguous'
                      ? '（站内存在多个同名类目，请手动选择）'
                      : '（站内没有同名叶子类目，请手动选择）'}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleCreate()} disabled={creating || !preview}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {creating ? '创建中…' : '按所选字段建站'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              只会写入勾选的字段；未勾选的字段保持为空，不做二次富化。
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
