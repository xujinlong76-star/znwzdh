/**
 * 站点纠错上报 · 共享客户端 helper（升级第 10 条，接口预留见附录 B）。
 *
 * 详情页是首个调用方；搜索 P0-4 落地时，它的纠错弹窗调同一个
 * `reportSiteIssue`（`source: 'search'`），不建第二端点、不建第二张表。
 *
 * 走同源 `/api/hub/*` 代理到中枢（与 navhub-api.ts 的 fetchSite 同路，
 * 不走裸 /api——Next 应用里没有对应的直连路由）。
 */

export const SITE_REPORT_KINDS = [
  'wrong-description',
  'dead-link',
  'wrong-category',
  'wrong-pricing',
  'other',
] as const

export type SiteReportKind = (typeof SITE_REPORT_KINDS)[number]

export const SITE_REPORT_KIND_LABELS: Record<SiteReportKind, string> = {
  'wrong-description': '描述写错',
  'dead-link': '链接打不开',
  'wrong-category': '分类不对',
  'wrong-pricing': '定价不对',
  other: '其它',
}

export type SiteReportSource = 'site-detail' | 'search'

export interface SiteReportInput {
  siteId: string
  kinds: SiteReportKind[]
  detail: string
  contact?: string
  source: SiteReportSource
}

export interface SiteReportResult {
  ok: boolean
  id?: string
}

export const SITE_REPORT_DETAIL_MIN = 5
export const SITE_REPORT_DETAIL_MAX = 2000

/** 本地先验：不满足直接抛错，绝不发请求（弹窗据此在原地给提示）。 */
export function validateSiteReportInput(input: SiteReportInput): string | null {
  if (!input.siteId || input.siteId.trim().length === 0) return '站点不存在，无法上报'
  if (!Array.isArray(input.kinds) || input.kinds.length === 0) return '请至少选择一种问题类型'
  const detail = input.detail.trim()
  if (detail.length < SITE_REPORT_DETAIL_MIN || detail.length > SITE_REPORT_DETAIL_MAX) {
    return `请填写 ${SITE_REPORT_DETAIL_MIN}–${SITE_REPORT_DETAIL_MAX} 字的具体情况`
  }
  if (input.contact && input.contact.trim().length > 200) return '联系方式请控制在 200 字以内'
  return null
}

export async function reportSiteIssue(input: SiteReportInput): Promise<SiteReportResult> {
  const invalid = validateSiteReportInput(input)
  if (invalid) throw new Error(invalid)
  const res = await fetch(`/api/hub/sites/${encodeURIComponent(input.siteId)}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kinds: input.kinds,
      detail: input.detail.trim(),
      contact: input.contact?.trim() ? input.contact.trim() : undefined,
      source: input.source,
    }),
  })
  let data: { ok?: boolean; id?: string; success?: boolean; message?: string } | null = null
  try {
    data = (await res.json()) as typeof data
  } catch {
    data = null
  }
  if (res.status === 429) {
    throw new Error('提交太频繁，请稍后再试')
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.message || '提交失败，请稍后再试')
  }
  return { ok: true, id: data.id }
}
