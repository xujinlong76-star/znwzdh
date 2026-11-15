/**
 * 对照表分享的浏览器侧取数（Batch 4 Phase 2 P2-4）。
 *
 * 只做分享的四件事，全部走服务端分享接口：
 *   - 发布：POST /api/compare/snapshots/:id/publish { fields }；
 *   - 下线/重新发布：PATCH /api/compare/shares/:slug { status }；
 *   - 删除分享：DELETE /api/compare/shares/:slug（slug 永不复用）。
 * 公开读（GET /api/compare/shares/:slug）是免登的服务端直读，走
 * app/pub/compare/[slug]/page.tsx，不在这里。
 *
 * 可公开字段（与服务端 SHAREABLE_COMPARE_FIELDS 同源，默认全不选）：
 * pricing / price / platform / form / maintenance。
 * note / migration 永不可公开：本文件不提供这两个键，服务端请求里
 * 出现即 400。
 */

import { getApiToken, hubUrl } from '@/lib/navhub-api'
import { COMPARE_DIMENSION_LABELS } from '@/lib/compare'

/** 可公开的对照字段（服务端白名单的浏览器侧镜像，默认全不选）。 */
export const SHAREABLE_COMPARE_FIELDS = ['pricing', 'price', 'platform', 'form', 'maintenance'] as const

export type ShareableCompareField = (typeof SHAREABLE_COMPARE_FIELDS)[number]

export const SHAREABLE_COMPARE_FIELD_LABELS: Record<ShareableCompareField, string> = Object.fromEntries(
  SHAREABLE_COMPARE_FIELDS.map((key) => [key, COMPARE_DIMENSION_LABELS[key]]),
) as Record<ShareableCompareField, string>

export function isShareableCompareField(key: string): key is ShareableCompareField {
  return (SHAREABLE_COMPARE_FIELDS as readonly string[]).includes(key)
}

/** 分享的公开链接（与服务端 publish 响应里的 url 同形）。 */
export function compareShareUrl(slug: string): string {
  return `/pub/compare/${slug}`
}

export interface CompareShareSummary {
  slug: string
  url: string
  fields: string[]
  status: string
  createdAt: number
}

export class CompareShareFetchError extends Error {
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

function toShareSummary(raw: unknown): CompareShareSummary {
  const record = raw as Record<string, unknown>
  const slug = typeof record.slug === 'string' ? record.slug : ''
  return {
    slug,
    url: typeof record.url === 'string' ? record.url : compareShareUrl(slug),
    fields: Array.isArray(record.fields) ? (record.fields as unknown[]).map((f) => String(f)) : [],
    status: typeof record.status === 'string' ? record.status : 'published',
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
  }
}

export async function publishCompareShare(
  snapshotId: string,
  fields: readonly string[],
): Promise<CompareShareSummary> {
  const res = await fetch(hubUrl(`/api/compare/snapshots/${encodeURIComponent(snapshotId)}/publish`), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: [...fields] }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new CompareShareFetchError(401, await readErrorMessage(res, '对照分享只对登录用户开放，请先登录后再发布。'))
    }
    if (res.status === 404) {
      throw new CompareShareFetchError(404, await readErrorMessage(res, '快照不存在或不属于你。'))
    }
    if (res.status === 400) {
      throw new CompareShareFetchError(400, await readErrorMessage(res, '请选择至少 1 个可公开的对照字段。'))
    }
    if (res.status === 409) {
      throw new CompareShareFetchError(409, await readErrorMessage(res, '这张快照已经发布过了，先下线或删除现有分享再重新发布。'))
    }
    throw new CompareShareFetchError(res.status, await readErrorMessage(res, `发布分享返回 HTTP ${res.status}，请稍后重试。`))
  }
  const data: unknown = await res.json()
  const share = (data as Record<string, unknown>)?.share as Record<string, unknown> | undefined
  if (!share || typeof share.slug !== 'string') {
    throw new CompareShareFetchError(200, '服务端没有返回可用的分享链接，请稍后重试。')
  }
  return toShareSummary(share)
}

export async function setCompareShareStatus(
  slug: string,
  status: 'published' | 'unpublished',
): Promise<CompareShareSummary> {
  const res = await fetch(hubUrl(`/api/compare/shares/${encodeURIComponent(slug)}`), {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new CompareShareFetchError(401, await readErrorMessage(res, '对照分享只对登录用户开放，请先登录后再操作。'))
    }
    if (res.status === 404) {
      throw new CompareShareFetchError(404, await readErrorMessage(res, '分享不存在。'))
    }
    throw new CompareShareFetchError(res.status, await readErrorMessage(res, `更新分享状态返回 HTTP ${res.status}，请稍后重试。`))
  }
  const data: unknown = await res.json()
  const share = (data as Record<string, unknown>)?.share as Record<string, unknown> | undefined
  if (!share || typeof share.slug !== 'string') {
    throw new CompareShareFetchError(200, '服务端没有返回可用的分享状态，请稍后重试。')
  }
  return toShareSummary(share)
}

export async function deleteCompareShare(slug: string): Promise<void> {
  const res = await fetch(hubUrl(`/api/compare/shares/${encodeURIComponent(slug)}`), {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new CompareShareFetchError(401, await readErrorMessage(res, '对照分享只对登录用户开放，请先登录后再操作。'))
    }
    if (res.status === 404) {
      throw new CompareShareFetchError(404, await readErrorMessage(res, '分享不存在。'))
    }
    throw new CompareShareFetchError(res.status, await readErrorMessage(res, `删除分享返回 HTTP ${res.status}，请稍后重试。`))
  }
}
