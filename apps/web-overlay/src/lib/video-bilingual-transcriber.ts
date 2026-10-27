import type { VideoTranscriptItem } from '@/types/navigation'

export interface SubtitleToken {
  word: string
  startSec: number
  endSec: number
  isTerm?: boolean
}

export interface AlignedSubtitleCue {
  id: string
  startSec: number
  endSec: number
  sourceText: string
  targetText: string
  tokens: SubtitleToken[]
}

export interface TechnicalTermDefinition {
  term: string
  category: 'cloud-native' | 'network' | 'storage' | 'security' | 'architecture'
  chineseName: string
  summary: string
  bestPractice: string
}

export const TECHNICAL_GLOSSARY: Record<string, TechnicalTermDefinition> = {
  kubernetes: {
    term: 'Kubernetes',
    category: 'cloud-native',
    chineseName: 'K8s 容器编排系统',
    summary: '自动化部署、扩展和管理容器化应用程序的开源系统。',
    bestPractice: '在生产环境中避免直接操作 Pod，始终使用 Deployment 或 StatefulSet 进行受控发布。',
  },
  ingress: {
    term: 'Ingress',
    category: 'network',
    chineseName: '集群流量入口网关',
    summary: '管理外部访问集群内服务的 API 对象，提供负载均衡、SSL 终止与名称路由。',
    bestPractice: '优先选型 Envoy-based 控制器（如 Ingress-Nginx 或 Gateway API）并严格配置路由重写策略。',
  },
  helm: {
    term: 'Helm',
    category: 'cloud-native',
    chineseName: 'Kubernetes 包管理器',
    summary: '类似于 apt/yum 的云原生应用包管理工具，使用 Chart 定义、安装和升级复杂 K8s 资源。',
    bestPractice: '将环境变量与凭据解耦到 values.yaml，并配合 CI/CD 流水线做模板渲染验证。',
  },
  etcd: {
    term: 'etcd',
    category: 'storage',
    chineseName: '分布式键值存储',
    summary: '基于 Raft 共识算法的高可用强一致性键值数据库，保存 K8s 集群所有状态数据。',
    bestPractice: '必须使用 NVMe 高速 SSD 独立部署，并定期自动化打快照备份以防数据损坏。',
  },
  sidecar: {
    term: 'Sidecar',
    category: 'architecture',
    chineseName: '边车协同容器模式',
    summary: '在同一 Pod 中与主应用容器共享生命周期与网络命名空间，承担日志收集、代理或监控职责。',
    bestPractice: '配置精确的 CPU/内存资源请求，避免由于 Sidecar 内存泄漏导致主应用被 OOM 杀死。',
  },
  prometheus: {
    term: 'Prometheus',
    category: 'cloud-native',
    chineseName: '时序监控告警系统',
    summary: '基于 Pull 模型的度量收集与 TSDB 时序数据库，具有强大的 PromQL 查询语言。',
    bestPractice: '为高频指标配置合理的采集步长（通常 15s-30s），避免时序基数爆炸 (Cardinality Explosion)。',
  },
  crd: {
    term: 'CRD',
    category: 'cloud-native',
    chineseName: '自定义资源定义',
    summary: 'CustomResourceDefinition，允许开发者无需修改源码即可扩展 Kubernetes 原生 API。',
    bestPractice: '配合 Operator 模式编写自定义控制器，并设置 openAPIV3Schema 校验输入字段。',
  },
}

/**
 * Looks up technical vocabulary case-insensitively.
 */
export function lookupTechnicalTerm(word: string): TechnicalTermDefinition | null {
  const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '')
  return TECHNICAL_GLOSSARY[clean] || null
}

/**
 * Builds karaoke-style aligned word tokens across cue duration.
 */
export function tokenizeSubtitles(text: string, startSec: number, endSec: number): SubtitleToken[] {
  const words = text.trim().split(/\s+/)
  if (words.length === 0) return []

  const totalDuration = Math.max(0.2, endSec - startSec)
  const tokenDuration = totalDuration / words.length

  return words.map((w, idx) => {
    const termDef = lookupTechnicalTerm(w)
    return {
      word: w,
      startSec: Number((startSec + (idx * tokenDuration)).toFixed(2)),
      endSec: Number((startSec + ((idx + 1) * tokenDuration)).toFixed(2)),
      isTerm: Boolean(termDef),
    }
  })
}

/**
 * Transforms raw transcript items into bilingual aligned cues with word tokens.
 */
export function buildAlignedBilingualCues(
  transcript: VideoTranscriptItem[],
  defaultTargetPrefix: string = '译'
): AlignedSubtitleCue[] {
  return transcript.map((item, idx) => {
    const targetText = item.translation || `${defaultTargetPrefix}: ${item.text}`
    const tokens = tokenizeSubtitles(item.text, item.startSec, item.endSec)

    return {
      id: item.id || `cue-${idx + 1}-${item.startSec}`,
      startSec: item.startSec,
      endSec: item.endSec,
      sourceText: item.text,
      targetText,
      tokens,
    }
  })
}

/**
 * Resolves current active cue based on playhead timestamp.
 */
export function findActiveBilingualCue(
  cues: AlignedSubtitleCue[],
  currentSec: number
): AlignedSubtitleCue | null {
  for (const cue of cues) {
    if (currentSec >= cue.startSec && currentSec <= cue.endSec) {
      return cue
    }
  }
  return null
}

/**
 * Resolves active word token within active cue for karaoke glow.
 */
export function findActiveKaraokeToken(
  cue: AlignedSubtitleCue,
  currentSec: number
): { token: SubtitleToken; index: number } | null {
  for (let i = 0; i < cue.tokens.length; i++) {
    const t = cue.tokens[i]
    if (currentSec >= t.startSec && currentSec <= t.endSec) {
      return { token: t, index: i }
    }
  }
  return null
}
