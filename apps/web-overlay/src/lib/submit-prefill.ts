/**
 * 搜索零结果 → 投稿收录的查询词携带（A11）。
 *
 * 三处零结果入口（/search 页、首页搜索面板、⌘K 超级搜索）与 /submit 页共用
 * 这一份判定，避免各写各的、一个入口带过去、另一个入口丢了：
 *
 * - 查询词本身就是网址 / 域名（如 `example.com`、`https://foo.dev/x`）→ 预填
 *   投稿表单的「网址」栏（缺协议时补 `https://`），标题留空让 AI 预填或用户填；
 * - 其他查询词（如 `免费修图`、`做短剧的工具`）→ 预填「网站名称」栏，
 *   网址留空（绝不把一个关键词硬拼成网址去猜）。
 *
 * 纯函数，可单测；不做网络请求、不读任何存储。
 */

export const SUBMIT_PREFILL_TITLE_MAX = 120
export const SUBMIT_PREFILL_URL_MAX = 2048

export interface SubmitPrefill {
  initialTitle?: string
  initialUrl?: string
}

/** 域名形查询词：`example.com`、`sub.foo.dev/path`（不含协议、不含空白） */
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i

function normalizeUrl(raw: string): string | null {
  const value = raw.trim().slice(0, SUBMIT_PREFILL_URL_MAX)
  if (!value || /\s/.test(value)) return null
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
    } catch {
      return null
    }
  }
  if (DOMAIN_LIKE.test(value)) {
    try {
      return new URL(`https://${value}`).href
    } catch {
      return null
    }
  }
  return null
}

/**
 * 由搜索查询词拼出 /submit 预填链接。
 * 空查询返回裸 `/submit`（不带空参数，避免表单被空字符串占位）。
 */
export function submitPrefillHref(query: string): string {
  const q = query.trim()
  if (!q) return '/submit'
  const url = normalizeUrl(q)
  if (url) return `/submit?url=${encodeURIComponent(url)}`
  return `/submit?title=${encodeURIComponent(q.slice(0, SUBMIT_PREFILL_TITLE_MAX))}`
}

/**
 * /submit 页解析 searchParams（Next 16 下为 Promise，调用方先 await）。
 * 只认 `title` / `url` 两个参数；非法值直接丢弃、不进表单，绝不把
 * `javascript:` 之类的脏串当成网址预填（表单提交时另有服务端校验）。
 */
export function parseSubmitPrefill(
  searchParams: Record<string, string | string[] | undefined> | null | undefined,
): SubmitPrefill {
  if (!searchParams) return {}
  const out: SubmitPrefill = {}
  const rawTitle = searchParams.title
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (title) out.initialTitle = title.slice(0, SUBMIT_PREFILL_TITLE_MAX)
  const rawUrl = searchParams.url
  const url = typeof rawUrl === 'string' ? normalizeUrl(rawUrl) : null
  if (url) out.initialUrl = url
  return out
}
