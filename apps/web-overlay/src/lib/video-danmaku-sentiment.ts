import type { VideoDanmakuItem } from '@/types/navigation'

export interface DanmakuSentiment {
  polarity: 'positive' | 'neutral' | 'negative' | 'confusion'
  category: 'question' | 'blocked' | 'aha' | 'applause' | 'neutral'
  score: number // -1.0 to 1.0
  isConfusion: boolean
  matchedKeywords: string[]
}

export interface ConfusionHotspot {
  timeSec: number
  startTimeSec: number
  endTimeSec: number
  confusionCount: number
  sampleDanmaku: string[]
  diagnosticRecommendation: string
  diagnosticAdvice?: string
}

const BLOCKED_REGEX = /(?:看不懂|报错|失败|坑|挂了|error|failed|crash|panic|nil|nullpointer|exception|404|500|卡住|跑不通)/i
const QUESTION_REGEX = /(?:为什么|为啥|怎么回事|不理解|怎么写|求问|如何解决)/i
const AHA_REGEX = /(?:恍然大悟|原来如此|顿悟|解惑|看懂了|aha)/i
const APPLAUSE_REGEX = /(?:太强了|干货|学到了|通透|好评|感谢|牛逼|牛|清楚|懂了|赞|awesome|great|cool|perfect)/i

/**
 * Scans danmaku text for sentiment polarity and confusion indicators.
 */
export function analyzeDanmakuSentiment(text: string): DanmakuSentiment {
  const matchedKeywords: string[] = []

  const blockedMatch = text.match(BLOCKED_REGEX)
  if (blockedMatch) {
    matchedKeywords.push(blockedMatch[0])
    return {
      polarity: 'confusion',
      category: 'blocked',
      score: -0.8,
      isConfusion: true,
      matchedKeywords,
    }
  }

  const questionMatch = text.match(QUESTION_REGEX)
  if (questionMatch) {
    matchedKeywords.push(questionMatch[0])
    return {
      polarity: 'confusion',
      category: 'question',
      score: -0.5,
      isConfusion: true,
      matchedKeywords,
    }
  }

  const ahaMatch = text.match(AHA_REGEX)
  if (ahaMatch) {
    matchedKeywords.push(ahaMatch[0])
    return {
      polarity: 'positive',
      category: 'aha',
      score: 0.8,
      isConfusion: false,
      matchedKeywords,
    }
  }

  const applauseMatch = text.match(APPLAUSE_REGEX)
  if (applauseMatch) {
    matchedKeywords.push(applauseMatch[0])
    return {
      polarity: 'positive',
      category: 'applause',
      score: 0.9,
      isConfusion: false,
      matchedKeywords,
    }
  }

  return {
    polarity: 'neutral',
    category: 'neutral',
    score: 0,
    isConfusion: false,
    matchedKeywords: [],
  }
}

/**
 * Clusters confusion danmaku along the timeline to detect technical stumbling blocks.
 */
export function clusterConfusionHotspots(
  danmaku: VideoDanmakuItem[],
  windowSec: number = 20
): ConfusionHotspot[] {
  const confusionItems = danmaku
    .map(dm => ({ ...dm, sentiment: analyzeDanmakuSentiment(dm.text) }))
    .filter(dm => dm.sentiment.isConfusion || dm.isPitfallWarning)
    .sort((a, b) => a.timeSec - b.timeSec)

  if (confusionItems.length === 0) {
    return []
  }

  const clusters: Array<typeof confusionItems> = []
  let currentCluster: typeof confusionItems = []

  confusionItems.forEach((item) => {
    if (currentCluster.length === 0) {
      currentCluster.push(item)
    } else {
      const prev = currentCluster[currentCluster.length - 1]
      if (item.timeSec - prev.timeSec <= windowSec) {
        currentCluster.push(item)
      } else {
        clusters.push(currentCluster)
        currentCluster = [item]
      }
    }
  })

  if (currentCluster.length > 0) {
    clusters.push(currentCluster)
  }

  return clusters.map((items) => {
    const startTimeSec = items[0].timeSec
    const endTimeSec = items[items.length - 1].timeSec
    const centerSec = Math.round((startTimeSec + endTimeSec) / 2)
    const samples = items.map(i => i.text).slice(0, 3)

    let advice = '此处涉及系统核心依赖或外部网络状态，请确认前置依赖配置是否一致。'
    if (items.some(i => /404|500|network/i.test(i.text))) {
      advice = '网络或路由请求异常：检查网关 Ingress 路由规则及后端服务存活探针。'
    } else if (items.some(i => /nil|nullpointer|pointer/i.test(i.text))) {
      advice = '空指针异常高发：确认入参结构是否满足非空校验与泛型类型约束。'
    }

    return {
      timeSec: centerSec,
      startTimeSec,
      endTimeSec,
      confusionCount: items.length,
      sampleDanmaku: samples,
      diagnosticRecommendation: advice,
      diagnosticAdvice: advice,
    }
  })
}
