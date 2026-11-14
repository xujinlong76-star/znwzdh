/**
 * 搜索框 AI 模式的小助手（纯函数，可单测）。
 *
 * 模式语义：打开后，搜索框回车不再打开第一条站内结果，而是把整句查询
 * 直接发给 AI 找站（openCopilot 全局抽屉）。交互成本最低：点一下 AI
 * 按钮进模式，输完词回车即问；再点一下回普通搜索。
 *
 * 与 Spotlight 的约定对齐：输入以 `?` 或 `ai ` 开头时也自动进 AI 模式
 * 并去掉前缀（`?` 本来就是 Spotlight 的 AI 前缀，用户不用再学一套）。
 */

export const SEARCH_AI_MODE_STORAGE_KEY = 'navhub.search.aiMode.v1'

/** AI 模式下的输入框提示语：明说这是在问 AI，不是站内检索。 */
export const SEARCH_AI_PLACEHOLDER = '问 AI 找站，说一句话…'

export function readSearchAiMode(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    return window.localStorage.getItem(SEARCH_AI_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeSearchAiMode(on: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (on) window.localStorage.setItem(SEARCH_AI_MODE_STORAGE_KEY, '1')
    else window.localStorage.removeItem(SEARCH_AI_MODE_STORAGE_KEY)
  } catch {
    // 隐私模式等写失败时只影响记忆，不影响本次使用
  }
}

/**
 * 解析一次输入：返回「是否进入 AI 模式」与「真正要用的查询词」。
 * 只有行首的 `?` / `ai ` 是模式前缀，中间的问号不动；前缀被去掉后
 * 查询词为空时不进模式（只剩一个 `?` 不算一句话）。
 */
export function resolveAiModeInput(value: string): { aiMode: boolean; query: string } {
  if (value.startsWith('?')) {
    const query = value.slice(1).trimStart()
    return query ? { aiMode: true, query } : { aiMode: false, query: value }
  }
  if (/^ai\s+/i.test(value)) {
    const query = value.replace(/^ai\s+/i, '')
    return query ? { aiMode: true, query } : { aiMode: false, query: value }
  }
  return { aiMode: false, query: value }
}
