/**
 * Automated Trending Video Harvester & Content Enrichment Engine
 * Discovers, filters, scores, and injects hot tech tutorials into video catalogs.
 */

import type { NavigationData, NavigationItem, NavigationSubItem, VideoChapter, VideoTranscriptItem } from '@/types/navigation'
import { calculateFreshnessScore } from '@/lib/video-scoring'
import { videoExternalKey } from '@/lib/video-identity'

export interface TrendingTechTopic {
  domain: string
  keyword: string
  hotIndex: number
  recommendedTitle: string
  bvidFallback: string
  author: string
  durationSec: number
  chapters: VideoChapter[]
  transcripts: VideoTranscriptItem[]
  /**
   * 真实发布时间（ISO 字符串）。
   *
   * 没有这一项就**不要**入库时写 `new Date()`：历史实现把 2021 年的课程标成「今天发布」
   * 并写死 `freshnessScore: 98`，直接绕过整个保鲜衰减模型（`worstScore < 45` 永不成立，
   * 「过时内容轮换」因此不可能触发）。留空表示「未知」，按不确定处理。
   */
  publishedAt?: string
}

export interface TrendingHarvestResult {
  timestamp: number
  harvestedCount: number
  categoriesEnriched: string[]
  topDiscoveredVideos: Array<{
    title: string
    category: string
    author: string
    hotIndex: number
    durationSec: number
  }>
}

export const CURATED_TRENDING_TOPICS: TrendingTechTopic[] = [
  {
    domain: 'cat_ai_engineering',
    keyword: '李宏毅机器学习与大模型前沿',
    hotIndex: 98,
    recommendedTitle: '李宏毅 2021/2022 机器学习与深度学习前沿：从 Transformer 到大模型原理实战',
    bvidFallback: 'BV1Wv411h7kN',
    author: '啥都会一点的研究生',
    durationSec: 314062,
    chapters: [
      { id: 'c1', title: '机器学习概述与回归/分类基本概念', startTime: 0, duration: 3600 },
      { id: 'c2', title: '自注意力机制 (Self-Attention) 与 Transformer 架构', startTime: 3600, duration: 4200 },
      { id: 'c3', title: '生成对抗网络 GAN 与扩散模型 Diffusion', startTime: 7800, duration: 3800 },
      { id: 'c4', title: '大语言模型预训练、对齐与人类反馈强化学习 (RLHF)', startTime: 11600, duration: 4500 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 60, text: '欢迎大家来到李宏毅老师的机器学习课程。' },
      { id: 't2', startSec: 3600, endSec: 3700, text: 'Self-attention 的核心在于让序列中每一个 token 能够动态感知全局上下文。' },
      { id: 't3', startSec: 7800, endSec: 7900, text: '生成式 AI 正在深刻改变自然语言处理与多模态创作。' },
    ],
  },
  {
    domain: 'cat_ai_engineering',
    keyword: '吴恩达机器学习经典课程',
    hotIndex: 96,
    recommendedTitle: '吴恩达机器学习经典全套：从监督学习算法到神经网络与工程诊断',
    bvidFallback: 'BV164411b7dx',
    author: '岁月觞',
    durationSec: 69864,
    chapters: [
      { id: 'c1', title: '线性回归、梯度下降与代价函数求解', startTime: 0, duration: 1800 },
      { id: 'c2', title: '逻辑回归、正则化与过拟合预防策略', startTime: 1800, duration: 2400 },
      { id: 'c3', title: '神经网络前向传播与反向传播算法推导', startTime: 4200, duration: 3200 },
      { id: 'c4', title: '机器学习系统设计与学习曲线诊断技巧', startTime: 7400, duration: 2800 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 50, text: '欢迎学习吴恩达教授经典的机器学习课程。' },
      { id: 't2', startSec: 1800, endSec: 1900, text: '梯度下降法是优化代价函数、更新权重参数的基石。' },
    ],
  },
  {
    domain: 'cat_fullstack_architecture',
    keyword: 'SpringBoot3 与 Vue3 企业级全栈实战',
    hotIndex: 97,
    recommendedTitle: '黑马程序员 SpringBoot3 + Vue3 全套视频教程：企业级全栈开发实战',
    bvidFallback: 'BV14z4y1N7pg',
    author: '黑马程序员',
    durationSec: 87120,
    chapters: [
      { id: 'c1', title: 'SpringBoot3 基础架构与工程搭建', startTime: 0, duration: 3600 },
      { id: 'c2', title: 'MyBatis-Plus 数据持久化与分页查询', startTime: 3600, duration: 4200 },
      { id: 'c3', title: 'JWT 鉴权认证与 Redis 分布式会话缓存', startTime: 7800, duration: 3600 },
      { id: 'c4', title: 'Vue3 + Pinia + Element-Plus 前端工程化对接', startTime: 11400, duration: 4800 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 60, text: '本课程从企业实际应用为切入点，系统讲授 SpringBoot3 与 Vue3 前后端分离全栈架构。' },
      { id: 't2', startSec: 7800, endSec: 7900, text: '通过 JWT 拦截器实现无状态接口鉴权与多角色权限校验。' },
    ],
  },
  {
    domain: 'cat_fullstack_architecture',
    keyword: 'JavaScript 现代前端核心与 DOM/BOM/ES6',
    hotIndex: 95,
    recommendedTitle: 'JavaScript 前端全套课程：DOM / BOM / ES6 新语法 / 数据可视化与异步编程实战',
    bvidFallback: 'BV1Sy4y1C7ha',
    author: '黑马pink讲前端',
    durationSec: 188921,
    chapters: [
      { id: 'c1', title: 'JavaScript 基础语法与核心数据结构', startTime: 0, duration: 3600 },
      { id: 'c2', title: 'Web API：DOM 元素操作与事件高级冒泡委托', startTime: 3600, duration: 4800 },
      { id: 'c3', title: 'BOM 对象模型与本地离线持久化', startTime: 8400, duration: 3200 },
      { id: 'c4', title: 'ES6+ 进阶：Promise、Async/Await 与模块化', startTime: 11600, duration: 4200 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 50, text: '欢迎来到 JavaScript 现代前端全栈筑基大课。' },
      { id: 't2', startSec: 11600, endSec: 11700, text: '掌握 Promise 与异步编程机制是进入现代框架开发的必经之路。' },
    ],
  },
  {
    domain: 'cat_devops_cloud',
    keyword: 'RabbitMQ 消息队列与分布式集群',
    hotIndex: 96,
    recommendedTitle: 'RabbitMQ 高可用消息队列：从延迟队列、死信队列到分布式集群运维',
    bvidFallback: 'BV1cb4y1o7zz',
    author: '尚硅谷',
    durationSec: 41829,
    chapters: [
      { id: 'c1', title: '消息中间件核心概念与 AMQP 协议模型', startTime: 0, duration: 2400 },
      { id: 'c2', title: 'Work 队列、交换机模式与死信队列机制', startTime: 2400, duration: 3600 },
      { id: 'c3', title: '延迟队列与分布式消息确认机制 (ACK)', startTime: 6000, duration: 3000 },
      { id: 'c4', title: '镜像集群搭建、高可用负载均衡与运维监控', startTime: 9000, duration: 3200 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 45, text: '消息中间件是分布式系统解耦、异步通信和流量削峰的核心基础设施。' },
      { id: 't2', startSec: 6000, endSec: 6080, text: '死信队列配合 TTL 可以优雅实现超时取消、延迟通知等高可用业务流。' },
    ],
  },
  {
    domain: 'cat_systems_perf',
    keyword: 'C++ 现代系统编程与面向对象核心',
    hotIndex: 97,
    recommendedTitle: '黑马程序员 C++ 教程从 0 到 1：系统编程、内存模型、STL 泛化与多态实战',
    bvidFallback: 'BV1et411b73Z',
    author: '黑马程序员',
    durationSec: 188972,
    chapters: [
      { id: 'c1', title: 'C++ 基础语法、指针与引用内存剖析', startTime: 0, duration: 4800 },
      { id: 'c2', title: '面向对象三大特性：封装、继承与多态机制', startTime: 4800, duration: 6000 },
      { id: 'c3', title: '深拷贝与浅拷贝、运算符重载与文件操作', startTime: 10800, duration: 4200 },
      { id: 'c4', title: 'STL 泛型编程：常用容器、算法与迭代器深度实战', startTime: 15000, duration: 7200 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 50, text: 'C++ 是一门高性能且直接操控底层硬件的硬核语言。' },
      { id: 't2', startSec: 4800, endSec: 4900, text: '虚函数表指针 vptr 是 C++ 运行时实现动态多态的底层基石。' },
    ],
  },
  {
    domain: 'cat_tools_indie',
    keyword: 'Git 版本控制与多人协作流程',
    hotIndex: 95,
    recommendedTitle: '【狂神说】Git 进阶与项目版本控制：分支策略、冲突解决与 GitHub/Gitee 协同工作流',
    bvidFallback: 'BV1FE411P7B3',
    author: '遇见狂神说',
    durationSec: 6570,
    chapters: [
      { id: 'c1', title: '版本控制体系演进与 Git 核心架构', startTime: 0, duration: 900 },
      { id: 'c2', title: '本地暂存区、工作区与提交历史探秘', startTime: 900, duration: 1500 },
      { id: 'c3', title: '分支管理、合并合并与冲突解决实战', startTime: 2400, duration: 1800 },
      { id: 'c4', title: '远程仓库推送、Pull Request 与团队工作流', startTime: 4200, duration: 2370 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 40, text: 'Git 是每一位现代开发者必须掌握的核心生产力工具。' },
      { id: 't2', startSec: 2400, endSec: 2480, text: '理解 HEAD 指针与分支游标的移动，就能轻松解决任何合并冲突。' },
    ],
  },
  {
    domain: 'cat_fullstack_architecture',
    keyword: 'React 19 Actions 与 Turbopack 深度实战',
    hotIndex: 95,
    recommendedTitle: 'React 19 核心特性与架构升级：从 useTransition 到 Server Actions 全面实战',
    bvidFallback: 'BV1MmUSB5Efw',
    author: 'Web全栈大师',
    durationSec: 2420,
    chapters: [
      { id: 'c1', title: 'React 19 编译器架构与自动 Memoization 机制', startTime: 0, duration: 540 },
      { id: 'c2', title: 'useActionState 与 useOptimistic 乐观更新优雅实践', startTime: 540, duration: 680 },
      { id: 'c3', title: 'Server Components 与 Client Boundaries 分层解耦', startTime: 1220, duration: 620 },
      { id: 'c4', title: '生产级 Turbopack 构建流与缓存调优', startTime: 1840, duration: 580 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 45, text: 'React 19 带来了近年来最令人兴奋的重构。' },
      { id: 't2', startSec: 45, endSec: 120, text: '我们不再需要繁琐的 useMemo 和 useCallback，编译器会自动推断。' },
      { id: 't3', startSec: 540, endSec: 620, text: '通过 useActionState，我们可以轻松绑定表单提交与加载态。' },
      { id: 't4', startSec: 1220, endSec: 1300, text: '服务端组件让网络传输包体减少高达 60%。' },
    ],
  },
  {
    domain: 'cat_devops_cloud',
    keyword: 'Kubernetes eBPF 网络可观测性',
    hotIndex: 92,
    recommendedTitle: '基于 Cilium 与 eBPF 的 K8s 高性能服务网格与零信任微服务网络',
    bvidFallback: 'BV1og4y1q7M4',
    author: '云原生实战派',
    durationSec: 2850,
    chapters: [
      { id: 'c1', title: 'Linux 内核 eBPF 技术原理与内核态网络挂钩', startTime: 0, duration: 600 },
      { id: 'c2', title: '部署 Cilium 替代传统 kube-proxy iptables', startTime: 600, duration: 750 },
      { id: 'c3', title: 'Hubble 流量拓扑可视化与网络安全策略', startTime: 1350, duration: 800 },
      { id: 'c4', title: '高并发低延迟吞吐压测与故障排查', startTime: 2150, duration: 700 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 40, text: 'eBPF 彻底重塑了云原生基础设施的可观测性与网络性能。' },
      { id: 't2', startSec: 600, endSec: 680, text: 'Cilium 直接绕过 iptables 的线性扫描，实现 O(1) 路由寻址。' },
      { id: 't3', startSec: 1350, endSec: 1420, text: 'Hubble 让集群微服务间每一次 TCP 连接和 DNS 解析都一目了然。' },
    ],
  },
  {
    domain: 'cat_systems_perf',
    keyword: 'Rust 系统编程与高性能微服务',
    hotIndex: 96,
    recommendedTitle: 'Rust 2024 高性能异步系统编程：从 Tokio 运行时到无锁并发核心算法',
    bvidFallback: 'BV1pM411i7a1',
    author: '硬核系统工坊',
    durationSec: 3100,
    chapters: [
      { id: 'c1', title: '所有权机制、生命周期标注与内存零成本抽象', startTime: 0, duration: 720 },
      { id: 'c2', title: 'Tokio 异步任务调度与 Epoll 事件循环实现', startTime: 720, duration: 880 },
      { id: 'c3', title: '无锁环形队列 (Lock-free RingBuffer) 实战', startTime: 1600, duration: 800 },
      { id: 'c4', title: '微服务网关压测：Rust 对决 Go/Node.js', startTime: 2400, duration: 700 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 50, text: '欢迎探索 Rust 系统级工程之美。' },
      { id: 't2', startSec: 720, endSec: 800, text: 'Tokio 借助工作窃取调度器，能在极少线程开销下驱动百万级连接。' },
      { id: 't3', startSec: 1600, endSec: 1700, text: '无锁环形队列通过原子操作 CAS 消除上下文锁争用。' },
    ],
  },
  {
    domain: 'cat_tools_indie',
    keyword: '独立开发出海与 AI 应用变现',
    hotIndex: 94,
    recommendedTitle: '独立开发者出海 2025 全攻略：AI 原生微 SaaS 产品设计、Stripe 支付与全球冷启动',
    bvidFallback: 'BV1ADzkBoEDS',
    author: '出海创客营',
    durationSec: 2150,
    chapters: [
      { id: 'c1', title: '海外 AI 微 SaaS 市场机会与痛点挖掘方法论', startTime: 0, duration: 480 },
      { id: 'c2', title: '极简技术栈构建：Next.js + Supabase + Stripe 订阅', startTime: 480, duration: 620 },
      { id: 'c3', title: 'ProductHunt 登顶技巧与社交媒体病毒式传播', startTime: 1100, duration: 550 },
      { id: 'c4', title: '首月 MRR 破 $3,000 的转化率与留存优化复盘', startTime: 1650, duration: 500 },
    ],
    transcripts: [
      { id: 't1', startSec: 0, endSec: 40, text: '这是献给所有渴望用代码创造自由的独立开发者的完整实战课。' },
      { id: 't2', startSec: 480, endSec: 560, text: '选择现代全栈框架能够让你在 48 小时内完成 MVP 并上线测试。' },
      { id: 't3', startSec: 1100, endSec: 1180, text: 'ProductHunt 发射当天的素材设计与时区排期至关重要。' },
    ],
  },
]

/**
 * Executes trending harvest and automatically injects discovered trending tech courses.
 */
export function harvestTrendingVideos(
  currentData: NavigationData,
  options: { maxItemsPerCategory?: number; minHotIndex?: number } = {}
): { updatedData: NavigationData; result: TrendingHarvestResult } {
  const maxItems = options.maxItemsPerCategory || 8
  const minHot = options.minHotIndex || 80

  const categories = [...currentData.navigationItems]
  const existingKeys = new Set<string>()

  // Collect existing video IDs（复合键 platform:externalId）
  categories.forEach(cat => {
    ;(cat.items || []).forEach(it => {
      const key = videoExternalKey(it.videoConfig)
      if (key) existingKeys.add(key)
    })
  })

  // Ensure 'cat_systems_perf' exists if missing
  let sysCat = categories.find(c => c.id === 'cat_systems_perf')
  if (!sysCat) {
    sysCat = {
      id: 'cat_systems_perf',
      title: '系统底层与高性能计算',
      icon: 'Cpu',
      description: 'Rust 系统编程、Go 高并发微服务、WebGPU 硬件加速与网络内核调优',
      enabled: true,
      items: [],
      subCategories: [],
    }
    categories.push(sysCat)
  }

  const enrichedCategories = new Set<string>()
  const discovered: TrendingHarvestResult['topDiscoveredVideos'] = []
  let harvestedCount = 0

  for (const topic of CURATED_TRENDING_TOPICS) {
    if (topic.hotIndex < minHot) continue

    const targetCategory = categories.find(c => c.id === topic.domain)
    if (!targetCategory) continue
    if (!targetCategory.items) targetCategory.items = []

    // Skip if already in category or max capacity reached（候选池固定为 B 站）
    const topicKey = `bilibili:${topic.bvidFallback}`
    if (existingKeys.has(topicKey)) continue
    if (targetCategory.items.length >= maxItems) continue

    // 质量分来自候选池的人工评估分；保鲜分由**真实**发布时间推导。
    // 没有发布时间就按「未知」算（calculateFreshnessScore 的 undefined 分支），
    // 不再写死 98 假装刚发布。
    const qualityScore = Math.min(99, topic.hotIndex + 2)
    const freshnessScore = calculateFreshnessScore(topic.publishedAt, qualityScore, 90, topic.recommendedTitle)

    const newItem: NavigationSubItem = {
      id: `harvest_${topic.bvidFallback}_${Date.now()}`,
      title: topic.recommendedTitle,
      href: `https://www.bilibili.com/video/${topic.bvidFallback}`,
      description: `【热点精选】深度涵盖 ${topic.keyword}。系统梳理工程架构，提供完整章节大纲与源码演练。`,
      // 不写封面：候选池没有真实封面来源，留空后前端走平台占位
      enabled: true,
      videoConfig: {
        type: 'bilibili',
        bvid: topic.bvidFallback,
        p: 1,
        author: topic.author,
        durationSec: topic.durationSec,
        ...(topic.publishedAt ? { publishedAt: topic.publishedAt } : {}),
        harvestedAt: Date.now(),
        qualityScore,
        freshnessScore,
        sourceType: 'auto_trend',
        trendKeyword: topic.keyword,
        pinned: false,
        healthStatus: 'healthy',
        chapters: topic.chapters,
        transcript: topic.transcripts,
        // stats 不再编造：历史实现用 `125000 + Math.random() * 80000` 生成播放量，
        // 这些假数字会进入 calculateQualityScore 的 log10(views) 与收藏率，
        // 让「质量分」变成随机数的函数。没有真实来源就留空，UI 走「无统计」分支。
      },
    }

    targetCategory.items.push(newItem)
    existingKeys.add(topicKey)
    enrichedCategories.add(targetCategory.title)
    harvestedCount++

    discovered.push({
      title: topic.recommendedTitle,
      category: targetCategory.title,
      author: topic.author,
      hotIndex: topic.hotIndex,
      durationSec: topic.durationSec,
    })
  }

  const result: TrendingHarvestResult = {
    timestamp: Date.now(),
    harvestedCount,
    categoriesEnriched: Array.from(enrichedCategories),
    topDiscoveredVideos: discovered,
  }

  return {
    updatedData: {
      ...currentData,
      navigationItems: categories,
    },
    result,
  }
}
