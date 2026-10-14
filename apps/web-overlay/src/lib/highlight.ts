/**
 * 搜索结果关键词高亮（纯函数，无 React 依赖）。
 *
 * 与上游 search-bar 的 highlightText 的区别：
 *  - 上游把 query **原样**塞进 `new RegExp(query)` —— 查询含 `+` `(` `.` `[` 等
 *    正则元字符会直接抛异常（高亮失败会连带结果渲染崩溃）或产生误匹配。
 *    这里对每个 token 单独转义后再组装。
 *  - 支持多词查询：按空白切分，任一 token 命中即高亮（对应检索的多词语义）。
 *
 * 注意：只对**字面命中**的场景有意义——拼音（zgtqw）与语义召回的命中
 * 在文本里没有对应字面，不高亮是正确行为。
 */

export interface HighlightSegment {
  text: string
  hit: boolean
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g

export function highlightParts(text: string, query: string): HighlightSegment[] {
  if (!text) return []
  const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 0) return [{ text, hit: false }]

  // 长 token 排前面：alternation 同位置短词先匹配会把 "code" 塞进 "coder"，
  // 拆出无意义的 "er" 碎片
  const pattern = tokens
    .map((t) => t.replace(REGEX_SPECIALS, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|")

  let re: RegExp
  try {
    re = new RegExp("(" + pattern + ")", "gi")
  } catch {
    // 转义后理应不可能失败；高亮是锦上添花，失败时原样返回不阻断展示
    return [{ text, hit: false }]
  }

  const out: HighlightSegment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ text: text.slice(last, idx), hit: false })
    out.push({ text: m[0], hit: true })
    last = idx + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out
}
