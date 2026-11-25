/**
 * 统一三合一搜索窗（站内检索 × AI 找站 × 找相似）纯函数意图识别与前缀解析。
 *
 * 与 `search-ai-mode.ts`（`?` / `ai ` 前缀）互补：
 *   - `resolveSimilarModeInput`：`sim ` / `similar ` / `相似 ` 前缀一键切到「找相似」模式；
 *   - `detectDiscoveryIntent`：根据输入形态温和提示跨模式切换（网址/域名 → 找相似；任务需求句 → AI 找站）。
 */

export type SearchDiscoveryTab = 'search' | 'ai' | 'similar'

/**
 * 解析输入是否以「找相似」快捷前缀开头（`sim ` / `similar ` / `相似 `）。
 * 只有前缀后跟着实际内容（去空白非空）才触发切换，避免刚输入前缀还没打词就误切。
 */
export function resolveSimilarModeInput(raw: string): { similarMode: boolean; query: string } {
  const m = raw.match(/^(?:sim|similar|相似|找相似)\s+(.+)$/i)
  if (!m) return { similarMode: false, query: raw }
  const rest = m[1]?.trim() ?? ''
  if (!rest) return { similarMode: false, query: raw }
  return { similarMode: true, query: rest }
}

/** 轻量判断输入更像「网址/域名（找相似）」还是「自然语言需求（AI 找站）」 */
export function detectDiscoveryIntent(raw: string): 'ai' | 'similar' | null {
  const q = raw.trim()
  if (q.length < 3) return null
  // 明显是 URL 或裸域名（不含空白，含合法点分顶级域）
  if (
    /^https?:\/\//i.test(q) ||
    (!/\s/.test(q) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(q))
  ) {
    return 'similar'
  }
  // 明显是中文场景任务需求句
  if (
    /(我要|帮我|想找|想做|怎么|如何|有没有|免费做|在线做|推荐一个|什么网站|用来做|工具推荐)/.test(q) ||
    (q.length >= 9 && /[\u4e00-\u9fa5]/.test(q) && !q.includes('.'))
  ) {
    return 'ai'
  }
  return null
}
