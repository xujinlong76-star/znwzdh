/**
 * 纯文本剥标签辅助（无 DOM 依赖，可在 node 里直接单测）。
 *
 * 单次正则 `.replace(/<[^>]+>/g, '')` 有两处硬伤（CodeQL #138/#139「不完整
 * 的多字符清理」）：
 * 1. 引号盲区：`<a title="x>y">正文</a>` 会在属性内的 `>` 处提前截断，真实
 *    文本被吞、残留 `y">` 碎片；
 * 2. 拼接复活：嵌套标签经一次删除后，外层残片可能拼成新的标签形子串。
 *
 * 这里是单遍状态机：逐字符扫描，只把 `<` 后跟字母 / `/` / `!` / `?` 的才当
 * 标签开头（`a < b` 这种纯文本小于号原样保留），标签内引号里的 `>` 不闭合
 * 标签，未闭合标签丢弃剩余部分。一次扫描即干净，不存在“删完再拼活”的
 * 中间态，线性时间、无回溯。
 */
export function stripHtmlTags(text: string): string {
  const out: string[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch !== '<') {
      out.push(ch)
      i++
      continue
    }
    // `<` 后不是字母 / `/` / `!` / `?`：是纯文本小于号，原样保留。
    const next = text[i + 1]
    if (next === undefined || !/[A-Za-z/?!]/.test(next)) {
      out.push(ch)
      i++
      continue
    }
    // 扫描到配对的 `>`，引号内的 `>` 不闭合标签。
    let j = i + 1
    let quote: string | null = null
    while (j < n) {
      const c = text[j]
      if (quote) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'") {
        quote = c
      } else if (c === '>') {
        break
      }
      j++
    }
    if (j >= n) break // 未闭合标签：丢弃剩余部分
    i = j + 1
  }
  return out.join('').trim()
}
