/**
 * Autonomous AI Video Harvester & Intelligent Content Enrichment Pipeline
 * Performs unattended continuous harvesting powered by AI models for evaluation, sanitization,
 * chapter synthesis, and curriculum knowledge injection.
 */

import type {
  NavigationData,
  NavigationItem,
  NavigationSubItem,
  VideoChapter,
  VideoTranscriptItem,
  VideoStats,
} from '@/types/navigation'
import type { VideoQuizQuestion } from '@/lib/video-quiz-generator'
import { CURATED_TRENDING_TOPICS, type TrendingTechTopic } from '@/lib/video-trending-harvester'
import { calculateFreshnessScore } from '@/lib/video-scoring'
import { syntheticMetadataEnabled } from '@/lib/video-metadata-policy'
import { videoExternalKey } from '@/lib/video-identity'
import { enrichVideoItemSeo, submitUrlsToIndexNow } from '@/lib/video-seo'
import { harvestMultiPlatformVideosForKeyword } from '@/lib/video-multi-platform-harvester'
import { configuredSiteOrigin } from '@/lib/seo/origin'

export interface AIEvaluationResult {
  aiQualityScore: number // 0 - 100
  isApproved: boolean
  rejectReason?: string
  techDepth: 'beginner' | 'intermediate' | 'advanced' | 'architect'
  conceptTags: string[]
  detectedClickbait: boolean
  pedagogicalValue: string
}

export interface AISanitizedCourse {
  cleanTitle: string
  cleanDescription: string
  overview: string
  chapters: VideoChapter[]
  transcripts: VideoTranscriptItem[]
  quizzes: VideoQuizQuestion[]
  prerequisites: string[]
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

  // 4. Calculate AI pedagogical score based on stats and depth
  const views = stats.views || 10000
  const likes = stats.likes || 500
  const coins = stats.coins || 200
  const favorites = stats.favorites || 1000

  // High coin/like ratio indicates high practical educational takeaway (干货比)
  const coinToLikeRatio = likes > 0 ? coins / likes : 0.2
  const favToViewRatio = views > 0 ? favorites / views : 0.05

  let baseScore = 75
  if (matchedTags.length >= 3) baseScore += 10
  if (duration >= 900) baseScore += 8 // > 15 mins
  if (coinToLikeRatio >= 0.3) baseScore += 5
  if (favToViewRatio >= 0.08) baseScore += 5
  // 标题党惩罚必须大于「多命中 1 个关键词」的加分(+10)，否则「震惊体 + 堆关键词」
  // 反而比正常标题得分更高 —— 实测 95 分 > 93 分，评分方向是反的。
  if (hasClickbait) baseScore -= 15

  const finalScore = Math.max(10, Math.min(99, Math.round(baseScore)))

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
 * AI Model content synthesis function: cleans title, structures chapters,
 * extracts transcripts and generates self-assessment quiz questions.
 */
export function generateAISanitizedMetadata(
  rawTitle: string,
  rawDesc: string = '',
  durationSec: number = 1800,
  conceptTags: string[] = ['架构']
): AISanitizedCourse {
  // 1. Sanitize title: strip brackets and sensational marketing words
  let cleanTitle = rawTitle
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/震惊|必看|绝了|逆天|全网最强/g, '')
    .replace(/[!！?？]+/g, '')
    .trim()

  if (cleanTitle.length < 5) cleanTitle = rawTitle.slice(0, 30)

  // 2. Synthesize AI Overview
  const tagList = conceptTags.join('、')
  const overview = `由 AI 大模型深度提炼：本课程围绕 ${tagList} 展开，系统解构核心架构设计与工程化演进路径，提供完备的代码里程碑与实操避坑指引。`

  // 3. Synthesize 4 structured chapters aligned with total duration
  const chDuration = Math.floor(durationSec / 4)
  const chapters: VideoChapter[] = [
    {
      id: 'ai-ch-1',
      title: `${conceptTags[0] || '核心技术'}：背景与架构原理深潜`,
      startTime: 0,
      duration: chDuration,
      summary: '梳理底层技术演进脉络与关键设计决策。',
      codeSnippet: `// 阶段 1: 核心初始化\nconsole.log("Initializing ${conceptTags[0] || 'System'} Runtime...");`,
      codeLanguage: 'typescript',
    },
    {
      id: 'ai-ch-2',
      title: '生产级核心功能搭建与状态模型',
      startTime: chDuration,
      duration: chDuration,
      summary: '手把手编码实现高内聚低耦合的核心模块。',
      codeSnippet: `// 阶段 2: 状态机分层模型\nexport function setupPipeline() {\n  return { status: "active", latencyMs: 12 };\n}`,
      codeLanguage: 'typescript',
    },
    {
      id: 'ai-ch-3',
      title: '性能调优、边界异常保护与高可用压测',
      startTime: chDuration * 2,
      duration: chDuration,
      summary: '深入并发瓶颈、内存分配与零拷贝优化。',
      codeSnippet: `// 阶段 3: 并发与异常处理\nif (ratio > 0.95) {\n  triggerFailover();\n}`,
      codeLanguage: 'typescript',
    },
    {
      id: 'ai-ch-4',
      title: '生产环境发布交付与 CI/CD 自动化',
      startTime: chDuration * 3,
      duration: durationSec - (chDuration * 3),
      summary: '完成容器化打包、自动化流水线部署与指标监控。',
      codeSnippet: `// 阶段 4: 监控告警闭环\nemitTelemetryMetric("health_status", 100);`,
      codeLanguage: 'typescript',
    },
  ]

  // 4. Synthesize AI transcripts
  const transcripts: VideoTranscriptItem[] = [
    { id: 'ai-t-1', startSec: 0, endSec: 30, text: `大家好，欢迎学习由 AI 知识引擎收录的 ${cleanTitle} 实战课。` },
    { id: 'ai-t-2', startSec: chDuration, endSec: chDuration + 40, text: `下面我们进入第二阶段，重点实现 ${tagList} 的工程化落地。` },
    { id: 'ai-t-3', startSec: chDuration * 2, endSec: chDuration * 2 + 40, text: '高并发场景下的性能瓶颈调优至关重要，需要严格防范雪崩。' },
    { id: 'ai-t-4', startSec: chDuration * 3, endSec: chDuration * 3 + 30, text: '最后我们结合自动化 CI/CD 流水线完成整体上线。' },
  ]

  // 5. Synthesize 3 automated checkpoint quiz questions
  const quizzes: VideoQuizQuestion[] = [
    {
      id: 'ai-q-1',
      timestamp: Math.floor(chDuration * 0.8),
      question: `在 ${conceptTags[0] || '系统'} 的生产实践中，核心设计原则是什么？`,
      options: ['高内聚低耦合与分层解耦', '所有逻辑写在单一文件', '忽略异常错误处理', '硬编码所有配置参数'],
      correctIndex: 0,
      correctAnswerIndex: 0,
      explanation: '软件工程的核心目标是可维护性与模块解耦，高内聚低耦合是生产架构的基石。',
    },
    {
      id: 'ai-q-2',
      timestamp: Math.floor(chDuration * 2.2),
      question: '当系统遭遇突发高并发流量时，以下哪种措施最能保障服务存活？',
      options: ['直接关闭服务器', '令牌桶限流与优雅降级熔断', '无限增加线程数量', '忽略超时等待'],
      correctIndex: 1,
      correctAnswerIndex: 1,
      explanation: '令牌桶限流与熔断降级能够防止雪崩效应，保护后端核心服务不被打垮。',
    },
    {
      id: 'ai-q-3',
      timestamp: Math.floor(chDuration * 3.5),
      question: '关于现代化 CI/CD 自动化发布，以下哪项属于最佳实践？',
      options: ['人工通过 FTP 传文件覆盖生产', '流水线包含自动化静态分析、单元测试与渐进灰度', '跳过所有测试直接推主干', '关闭所有生产日志监控'],
      correctIndex: 1,
      correctAnswerIndex: 1,
      explanation: '现代 DevOps 强调自动化门禁卡点与渐进式灰度发布，确保零事故交付。',
    },
  ]

  return {
    cleanTitle,
    cleanDescription: rawDesc.slice(0, 200) || overview,
    overview,
    chapters,
    transcripts,
    quizzes,
    prerequisites: conceptTags.map(t => `${t} 基础与开发规范`),
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

      // 2. Run AI Metadata Synthesis
      const synthetic = syntheticMetadataEnabled()
      const meta = generateAISanitizedMetadata(
        topic.recommendedTitle,
        `系统化讲解 ${topic.keyword}。`,
        topic.durationSec,
        evalResult.conceptTags
      )

      this.addLog(
        'ai_thought',
        synthetic
          ? `已为 "${meta.cleanTitle}" 生成 ${meta.chapters.length} 个示例章节、${meta.transcripts.length} 条示例字幕与 ${meta.quizzes.length} 道课后测验（synthetic=true，UI 需标注）`
          : `已跳过 "${meta.cleanTitle}" 的合成章节/字幕（NAVHUB_VIDEO_SYNTHETIC_METADATA 未开启）`,
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
        title: meta.cleanTitle,
        href: `https://www.bilibili.com/video/${topic.bvidFallback}`,
        description: synthetic ? meta.overview : '',
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
          ...(synthetic
            ? { chapters: meta.chapters, transcript: meta.transcripts, synthetic: true }
            : {}),
        },
      }

      const enrichedItem = enrichVideoItemSeo(rawSubItem, targetCat.title)

      if (!options.dryRun) {
        if (targetCat.subCategories && targetCat.subCategories.length > 0) {
          targetCat.subCategories[0].items.push(enrichedItem)
        } else {
          targetCat.items.push(enrichedItem)
        }
        existingIds.add(topicKey)
      }

      categoriesEnriched.add(targetCat.title)
      newCourses.push({
        title: meta.cleanTitle,
        categoryTitle: targetCat.title,
        author: topic.author,
        aiScore: evalResult.aiQualityScore,
        durationSec: topic.durationSec,
        platform: 'bilibili',
        landingUrl: siteOrigin ? `${siteOrigin}/videos/v/${encodeURIComponent(subItemId)}` : undefined,
      })
    }

    // 阶段 2：多平台动态检索与 AI 智能富化扩展（支持 YouTube / Dailymotion / PeerTube / TED）
    if (options.includeMultiPlatform !== false && newCourses.length < maxAdditions) {
      this.addLog('info', '正在执行多平台动态扩展采集 (YouTube / Dailymotion / PeerTube / TED)...')

      for (const cat of updatedCategories) {
        if (options.forceCategory && cat.id !== options.forceCategory) continue
        if (newCourses.length >= maxAdditions) break

        const policy = cat.harvestPolicy
        const kwList = policy?.keywords?.length
          ? policy.keywords.slice(0, 3)
          : [cat.title]
        const platforms = policy?.platforms?.length
          ? policy.platforms.filter((p) => p !== 'bilibili')
          : (['dailymotion', 'peertube', 'ted', 'youtube'] as any)

        for (const kw of kwList) {
          if (newCourses.length >= maxAdditions) break
          try {
            this.addLog(
              'ai_thought',
              `AI 正在多平台检索前沿实战视频: "${kw}" (覆盖平台: ${platforms.join(', ')})`
            )
            const multiCandidates = await harvestMultiPlatformVideosForKeyword(
              kw,
              {
                platforms,
                minDurationSec: policy?.minDurationSec || 180,
                minQualityScore: policy?.minQualityScore || 60,
                limitPerKeyword: options.limitPerKeyword || 2,
              },
              fetchFn
            )

            for (const cand of multiCandidates) {
              if (newCourses.length >= maxAdditions) break
              scanned++
              const candKey = videoExternalKey(cand.videoConfig)
              if (!candKey || existingIds.has(candKey)) continue

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

              const enrichedCand = enrichVideoItemSeo(
                {
                  ...cand,
                  videoConfig: {
                    ...cand.videoConfig!,
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

              if (!options.dryRun) {
                if (cat.subCategories && cat.subCategories.length > 0) {
                  cat.subCategories[0].items.push(enrichedCand)
                } else {
                  cat.items.push(enrichedCand)
                }
                existingIds.add(candKey)
              }

              categoriesEnriched.add(cat.title)
              newCourses.push({
                title: cand.title,
                categoryTitle: cat.title,
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
