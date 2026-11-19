'use client'

/**
 * 对照表视图（Batch 4 Phase 1 第 2 项）。
 *
 * 只比调用者本人的收藏：数据来自 `GET /api/compare?siteIds=`（第 1 项），
 * 匿名调接口会 401/404——这里报诚实错误，不渲染空表。
 *
 * 呈现约定（设计 §3.3 + 评审判定）：
 *   - 并排对照：行 = 7 个维度 + 档案四格（Batch0-02 §8.3：适用 best_for/not_for、
 *     数据 license、替代 alternatives；四格在价格行之后、平台行之前），
 *     列 = 站点（2–4 列）；移动端卡片堆叠
 *     `grid-cols-1 md:grid-cols-2 xl:grid-cols-4`（断点 md 768px / xl 1280px；
 *     4 列只在 xl（1280px+）展开，md/lg 保持 2 列——lg 4 列每卡过挤）；
 *   - 每格 = 值 + 来源 + 日期，缺失显式“未验证”，不填充模板句；
 *     档案四格只有 `verified === true` 才出值（best_for/not_for 原文、license 值、
 *     alternatives 站名列表点进目标站）；`verified === false`（含 draft 行）的格
 *     灰显“未验证”，不编造值；
 *   - 差异高亮只高亮“值不同”的行（复用 `border-primary/40 + bg-primary/5`），
 *     不标谁赢、无 `winner`；
 *   - 分流结论只写按场景分流的一句话，注明依据是哪几个格子；结论只能引用
 *     对照表内的 siteId（客户端白名单校验，见 lib/compare.ts）；
 *   - 结论保存走本机 localStorage（`navhub.compare.notes.v1`），对照页内设
 *     “已保存的对照结论”区（可查看、可删除），保存即真实可见；
 *     禁止把结论塞进某站的 `note`。
 *
 * 本组件由 `app/compare/page.tsx` 经 `next/dynamic` + `{ ssr: false }` 懒加载，
 * 不进 `/compare` 首屏 chunk。
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getApiToken, hubUrl } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  alternativeSiteIds,
  COMPARE_DIMENSIONS,
  COMPARE_SCENARIOS,
  PRICE_CURRENCIES,
  PRICE_PERIODS,
  PROFILE_DIMENSIONS,
  buildCompareConclusion,
  compareRowDiffers,
  deleteCompareNote,
  formatCellValue,
  formatVerifiedDate,
  isRobotsDisallowedSite,
  normalizeComparisonItems,
  priceAmountToMinor,
  priceMinorToAmount,
  readCompareNotes,
  readPriceRobotsDisallowedSiteIds,
  readRobotsDisallowedSiteIds,
  rememberPriceRobotsDisallowedSiteId,
  rememberRobotsDisallowedSiteId,
  saveCompareNote,
  verifyOutcomeMessage,
  type ComparisonCell,
  type ComparisonItem,
  type CompareDimensionKey,
  type CompareScenarioKey,
  type PriceScrapeCandidate,
  type ProfileDimensionKey,
  type SavedCompareNote,
  type VerifyStatusResult,
} from '@/lib/compare'

class CompareFetchError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function fetchCompareItems(siteIds: string[]): Promise<ComparisonItem[]> {
  const token = getApiToken()
  const res = await fetch(
    hubUrl('/api/compare?siteIds=' + siteIds.map(encodeURIComponent).join(',')),
    {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  )
  if (!res.ok) {
    // 诚实错误：透出服务端的人话 message；401/404 不渲染空表。
    let message = ''
    try {
      const body: unknown = await res.json()
      if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).message === 'string') {
        message = (body as Record<string, unknown>).message as string
      }
    } catch {
      // 非 JSON 错误体：用状态码兜底文案
    }
    if (res.status === 401) {
      throw new CompareFetchError(401, message || '横向对比只对登录用户开放，请先登录后再查看。')
    }
    if (res.status === 404) {
      throw new CompareFetchError(404, message || '其中有站点不在你的收藏里，或已不在可对比状态。')
    }
    if (res.status === 400) {
      throw new CompareFetchError(400, message || '请勾选 2–4 个已收藏站点进行对比。')
    }
    throw new CompareFetchError(res.status, message || `对照接口返回 HTTP ${res.status}，请稍后重试。`)
  }
  const data: unknown = await res.json()
  return normalizeComparisonItems(data)
}

async function fetchVerifyStatus(siteId: string): Promise<VerifyStatusResult | null> {
  const token = getApiToken()
  const res = await fetch(hubUrl('/api/sites/' + encodeURIComponent(siteId) + '/verify'), {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) return null
  const data: unknown = await res.json().catch(() => {
    /* 响应体不是合法 JSON（空体/HTML 错误页）：按无验证结果处理，下行判空返回 null */
    return null
  })
  if (!data || typeof data !== 'object') return null
  return data as VerifyStatusResult
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function CellValue({ cell, dimensionKey }: { cell: ComparisonCell; dimensionKey: CompareDimensionKey }) {
  const verified = cell.verified && formatCellValue(cell) !== '未验证'
  const date = formatVerifiedDate(cell.verifiedAt)
  // 副行日期加定语：维护格与价格格的日期是核实时间，其余格的日期是
  // 站点/收藏记录的更新时间（分面/备注格的日期是 updatedAt，不是核实日期）。
  const dateLabel = dimensionKey === 'maintenance' || dimensionKey === 'price' ? '核实于' : '更新于'
  // 价格格：stale（90–180 天）加琥珀色“可能过期”徽标；expired（>180 天，
  // verified 为 false 但有值）整格灰显 + “未验证”；无记录显“未验证”。
  const isPrice = dimensionKey === 'price'
  const hasValue = formatCellValue(cell) !== '未验证'
  const expired = isPrice && !cell.verified && hasValue
  return (
    <div className={cn('min-w-0', expired && 'opacity-60')}>
      <div className="text-sm text-foreground break-words">
        {formatCellValue(cell)}
        {isPrice && cell.stale === true && (
          <span className="ml-1.5 px-1.5 py-px rounded text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
            可能过期
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {cell.source ? `来源：${cell.source}` : '来源未标注'}
        {date ? ` · ${dateLabel} ${date}` : ''}
        {verified ? '' : ' · 未验证'}
      </div>
    </div>
  )
}

/**
 * 档案四格的格子值（Batch0-02 §8.3，F8）。
 * 只有 `verified === true` 且有值才出值：best_for/not_for/license 出原文，
 * alternatives 出站名列表（每站名点进 `/site/<id>` 目标站，标题按 id 懒取，
 * 取不到只显示站内 id，不编造站名）；`verified === false`（缺失 / draft 行）
 * 一律灰显“未验证”，不编造值、不画占位文案。
 */
function ProfileCellValue({
  cell,
  dimensionKey,
  alternativeTitles,
}: {
  cell: ComparisonCell
  dimensionKey: ProfileDimensionKey
  alternativeTitles: Readonly<Record<string, string>>
}) {
  const date = formatVerifiedDate(cell.verifiedAt)
  const altIds = dimensionKey === 'alternatives' ? alternativeSiteIds(cell) : []
  const shown = dimensionKey === 'alternatives' ? altIds.length > 0 : cell.verified === true && formatCellValue(cell) !== '未验证'
  if (!shown) {
    return (
      <div className="min-w-0 opacity-60">
        <div className="text-sm text-foreground break-words">未验证</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {cell.source ? `来源：${cell.source}` : '来源未标注'}
          {date ? ` · 核实于 ${date}` : ''}
          {' · 未验证'}
        </div>
      </div>
    )
  }
  return (
    <div className="min-w-0">
      {dimensionKey === 'alternatives' ? (
        <ul className="space-y-1">
          {altIds.map((id) => (
            <li key={id}>
              <Link
                href={`/site/${encodeURIComponent(id)}`}
                className="text-sm text-primary hover:underline break-words"
              >
                {alternativeTitles[id] ?? id}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-foreground break-words">{formatCellValue(cell)}</div>
      )}
      <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {cell.source ? `来源：${cell.source}` : '来源未标注'}
        {date ? ` · 核实于 ${date}` : ''}
      </div>
    </div>
  )
}

export function CompareView({ siteIds }: { siteIds: string[] }) {
  const [items, setItems] = useState<ComparisonItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // 档案四格（F8）：alternatives 的站内 id → 站名（按 id 懒取，取不到显示 id，不编造站名）
  const [alternativeTitles, setAlternativeTitles] = useState<Record<string, string>>({})

  // 刷新验证（P2-1）：逐站 loading / 结果文案 / robots 禁抓本机记忆
  const [verifyingIds, setVerifyingIds] = useState<Record<string, boolean>>({})
  const [verifyMessages, setVerifyMessages] = useState<Record<string, string>>({})
  const [robotsBlockedIds, setRobotsBlockedIds] = useState<string[]>([])

  // 价格数值（P2-2）：内联编辑表单 + 抓取候选 + robots 禁抓本机记忆
  const [priceRobotsBlockedIds, setPriceRobotsBlockedIds] = useState<string[]>([])
  const [editingPriceSiteId, setEditingPriceSiteId] = useState<string | null>(null)
  const [priceForm, setPriceForm] = useState({
    amount: '',
    currency: 'CNY',
    period: 'month',
    freeTierLimit: '',
    sourceUrl: '',
  })
  // 抓取确认凭证（P2-2 NIT 2）：点选候选时带上的服务端一次性凭证；
  // 写库来源只由它决定——客户端自称的 sourceType 后端一律不认，
  // 无凭证的提交按手工填写写库。凭证单次使用，保存成功后即清空。
  const [priceConfirmToken, setPriceConfirmToken] = useState<string | null>(null)
  const [priceMessages, setPriceMessages] = useState<Record<string, string>>({})
  const [savingPriceIds, setSavingPriceIds] = useState<Record<string, boolean>>({})
  const [scrapingPriceIds, setScrapingPriceIds] = useState<Record<string, boolean>>({})
  const [priceCandidates, setPriceCandidates] = useState<Record<string, PriceScrapeCandidate[]>>({})

  useEffect(() => {
    setRobotsBlockedIds(readRobotsDisallowedSiteIds())
    setPriceRobotsBlockedIds(readPriceRobotsDisallowedSiteIds())
  }, [])

  // 分流结论：场景 + 被选站点 + 依据格子（全部只取对照表内的值）
  const [scenario, setScenario] = useState<CompareScenarioKey>('budget')
  const [chosenSiteId, setChosenSiteId] = useState('')
  const [basisKeys, setBasisKeys] = useState<CompareDimensionKey[]>(['pricing', 'maintenance'])
  const [conclusionError, setConclusionError] = useState<string | null>(null)
  const [savedNotes, setSavedNotes] = useState<SavedCompareNote[]>([])

  useEffect(() => {
    setSavedNotes(readCompareNotes())
  }, [])

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    void fetchCompareItems(siteIds)
      .then((loaded) => {
        if (cancelled) return
        if (loaded.length === 0) {
          setError('对照接口没有返回任何站点，请回到收藏夹重新勾选 2–4 个站点。')
          return
        }
        setItems(loaded)
        setChosenSiteId((prev) => (prev && loaded.some((item) => item.siteId === prev) ? prev : loaded[0]?.siteId ?? ''))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // 只有服务端诚实错误（CompareFetchError）才透出原文；其余一律映射
        // 为中文网络错误，不把 `Failed to fetch` 之类英文贴给用户。
        setError(err instanceof CompareFetchError ? err.message : '网络出了问题，请检查连接后重试。')
      })
    return () => {
      cancelled = true
    }
  }, [siteIds.join(','), reloadToken])

  // 档案四格（F8）：alternatives 只存站内 id，站名按 id 向 GET /api/sites/:id 懒取；
  // 取不到（404/网络失败）不编造站名，渲染时回落显示站内 id。
  useEffect(() => {
    if (!items) return
    const ids = [...new Set(items.flatMap((item) => alternativeSiteIds(item.alternatives)))]
    if (ids.length === 0) return
    let cancelled = false
    const token = getApiToken()
    void Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(hubUrl('/api/sites/' + encodeURIComponent(id)), {
            headers: {
              Accept: 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          })
          if (!res.ok) return null
          const body: unknown = await res.json()
          const title =
            body && typeof body === 'object' && typeof (body as Record<string, unknown>).title === 'string'
              ? ((body as Record<string, unknown>).title as string).trim()
              : ''
          return title ? { id, title } : null
        } catch {
          return null
        }
      }),
    ).then((found) => {
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const entry of found) if (entry) next[entry.id] = entry.title
      if (Object.keys(next).length > 0) setAlternativeTitles((prev) => ({ ...prev, ...next }))
    })
    return () => {
      cancelled = true
    }
  }, [items])

  const siteTitles = useMemo(() => {
    const map: Record<string, string> = {}
    for (const item of items ?? []) map[item.siteId] = item.title
    return map
  }, [items])

  const chosenItem = useMemo(
    () => items?.find((item) => item.siteId === chosenSiteId) ?? null,
    [items, chosenSiteId],
  )

  // 被选站点在依据维度上的格子：预览与保存两条路径共用同一份依据，
  // 未验证的依据格在 buildCompareConclusion 里按严格规则 (a) 拒绝生成。
  const basisCells = useMemo(
    () => basisKeys.map((key) => chosenItem?.[key]),
    [basisKeys, chosenItem],
  )

  const conclusionResult = useMemo(() => {
    if (!items || !chosenSiteId) return null
    return buildCompareConclusion({
      scenario,
      siteId: chosenSiteId,
      basisKeys,
      basisCells,
      siteIds: items.map((item) => item.siteId),
      siteTitles,
    })
  }, [items, scenario, chosenSiteId, basisKeys, basisCells, siteTitles])

  const conclusionPreview = conclusionResult?.ok ? conclusionResult.text : null
  const conclusionPreviewError =
    conclusionResult && !conclusionResult.ok ? conclusionResult.error : null

  const handleSaveConclusion = () => {
    if (!items) return
    const result = saveCompareNote({
      scenario,
      siteId: chosenSiteId,
      basisKeys,
      basisCells,
      siteIds: items.map((item) => item.siteId),
      siteTitles,
    })
    if (!result.ok) {
      setConclusionError(result.error)
      return
    }
    setConclusionError(null)
    setSavedNotes(result.notes)
  }

  const handleDeleteNote = (id: string) => {
    setSavedNotes(deleteCompareNote(id))
  }

  const toggleBasis = (key: CompareDimensionKey) => {
    setBasisKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  /**
   * 刷新验证（P2-1）：POST /api/sites/:id/verify 只触发一次后台探活；
   * 202 后轮询 GET 状态（最多约 10 秒），状态翻成 done/robots_disallowed
   * 后重拉 /api/compare 回填格子（来源与日期同步更新）。
   * 未验证的结论（403/超时/服务端异常）不改健康字段：格子仍显示旧值或
   * “未验证”，文案只说“未能确认可用性”，绝不写“已停更”。
   */
  const handleVerify = async (item: ComparisonItem) => {
    const siteId = item.siteId
    if (verifyingIds[siteId] || isRobotsDisallowedSite(siteId, null) || robotsBlockedIds.includes(siteId)) {
      return
    }
    setVerifyingIds((prev) => ({ ...prev, [siteId]: true }))
    setVerifyMessages((prev) => ({ ...prev, [siteId]: '' }))
    try {
      const token = getApiToken()
      const res = await fetch(hubUrl('/api/sites/' + encodeURIComponent(siteId) + '/verify'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) {
        let message = '验证触发失败，请稍后再试。'
        try {
          const body: unknown = await res.json()
          if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).message === 'string') {
            message = (body as Record<string, unknown>).message as string
          }
        } catch {
          // 非 JSON 错误体：用兜底文案
        }
        setVerifyMessages((prev) => ({ ...prev, [siteId]: res.status === 429 ? '出站验证预算已耗尽，请稍后再试。' : message }))
        return
      }
      const posted: unknown = await res.json().catch(() => {
        /* 响应体不是合法 JSON：按无 robots 标记处理，下行条件为假即走正常流程 */
        return null
      })
      if (posted && typeof posted === 'object' && (posted as Record<string, unknown>).robots_disallowed === true) {
        // robots.txt 明确禁抓：服务端没发站点请求；本机记住，按钮从此置灰。
        setRobotsBlockedIds(rememberRobotsDisallowedSiteId(siteId))
        setVerifyMessages((prev) => ({
          ...prev,
          [siteId]: '该站点的 robots.txt 禁止抓取，刷新验证已置灰。',
        }))
        return
      }
      // 轮询后台任务状态：done 或 robots_disallowed 即停，最多约 10 秒。
      let finalStatus: VerifyStatusResult | null = null
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        await sleep(1000)
        const current = await fetchVerifyStatus(siteId)
        if (current && (current.status === 'done' || current.status === 'robots_disallowed')) {
          finalStatus = current
          break
        }
      }
      if (finalStatus?.status === 'robots_disallowed' || finalStatus?.robots_disallowed) {
        setRobotsBlockedIds(rememberRobotsDisallowedSiteId(siteId))
        setVerifyMessages((prev) => ({
          ...prev,
          [siteId]: '该站点的 robots.txt 禁止抓取，刷新验证已置灰。',
        }))
        return
      }
      // 回填：重拉对照表，maintenance 格的来源与日期随健康字段同步更新。
      const reloaded = await fetchCompareItems(siteIds)
      setItems(reloaded)
      if (!finalStatus) {
        setVerifyMessages((prev) => ({
          ...prev,
          [siteId]: '验证还在后台跑，格子仍显示上次验证时间；稍后刷新页面查看。',
        }))
        return
      }
      const kind = finalStatus.outcome?.kind
      const date = formatVerifiedDate(finalStatus.lastCheckedAt)
      setVerifyMessages((prev) => ({
        ...prev,
        [siteId]: verifyOutcomeMessage(kind) + (date ? `上次验证于 ${date}。` : ''),
      }))
    } catch {
      setVerifyMessages((prev) => ({ ...prev, [siteId]: '网络出了问题，验证没有完成，请稍后再试。' }))
    } finally {
      setVerifyingIds((prev) => ({ ...prev, [siteId]: false }))
    }
  }

  /**
   * 价格数值（P2-2）：内联编辑——未填 → “填写价格”，已填 → “修改 / 删除”；
   * 提交调 POST /api/sites/:id/price，成功后重拉 /api/compare 回填
   * （抄 handleVerify 的回填模式）。保存后核实日期记为此刻；超过 90 天
   * 会标“可能过期”，超过 180 天降级“未验证”并灰显。
   */
  const openPriceForm = (item: ComparisonItem) => {
    const cell = item.price
    setPriceForm({
      amount:
        typeof cell.amountMinor === 'number'
          ? priceMinorToAmount(cell.amountMinor, cell.currency ?? 'CNY')
          : '',
      currency: cell.currency ?? 'CNY',
      period: cell.period ?? 'month',
      freeTierLimit: cell.freeTierLimit ?? '',
      sourceUrl: cell.sourceUrl ?? '',
    })
    setPriceConfirmToken(null)
    setEditingPriceSiteId(item.siteId)
  }

  const handleSavePrice = async (item: ComparisonItem) => {
    const siteId = item.siteId
    if (savingPriceIds[siteId]) return
    // 货币必填（P2-2 NIT 3）：裸 ¥ 候选 currency 为空时表单 currency 留空，
    // 绝不默认回旧值或 CNY；未选货币不许提交——后端 currency 必填，也不猜。
    if (!PRICE_CURRENCIES.some((c) => c.value === priceForm.currency)) {
      setPriceMessages((prev) => ({
        ...prev,
        [siteId]: '请先选择货币：该候选的货币未定（裸 ¥ 既可能是人民币也可能是日元），选定货币后才能保存。',
      }))
      return
    }
    const amountMinor = priceAmountToMinor(priceForm.amount, priceForm.currency)
    if (amountMinor === null) {
      setPriceMessages((prev) => ({ ...prev, [siteId]: '金额须为大于 0 的数字。' }))
      return
    }
    setSavingPriceIds((prev) => ({ ...prev, [siteId]: true }))
    try {
      const token = getApiToken()
      const res = await fetch(hubUrl('/api/sites/' + encodeURIComponent(siteId) + '/price'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amountMinor,
          currency: priceForm.currency,
          period: priceForm.period,
          freeTierLimit: priceForm.freeTierLimit.trim() ? priceForm.freeTierLimit.trim() : null,
          // 来源不由客户端自称：只带服务端签发的确认凭证（有则 official_scrape，
          // 无则 manual）；不发 sourceType，后端收到也会丢弃。
          ...(priceConfirmToken ? { confirmToken: priceConfirmToken } : {}),
          sourceUrl: priceForm.sourceUrl.trim() ? priceForm.sourceUrl.trim() : null,
        }),
      })
      if (!res.ok) {
        let message = '价格保存失败，请稍后再试。'
        try {
          const body: unknown = await res.json()
          if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).message === 'string') {
            message = (body as Record<string, unknown>).message as string
          }
        } catch {
          // 非 JSON 错误体：用兜底文案
        }
        setPriceMessages((prev) => ({ ...prev, [siteId]: message }))
        return
      }
      // 回填：重拉对照表，价格格的值与核实日期同步更新。
      const reloaded = await fetchCompareItems(siteIds)
      setItems(reloaded)
      setEditingPriceSiteId(null)
      // 凭证单次使用：保存成功即已核销，清空防重放。
      setPriceConfirmToken(null)
      setPriceCandidates((prev) => ({ ...prev, [siteId]: [] }))
      setPriceMessages((prev) => ({ ...prev, [siteId]: '价格已保存，核实日期记为此刻。' }))
    } catch {
      setPriceMessages((prev) => ({ ...prev, [siteId]: '网络出了问题，价格没有保存，请稍后再试。' }))
    } finally {
      setSavingPriceIds((prev) => ({ ...prev, [siteId]: false }))
    }
  }

  const handleDeletePrice = async (item: ComparisonItem) => {
    const siteId = item.siteId
    if (savingPriceIds[siteId]) return
    setSavingPriceIds((prev) => ({ ...prev, [siteId]: true }))
    try {
      const token = getApiToken()
      const res = await fetch(hubUrl('/api/sites/' + encodeURIComponent(siteId) + '/price'), {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) {
        setPriceMessages((prev) => ({ ...prev, [siteId]: '价格删除失败，请稍后再试。' }))
        return
      }
      const reloaded = await fetchCompareItems(siteIds)
      setItems(reloaded)
      setEditingPriceSiteId(null)
      setPriceCandidates((prev) => ({ ...prev, [siteId]: [] }))
      setPriceMessages((prev) => ({ ...prev, [siteId]: '已删除该站的价格记录。' }))
    } catch {
      setPriceMessages((prev) => ({ ...prev, [siteId]: '网络出了问题，价格没有删除，请稍后再试。' }))
    } finally {
      setSavingPriceIds((prev) => ({ ...prev, [siteId]: false }))
    }
  }

  /**
   * 从官方定价页抓取（P2-2）：只抓该站已存的 source_url，绝不猜路径；
   * POST /api/sites/:id/price/scrape 只回候选列表，不写库；用户点选一条
   * 候选 → 表单预填 → 再调 POST /api/sites/:id/price 写库，带上该候选的
   * confirmToken（服务端签发的一次性凭证，核对通过才写 official_scrape；
   * 无凭证的提交一律按手工填写，客户端自称来源无效）。
   */
  const handleScrapePrice = async (item: ComparisonItem) => {
    const siteId = item.siteId
    if (scrapingPriceIds[siteId] || !item.price.sourceUrl || priceRobotsBlockedIds.includes(siteId)) {
      return
    }
    setScrapingPriceIds((prev) => ({ ...prev, [siteId]: true }))
    setPriceMessages((prev) => ({ ...prev, [siteId]: '' }))
    try {
      const token = getApiToken()
      const res = await fetch(hubUrl('/api/sites/' + encodeURIComponent(siteId) + '/price/scrape'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) {
        let message = '抓取失败，请稍后再试。'
        try {
          const body: unknown = await res.json()
          if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).message === 'string') {
            message = (body as Record<string, unknown>).message as string
          }
        } catch {
          // 非 JSON 错误体：用兜底文案
        }
        setPriceMessages((prev) => ({ ...prev, [siteId]: res.status === 429 ? '出站抓取预算已耗尽，请稍后再试。' : message }))
        return
      }
      const data: unknown = await res.json().catch(() => {
        /* 响应体不是合法 JSON：按空体处理，下行按缺字段分支走错误文案 */
        return null
      })
      const body = (data ?? {}) as Record<string, unknown>
      if (body.robots_disallowed === true) {
        setPriceRobotsBlockedIds(rememberPriceRobotsDisallowedSiteId(siteId))
        setPriceMessages((prev) => ({
          ...prev,
          [siteId]: '该站点的 robots.txt 禁止抓取，抓取已置灰。',
        }))
        return
      }
      const candidates = Array.isArray(body.candidates) ? (body.candidates as PriceScrapeCandidate[]) : []
      setPriceCandidates((prev) => ({ ...prev, [siteId]: candidates }))
      setPriceMessages((prev) => ({
        ...prev,
        [siteId]:
          typeof body.message === 'string' && body.message
            ? body.message
            : candidates.length === 0
              ? '官方定价页上没有识别出价格候选，未写入任何值。'
              : '请点选一条候选确认后写入，抓取本身不写库。',
      }))
    } catch {
      setPriceMessages((prev) => ({ ...prev, [siteId]: '网络出了问题，抓取没有完成，请稍后再试。' }))
    } finally {
      setScrapingPriceIds((prev) => ({ ...prev, [siteId]: false }))
    }
  }

  /**
   * 点选抓取候选（P2-2 NIT 2/3）：只预填表单，不写库；确认凭证随表单
   * 保存时一起发，服务端核对通过才写 official_scrape。
   *   - amountMinor 为空时（裸 ¥ 候选货币未定，minor 算不出）用原文金额
   *     candidate.amount 预填本位金额，不再沿用表单旧值；选定货币后保存
   *     时再按该货币换算 minor（JPY/KRW 不乘 100）。
   *   - currency 为空时表单货币留空，强制用户选货币——不默认回旧值或 CNY。
   */
  const handlePickPriceCandidate = (item: ComparisonItem, candidate: PriceScrapeCandidate) => {
    const currencyKnown = typeof candidate.currency === 'string' && candidate.currency !== ''
    setPriceForm((prev) => ({
      ...prev,
      amount:
        typeof candidate.amountMinor === 'number' && currencyKnown
          ? priceMinorToAmount(candidate.amountMinor, candidate.currency as string)
          : typeof candidate.amount === 'number'
            ? String(candidate.amount)
            : '',
      currency: candidate.currency ?? '',
      period: candidate.period ?? prev.period,
    }))
    setPriceConfirmToken(candidate.confirmToken ?? null)
    setEditingPriceSiteId(item.siteId)
    setPriceMessages((prev) => ({
      ...prev,
      [item.siteId]: currencyKnown
        ? '已按候选预填表单，确认无误后点“保存价格”写入。'
        : '该候选的货币未定（裸 ¥ 既可能是人民币也可能是日元），请先选择货币再点“保存价格”。',
    }))
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
        <p className="text-sm font-semibold text-foreground">对照加载失败</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="min-h-11 text-xs" onClick={() => setReloadToken((n) => n + 1)}>
            重试
          </Button>
          <Button asChild size="sm" variant="outline" className="min-h-11 text-xs">
            <Link href="/favorites">回到收藏夹重新勾选</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (!items) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-3">
        <span className="sr-only">正在加载对照表…</span>
        <div className="h-6 w-40 rounded bg-muted/60 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[0, 1, 2].map((n) => (
            <div key={n} className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3 animate-pulse">
              <div className="h-5 w-2/3 rounded bg-muted/60" />
              <div className="h-4 w-full rounded bg-muted/60" />
              <div className="h-4 w-5/6 rounded bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 并排对照：每站一张卡；桌面端 2–4 列并排（4 列只在 xl 展开），移动端卡片堆叠 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {items.map((item) => (
          <article
            key={item.siteId}
            aria-label={`「${item.title}」的对照卡片`}
            className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-2xs"
          >
            <header className="min-w-0 border-b border-border/60 pb-2">
              <h2 className="text-sm font-semibold truncate" title={item.title}>
                {item.url ? (
                  <a
                    href={safeHref(item.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-primary hover:underline"
                  >
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </h2>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.url}</p>
            </header>
            <dl className="space-y-2.5">
              {COMPARE_DIMENSIONS.map((dim) => {
                const differs = compareRowDiffers(items, dim.key)
                const cell = item[dim.key]
                return (
                  <Fragment key={dim.key}>
                    <div
                      className={cn(
                        'rounded-lg px-2.5 py-2',
                        differs && 'border border-primary/40 bg-primary/5',
                      )}
                    >
                    <dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      {dim.label}
                      {differs && (
                        <span className="px-1.5 py-px rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/30">
                          差异
                        </span>
                      )}
                    </dt>
                    <dd className="mt-1">
                      <CellValue cell={cell} dimensionKey={dim.key} />
                      {dim.key === 'price' && (
                        <div className="mt-1.5 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {formatCellValue(cell) === '未验证' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-11 px-2 text-xs"
                                onClick={() => openPriceForm(item)}
                                aria-label={`填写「${item.title}」的价格`}
                              >
                                填写价格
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="min-h-11 px-2 text-xs"
                                  onClick={() => openPriceForm(item)}
                                  aria-label={`修改「${item.title}」的价格`}
                                >
                                  修改
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="min-h-11 px-2 text-xs text-muted-foreground"
                                  disabled={Boolean(savingPriceIds[item.siteId])}
                                  onClick={() => void handleDeletePrice(item)}
                                  aria-label={`删除「${item.title}」的价格`}
                                >
                                  删除
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11 px-2 text-xs"
                              disabled={
                                Boolean(scrapingPriceIds[item.siteId]) ||
                                !cell.sourceUrl ||
                                priceRobotsBlockedIds.includes(item.siteId)
                              }
                              onClick={() => void handleScrapePrice(item)}
                              title={
                                priceRobotsBlockedIds.includes(item.siteId)
                                  ? '该站点的 robots.txt 禁止抓取，抓取已置灰'
                                  : !cell.sourceUrl
                                    ? '请先在价格表单里填写官方定价页 URL，再从官方定价页抓取'
                                    : '从已填的官方定价页抓一次价格候选（只列候选，不直接写库）'
                              }
                              aria-label={`从官方定价页抓取「${item.title}」的价格`}
                            >
                              {scrapingPriceIds[item.siteId] ? '抓取中…' : '从官方定价页抓取'}
                            </Button>
                          </div>
                          {priceRobotsBlockedIds.includes(item.siteId) && (
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                              该站点的 robots.txt 禁止抓取，抓取已置灰。
                            </p>
                          )}
                          {priceCandidates[item.siteId] && priceCandidates[item.siteId]!.length > 0 && (
                            <ul className="space-y-1">
                              {priceCandidates[item.siteId]!.map((candidate, index) => (
                                <li key={`${candidate.text}-${index}`}>
                                  <button
                                    type="button"
                                    className="w-full rounded-lg border border-border/70 bg-background px-2 py-1.5 text-left text-xs text-foreground hover:border-primary/40"
                                    onClick={() => handlePickPriceCandidate(item, candidate)}
                                    title="点选这条候选预填表单，确认后点“保存价格”写入"
                                  >
                                    {candidate.text}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {editingPriceSiteId === item.siteId && (
                            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2.5">
                              <div className="flex flex-wrap gap-2">
                                <label className="flex min-w-28 flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
                                  金额
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={priceForm.amount}
                                    onChange={(e) => setPriceForm((prev) => ({ ...prev, amount: e.target.value }))}
                                    placeholder="如 19.9"
                                    className="min-h-11 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
                                  />
                                </label>
                                <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                                  货币
                                  <select
                                    value={priceForm.currency}
                                    onChange={(e) => setPriceForm((prev) => ({ ...prev, currency: e.target.value }))}
                                    className="min-h-11 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
                                  >
                                    <option value="" disabled>
                                      请选择货币
                                    </option>
                                    {PRICE_CURRENCIES.map((c) => (
                                      <option key={c.value} value={c.value}>
                                        {c.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                                  周期
                                  <select
                                    value={priceForm.period}
                                    onChange={(e) => setPriceForm((prev) => ({ ...prev, period: e.target.value }))}
                                    className="min-h-11 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
                                  >
                                    {PRICE_PERIODS.map((p) => (
                                      <option key={p.value} value={p.value}>
                                        {p.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              {!priceForm.currency && (
                                <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                                  该候选的货币未定：裸 ¥ 既可能是人民币也可能是日元，请先在上方选择货币，选定后才能保存。
                                </p>
                              )}
                              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                                免费档上限（可选）
                                <input
                                  type="text"
                                  value={priceForm.freeTierLimit}
                                  onChange={(e) => setPriceForm((prev) => ({ ...prev, freeTierLimit: e.target.value }))}
                                  placeholder="如 100次/月"
                                  maxLength={120}
                                  className="min-h-11 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                                官方定价页 URL（可选，须与该站同源）
                                <input
                                  type="url"
                                  value={priceForm.sourceUrl}
                                  onChange={(e) => setPriceForm((prev) => ({ ...prev, sourceUrl: e.target.value }))}
                                  placeholder="如 https://example.com/pricing"
                                  className="min-h-11 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
                                />
                              </label>
                              <p className="text-[11px] leading-relaxed text-muted-foreground">
                                保存后核实日期记为此刻；超过 90 天会标“可能过期”，超过 180 天降级“未验证”。
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  className="min-h-11 px-2 text-xs"
                                  disabled={Boolean(savingPriceIds[item.siteId]) || !priceForm.currency}
                                  title={!priceForm.currency ? '请先选择货币' : undefined}
                                  onClick={() => void handleSavePrice(item)}
                                >
                                  {savingPriceIds[item.siteId] ? '保存中…' : '保存价格'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="min-h-11 px-2 text-xs text-muted-foreground"
                                  onClick={() => {
                                    setPriceConfirmToken(null)
                                    setEditingPriceSiteId(null)
                                  }}
                                >
                                  取消
                                </Button>
                              </div>
                            </div>
                          )}
                          {priceMessages[item.siteId] && (
                            <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
                              {priceMessages[item.siteId]}
                            </p>
                          )}
                        </div>
                      )}
                      {dim.key === 'maintenance' && (
                        <div className="mt-1.5 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11 px-2 text-xs"
                              disabled={Boolean(verifyingIds[item.siteId]) || robotsBlockedIds.includes(item.siteId)}
                              onClick={() => void handleVerify(item)}
                              title={
                                robotsBlockedIds.includes(item.siteId)
                                  ? '该站点的 robots.txt 禁止抓取，刷新验证已置灰'
                                  : '手动触发一次探活，核实该站现在是否可达'
                              }
                              aria-label={`刷新验证「${item.title}」`}
                            >
                              {verifyingIds[item.siteId] ? '验证中…' : '刷新验证'}
                            </Button>
                            <span className="text-[11px] text-muted-foreground">
                              {cell.lastCheckedAt ?? cell.verifiedAt
                                ? `上次验证于 ${formatVerifiedDate(cell.lastCheckedAt ?? cell.verifiedAt) ?? ''}`
                                : '尚未验证过'}
                            </span>
                          </div>
                          {robotsBlockedIds.includes(item.siteId) && (
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                              该站点的 robots.txt 禁止抓取，刷新验证已置灰。
                            </p>
                          )}
                          {verifyMessages[item.siteId] && (
                            <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
                              {verifyMessages[item.siteId]}
                            </p>
                          )}
                        </div>
                      )}
                    </dd>
                    </div>
                    {/* 档案四格（Batch0-02 §8.3，F8）：在价格行之后、平台行之前，按适用 / 数据 / 替代分组 */}
                    {dim.key === 'price' &&
                      PROFILE_DIMENSIONS.map((pdim) => {
                        const profileDiffers = compareRowDiffers(items, pdim.key)
                        const profileCell = item[pdim.key]
                        const showGroupCaption =
                          pdim.key === 'best_for' || pdim.key === 'license' || pdim.key === 'alternatives'
                        return (
                          <Fragment key={pdim.key}>
                            {showGroupCaption && (
                              <div className="pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                                {pdim.group}
                              </div>
                            )}
                            <div
                              className={cn(
                                'rounded-lg px-2.5 py-2',
                                profileDiffers && 'border border-primary/40 bg-primary/5',
                              )}
                            >
                              <dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                                {pdim.label}
                                {profileDiffers && (
                                  <span className="px-1.5 py-px rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/30">
                                    差异
                                  </span>
                                )}
                              </dt>
                              <dd className="mt-1">
                                <ProfileCellValue
                                  cell={profileCell}
                                  dimensionKey={pdim.key}
                                  alternativeTitles={alternativeTitles}
                                />
                              </dd>
                            </div>
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              })}
            </dl>
          </article>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        差异行只表示各站的值不同，不表示谁更好；“未验证”表示该格没有可验证的来源与日期，不代表站点已停更或不可用。
      </p>

      {/* 分流结论：按场景分流一句话，注明依据是哪几个格子 */}
      <section aria-labelledby="compare-conclusion-heading" className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
        <h2 id="compare-conclusion-heading" className="text-sm font-bold text-foreground">
          分流结论
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="compare-scenario" className="text-xs text-muted-foreground">
            场景
          </label>
          <select
            id="compare-scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as CompareScenarioKey)}
            className="min-h-11 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
          >
            {COMPARE_SCENARIOS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <label htmlFor="compare-site" className="text-xs text-muted-foreground">
            选
          </label>
          <select
            id="compare-site"
            value={chosenSiteId}
            onChange={(e) => setChosenSiteId(e.target.value)}
            title={chosenItem?.title}
            className="min-h-11 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground max-w-55"
          >
            {items.map((item) => (
              <option key={item.siteId} value={item.siteId}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="text-xs text-muted-foreground">分流依据（勾选对照表里的格子）</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {COMPARE_DIMENSIONS.map((dim) => (
              <label
                key={dim.key}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                  basisKeys.includes(dim.key)
                    ? 'border-primary/40 bg-primary/5 text-primary'
                    : 'border-border/70 text-muted-foreground',
                )}
              >
                <input
                  type="checkbox"
                  checked={basisKeys.includes(dim.key)}
                  onChange={() => toggleBasis(dim.key)}
                  className="sr-only"
                />
                {dim.label}
              </label>
            ))}
          </div>
        </fieldset>
        {conclusionPreview ? (
          <p className="text-sm leading-relaxed text-foreground">结论：{conclusionPreview}</p>
        ) : conclusionPreviewError ? (
          <p className="text-sm text-muted-foreground">{conclusionPreviewError}</p>
        ) : (
          <p className="text-sm text-muted-foreground">请先选一个站点并至少勾选一个依据格子。</p>
        )}
        {conclusionError && (
          <p role="alert" className="text-xs text-destructive-text">
            {conclusionError}
          </p>
        )}
        <div>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 text-xs"
            disabled={!conclusionPreview}
            onClick={handleSaveConclusion}
            title="把这条结论保存到本机（只保存在这台设备上，不写进任何站点的备注）"
          >
            保存结论到本机
          </Button>
        </div>
      </section>

      {/* 已保存的对照结论：本机可见，可查看、可删除 */}
      <section aria-labelledby="compare-saved-notes-heading" className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
        <h2 id="compare-saved-notes-heading" className="text-sm font-bold text-foreground">
          已保存的对照结论
        </h2>
        {savedNotes.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            还没有保存的结论。上面生成分流结论后点“保存结论到本机”，会立刻出现在这里；只保存在这台设备上。
          </p>
        ) : (
          <ul className="space-y-2.5">
            {savedNotes.map((note) => (
              <li key={note.id} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm leading-relaxed text-foreground min-w-0">{note.text}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground shrink-0"
                    onClick={() => handleDeleteNote(note.id)}
                    title="删除这条已保存的结论"
                  >
                    删除
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  对照站点：{note.siteIds.map((id) => note.siteTitles[id] ?? id).join('、')}
                  {note.createdAt ? ` · ${formatVerifiedDate(note.createdAt) ?? ''}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
