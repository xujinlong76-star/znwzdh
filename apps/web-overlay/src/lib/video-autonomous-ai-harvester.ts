/**
 * Autonomous AI Video Harvester & Intelligent Content Enrichment Pipeline
 * Performs unattended continuous harvesting powered by AI models for evaluation, sanitization,
 * chapter synthesis, and curriculum knowledge injection.
 */

import type {
  NavigationData,
  NavigationItem,
  NavigationSubItem,
  VideoStats,
} from '@/types/navigation'
import { CURATED_TRENDING_TOPICS, type TrendingTechTopic } from '@/lib/video-trending-harvester'
import { calculateFreshnessScore } from '@/lib/video-scoring'
import { videoExternalKey } from '@/lib/video-identity'
import {
  HARVEST_GUARD_REJECT_PREFIX,
  checkHarvestEligibility,
  isHarvestEligibleForItem,
} from '@/lib/video-harvest-guard'
import { enrichVideoItemSeo, submitUrlsToIndexNow } from '@/lib/video-seo'
import { harvestMultiPlatformVideosForKeyword } from '@/lib/video-multi-platform-harvester'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import {
  routeVideoToSubcategory,
  isFuzzyDuplicateVideo,
  extractTechBadgesAndDifficulty,
  normalizeVideoCoverUrl,
} from './video-subcategory-router'

export interface AIEvaluationResult {
  aiQualityScore: number // 0 - 100
  isApproved: boolean
  rejectReason?: string
  techDepth: 'beginner' | 'intermediate' | 'advanced' | 'architect'
  conceptTags: string[]
  detectedClickbait: boolean
  pedagogicalValue: string
}


export interface AutonomousHarvestLogEntry {
  timestamp: number
  level: 'info' | 'ai_thought' | 'approved' | 'rejected' | 'success'
  message: string
  details?: Record<string, any>
}

export interface AutonomousHarvestRunOptions {
  dryRun?: boolean
  forceCategory?: string
  includeMultiPlatform?: boolean
  autoSubmitIndexNow?: boolean
  maxAdditionsPerCycle?: number
  limitPerKeyword?: number
  fetchImpl?: typeof fetch
}

export interface AutonomousHarvestCycleReport {
  cycleId: string
  startedAt: number
  completedAt: number
  scannedCandidatesCount: number
  aiApprovedCount: number
  aiRejectedCount: number
  categoriesEnriched: string[]
  indexNowSubmitted?: number
  logs: AutonomousHarvestLogEntry[]
  newCourses: Array<{
    title: string
    categoryTitle: string
    subCategoryTitle?: string
    author: string
    aiScore: number
    durationSec: number
    platform?: string
    landingUrl?: string
  }>
}

/**
 * AI Model evaluation function: assesses tutorial quality, technical depth,
 * and filters out low-value / clickbait content.
 */
export function evaluateVideoWithAIModel(rawVideo: {
  title: string
  description?: string
  author?: string
  durationSec?: number
  stats?: VideoStats
}): AIEvaluationResult {
  const title = (rawVideo.title || '').trim()
  const desc = (rawVideo.description || '').trim()
  const duration = rawVideo.durationSec || 0
  const stats = rawVideo.stats || {}

  // 1. Clickbait detection patterns
  const clickbaitRegex = /震惊|必看|绝了|逆天|全网最强|看这一篇就够了|秒杀|暴打|吊打/i
  const hasClickbait = clickbaitRegex.test(title)

  // 2. Duration filter: tech tutorials under 180s (3 minutes) lack technical depth
  if (duration > 0 && duration < 180) {
    return {
      aiQualityScore: 42,
      isApproved: false,
      rejectReason: '视频时长过短（不足3分钟），属于碎片化短视频，缺乏系统级工程实战深度',
      techDepth: 'beginner',
      conceptTags: ['碎片短视频'],
      detectedClickbait: hasClickbait,
      pedagogicalValue: '低',
    }
  }

  // 3. Technical keywords extraction
  //
  // 两个历史缺陷：
  //   a) 词表只有英文，而候选池与真实入库内容 90% 是中文标题 —— 李宏毅/吴恩达/
  //      SpringBoot3/JavaScript/RabbitMQ/C++/Git 全部因「未识别到关键词」被判 50 分拒收
  //      （实测 11 条候选拒 7 条）。技术上等于「中文内容一律不进库」。
  //   b) 用 `new RegExp(kw).test()` 匹配，词表里一旦出现 `C++`/`Next.js`/`CI/CD`
  //      就会因正则元字符抛 `Invalid regular expression`，整个采集循环中断。
  //      改成小写 `includes` 后既安全又能同时匹配中英文。
  const techKeywords = [
    // 英文技术栈
    'DeepSeek', 'LLM', 'Agent', 'MCP', 'Cursor', 'Next.js', 'React', 'Vue', 'TypeScript',
    'JavaScript', 'Rust', 'Tokio', 'Kubernetes', 'Docker', 'eBPF', 'Cilium', 'WebGPU', 'Go',
    'Microservices', 'SaaS', 'Stripe', 'RAG', 'Vector', 'Prompt', 'Linux', 'DevOps', 'CI/CD',
    'SpringBoot', 'RabbitMQ', 'Kafka', 'Redis', 'MySQL', 'PostgreSQL', 'C++', 'Git', 'Nginx',
    'Transformer', 'PyTorch', 'TensorFlow', 'FastAPI', 'Golang', 'WebAssembly', 'gRPC',
    'Claude', 'OpenAI', 'LangChain', 'LangGraph', 'CrewAI', 'Ollama', 'vLLM', 'TensorRT',
    'GraphQL', 'Protobuf', 'Tailwind', 'Vite', 'Node.js', 'Deno', 'Bun', 'Tauri', 'Electron',
    'ClickHouse', 'TiDB', 'Elasticsearch', 'MongoDB', 'SQLite', 'DuckDB', 'PolarDB',
    'Prometheus', 'Grafana', 'OpenTelemetry', 'Envoy', 'Istio', 'Helm', 'Terraform', 'Ansible',
    // 中文技术概念（缺失这一段是「中文内容全被拒」的直接原因）
    '机器学习', '深度学习', '神经网络', '大模型', '算法', '架构', '微服务', '分布式',
    '并发', '内核', '内存模型', '消息队列', '版本控制', '前端', '后端', '全栈',
    '性能优化', '系统编程', '容器化', '云原生', '可观测性', '向量检索', '提示工程',
    '独立开发', '出海', '数据分析', '自动化测试', '高可用', '负载均衡', '缓存',
    '逆向工程', '渗透测试', '密码学', '零信任', '服务网格', '无服务器', '边缘计算',
    '代码重构', '单元测试', '音视频', 'Web3', '区块链', '物联网', '嵌入式',
  ]

  const matchedTags: string[] = []
  const fullText = `${title} ${desc} ${rawVideo.author || ''}`
  const haystack = fullText.toLowerCase()
  for (const kw of techKeywords) {
    if (haystack.includes(kw.toLowerCase())) {
      matchedTags.push(kw)
    }
  }

  if (matchedTags.length === 0) {
    return {
      aiQualityScore: 50,
      isApproved: false,
      rejectReason: '未匹配到技术栈关键词（可能是非技术内容，或词表未覆盖该领域，建议人工复核）',
      techDepth: 'beginner',
      conceptTags: ['未分类'],
      detectedClickbait: hasClickbait,
      pedagogicalValue: '无关技术',
    }
  }

  // 4. Calculate AI pedagogical score based on stats and depth.
  // 无互动数据就是 0，不编造默认值：此前缺 stats 时按 10000 播放 / 500 点赞 /
  // 200 投币 / 1000 收藏估算，等于给「零数据」视频发了一张中等成绩单。
  const views = stats.views || 0
  const likes = stats.likes || 0
  const coins = stats.coins || 0
  const favorites = stats.favorites || 0

  // High coin/like ratio indicates high practical educational takeaway (干货比)
  const coinToLikeRatio = likes > 0 ? coins / likes : 0
  const favToViewRatio = views > 0 ? favorites / views : 0

  let baseScore = 75
  if (matchedTags.length >= 3) baseScore += 10
  if (duration >= 900) baseScore += 8 // > 15 mins
  if (coinToLikeRatio >= 0.3) baseScore += 5
  if (favToViewRatio >= 0.08) baseScore += 5
  // 标题党惩罚必须大于「多命中 1 个关键词」的加分(+10)，否则「震惊体 + 堆关键词」
  // 反而比正常标题得分更高 —— 实测 95 分 > 93 分，评分方向是反的。
  if (hasClickbait) baseScore -= 15

  // 没有下限钳制：旧 Math.max(10, …) 在本函数里从未生效（baseScore 最低 60，
  // 75 起评 − 15 标题党惩罚），只是挂在评分末尾的一处垫高写法，去掉。
  const finalScore = Math.min(99, Math.round(baseScore))

  let depth: AIEvaluationResult['techDepth'] = 'intermediate'
  if (/架构|底层|内核|eBPF|无锁|微服务|分布式/i.test(fullText)) {
    depth = 'architect'
  } else if (/实战|进阶|优化|深度|原理/i.test(fullText)) {
    depth = 'advanced'
  } else if (/入门|基础|零基础|指南/i.test(fullText)) {
    depth = 'beginner'
  }

  return {
    aiQualityScore: finalScore,
    isApproved: finalScore >= 70,
    rejectReason: finalScore < 70 ? 'AI 综合评分未达 70 分发布基线' : undefined,
    techDepth: depth,
    conceptTags: matchedTags.slice(0, 5),
    detectedClickbait: hasClickbait,
    pedagogicalValue: finalScore >= 90 ? '极高（企业生产级必读）' : finalScore >= 80 ? '高（深度实战教程）' : '良好',
  }
}

/**
 * Autonomous Harvest Controller coordinating continuous scanning, AI evaluation,
 * and automatic ingestion into the navigation catalog.
 */
export class AutonomousAIHarvesterController {
  /**
   * 只保留 logs。
   *
   * 原来还有 `isRunning: boolean` 与 `timer: any` 两个字段：前者从未被任何代码读写，
   * 后者从未被赋过值（也没有 setInterval 调用）—— 属于「看起来有并发保护，实际没有」的
   * 装饰性代码，会误导后续维护者以为这套采集有互斥。
   */
  private logs: AutonomousHarvestLogEntry[] = []

  getLogs(): AutonomousHarvestLogEntry[] {
    return [...this.logs]
  }

  private addLog(level: AutonomousHarvestLogEntry['level'], message: string, details?: Record<string, any>): void {
    const entry: AutonomousHarvestLogEntry = {
      timestamp: Date.now(),
      level,
      message,
      details,
    }
    this.logs.push(entry)
    if (this.logs.length > 80) this.logs.shift()
  }

  /**
   * Executes a full autonomous harvesting and AI enrichment cycle.
   */
  async runCycle(
    currentData: NavigationData,
    options: AutonomousHarvestRunOptions = {}
  ): Promise<{ updatedData: NavigationData; report: AutonomousHarvestCycleReport }> {
    const cycleId = `cycle-${Date.now()}`
    const startedAt = Date.now()
    const maxAdditions = options.maxAdditionsPerCycle ?? 15
    const fetchFn = options.fetchImpl || fetch
    const siteOrigin = configuredSiteOrigin()

    this.addLog('info', `[Autonomous Cycle: ${cycleId}] 启动全流程全自动自主采集流水线...`)

    // 复合键 `platform:externalId`，见 lib/video-identity.ts
    const existingIds = new Set<string>()
    currentData.navigationItems.forEach((cat) => {
      ;(cat.items || []).forEach((it) => {
        const key = videoExternalKey(it.videoConfig)
        if (key) existingIds.add(key)
      })
      ;(cat.subCategories || []).forEach((sub) => {
        ;(sub.items || []).forEach((it) => {
          const key = videoExternalKey(it.videoConfig)
          if (key) existingIds.add(key)
        })
      })
    })

    const newCourses: AutonomousHarvestCycleReport['newCourses'] = []
    const categoriesEnriched = new Set<string>()
    let scanned = 0
    let approved = 0
    let rejected = 0

    const updatedCategories = currentData.navigationItems.map((cat) => ({
      ...cat,
      items: [...(cat.items || [])],
      subCategories: (cat.subCategories || []).map((sub) => ({
        ...sub,
        items: [...(sub.items || [])],
      })),
    }))

    // 阶段 1：精选热点选题池自主评估与入库
    for (const topic of CURATED_TRENDING_TOPICS) {
      if (options.forceCategory && topic.domain !== options.forceCategory) continue
      if (newCourses.length >= maxAdditions) break
      scanned++

      this.addLog('ai_thought', `AI 正在扫描候选视频: "${topic.recommendedTitle}" (来自领域: ${topic.domain})`)

      // 入库严标准守卫：精选选题池（CURATED_TRENDING_TOPICS）是人工精选清单，
      // 按严标准走「精选」豁免放行——豁免是显式的（matchedRule: curated），
      // 不是「没数据就默认通过」。清单里的 BV 号本身是真实稿件；
      // 若后续要对精选也验真实播放量，应在这里先调 B 站接口取 stats 再判，
      // 而不是把豁免悄悄扩大到其它来源。
      const curatedVerdict = checkHarvestEligibility({ isCurated: true })
      if (!curatedVerdict.eligible) {
        rejected++
        this.addLog('rejected', `守卫拒绝入库: "${topic.recommendedTitle}"`)
        continue
      }

      // 1. Run AI Evaluation
      const evalResult = evaluateVideoWithAIModel({
        title: topic.recommendedTitle,
        description: `深度探讨 ${topic.keyword}，包含完整的代码实践与技术架构。`,
        durationSec: topic.durationSec,
        author: topic.author,
      })

      if (!evalResult.isApproved) {
        rejected++
        this.addLog('rejected', `AI 拒绝入库: "${topic.recommendedTitle}" - 原因: ${evalResult.rejectReason}`)
        continue
      }

      approved++
      this.addLog(
        'approved',
        `AI 审核通过: "${topic.recommendedTitle}" - 综合教学价值评分: ${evalResult.aiQualityScore}分 (${evalResult.pedagogicalValue})`
      )

      // Check duplicate
      const topicKey = `bilibili:${topic.bvidFallback}`
      if (existingIds.has(topicKey)) {
        this.addLog('info', `跳过已存在视频: ${topic.bvidFallback}`)
        continue
      }

      // 2. 不再合成元数据：模板章节/字幕/测验不是视频原文，不入库。
      this.addLog(
        'ai_thought',
        `已跳过 "${topic.recommendedTitle}" 的合成章节/字幕（模板内容不是原文，不入库）`,
      )

      let targetCat = updatedCategories.find((c) => c.id === topic.domain)
      if (!targetCat) {
        const domainTitleMap: Record<string, string> = {
          cat_ai_engineering: 'AI 与大模型工程',
          cat_fullstack_architecture: '现代全栈与微服务架构',
          cat_devops_cloud: '云原生与 DevOps 实战',
          cat_systems_perf: '系统底层与高性能计算',
          cat_database_bigdata: '现代存储引擎与海量数据架构',
          cat_tools_indie: '开源神器与独立开发出海',
          cat_mobile_multiplatform: '移动端与跨平台全栈开发',
          cat_security_network: '网络安全与攻防工程',
          cat_algorithms_interview: '算法精粹与系统设计',
          cat_game_graphics: '游戏开发与 3D 图形渲染',
          cat_embedded_iot: '嵌入式系统与物联网硬件',
          cat_qa_performance: '软件测试与自动化效能工程',
        }
        const catTitle = domainTitleMap[topic.domain] || 'AI 自动拓展技术分类'
        targetCat = {
          id: topic.domain,
          title: catTitle,
          icon: 'Bot',
          items: [],
          subCategories: [
            {
              id: `sub_${topic.domain}_core`,
              title: `${catTitle}核心精选`,
              parentId: topic.domain,
              enabled: true,
              items: [],
            },
          ],
        }
        updatedCategories.push(targetCat)
      }

      const subItemId = `ai_auto_${topic.bvidFallback}_${Date.now()}`
      const rawSubItem: NavigationSubItem = {
        id: subItemId,
        title: topic.recommendedTitle,
        href: `https://www.bilibili.com/video/${topic.bvidFallback}`,
        description: '',
        enabled: true,
        videoConfig: {
          type: 'bilibili',
          bvid: topic.bvidFallback,
          p: 1,
          author: topic.author,
          durationSec: topic.durationSec,
          ...(topic.publishedAt ? { publishedAt: topic.publishedAt } : {}),
          harvestedAt: Date.now(),
          qualityScore: evalResult.aiQualityScore,
          freshnessScore: calculateFreshnessScore(
            topic.publishedAt,
            evalResult.aiQualityScore,
            90,
            topic.recommendedTitle
          ),
          sourceType: 'auto_trend',
          trendKeyword: topic.keyword,
          pinned: false,
          healthStatus: 'healthy',
        },
      }

      const enrichedItem = enrichVideoItemSeo(rawSubItem, targetCat.title)

      let routedSubTitle: string | undefined = undefined
      if (!options.dryRun) {
        if (targetCat.subCategories && targetCat.subCategories.length > 0) {
          const match = routeVideoToSubcategory(
            {
              title: enrichedItem.title,
              description: enrichedItem.description,
              trendKeyword: topic.keyword,
              tags: enrichedItem.tags,
            },
            targetCat.subCategories
          )
          const targetSub = match.targetSub
          routedSubTitle = targetSub.title
          if (enrichedItem.videoConfig) {
            enrichedItem.videoConfig.subCategoryId = targetSub.id
            enrichedItem.videoConfig.subCategoryTitle = targetSub.title
          }
          if (!targetSub.items) targetSub.items = []
          targetSub.items.unshift(enrichedItem)
          this.addLog(
            'approved',
            `🎯 智能语义分流: 将《${enrichedItem.title}》精准归入子方向「${targetSub.title}」(${match.matchReason})`
          )
        } else {
          targetCat.items.unshift(enrichedItem)
        }
        existingIds.add(topicKey)
      } else if (targetCat.subCategories && targetCat.subCategories.length > 0) {
        const match = routeVideoToSubcategory(
          {
            title: enrichedItem.title,
            description: enrichedItem.description,
            trendKeyword: topic.keyword,
            tags: enrichedItem.tags,
          },
          targetCat.subCategories
        )
        routedSubTitle = match.targetSub.title
      }

      categoriesEnriched.add(targetCat.title)
      newCourses.push({
        title: topic.recommendedTitle,
        categoryTitle: targetCat.title,
        subCategoryTitle: routedSubTitle,
        author: topic.author,
        aiScore: evalResult.aiQualityScore,
        durationSec: topic.durationSec,
        platform: 'bilibili',
        landingUrl: siteOrigin ? `${siteOrigin}/videos/v/${encodeURIComponent(subItemId)}` : undefined,
      })
    }

    // 阶段 2：多平台动态检索与 AI 智能富化扩展（支持 YouTube / Dailymotion / TED）
    if (options.includeMultiPlatform !== false && newCourses.length < maxAdditions) {
      this.addLog('info', '正在执行多平台动态扩展采集 (YouTube / Dailymotion / TED)...')

      for (const cat of updatedCategories) {
        if (options.forceCategory && cat.id !== options.forceCategory) continue
        if (newCourses.length >= maxAdditions) break

        const policy = cat.harvestPolicy
        const kwList = policy?.keywords?.length
          ? policy.keywords.slice(0, 3)
          : [cat.title]
        const platforms = policy?.platforms?.length
          ? policy.platforms.filter((p) => p !== 'bilibili')
          : (['dailymotion', 'ted', 'youtube'] as any)

        for (const kw of kwList) {
          if (newCourses.length >= maxAdditions) break
          try {
            this.addLog(
              'ai_thought',
              `AI 正在多平台检索前沿实战视频: "${kw}" (覆盖平台: ${platforms.join(', ')})`
            )
            const stageFailures: Array<{ keyword: string; reason: string }> = []
            const multiCandidates = await harvestMultiPlatformVideosForKeyword(
              kw,
              {
                platforms,
                minDurationSec: policy?.minDurationSec || 180,
                limitPerKeyword: options.limitPerKeyword || 2,
                failures: stageFailures,
              },
              fetchFn
            )
            // 汇聚点守卫已拦下的候选不会出现在这里；把它们的拒收记进
            // 本周期报告（rejected 计数 + 日志），否则报告会谎称「没扫到」。
            for (const f of stageFailures) {
              if (f.reason.includes(HARVEST_GUARD_REJECT_PREFIX)) {
                scanned++
                rejected++
                this.addLog('rejected', `守卫拒绝入库: ${f.reason}`)
              }
            }

            for (const cand of multiCandidates) {
              if (newCourses.length >= maxAdditions) break
              scanned++
              const candKey = videoExternalKey(cand.videoConfig)
              if (!candKey || existingIds.has(candKey)) continue

              // 入库前复核：汇聚点已按严标准过滤，这里是第二道关——
              // 候选的 stats / pinned / sourceType 任一不满足即拒收，
              // 不许只凭 AI 评分入库（零数据视频的 AI 分也能过 70）。
              const guardVerdict = isHarvestEligibleForItem(cand)
              if (!guardVerdict.eligible) {
                rejected++
                this.addLog(
                  'rejected',
                  `守卫拒绝入库: "${cand.title}" - 原因: ${guardVerdict.rejectReason}`,
                )
                continue
              }

              // 模糊相似度去重：防跨平台同质化教程
              const existingCatTitles = [
                ...(cat.items || []),
                ...(cat.subCategories || []).flatMap(s => s.items || []),
              ].map(it => it.title).filter(Boolean)
              const fuzzy = isFuzzyDuplicateVideo(cand.title, existingCatTitles)
              if (fuzzy.isDuplicate) {
                this.addLog('info', `跳过高度相似视频: "${cand.title}" (与既有课程「${fuzzy.matchedTitle}」相似度 ${(fuzzy.similarity || 0) * 100}%)`)
                continue
              }

              const evalRes = evaluateVideoWithAIModel({
                title: cand.title,
                description: cand.description,
                author: cand.videoConfig?.author,
                durationSec: cand.videoConfig?.durationSec,
                stats: cand.videoConfig?.stats,
              })

              if (!evalRes.isApproved) {
                rejected++
                this.addLog('rejected', `AI 拒绝入库: "${cand.title}" - 原因: ${evalRes.rejectReason}`)
                continue
              }

              approved++
              this.addLog(
                'approved',
                `AI 审核通过: "${cand.title}" (平台: ${cand.videoConfig?.type}) - 综合评分: ${evalRes.aiQualityScore}分 (${evalRes.pedagogicalValue})`
              )

              // 萃取标签与规范化封面
              const { tags, difficulty } = extractTechBadgesAndDifficulty(cand.title, cand.description)
              cand.tags = Array.from(new Set([...(cand.tags || []), ...tags]))
              cand.icon = normalizeVideoCoverUrl(cand.icon, cand.videoConfig?.type)

              const enrichedCand = enrichVideoItemSeo(
                {
                  ...cand,
                  videoConfig: {
                    ...cand.videoConfig!,
                    tags: cand.tags,
                    difficulty,
                    qualityScore: evalRes.aiQualityScore,
                    freshnessScore: calculateFreshnessScore(
                      cand.videoConfig?.publishedAt,
                      evalRes.aiQualityScore,
                      90,
                      cand.title
                    ),
                  },
                },
                cat.title
              )

              let routedSubTitle: string | undefined = undefined
              if (!options.dryRun) {
                if (cat.subCategories && cat.subCategories.length > 0) {
                  const match = routeVideoToSubcategory(
                    {
                      title: enrichedCand.title,
                      description: enrichedCand.description,
                      trendKeyword: kw,
                      tags: enrichedCand.tags,
                    },
                    cat.subCategories
                  )
                  const targetSub = match.targetSub
                  routedSubTitle = targetSub.title
                  if (enrichedCand.videoConfig) {
                    enrichedCand.videoConfig.subCategoryId = targetSub.id
                    enrichedCand.videoConfig.subCategoryTitle = targetSub.title
                  }
                  if (!targetSub.items) targetSub.items = []
                  targetSub.items.unshift(enrichedCand)
                  this.addLog(
                    'approved',
                    `🎯 智能语义分流: 将《${enrichedCand.title}》精准归入子方向「${targetSub.title}」(${match.matchReason})`
                  )
                } else {
                  cat.items.unshift(enrichedCand)
                }
                existingIds.add(candKey)
              } else if (cat.subCategories && cat.subCategories.length > 0) {
                const match = routeVideoToSubcategory(
                  {
                    title: enrichedCand.title,
                    description: enrichedCand.description,
                    trendKeyword: kw,
                    tags: enrichedCand.tags,
                  },
                  cat.subCategories
                )
                routedSubTitle = match.targetSub.title
              }

              categoriesEnriched.add(cat.title)
              newCourses.push({
                title: cand.title,
                categoryTitle: cat.title,
                subCategoryTitle: routedSubTitle,
                author: cand.videoConfig?.author || '技术创作者',
                aiScore: evalRes.aiQualityScore,
                durationSec: cand.videoConfig?.durationSec || 600,
                platform: cand.videoConfig?.type,
                landingUrl: siteOrigin ? `${siteOrigin}/videos/v/${encodeURIComponent(cand.id)}` : undefined,
              })
            }
          } catch (err) {
            this.addLog(
              'info',
              `多平台检索关键词 "${kw}" 异常: ${err instanceof Error ? err.message : '网络故障'}`
            )
          }
        }
      }
    }

    // 阶段 3：全自动 IndexNow 搜索引擎主动提交通道
    let indexNowSubmitted = 0
    if (!options.dryRun && options.autoSubmitIndexNow !== false && newCourses.length > 0 && siteOrigin) {
      try {
        const landingUrls: string[] = [`${siteOrigin}/videos/sitemap.xml`]
        for (const course of newCourses) {
          if (course.landingUrl) landingUrls.push(course.landingUrl)
        }
        const pingRes = await submitUrlsToIndexNow(landingUrls, {
          siteOrigin,
          fetchImpl: fetchFn,
        })
        indexNowSubmitted = pingRes.submitted
        if (pingRes.ok) {
          this.addLog(
            'success',
            `[SEO IndexNow] 成功向搜索引擎主动提交 ${indexNowSubmitted} 个新收录视频落地页 (Bing / Yandex)`
          )
        } else if (pingRes.error) {
          this.addLog('info', `[SEO IndexNow] 提示: ${pingRes.error}`)
        }
      } catch (err) {
        this.addLog('info', `[SEO IndexNow] 提交网络异常: ${err instanceof Error ? err.message : '失败'}`)
      }
    }

    const report: AutonomousHarvestCycleReport = {
      cycleId,
      startedAt,
      completedAt: Date.now(),
      scannedCandidatesCount: scanned,
      aiApprovedCount: approved,
      aiRejectedCount: rejected,
      categoriesEnriched: Array.from(categoriesEnriched),
      indexNowSubmitted,
      logs: this.getLogs(),
      newCourses,
    }

    this.addLog('success', `[Autonomous Cycle: ${cycleId}] 自主采集巡航圆满完成！新增入库 ${newCourses.length} 部优质课程`)

    return {
      updatedData: {
        ...currentData,
        navigationItems: updatedCategories,
      },
      report,
    }
  }
}

/**
 * 进程内共享的控制器。
 *
 * 每次 POST 都 `new AutonomousAIHarvesterController()` 会让 `logs` 每个周期从零开始，
 * 管理端的「AI 思考过程」因此永远只显示当前这一轮。改为模块级单例后至少在同一进程内
 * 能连续观察；多副本部署下仍然各看各的（真正的共享需要落库，属 C1/C6 的范围）。
 */
let sharedController: AutonomousAIHarvesterController | null = null

export function getAutonomousHarvesterController(): AutonomousAIHarvesterController {
  if (!sharedController) sharedController = new AutonomousAIHarvesterController()
  return sharedController
}
