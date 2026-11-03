/**
 * 工作台小组件的纯逻辑：便签待办、时间戳互转、启动坞自定义链接。
 * 抽成纯函数是为了能单测，组件只负责渲染与持久化。
 */

/* ------------------------------ 便签待办 ------------------------------ */

const TODO_OPEN = /^(\s*)- \[ \] /
const TODO_DONE = /^(\s*)- \[[xX]\] /

/** 翻转指定行的待办状态；非待办行原样返回 */
export function toggleTodoLine(content: string, lineIndex: number): string {
  const lines = content.split('\n')
  const line = lines[lineIndex]
  if (line === undefined) return content
  if (TODO_OPEN.test(line)) lines[lineIndex] = line.replace(TODO_OPEN, '$1- [x] ')
  else if (TODO_DONE.test(line)) lines[lineIndex] = line.replace(TODO_DONE, '$1- [ ] ')
  else return content
  return lines.join('\n')
}

/** 删除所有已完成待办行 */
export function clearDoneTodos(content: string): string {
  return content
    .split('\n')
    .filter((line) => !TODO_DONE.test(line))
    .join('\n')
}

/** 只统计行首的待办（正文里提到的 "- [ ] " 不算） */
export function countTodos(content: string): { total: number; done: number } {
  let total = 0
  let done = 0
  for (const line of content.split('\n')) {
    if (TODO_DONE.test(line)) {
      total++
      done++
    } else if (TODO_OPEN.test(line)) {
      total++
    }
  }
  return { total, done }
}

/* ------------------------------ 时间戳互转 ------------------------------ */

export interface TimestampConversion {
  /** 毫秒时间戳 */
  ms: number
  /** 秒级时间戳 */
  seconds: number
  /** 输入被识别成什么 */
  kind: 'seconds' | 'milliseconds' | 'date'
}

/**
 * 10 位及以下按秒、11~13 位按毫秒、其余数字拒绝（避免把手机号当时间）。
 * 非纯数字按日期字符串解析，无法解析返回 null。
 */
export function convertTimestampInput(raw: string): TimestampConversion | null {
  const s = raw.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    if (s.length > 13) return null
    const n = Number(s)
    const isSeconds = s.length <= 10
    const ms = isSeconds ? n * 1000 : n
    if (!Number.isFinite(ms) || Number.isNaN(new Date(ms).getTime())) return null
    return { ms, seconds: Math.floor(ms / 1000), kind: isSeconds ? 'seconds' : 'milliseconds' }
  }
  const parsed = Date.parse(s)
  if (Number.isNaN(parsed)) return null
  return { ms: parsed, seconds: Math.floor(parsed / 1000), kind: 'date' }
}

/* --------------------------- 启动坞自定义链接 --------------------------- */

/**
 * 自定义链接单独存放，**不进收藏同步链路**：收藏会按 siteId 推到中枢，
 * 而中枢里不存在这些私有地址（内网 / localhost），推上去只会失败重试。
 */
export const DOCK_CUSTOM_LINKS_KEY = 'navhub_dock_custom_links_v1'
export const DOCK_CUSTOM_LINKS_MAX = 50

export interface DockCustomLink {
  id: string
  title: string
  href: string
  createdAt: number
}

/** 补协议并校验；只接受 http(s)，拒绝 javascript: 等伪协议 */
export function normalizeCustomLinkUrl(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    return u.toString()
  } catch {
    return null
  }
}

/** 解析存储内容；脏数据逐条丢弃，不抛错 */
export function parseCustomLinks(raw: string | null): DockCustomLink[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (x): x is DockCustomLink =>
          x &&
          typeof x.id === 'string' &&
          typeof x.title === 'string' &&
          typeof x.href === 'string' &&
          normalizeCustomLinkUrl(x.href) !== null,
      )
      .slice(0, DOCK_CUSTOM_LINKS_MAX)
  } catch {
    return []
  }
}

/** 新增链接：同地址去重（覆盖标题并置顶），超上限截断 */
export function addCustomLink(
  list: DockCustomLink[],
  input: { title: string; url: string },
  now: number,
): { ok: true; list: DockCustomLink[] } | { ok: false; error: string } {
  const href = normalizeCustomLinkUrl(input.url)
  if (!href) return { ok: false, error: '网址格式不正确（仅支持 http/https）' }
  const host = new URL(href).host
  const title = input.title.trim().slice(0, 40) || host
  const rest = list.filter((l) => l.href !== href)
  const next = [{ id: `dock-${now.toString(36)}`, title, href, createdAt: now }, ...rest].slice(
    0,
    DOCK_CUSTOM_LINKS_MAX,
  )
  return { ok: true, list: next }
}
