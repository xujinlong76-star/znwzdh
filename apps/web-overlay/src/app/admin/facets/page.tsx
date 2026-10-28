'use client'

/**
 * 管理端：多维分面治理 (Faceted Taxonomy Governance - Phase 2)
 *
 * 对应中枢端点：
 *   - GET  /api/facets              分面体系定义及各候选值热度分布
 *   - GET  /api/sites?facets=...   分面组合筛选站点
 *   - PUT  /api/sites/:id/facets   单站点分面更新
 *
 * 治理闭环：以前这一页只能看。发现某个站点标错了分面，管理员需要离开本页去
 * 站点编辑页重做标注，而这里连保存入口都没有（`hubSend` 引入了却从未调用）。
 * 现在命中站点卡片上可以直接修订标注：整份维度一起编辑（中枢按整份重写，
 * 少提交一个维度等于静默抹掉它），保存走 PUT，失败回滚并展示字段级原因。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { newRequestGate, settleLatest, type RequestGate } from '@/lib/latest-request'
import { describeDegrade } from '@/lib/degrade'
import {
  canonicalFacets,
  facetLabel,
  facetOptionLabel,
  fieldIssuesOf,
  removeFacetValue,
  sameFacets,
  toggleFacetValue,
  uncontrolledValues,
  type FacetDraft,
  type FacetVocabulary,
  type FieldIssue,
} from '@/lib/facet-editing'
import Link from 'next/link'

interface FacetOptionCount {
  value: string
  label: string
  labelEn?: string
  count: number
}

interface FacetGroupSummary {
  key: string
  label: string
  labelEn?: string
  description?: string
  options: FacetOptionCount[]
}

interface FacetsResponse {
  ok: boolean
  definitions: FacetVocabulary[]
  facets: FacetGroupSummary[]
}

interface SiteSample {
  id: string
  title: string
  url: string
  facets?: Record<string, string[]>
}

interface SaveError {
  siteId: string
  message: string
  issues: FieldIssue[]
}

/** 站点卡片上的标注摘要：空维度不画（画一个空分组只会让人以为「加载失败」） */
function facetEntries(facets: Record<string, string[]> | undefined): Array<{ key: string; values: string[] }> {
  return Object.entries(facets ?? {})
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([key, values]) => ({ key, values }))
}

export default function AdminFacetsPage() {
  const [data, setData] = useState<FacetsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // 拉取失败必须能持续显示：失败时页面本来会只剩一个「什么都不画」的空网格
  const [loadError, setLoadError] = useState<unknown>(null)
  // 样例站点是第二个请求：它失败时不能把「没查到」说成「这些分面没有站点」
  const [samplesError, setSamplesError] = useState<unknown>(null)
  const [activeTab, setActiveTab] = useState<string>('pricing')
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [siteSamples, setSiteSamples] = useState<SiteSample[]>([])
  const [loadingSites, setLoadingSites] = useState(false)

  // 编辑弹窗：editing 保留打开时的快照（标题、原始标注）；draft 才是可变的草稿
  const [editing, setEditing] = useState<SiteSample | null>(null)
  const [draft, setDraft] = useState<FacetDraft>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<SaveError | null>(null)
  // 保存成功后的去向说明（站点可能已移出当前筛选，列表里找不到它了）
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  // 样例站点请求的闸门：连点不同分面项时，先发那次的后到不许覆盖后发那次
  const samplesGateRef = useRef<RequestGate | null>(null)
  if (samplesGateRef.current === null) samplesGateRef.current = newRequestGate()
  const samplesGate = samplesGateRef.current
  const [searchTerm, setSearchTerm] = useState('')

  const loadFacets = useCallback(() => {
    setLoading(true)
    // GET /api/facets 带 60s 浏览器缓存：保存标注后刷新分布会拿回旧计数。
    // 加一次性参数绕过 HTTP 缓存，服务端忽略它。
    void hubGet<FacetsResponse>('/api/facets?ts=' + Date.now())
      .then((res) => {
        setData(res)
        setLoadError(null)
        if (res.facets.length > 0 && !res.facets.some((f) => f.key === activeTab)) {
          setActiveTab(res.facets[0].key)
        }
      })
      .catch((err) => {
        // 原来只 setData(null)：失败后分面 Tabs 与选项矩阵都是空的，
        // 页面看上去只是「这里本来就没有分面」，连一句解释都没有。
        console.error('[facets] 加载分面失败:', err)
        setData(null)
        setLoadError(err)
      })
      .finally(() => setLoading(false))
  }, [activeTab])

  useEffect(() => {
    loadFacets()
  }, [loadFacets])

  // 抓取某个分面项的样例站点（抽成 useCallback：失败时可以原地重试）
  const loadSamples = useCallback((facetKey: string, option: string) => {
    setLoadingSites(true)
    const facetParam = encodeURIComponent(JSON.stringify({ [facetKey]: [option] }))
    void (async () => {
      // 同样绕过 60s HTTP 缓存：保存标注后要看到「这个站点是否还在当前筛选里」
      const out = await settleLatest(samplesGate, () =>
        hubGet<SiteSample[]>(`/api/sites?facets=${facetParam}&limit=12&ts=${Date.now()}`),
      )
      // 过期（用户已经点了别的分面项）：一个字都不要写
      if (out.status === 'stale') return
      if (out.status === 'value') {
        setSiteSamples(Array.isArray(out.value) ? out.value : [])
        setSamplesError(null)
      } else {
        // 原来只 setSiteSamples([])：请求失败会渲染成
        // 「暂无匹配站点（可使用 AI 富化或在站点编辑页手动标注）」——
        // 拿一次失败去建议管理员重做分类。
        console.error('[facets] 加载样例站点失败:', out.error)
        setSiteSamples([])
        setSamplesError(out.error)
      }
      setLoadingSites(false)
    })()
  }, [samplesGate])

  // 当选中某个分面项时，抓取样例站点；切换筛选时关闭编辑弹窗，避免拿旧选项的站点评判新列表
  useEffect(() => {
    if (!selectedOption) {
      setSiteSamples([])
      return
    }
    setEditing(null)
    setDraft({})
    setSaveError(null)
    setSaveNotice(null)
    loadSamples(activeTab, selectedOption)
  }, [activeTab, selectedOption, loadSamples])

  const currentFacet = data?.facets.find((f) => f.key === activeTab)

  // 只保留真正带候选值的维度：老中枢缺 options 时编辑器必须禁用而不是画空词表
  const definitions = (data?.definitions ?? []).filter(
    (definition) => Array.isArray(definition.options) && definition.options.length > 0,
  )

  const filteredOptions = currentFacet?.options.filter((opt) => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return true
    return (
      opt.label.toLowerCase().includes(q) ||
      (opt.labelEn && opt.labelEn.toLowerCase().includes(q)) ||
      opt.value.toLowerCase().includes(q)
    )
  }) ?? []

  // 计算全站分面覆盖度指标
  const totalTaggedCount = currentFacet?.options.reduce((sum, o) => sum + o.count, 0) ?? 0

  const degradeNotice = loadError ? describeDegrade(loadError) : null
  const samplesNotice = samplesError ? describeDegrade(samplesError) : null

  const openEditor = (site: SiteSample) => {
    setEditing(site)
    setDraft(canonicalFacets(site.facets))
    setSaveError(null)
    setSaveNotice(null)
  }

  const closeEditor = () => {
    setEditing(null)
    setDraft({})
    setSaveError(null)
  }

  const saveFacets = async (site: SiteSample) => {
    if (savingId) return
    const payload = canonicalFacets(draft)
    const before = siteSamples
    setSavingId(site.id)
    setSaveError(null)
    setSaveNotice(null)
    // 乐观更新：卡片立即显示新标注；失败时整体回滚到 before
    setSiteSamples((prev) =>
      prev.map((item) => (item.id === site.id ? { ...item, facets: payload } : item)),
    )
    try {
      await hubSend(`/api/sites/${encodeURIComponent(site.id)}/facets`, 'PUT', { facets: payload })
      setEditing(null)
      setDraft({})
      setSaveNotice(
        `已保存「${site.title}」的分面标注；分布计数与样例列表正在按新值刷新。` +
          '如果新标注不再命中当前筛选，该站点会从样例中移出。',
      )
      loadFacets()
      if (selectedOption) loadSamples(activeTab, selectedOption)
    } catch (err) {
      // 回滚：乐观更新写进列表的是「以为成功」的值，不能让它在失败后留在界面上
      setSiteSamples(before)
      const issues = fieldIssuesOf(err)
      setSaveError({
        siteId: site.id,
        message:
          issues.length > 0
            ? '中枢拒绝了本次标注（参数无效），已恢复原值。字段级原因：'
            : `保存失败，已恢复原值。${describeDegrade(err).message}`,
        issues,
      })
    } finally {
      setSavingId(null)
    }
  }

  const editingDirty = editing ? !sameFacets(draft, editing.facets) : false

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      {/* 头部标题与操作 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">多维分面体系治理</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              Phase 2 Faceted Taxonomy
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            正交分面维度（付费模式、平台、形态、语言、场景）受控词表治理与全站标注分布监测。
            发现标注错误时，选中分面项后可直接在站点卡片上修订。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="text-xs">
            <Link href="/admin/tags">
              ← 标签与概念别名
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={loadFacets} disabled={loading}>
            {loading ? '刷新中…' : '刷新分布'}
          </Button>
        </div>
      </div>

      {/* 拉取失败必须说出来：以前失败只剩一个什么也不画的空网格 */}
      {degradeNotice && (
        <div
          role="status"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <span>
            {data
              ? `本次刷新失败，下面是上一次成功获取的分面数据。${degradeNotice.message}`
              : `分面数据没能加载出来。${degradeNotice.message}`}
          </span>
          {degradeNotice.retryable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={loadFacets}
              disabled={loading}
            >
              重试
            </Button>
          )}
        </div>
      )}

      {/* 分面维度 Tabs */}
      <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto no-scrollbar touch-pan-x flex-nowrap shrink-0">
        {data?.facets.map((f) => {
          const sum = f.options.reduce((acc, o) => acc + o.count, 0)
          const isActive = activeTab === f.key
          return (
            <button
              key={f.key}
              onClick={() => {
                setActiveTab(f.key)
                setSelectedOption(null)
              }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-background text-muted-foreground'
                }`}
              >
                {sum}
              </span>
            </button>
          )
        })}
      </div>

      {/* 当前分面说明与快捷搜索 */}
      {currentFacet && (
        <div className="bg-card border rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground">{currentFacet.label}</span>
              {currentFacet.labelEn && (
                <span className="text-xs text-muted-foreground font-mono">({currentFacet.labelEn})</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {currentFacet.description || '支持与主分类及话题标签任意组合正交筛选'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input aria-label="过滤当前分面选项"
              placeholder="过滤当前分面选项…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-xs h-8 w-full md:w-48"
            />
          </div>
        </div>
      )}

      {/* 分面选项卡片矩阵 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredOptions.map((opt) => {
          const isSelected = selectedOption === opt.value
          // 原来是 <div onClick>：键盘用户既无法聚焦，也读不到「已选中」
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedOption(isSelected ? null : opt.value)}
              className={`w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isSelected
                  ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-sm'
                  : 'border-border/60 hover:border-primary/50 bg-card hover:shadow-sm'
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="block">
                  <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                  <span className="block text-[11px] text-muted-foreground font-mono">{opt.value}</span>
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    opt.count > 0
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {opt.count}
                </span>
              </span>
              {opt.labelEn && (
                <span className="block text-[11px] text-muted-foreground/80 mt-2 truncate">
                  {opt.labelEn}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 选中选项后：站点预览列表 */}
      {selectedOption && (
        <div className="mt-8 border rounded-xl p-5 bg-card/60 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">命中站点样例</span>
              <span className="text-xs text-muted-foreground">
                (当前分面: {currentFacet?.label} = {selectedOption})
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedOption(null)} className="text-xs h-7">
              关闭抽屉
            </Button>
          </div>

          {/* 保存成功后的去向说明：标注改动可能让站点离开当前筛选 */}
          {saveNotice && (
            <div
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
            >
              {saveNotice}
            </div>
          )}

          {loadingSites ? (
            <div className="text-xs text-muted-foreground py-8 text-center">正在加载归属站点…</div>
          ) : samplesNotice ? (
            <div role="status" className="text-xs text-destructive py-8 text-center">
              样例站点没能加载出来。{samplesNotice.message}
              <button
                type="button"
                className="ml-2 underline underline-offset-2"
                onClick={() => loadSamples(activeTab, selectedOption)}
              >
                重试
              </button>
            </div>
          ) : siteSamples.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">
              暂无匹配站点（可使用 AI 富化或在站点编辑页手动标注该分面）
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {siteSamples.map((site) => (
                <div
                  key={site.id}
                  className="p-3 rounded-lg border bg-background/80 hover:bg-background transition-colors flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{site.title}</div>
                      <div className="text-[11px] text-muted-foreground truncate font-mono mt-0.5">
                        {site.url}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      aria-expanded={editing?.id === site.id}
                      onClick={() => openEditor(site)}
                      disabled={definitions.length === 0 || savingId !== null}
                      title={
                        definitions.length === 0
                          ? '分面定义未加载，暂不能编辑标注'
                          : '修订该站点的分面标注'
                      }
                    >
                      编辑分面
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2.5">
                    {facetEntries(site.facets).length === 0 ? (
                      <span className="text-[10px] text-muted-foreground">尚未标注分面</span>
                    ) : (
                      facetEntries(site.facets).map(({ key, values }) => (
                        <span
                          key={key}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground"
                        >
                          {facetLabel(definitions, key)}:{values.map((value) => facetOptionLabel(definitions, key, value)).join(' / ')}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {definitions.length === 0 && data && (
        <p className="text-[11px] text-muted-foreground">
          中枢返回的分面定义里没有候选值，标注编辑已禁用；请先「刷新分布」或检查中枢版本。
        </p>
      )}

      {/* 标注编辑弹窗：中枢按整份重写，所以这里一次编辑全部维度 */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && savingId === null) closeEditor()
        }}
      >
        <DialogContent className="max-w-2xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">编辑分面标注</DialogTitle>
                <DialogDescription className="text-xs leading-relaxed">
                  {editing.title} · {editing.url}
                  <br />
                  中枢按整份重写：保存会覆盖该站点的全部维度标注。历史值（不在受控词表里的值）会保留，
                  除非在这里手动移除。
                </DialogDescription>
              </DialogHeader>

              {saveError && saveError.siteId === editing.id && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-1"
                >
                  <p>{saveError.message}</p>
                  {saveError.issues.length > 0 && (
                    <ul className="list-disc pl-4 space-y-0.5">
                      {saveError.issues.map((issue, index) => (
                        <li key={`${issue.path}-${index}`}>
                          {issue.path && <span className="font-mono">{issue.path}</span>}
                          {issue.path ? '：' : ''}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="space-y-4 max-h-[52vh] overflow-y-auto pr-1">
                {definitions.map((definition) => {
                  const selected = draft[definition.key] ?? []
                  const known = new Set(definition.options.map((option) => option.value))
                  const legacy = selected.filter((value) => !known.has(value))
                  return (
                    <section key={definition.key} aria-label={definition.label}>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-xs font-semibold text-foreground">
                          {definition.label}
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            {definition.multiselect === false ? '单选' : '可多选'}
                          </span>
                        </h3>
                        <span className="text-[11px] text-muted-foreground">
                          {selected.length > 0 ? `已选 ${selected.length}` : '未标注'}
                        </span>
                      </div>
                      <div
                        className="flex flex-wrap gap-1.5 mt-1.5"
                        role="group"
                        aria-label={`${definition.label}候选值`}
                      >
                        {definition.options.map((option) => {
                          const isOn = selected.includes(option.value)
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={isOn}
                              title={option.description}
                              onClick={() =>
                                setDraft((prev) => toggleFacetValue(prev, definition, option.value))
                              }
                              className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                isOn
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border/70 bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                              }`}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                      {legacy.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            历史值（不在受控词表，点击移除）：
                          </span>
                          {legacy.map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setDraft((prev) => removeFacetValue(prev, definition.key, value))}
                              className="px-2 py-0.5 rounded-full border border-dashed border-amber-300 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-400"
                              title="此值不在受控词表中；保留会继续参与筛选"
                            >
                              {value} ×
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}

                {/* 词表里没有的维度：同样必须可见可删，否则保存会静默抹掉 */}
                {uncontrolledValues(draft, definitions)
                  .filter(({ key }) => !definitions.some((definition) => definition.key === key))
                  .map(({ key, values }) => (
                    <section key={key} aria-label={`未登记维度 ${key}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-xs font-semibold text-foreground">
                          {key}
                          <span className="ml-1.5 font-normal text-amber-700 dark:text-amber-400">
                            未登记维度（不在当前词表中）
                          </span>
                        </h3>
                        <span className="text-[11px] text-muted-foreground">已选 {values.length}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {values.map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDraft((prev) => removeFacetValue(prev, key, value))}
                            className="px-2 py-0.5 rounded-full border border-dashed border-amber-300 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-400"
                            title="点击移除该值"
                          >
                            {value} ×
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
              </div>

              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={closeEditor} disabled={savingId !== null}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveFacets(editing)}
                  disabled={savingId !== null || !editingDirty}
                >
                  {savingId === editing.id ? '保存中…' : editingDirty ? '保存分面' : '没有改动'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
