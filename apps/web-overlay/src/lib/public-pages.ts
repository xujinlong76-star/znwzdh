/**
 * 公开导航页（Batch 3 第 6 项）的 Web 侧共享模块。
 *
 * 与 /pack 的区分：pack 是发一次的快照文件（hash 编码、无服务端、无 SEO、
 * 无下线、20 条/4KB）；公开页是常驻页面——服务端存发布关系、live 引用文件夹、
 * 有独立链接与 SEO、可随时下线。两者各走各的路由与存储，不共用信封。
 *
 * 本模块分两层：
 *   - 纯函数（slug 校验/生成、条目过滤）：无 window/document 依赖，可测；
 *   - 客户端调用（hubGet/hubSend + anonHeaders）：失败不抛错，返回
 *     `{ ok: false, message }`，调用方直接把中枢的人话展示出来。
 */

import { anonHeaders, hubGet, hubSend } from '@/lib/navhub-api'

export const PUBLIC_PAGE_TITLE_MAX = 40
export const PUBLIC_PAGE_DESCRIPTION_MAX = 200
/** 公开页最多条目：与中枢 PUBLIC_PAGE_MAX_ITEMS 同口径（一页展示，不分页）。 */
export const PUBLIC_PAGE_MAX_ITEMS = 100
export const PUBLIC_PAGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/

export type PublicPageStatus = 'published' | 'unpublished'

export interface PublicPageView {
  id: string
  slug: string
  title: string
  description: string | null
  folderId: string | null
  status: PublicPageStatus
  createdAt: number
  updatedAt: number
}

export interface PublicPageItem {
  siteId: string
  title: string
  url: string
  description: string | null
  categoryId: string
}

export interface PublicPageDetail {
  page: PublicPageView
  items: PublicPageItem[]
}

export type PublicPageResult<T> = { ok: true; data: T } | { ok: false; message: string }

/** 自定义 slug 的合法性：与中枢 SLUG_PATTERN 同口径。 */
export function isValidPublicPageSlug(slug: string): boolean {
  return PUBLIC_PAGE_SLUG_PATTERN.test(slug)
}

/** 用户输入的 slug 归一化（去空格、转小写）；非法字符留给校验报错，不静默改写。 */
export function normalizePublicPageSlugInput(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * 标题 slug 化（客户端预览用）：与中枢 slugifyPublicPageTitle 同口径。
 * 中文标题 slug 化后为空是常态，兜底 'nav'；最终 slug 由服务端拼随机后缀、
 * 落库前再查重——客户端只做预览，不承诺可用。
 */
export function slugifyPublicPageTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return base || 'nav'
}

export function publicPageUrl(slug: string, origin?: string): string {
  const base = origin ?? (typeof window === 'undefined' ? '' : window.location.origin)
  return `${base}/pub/${encodeURIComponent(slug)}`
}

/**
 * 公开条目过滤（客户端复核用）：只留仍存在且 active 的站。
 * 中枢读端已做同一过滤；这里是给「发布前预览条数」与测试用的第二道口径，
 * 两处口径必须一致，改一处就要改另一处（见 apps/api/src/routes/public-pages.ts）。
 */
export function filterPublicPageItems<T extends { site: { enabled?: boolean; status?: string } | null }>(
  favorites: T[],
): T[] {
  return favorites.filter((f) => f.site && f.site.enabled !== false && f.site.status === 'active')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '中枢暂时不可用，请稍后再试'
}

export async function listMyPublicPages(identity: string): Promise<PublicPageResult<PublicPageView[]>> {
  try {
    const data = await hubGet<{ pages: PublicPageView[] }>('/api/public-pages', undefined, anonHeaders(identity))
    return { ok: true, data: data.pages ?? [] }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function createPublicPage(
  identity: string,
  input: { title: string; description?: string | null; folderId?: string | null; slug?: string | null },
): Promise<PublicPageResult<{ page: PublicPageView; url: string }>> {
  try {
    const data = await hubSend<{ page: PublicPageView; url: string }>(
      '/api/public-pages',
      'POST',
      input,
      undefined,
      anonHeaders(identity),
    )
    return { ok: true, data }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function setPublicPageStatus(
  identity: string,
  slug: string,
  status: PublicPageStatus,
): Promise<PublicPageResult<PublicPageView>> {
  try {
    const data = await hubSend<{ page: PublicPageView }>(
      '/api/public-pages/' + encodeURIComponent(slug),
      'PATCH',
      { status },
      undefined,
      anonHeaders(identity),
    )
    return { ok: true, data: data.page }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function deletePublicPage(identity: string, slug: string): Promise<PublicPageResult<true>> {
  try {
    await hubSend('/api/public-pages/' + encodeURIComponent(slug), 'DELETE', undefined, undefined, anonHeaders(identity))
    return { ok: true, data: true }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}
