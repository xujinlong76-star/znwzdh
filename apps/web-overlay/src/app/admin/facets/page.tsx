'use client'

/**
 * 管理端：多维分面治理 (Faceted Taxonomy Governance - Phase 2)
 *
 * 对应中枢端点：
 *   - GET  /api/facets              分面体系定义及各候选值热度分布
 *   - GET  /api/sites?facets=...   分面组合筛选站点
 *   - PUT  /api/sites/:id/facets   单站点分面更新
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { newRequestGate, settleLatest, type RequestGate } from '@/lib/latest-request'
import { describeDegrade } from '@/lib/degrade'
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
  definitions: Array<{
    key: string
    label: string
    labelEn?: string
    description?: string
    multiselect?: boolean
  }>
  facets: FacetGroupSummary[]
}

interface SiteSample {
  id: string
  title: string
  url: string
  facets?: Record<string, string[]>
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

  // 样例站点请求的闸门：连点不同分面项时，先发那次的后到不许覆盖后发那次
  const samplesGateRef = useRef<RequestGate | null>(null)
  if (samplesGateRef.current === null) samplesGateRef.current = newRequestGate()
  const samplesGate = samplesGateRef.current
  const [searchTerm, setSearchTerm] = useState('')

  const loadFacets = useCallback(() => {
    setLoading(true)
    void hubGet<FacetsResponse>('/api/facets')
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
      const out = await settleLatest(samplesGate, () =>
        hubGet<SiteSample[]>(`/api/sites?facets=${facetParam}&limit=12`),
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

  // 当选中某个分面项时，抓取样例站点
  useEffect(() => {
    if (!selectedOption) {
      setSiteSamples([])
      return
    }
    loadSamples(activeTab, selectedOption)
  }, [activeTab, selectedOption, loadSamples])

  const currentFacet = data?.facets.find((f) => f.key === activeTab)

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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
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
      <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto">
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
              className="text-xs h-8 w-48"
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
                  <div>
                    <div className="text-xs font-medium text-foreground truncate">{site.title}</div>
                    <div className="text-[11px] text-muted-foreground truncate font-mono mt-0.5">
                      {site.url}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2.5">
                    {Object.entries(site.facets ?? {}).map(([fk, fvs]) => (
                      <span
                        key={fk}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground"
                      >
                        {fk}:{Array.isArray(fvs) ? fvs.join(',') : String(fvs)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
