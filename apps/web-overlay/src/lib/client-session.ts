'use client'

/**
 * 客户端会话探测的唯一入口（在飞去重）。
 *
 * 真实浪费：`/api/auth/session` 在同一次页面加载里会被打好几次 ——
 * 根布局的 `SessionSync` 打一次，`useMeOverview` 打一次，`useMeSettings` 再打一次。
 * 三处判据还各写一份（非 2xx / 解析失败 / 未登录），改一处就会漏掉另两处。
 *
 * 这里只做两件事：
 * 1. 同一时刻只保留一个在飞请求（组件在同一 tick 挂载就共享它；用户点「重试」时
 *    上一次已经结束，仍会发真正的新请求）；
 * 2. 把失败分成 **可区分** 的三类返回给调用方，而不是压成一个 null ——
 *    「网络断了」「服务在但会话取不到」「返回的不是 JSON」对用户是三种下一步，
 *    调用方各自的文案（`登录状态暂时无法确认` vs `网络不可用`）必须还能分开。
 *
 * 注意：不缓存结果，只去重并发。会话在登录后立刻变真实，任何 TTL 都会让
 * 用户中心读到「未登录」，那正是这类聚合器最容易犯的错。
 *
 * 「未登录」的正常回答是 200 + 字面量 null：它归 `kind: 'ok'`（session 为 `{}`），
 * 不是故障。只有解析抛错才算 `parse` —— 把 null 当故障会让匿名访客看到错误态，
 * 把故障当 null 又会对已登录用户说「你是匿名」，两个方向都修在这里。
 */

export interface ClientSessionShape {
  user?: { id?: string }
}

export type ClientSessionProbe =
  | { kind: 'ok'; session: ClientSessionShape }
  /** 非 2xx：中枢有响应，但这次拿不到会话 */
  | { kind: 'http' }
  /** 2xx 但正文解析不了 */
  | { kind: 'parse' }
  /** fetch 直接抛错（断网 / 请求被浏览器拦下） */
  | { kind: 'network' }
const SESSION_ENDPOINT = '/api/auth/session'

let inflight: Promise<ClientSessionProbe> | null = null

export function probeClientSession(): Promise<ClientSessionProbe> {
  if (inflight) return inflight
  const run = async (): Promise<ClientSessionProbe> => {
    let res: Response
    try {
      res = await fetch(SESSION_ENDPOINT, { cache: 'no-store' })
    } catch {
      return { kind: 'network' }
    }
    if (!res.ok) return { kind: 'http' }
    try {
      const parsed = (await res.json()) as ClientSessionShape | null
      return { kind: 'ok', session: parsed ?? {} }
    } catch {
      return { kind: 'parse' }
    }
  }
  const p = run().finally(() => {
    if (inflight === p) inflight = null
  })
  inflight = p
  return p
}

/** 三类会话故障里，只有「网络不通」值得告诉用户检查网络 */
export function isNetworkSessionFailure(probe: ClientSessionProbe): boolean {
  return probe.kind === 'network'
}
