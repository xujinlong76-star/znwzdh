/**
 * CRDT 协同 presence：在线标签页计数（纯逻辑，不依赖 React / BroadcastChannel）。
 *
 * 回归背景：胶囊「N 标签页实时协同」的计数以前是一个标量 peerCount——
 * 收到 PONG 就无脑 +1（不看 clientId、不去重、只加不减、上限 8），收到
 * CRDT_OP_BROADCAST 还直接采信对方报来的 peerCount（Math.max），而
 * navigation-content.tsx 与 video-content.tsx 各双挂一个 Sidebar，
 * 每个 Sidebar 都渲染一个胶囊实例、同 tab 内两实例互发 PING/PONG。
 * 结果：只开一个标签页也显示「2 标签页」，数字跨标签传染虚高、
 * 关标签后永不回落。
 *
 * 正确口径：一个 clientId 就是一个标签页（sessionStorage 按标签页隔离，
 * 同 tab 双实例共享同一个 clientId）。计数 = 存活的远端 clientId 数 + 自己。
 * - 同 tab 另一实例的 PONG：clientId 与自己相同，直接忽略——单 tab 双实例
 *   永远只计 1 个 tab。
 * - 远端 tab 的 PING / PONG / 操作广播：按 clientId 记一次存活时间戳，
 *   重复收到只刷新时间戳、不虚增。
 * - 超过 PEER_EXPIRY_MS 未见即摘除：关标签后计数回落；心跳每
 *   PEER_HEARTBEAT_MS 发一次 PING，活着的 tab 会不断续命。
 * - 不再采信任何一方报来的 peerCount：只信自己亲眼见到的 clientId。
 *
 * 已知局限：浏览器「复制标签页」会连 sessionStorage 一起复制，复制出的
 * 新标签页与原标签页 clientId 相同，会被互相忽略、各显示 1 个标签页。
 * 无法仅凭 clientId 区分「同 tab 另一实例」与「复制出的新标签页」，
 * 属于罕见边缘情况，接受此局限（旧实现在所有维度上都更错）。
 */
export const PEER_HEARTBEAT_MS = 5_000
export const PEER_EXPIRY_MS = 15_000

export type CrdtPresenceMessage = {
  type: string
  clientId?: unknown
  instanceId?: unknown
  [key: string]: unknown
}

const COUNTED_TYPES = new Set(['CRDT_PING', 'CRDT_PONG', 'CRDT_OP_BROADCAST'])

export class CrdtPresence {
  private readonly selfClientId: string
  /** key：远端标签页的 clientId；value：最近一次见到该标签页的时间戳。 */
  private readonly peers = new Map<string, number>()

  constructor(selfClientId: string) {
    this.selfClientId = selfClientId
  }

  /**
   * 记一条收到的远端消息。返回 peer 集合是否因此新增了一个标签页
   * （只刷新时间戳不算新增，调用方可用它决定是否需要重新渲染计数）。
   */
  noteMessage(msg: CrdtPresenceMessage | null | undefined, now: number): boolean {
    if (!msg || typeof msg.type !== 'string' || !COUNTED_TYPES.has(msg.type)) return false
    const clientId = typeof msg.clientId === 'string' ? msg.clientId : ''
    // 无 id 或自己（同 tab 另一实例共享同一个 clientId）都不计入。
    if (!clientId || clientId === this.selfClientId) return false
    const isNew = !this.peers.has(clientId)
    this.peers.set(clientId, now)
    return isNew
  }

  /** 摘除超过 PEER_EXPIRY_MS 未见的标签页，返回是否摘掉过。 */
  prune(now: number): boolean {
    let removed = false
    for (const [clientId, lastSeen] of this.peers) {
      if (now - lastSeen > PEER_EXPIRY_MS) {
        this.peers.delete(clientId)
        removed = true
      }
    }
    return removed
  }

  /** 在线标签页总数 = 存活的远端标签页数 + 自己。 */
  get peerCount(): number {
    return this.peers.size + 1
  }
}
