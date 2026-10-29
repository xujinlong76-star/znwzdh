/**
 * Copilot 流式客户端（AI-3）。
 *
 * 为什么不复用 navhub-api.ts 里的 sendJson：那条路径无条件 `await res.text()`
 * 后再 JSON.parse，等于把整段 SSE 缓冲到连接关闭才交给调用方——逐段输出在
 * 传输层就被抹掉了。这里直读 ReadableStream，按 SSE 帧增量回调。
 * 单独成文件（而不是往 navhub-api.ts 里加一个函数）是因为那个文件与并行会话共享，
 * 改动成本高于收益；这里只 import 它的导出，不修改它。
 *
 * 与中枢的分工（见 apps/api/src/routes/copilot.ts streamCopilotReply）：
 *   - 帧只有三种：delta / reasoning / done；
 *   - `done` 带的是**引用校验之后的权威终稿**：模型编造的链接会在服务端被降级成
 *     纯文本，逐段拼出来的草稿并没有经过这一道，所以草稿永远以 done 为准整体覆盖；
 *   - 额度用尽 / 未配置模型这两类降级**不开流**（没有逐段内容可推），回一次性 JSON，
 *     前端按 content-type 分流，降级横幅的口径与旧版完全一致。
 */
import { getApiToken, hubUrl, type CopilotChatResponse } from './navhub-api'
import { parseCopilotFrame, type CopilotFrame } from './copilot-frame'

export interface CopilotCitation {
  siteId: string
  title: string
  url: string
  description?: string | null
}

/**
 * 终稿正文 = 旧版一次性响应 + 中枢 AI-1 起附带的结构化字段。
 * citations / retrieval 不写进 navhub-api.ts 的 CopilotChatResponse：那个类型
 * 与并行会话共享，而消费侧（抽屉）需要它们。
 */
export interface CopilotReplyBody extends CopilotChatResponse {
  citations?: CopilotCitation[]
  retrieval?: { candidates: number; unverifiedLinks: number; failed: boolean }
  /** 中枢的机器码；`upstream_cancelled` 表示模型侧自己中断，不是用户按了停止 */
  code?: string
}

export type CopilotStreamOutcome =
  | { mode: 'stream'; final: CopilotReplyBody }
  | { mode: 'json'; final: CopilotReplyBody }

export interface CopilotStreamOptions {
  thinking?: boolean
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onReasoning?: (text: string) => void
}

/** 带状态码的错误：describeDegrade 靠 status 区分「中枢没起来」与「鉴权/限流」 */
function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

/**
 * 错误体里的可读消息。
 *
 * 解析失败必须回空串而不是抛错：否则 `SyntaxError: Unexpected token <` 会盖掉
 * 真正的状态码（中枢挂了 / 代理回了 HTML 错误页时，用户看到的是一句 JSON 解析错）。
 */
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

/**
 * 取一帧的边界。
 *
 * SSE 允许 `\r\n\r\n` 与 `\n\n` 两种分隔，中枢写的是后者，但中间代理层
 * （Next 路由透传 / 反代）不保证不改写行尾，所以两种都要认。
 */
function frameBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  if (lf !== -1) return { index: lf, length: 2 }
  return null
}

/**
 * 解析一帧。
 *
 * 以 `:` 开头的是注释（`: connected` 与每 10 秒一次 `: ping` 心跳，用来防止
 * 中间层掐掉首 token 之前的空闲连接），不是数据。
 *
 * 类型白名单与 JSON 校验统一走 `parseCopilotFrame`（事实源在
 * packages/core/src/copilot-frame.ts，本目录的 copilot-frame.ts 是受
 * sync-core-mirrors 生成的镜像）：未知 `type` 或非法形状一律返回 null，
 * 丢一块草稿不影响正确性，权威正文始终由 done 覆盖；真出传输问题表现为
 * 「没有 done」，由那一条统一报错。
 */
function parseFrame(block: string): CopilotFrame | null {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return null
  return parseCopilotFrame(dataLines.join('\n'))
}

export async function streamCopilotChat(
  message: string,
  history?: Array<{ role: string; content: string }>,
  options: CopilotStreamOptions = {},
): Promise<CopilotStreamOutcome> {
  const headers: Record<string, string> = {
    // 同时声明两种可接受格式：降级路径回的是 JSON，只写 event-stream 会让
    // 中枢的 406/内容协商变成一次「看起来像前端坏了」的失败。
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json',
  }
  const token = getApiToken()
  if (token) headers.Authorization = 'Bearer ' + token

  const res = await fetch(hubUrl('/api/copilot/chat'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      history,
      stream: true,
      ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
    }),
    signal: options.signal,
  })

  if (!res.ok) {
    throw httpError(res.status, (await serverMessage(res)) || '山羊胡中枢返回 HTTP ' + res.status)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const text = await res.text()
    return { mode: 'json', final: (text ? JSON.parse(text) : {}) as CopilotReplyBody }
  }
  // 服务端不支持流式读取（老浏览器 / 某些扩展劫持了 fetch）：明确报错，
  // 不要退化成「静默等整段」——那会让用户以为逐段输出真的在工作。
  if (!res.body) {
    throw new Error('本次回答以事件流返回，但当前浏览器环境不支持流式读取响应体。')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final: CopilotReplyBody | null = null

  try {
    while (true) {
      const { value, done: streamEnded } = await reader.read()
      if (streamEnded) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = frameBoundary(buffer)
      while (boundary) {
        const frame = parseFrame(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary.length)
        if (frame?.type === 'delta' && typeof frame.text === 'string') {
          options.onDelta?.(frame.text)
        } else if (frame?.type === 'reasoning' && typeof frame.text === 'string') {
          options.onReasoning?.(frame.text)
        } else if (frame?.type === 'done') {
          // 第一个 done 即权威终稿：同一缓冲里后续再出现的 delta / 第二个 done
          // 一律丢弃（协议上服务端只发一个；重复只可能是代理或上游串帧）
          final = frame as unknown as CopilotReplyBody
          break
        }
        boundary = frameBoundary(buffer)
      }
      // 终稿已到：不再等服务器关连接（done 之后只剩收尾），主动收流。
      if (final) break
    }
  } finally {
    // 正常取到终稿、传输中断、以及调用方 abort 都会走到这里。
    // cancel 是「别再收了」，不是「抹掉已经收到的草稿」：草稿留在调用方手里。
    // abort 之后流已经处于错误态，cancel 会 reject，那个拒绝没有行动价值（连接已断），
    // 但按本仓规则吞失败要写明理由，所以写成块体而不是 .catch(() => undefined)。
    reader.cancel().catch(() => {
      /* 流已被 abort 或已正常结束：这条 cancel 只是幂等的收尾，失败无需上报 */
    })
  }

  if (!final) {
    // 没有 done 的结束不是「回答完了」：草稿没经过服务端的引用校验，
    // 把半截内容当终稿会直接展示可能编造的链接。交给调用方按可重试失败处理。
    throw new Error('流式回答在中途断开：中枢没有给出终稿，本次内容不作为结果。')
  }
  return { mode: 'stream', final }
}
