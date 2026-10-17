/**
 * 中枢健康探测的「如实展示」判定（纯函数，便于单测）。
 *
 * 背景是真实缺陷：仪表盘的引擎监控小卡在健康探测失败时仍然显示
 * 「中枢在线」的绿色呼吸灯，并且用 `stats?.sites ?? 50` 把站点数**编**成 50。
 * 故障时给出虚假的绿色信号 + 虚假数字，比不给数据更有害：用户会据此判断
 * 「系统正常」，从而不去排查。
 *
 * 这里的规则：拿不到的数据一律说「未知」，绝不填默认值；
 * 探活失败就说离线，不再点亮任何「正常」指示。
 */

export interface HubHealthLike {
  ok?: boolean
  mode?: string
  capabilities?: {
    semantic?: boolean
    fts?: boolean
    llm?: boolean
  }
  stats?: {
    sites?: number
    categories?: number
    tags?: number
  }
}

export type HealthTone = 'probing' | 'online' | 'offline'

export interface HealthStatus {
  /** 用于上色的三态 */
  tone: HealthTone
  /** 右上角状态胶囊文字 */
  label: string
  /** 存储引擎架构 */
  engineLabel: string
  /** 站点数（未知时明确写未知，不给默认数字） */
  sitesLabel: string
  /** 语义召回能力 */
  semanticLabel: string
}

/** 有限的数字才当作有效统计；NaN / 负数 / 非数字都视为未知 */
function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function describeHealth(
  health: HubHealthLike | null | undefined,
  failed: boolean,
  loading: boolean,
): HealthStatus {
  if (loading) {
    return {
      tone: 'probing',
      label: '探测中...',
      engineLabel: '探测中',
      sitesLabel: '站点统计探测中',
      semanticLabel: '探测中',
    }
  }

  if (failed || !health) {
    return {
      tone: 'offline',
      label: '中枢离线',
      engineLabel: '引擎架构未知',
      sitesLabel: '站点统计不可用',
      semanticLabel: '能力状态未知',
    }
  }

  if (health.ok === false) {
    return {
      tone: 'offline',
      label: '中枢异常',
      engineLabel: health.mode === 'standard' ? 'PG + pgvector' : health.mode ? String(health.mode) : '引擎架构未知',
      sitesLabel: sitesLabelOf(health),
      semanticLabel: '能力状态未知',
    }
  }

  return {
    tone: 'online',
    label: '中枢在线',
    engineLabel: health.mode === 'standard' ? 'PG + pgvector' : health.mode ? String(health.mode) : '引擎架构未知',
    sitesLabel: sitesLabelOf(health),
    semanticLabel: health.capabilities?.semantic ? '向量 KNN 就绪' : '关键词+拼音',
  }
}

function sitesLabelOf(health: HubHealthLike): string {
  const sites = countOf(health.stats?.sites)
  return sites === null ? '站点数未知' : `收录 ${sites} 个站点`
}
