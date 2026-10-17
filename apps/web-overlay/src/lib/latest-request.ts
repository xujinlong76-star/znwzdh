/**
 * 「只认最后一次请求」的闸门。
 *
 * 为什么需要（这一类失败长什么样）：
 *   管理端这些列表/详情都是「点一下 → 发一次请求 → 结果整块覆盖界面」。
 *   请求是并发的，而网络不保证先来后到：**先发的慢请求后到，就会把后发的
 *   （用户真正想看的那次）结果覆盖掉**。实测的两种形态：
 *     - 专题管理：连点专题 A、B，B 的响应先到、A 的后到 —— 右侧详情标题是 B，
 *       条目却是 A 的（详情面板里 setItems 被过期响应写回）；
 *     - 标签管理：连点分组「领域」「平台」，领域那次慢一点，最后列出来的是
 *       领域标签，但高亮的分组是平台；
 *     - 统计页切「近 7 天 / 近 30 天」、分面页连点不同选项，同一回事。
 *
 *   盖住失败分支同样重要：过期请求里的**失败**如果不丢，就会把新请求已经
 *   拿到的数据说成「加载失败」，或者反过来把新请求的失败吞掉。
 *
 * 用法（一次请求一个令牌）：
 *   const out = await settleLatest(gate, () => hubGet<T>(url))
 *   if (out.status === 'stale') return          // 已经过期：一个字都不要写
 *   if (out.status === 'value') { ...写成功态 }
 *   else { ...写失败态 }
 *
 * 它不认识 React，也不知道请求是什么 —— 纯粹是「谁最新」的判定，
 * 所以可以直接在 Node 里用乱序的 Promise 把行为钉死（见 test/latest-request.test.ts）。
 */

/** 一块闸门：自己发号、自己判新旧 */
export interface RequestGate {
  /** 领一个新号；号只用于 isCurrent 比较，别拿它当请求 id 用 */
  begin(): number
  /** 这个号还是不是最新的那次（不是 → 结果已过期，必须整个丢掉） */
  isCurrent(token: number): boolean
  /** 作废当前号：之后所有在途响应一律视为过期（离开页面 / 清空选择时用） */
  invalidate(): void
}

/** 一次「只认最后一次」请求的结局 */
export type LatestOutcome<T> =
  | { status: 'value'; value: T }
  | { status: 'error'; error: unknown }
  | { status: 'stale' }

/**
 * 号是全局递增的：两块闸门各自从 1 数起的话，A 的第 1 号和 B 的第 1 号会撞在
 * 一起，万一有人把 A 的号拿去问 B，就会得到「还是最新」的错误答案。
 */
let nextToken = 0

export function newRequestGate(): RequestGate {
  let latest = 0
  return {
    begin() {
      latest = ++nextToken
      return latest
    },
    isCurrent(token: number) {
      // 号从 1 起：传 0 / NaN / undefined 一律不算最新，
      // 免得「忘了 begin 直接判」被当成合法结果写进界面
      return token > 0 && token === latest
    },
    invalidate() {
      latest = ++nextToken
    },
  }
}

/**
 * 跑一次请求，并按闸门判定结果是否还能用。
 *
 * 不抛异常：成功/失败/过期都从返回值里区分，调用方只需三选一。
 */
export async function settleLatest<T>(
  gate: RequestGate,
  task: () => Promise<T>,
): Promise<LatestOutcome<T>> {
  const token = gate.begin()
  try {
    const value = await task()
    // 结果回来之后再判一次：这中间可能已经有更新的请求出去了
    return gate.isCurrent(token) ? { status: 'value', value } : { status: 'stale' }
  } catch (error) {
    // 失败同样要过闸：先发那次的失败不该覆盖后发那次的成功
    return gate.isCurrent(token) ? { status: 'error', error } : { status: 'stale' }
  }
}
