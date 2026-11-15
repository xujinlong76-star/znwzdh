/**
 * 问问我的收藏：前端客户端（/ask）。
 *
 * 与中枢的分工（见 apps/api/src/routes/ask.ts）：
 *  - GET /api/ask/status：收藏条数、够不够 5 条开问、模型是否就绪、3 条动态示例标题；
 *  - POST /api/ask：SSE 流式。模型输出是严格 JSON，没有可渲染的逐字正文，
 *    所以流里只有 `: progress` 注释帧（retrieved/generating 两段）与终稿 done；
 *    done 是唯一权威终稿：引用校验可能改写答案，前端必须以 done 的 answer
 *    为准，绝不渲染流式草稿。降级（未配置/额度/0 命中）不开流，回一次性 JSON，
 *    前端按 content-type 分流，降级横幅的口径与 Copilot 一致。
 *  - 引用只渲染服务端返回的引用表（citations），不渲染模型原文里的任何链接；
 *    引用点击第一跳站内站点页（/site/:id），卡片上再给「打开原站」外链。
 *
 * 本机历史：最近 20 条问答只存 localStorage（问题 + 答案摘要 + 引用 siteId），
 * 服务端不存问答内容；/ask 页一键清空。
 */
import { getApiToken, hubGet, hubUrl } from './navhub-api'
import { parseCopilotFrame } from './copilot-frame'

export interface AskStatus {
  favoritesCount: number
  canAsk: boolean
  llmReady: boolean
  samples: string[]
}

export interface AskCitationCard {
  siteId: string
  title: string
  url: string
  description: string | null
  note: string | null
  tags: string[]
  createdAt: number
  referenceOnly?: boolean
}

export interface AskAnswerSegment {
  text: string
  citations: string[]
}

export type AskDegraded = 'unconfigured' | 'quota' | 'error' | null

/** 一次性 JSON 体与 SSE done 帧共用的终稿形状。 */
export interface AskFinalBody {
  ok: boolean
  mode?: 'ai' | 'local'
  degraded?: AskDegraded
  unknown?: boolean
  answer?: AskAnswerSegment[] | null
  citations?: AskCitationCard[]
  suggestions?: string[]
  message?: string
  error?: string
  retrieval?: {
    totalFavorites: number
    matched: number
    lexical: number
    semantic: number
    correction: { from: string; to: string } | null
    semanticAvailable: boolean
  }
  quota?: {
    scope: string
    metric: string
    limit: number
    used: number
    retryAfterSeconds: number
  }
}

export type AskProgressStage = 'retrieved' | 'generating'

export interface AskProgress {
  stage: AskProgressStage
  total?: number
  matched?: number
}

export interface AskStreamCallbacks {
  onProgress?: (progress: AskProgress) => void
  signal?: AbortSignal
}

export async function fetchAskStatus(): Promise<AskStatus> {
  return hubGet<AskStatus>('/api/ask/status')
}

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

async function serverMessage(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim()
    if (!text) return ''
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    return ''
  } catch {
    return ''
  }
}

function frameBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  if (lf !== -1) return { index: lf, length: 2 }
  return null
}

/** 解析一帧：data 行走 Copilot 帧协议，`: progress {...}` 注释行是 ask 的进度帧。 */
export function parseAskSseBlock(
  block: string,
): { frame: ReturnType<typeof parseCopilotFrame> } | { progress: AskProgress } | null {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith(': progress ')) {
      try {
        const parsed = JSON.parse(line.slice(': progress '.length)) as AskProgress
        if (parsed && (parsed.stage === 'retrieved' || parsed.stage === 'generating')) {
          return { progress: parsed }
        }
      } catch {
        return null
      }
    }
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return null
  return { frame: parseCopilotFrame(dataLines.join('\n')) }
}

export async function streamAskQuestion(
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  callbacks: AskStreamCallbacks = {},
): Promise<AskFinalBody> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json',
  }
  const token = getApiToken()
  if (token) headers.Authorization = 'Bearer ' + token

  const res = await fetch(hubUrl('/api/ask'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ question, history }),
    signal: callbacks.signal,
  })

  if (!res.ok) {
    throw httpError(res.status, (await serverMessage(res)) || '山羊胡中枢返回 HTTP ' + res.status)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as AskFinalBody
  }
  if (!res.body) {
    throw new Error('本次回答以事件流返回，但当前浏览器环境不支持流式读取响应体。')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final: AskFinalBody | null = null

  try {
    while (true) {
      const { value, done: streamEnded } = await reader.read()
      if (streamEnded) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = frameBoundary(buffer)
      while (boundary) {
        const parsed = parseAskSseBlock(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary.length)
        if (parsed && 'progress' in parsed) {
          callbacks.onProgress?.(parsed.progress)
        } else if (parsed && 'frame' in parsed && parsed.frame?.type === 'done') {
          final = parsed.frame as unknown as AskFinalBody
          break
        }
        boundary = frameBoundary(buffer)
      }
      if (final) break
    }
  } finally {
    reader.cancel().catch(() => {
      /* 流已被 abort 或已正常结束：这条 cancel 只是幂等的收尾，失败无需上报 */
    })
  }

  if (!final) {
    throw new Error('流式回答在中途断开：中枢没有给出终稿，本次内容不作为结果。')
  }
  return final
}

/* ------------------------------------------------------------------ *
 * 本机问答历史：最近 20 条，只存 localStorage（问题 + 答案摘要 + 引用 siteId）
 * ------------------------------------------------------------------ */

export const ASK_HISTORY_STORAGE_KEY = 'navhub.ask.history.v1'
export const ASK_HISTORY_LIMIT = 20

export interface AskHistoryEntry {
  question: string
  /** 答案摘要：首句结论（≤120 字）；「不知道」分支存固定文案 */
  summary: string
  siteIds: string[]
  at: number
}

function readStorage(): AskHistoryEntry[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return []
    const raw = window.localStorage.getItem(ASK_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is AskHistoryEntry =>
        !!e && typeof e === 'object' && typeof (e as { question?: unknown }).question === 'string',
    )
  } catch {
    return []
  }
}

export function loadAskHistory(): AskHistoryEntry[] {
  return readStorage().slice(0, ASK_HISTORY_LIMIT)
}

export function saveAskHistoryEntry(entry: AskHistoryEntry): AskHistoryEntry[] {
  const next = [
    { ...entry, question: entry.question.slice(0, 500), summary: entry.summary.slice(0, 120) },
    ...readStorage().filter((e) => e.question !== entry.question),
  ].slice(0, ASK_HISTORY_LIMIT)
  try {
    window.localStorage.setItem(ASK_HISTORY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 存储满/被禁时静默丢弃：历史只是本机便利，不阻断问答 */
  }
  return next
}

export function clearAskHistory(): void {
  try {
    window.localStorage.removeItem(ASK_HISTORY_STORAGE_KEY)
  } catch {
    /* 清空失败也静默：下次读取仍以现有内容为准 */
  }
}

/** 追问上下文：最近 3 轮（问题 + 答案摘要），每条 ≤500 字，由客户端带给服务端。
 * loadAskHistory 返回 newest-first，这里先取最近 3 条再反转为时间顺序（最旧在前、
 * 最新在后），否则模型收到的是倒序对话，追问指代（“它呢？”“还有呢？”）会被误导。 */
export function askHistoryForRequest(
  entries: readonly AskHistoryEntry[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const entry of [...entries.slice(0, 3)].reverse()) {
    turns.push({ role: 'user', content: entry.question.slice(0, 500) })
    if (entry.summary) turns.push({ role: 'assistant', content: entry.summary.slice(0, 500) })
  }
  return turns.slice(-6)
}
