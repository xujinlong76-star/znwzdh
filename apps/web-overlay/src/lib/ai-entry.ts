/**
 * AI 入口契约：所有唤起 Copilot 抽屉 / 插件工坊的入口共用这一份事件负载形状。
 *
 * 为什么需要单独一份：浏览器实测过两次真事故——
 *   1. 首屏网守 GlobalAiGateway 首次派发的是无负载的 `new Event('open-ai-copilot')`，
 *      Spotlight 带来的问题被丢掉：抽屉打开了，输入框却空着（AI-2 取证）；
 *   2. Spotlight 的 AI 模式（`?` 前缀）按 `{ prompt }` 派发，抽屉只读 `{ query }`，
 *      即使抽屉已挂载，问题也会静默消失。
 * 派发端与接收端都只认这里定义的字段名，新增入口不再各写各的。
 */

export const COPILOT_OPEN_EVENT = 'open-ai-copilot'
export const AI_STUDIO_OPEN_EVENT = 'open-ai-plugin-studio'

/** 谁唤起的抽屉：只用于观测与回归定位，不参与业务分支 */
export type CopilotOpenSource = 'keyboard' | 'spotlight' | 'preset' | 'programmatic' | 'external'

const OPEN_SOURCES: readonly CopilotOpenSource[] = ['keyboard', 'spotlight', 'preset', 'programmatic', 'external']

export interface CopilotOpenDetail {
  /** 唤起后立即发送的问题；不带则只打开抽屉 */
  query?: string
  /** 入口来源 */
  source?: CopilotOpenSource
}

export interface AiStudioOpenDetail {
  prompt?: string
}

/** 与中枢 chatSchema 的 message 上限一致：事件负载不能绕过接口侧的长度约束 */
export const COPILOT_OPEN_QUERY_MAX = 8000

/**
 * 把任意 `CustomEvent.detail` 收敛成契约形状。
 * 非法输入一律回空对象（只打开抽屉），绝不把 undefined / 非字符串塞进 handleSend。
 */
export function normalizeCopilotOpenDetail(input: unknown): CopilotOpenDetail {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const detail: CopilotOpenDetail = {}
  if (typeof raw.query === 'string') {
    const query = raw.query.trim().slice(0, COPILOT_OPEN_QUERY_MAX)
    if (query) detail.query = query
  }
  if (typeof raw.source === 'string' && (OPEN_SOURCES as readonly string[]).includes(raw.source)) {
    detail.source = raw.source as CopilotOpenSource
  }
  return detail
}

export function normalizeAiStudioOpenDetail(input: unknown): AiStudioOpenDetail {
  if (!input || typeof input !== 'object') return {}
  const prompt = (input as Record<string, unknown>).prompt
  return typeof prompt === 'string' ? { prompt } : {}
}

/** 唯一派发口：不要在别处再手写事件名（两次事故都源于各写各的负载） */
export function openCopilot(detail: CopilotOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent(COPILOT_OPEN_EVENT, { detail }))
}

export function openAiStudio(detail: AiStudioOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent(AI_STUDIO_OPEN_EVENT, { detail }))
}

/**
 * 首屏网守的意图寄存槽。
 *
 * 抽屉实现是 dynamic 懒加载：网关收到第一次唤起时抽屉可能还没挂载，此刻
 * 派发出去没有任何监听器。网关把意图放进这个槽位，抽屉挂载后主动取走——
 * 这样 detail.query 不会在「第一次唤起」这一跳丢失。
 */
let stashedOpen: CopilotOpenDetail | null = null
let drawerReady = false

export function stashCopilotOpen(detail: CopilotOpenDetail): void {
  // 后到的意图若没带问题，不要把先到的问题覆盖掉
  stashedOpen = { ...stashedOpen, ...detail }
}

export function takeStashedCopilotOpen(): CopilotOpenDetail | null {
  const detail = stashedOpen
  stashedOpen = null
  return detail
}

/** 抽屉挂载完成后登记；此后网关不再拦截，避免同一操作被处理两次 */
export function markCopilotDrawerReady(): void {
  drawerReady = true
}

export function isCopilotDrawerReady(): boolean {
  return drawerReady
}
