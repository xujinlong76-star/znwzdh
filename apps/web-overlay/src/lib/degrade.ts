/**
 * 降级提示：把「中枢请求失败」翻译成**用户能据此行动**的一句话。
 *
 * 背景是真实的用户痛点。中枢客户端的降级原则（见 navhub-api.ts 顶部注释）是
 * 「任何网络失败都返回可用的空结果」——这对首页首屏是对的，但落到 /hot、/tags、
 * /collections、/site/[id] 这些**以数据为主体**的页面就变成了误导：
 *
 *   - 站点详情页把「中枢连不上」渲染成「站点不存在或已被收录源清理」
 *   - 专题详情页把「中枢连不上」渲染成「专题不存在或已下架」
 *   - 榜单页把「中枢连不上」渲染成「暂无热度数据」
 *
 * 用户既拿不到真实原因，也拿不到重试入口，只能以为「这个站没有数据」而离开。
 * 这里把判定逻辑抽成纯函数（可单测），UI 只负责渲染。
 */

/** navhub-api 的降级回调：请求失败但已返回兜底值时被调用 */
export type DegradedHandler = (error: unknown) => void

export interface DegradeNotice {
  /** 面向用户的一句话原因，可直接渲染 */
  message: string
  /** 是否值得给用户一个「重试」按钮（4xx 鉴权类重试没用） */
  retryable: boolean
}

/** 从错误对象上取 HTTP 状态码（hubError 会把 status 挂在 Error 上） */
export function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null
  const status = (error as { status?: unknown }).status
  return typeof status === "number" && Number.isFinite(status) ? status : null
}

/**
 * 是否「确实不存在」。
 *
 * 这个判定很关键：调用方要用它区分「404 = 站点真被删了，可以显示不存在」
 * 与「502/超时 = 中枢挂了，绝不能显示不存在」。混在一起就是把故障说成事实。
 */
export function isNotFound(error: unknown): boolean {
  return errorStatus(error) === 404
}

/** AbortController 主动取消（组件卸载 / 超时） */
export function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  )
}

function rawMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === "string" && error.trim()) return error.trim()
  return ""
}

/**
 * 请求失败 → 降级提示。
 *
 * hubError 生成的 message 本身已经是可读中文（见 navhub-api.ts 的 HUB_STATUS_HINT），
 * 所以优先透出它，只在信息缺失时补默认文案；`retryable` 依据状态码判断。
 */
export function describeDegrade(error: unknown, subject = "NavHub 中枢"): DegradeNotice {
  if (isAbort(error)) {
    return { message: "请求超时或被中断，未取回最新数据。", retryable: true }
  }

  const status = errorStatus(error)
  const message = rawMessage(error)

  if (status === null) {
    // fetch 在网络层失败时抛 TypeError（服务未启动 / DNS / 断网 / 中间代理挡了）
    return {
      message: message || `无法连接 ${subject}：服务未启动或网络不可达。`,
      retryable: true,
    }
  }

  if (status === 404) {
    return { message: message || `${subject} 上找不到该资源（可能已被清理）。`, retryable: false }
  }
  if (status === 401 || status === 403) {
    return {
      message: (message || `${subject} 拒绝了本次请求。`) + "（可在「偏好设置」更新 API Token）",
      retryable: false,
    }
  }
  // 429 / 5xx / 其余：等一会儿再试有意义
  return { message: message || `${subject} 暂时不可用（HTTP ${status}）。`, retryable: true }
}
