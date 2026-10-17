/**
 * 实时遥测面板的状态判定：**不许把「解析失败」显示成「就绪」**。
 *
 * 真实缺陷（`admin/AdminDashboardClient.tsx`）：
 *
 *     sse.addEventListener('tick', (e) => {
 *       try { const payload = JSON.parse(e.data); setData(...) }
 *       catch {}                      // ← 解析失败，一声不吭
 *     })
 *     sse.onerror = () => setSseStatus('disconnected')
 *
 * 连接本身是好的（`onopen` 已经跑过），所以徽标一直是绿的「SSE 遥测就绪」——
 * 但消息解析失败时 `setData` 根本没执行，面板上那些「实时」数字**冻在旧值**。
 * 管理员盯着一个说「就绪」的面板，看到的却是几分钟前的吞吐量。
 *
 * 这里把判定抽成纯函数：连接状态 + 解析失败条数 → 四种状态，
 * 并且**每种状态都要说清后果**（失败态绝不含「就绪」）。
 */

export type SseStatus = 'connecting' | 'connected' | 'disconnected'

export type TelemetryState = 'connecting' | 'live' | 'stale' | 'offline'

/** 连接状态 + 最近消息的解析失败条数 → 面板该显示哪种状态 */
export function telemetryState(status: SseStatus, parseFailures: number): TelemetryState {
  if (status === 'disconnected') return 'offline'
  if (status === 'connecting') return 'connecting'
  return parseFailures > 0 ? 'stale' : 'live'
}

export interface TelemetryDescriptor {
  state: TelemetryState
  /** 徽标上的短标签 */
  label: string
  /** hover / 读屏用的完整说明：必须说清「数值可能停在旧值」 */
  detail: string
}

export function describeTelemetry(status: SseStatus, parseFailures: number): TelemetryDescriptor {
  const state = telemetryState(status, parseFailures)
  const count = Math.max(0, Math.trunc(parseFailures))

  switch (state) {
    case 'connecting':
      return {
        state,
        label: '连接中',
        detail: '正在建立实时遥测连接；当前数值来自一次性的整体快照。',
      }
    case 'live':
      return {
        state,
        label: 'SSE 遥测就绪',
        detail: '实时遥测正常，数值随服务器推送更新。',
      }
    case 'stale':
      return {
        state,
        label: `遥测解析失败（${count} 条）`,
        detail:
          `最近 ${count} 条实时消息无法解析，所以面板数值可能停在旧值。` +
          '连接本身是通的，通常是前后端消息格式不一致；刷新页面可重新拉取快照。',
      }
    case 'offline':
      return {
        state,
        label: '离线',
        detail: '实时遥测连接已断开，面板数值可能停在旧值；刷新页面可重试。',
      }
  }
}
