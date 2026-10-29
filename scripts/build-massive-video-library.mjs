/**
 * 6 大专业技术分类专属批量热点采集与库容量构建引擎 (纯 JavaScript)
 * 针对每个分类精准执行多关键词深层抓取，保证每类达到 500 部左右的高水准真实视频，
 * 建立 3000 部优质技术视频智库。
 */

import fs from 'node:fs'
import path from 'node:path'

const CATEGORIES = [
  {
    id: 'cat_ai_engineering',
    title: 'AI 与大模型工程',
    icon: 'Bot',
    description: '涵盖 DeepSeek 本地部署、Cursor 智能全栈开发、MCP 协议、多智能体 Agent 及 LLM 架构精讲',
    keywords: [
      'DeepSeek 本地部署',
      'Cursor 教程',
      'MCP 协议 Anthropic',
      'AI Agent 开发',
      'LangChain RAG 实战',
      'PyTorch 深度学习',
      'Transformer 原理',
      '大模型微调 LLaMA',
      'Claude 提示词工程',
      'Ollama 本地运行大模型',
      'vLLM 高并发推理',
      'Stable Diffusion 实战',
      '知识库 RAG 向量检索',
      '强化学习 RLHF',
      '李宏毅 机器学习'
    ],
    maxItems: 520,
    targetCount: 500
  },
  {
    id: 'cat_fullstack_architecture',
    title: '现代全栈与微服务架构',
    icon: 'Layers',
    description: '深入 Next.js 15 全栈、React 19 核心架构、TypeScript 工程化、SpringBoot 3 微服务与 Vue 3 生态',
    keywords: [
      'Next.js 全栈实战',
      'React 19 特性教程',
      'TypeScript 进阶实战',
      'SpringBoot3 Vue3 实战',
      'NestJS 架构',
      'Vue3 Pinia 全家桶',
      '微服务架构 SpringCloud',
      'TailwindCSS 实战',
      '前端工程化 Vite Webpack',
      'Node.js 后端开发',
      'GraphQL 全栈实战',
      'FastAPI 后端开发',
      '分布式事务与高并发',
      '前端性能优化 实战',
      '全栈开发 项目实战'
    ],
    maxItems: 520,
    targetCount: 500
  },
  {
    id: 'cat_devops_cloud',
    title: '云原生与 DevOps 实战',
    icon: 'Terminal',
    description: '系统掌握 Kubernetes 容器编排、Docker 生产实践、eBPF 网络可观测性与 CI/CD 自动化交付',
    keywords: [
      'Kubernetes K8s 实战教程',
      'Docker 入门到精通',
      'eBPF 网络可观测',
      'CI/CD 自动化流水线',
      'Cilium 服务网格',
      'Prometheus 监控告警 Grafana',
      'Terraform 自动化运维',
      'Linux 运维与 Shell 脚本',
      'Nginx 高性能配置',
      'Ansible 自动化运维',
      'Istio 服务网格 实战',
      '云原生 DevOps',
      'GitHub Actions 自动化',
      '微服务网关 APISIX Kong',
      'Linux 性能调优'
    ],
    maxItems: 520,
    targetCount: 500
  },
  {
    id: 'cat_systems_perf',
    title: '系统底层与高性能计算',
    icon: 'Cpu',
    description: '专注于 Rust 异步系统编程、Go 高性能微服务、Linux 内核原理、C++ 现代系统级开发与 WebGPU',
    keywords: [
      'Rust 编程语言教程',
      'Rust Tokio 异步编程',
      'Go 语言进阶实战',
      'Go 微服务高性能',
      'C++ 现代系统编程',
      'Linux 内核 操作系统原理',
      'WebGPU 着色器教程',
      '无锁数据结构 并发编程',
      '计算机网络 零拷贝',
      '汇编语言 与逆向工程',
      'CUDA 并行计算 GPU',
      '高性能网络编程 epoll',
      '操作系统从零实现',
      'Rust 嵌入式开发',
      '性能优化 CPU 缓存'
    ],
    maxItems: 520,
    targetCount: 500
  },
  {
    id: 'cat_database_bigdata',
    title: '现代存储引擎与海量数据架构',
    icon: 'Database',
    description: '聚焦 PostgreSQL 深度优化、Redis 核心底层、ClickHouse 极速 OLAP、Kafka 流计算与向量数据库',
    keywords: [
      'PostgreSQL 性能调优',
      'Redis 核心原理解析',
      'ClickHouse 实战教程',
      'Kafka 消息队列 进阶',
      'MySQL 架构与索引优化',
      'Milvus 向量数据库',
      'Elasticsearch 搜索引擎',
      'Flink 实时计算',
      '数据湖 Iceberg Spark',
      '分布式数据库 TiDB',
      'MongoDB 进阶实战',
      'DuckDB 嵌入式分析',
      '大数据数仓建模',
      'Neo4j 图数据库',
      '分库分表 ShardingSphere'
    ],
    maxItems: 520,
    targetCount: 500
  },
  {
    id: 'cat_tools_indie',
    title: '开源神器与独立开发出海',
    icon: 'Sparkles',
    description: '汇聚 AI 原生微 SaaS 出海实践、Stripe 商业化支付、GitHub 精选高星开源项目与极客效能利器',
    keywords: [
      '独立开发出海 经验分享',
      'AI SaaS 产品出海',
      'GitHub 开源项目 推荐',
      'Stripe 支付接入',
      'Supabase 极速开发',
      '效率神器 开发者工具',
      'Git 进阶协同工作流',
      '开源商业化 创业',
      'Chrome 插件开发',
      'Neovim 配置 打造 IDE',
      '出海 SEO 流量获取',
      '独立开发 产品冷启动',
      '独立开发者 变现',
      '优质开源项目 源码解析',
      '程序员副业 远程工作'
    ],
    maxItems: 520,
    targetCount: 500
  }
]

function parseDurationToSeconds(durationStr) {
  if (typeof durationStr === 'number') return durationStr
  if (!durationStr || typeof durationStr !== 'string') return 0
  const parts = durationStr.split(':').map(p => parseInt(p, 10))
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

async function searchBilibiliKeyword(keyword, page) {
  try {
    const url = `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}&order=totalrank`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com'
      },
      signal: AbortSignal.timeout(7000)
    })
    if (!res.ok) return []
    const json = await res.json()
    if (json?.code !== 0) return []
    return json?.data?.result || []
  } catch (err) {
    return []
  }
}

async function main() {
  console.log('🚀 开始执行 6 大专业分类 × 500 视频海量技术智库构建...')
  const videosFilePath = path.resolve('apps/web-overlay/src/navsphere/content/videos.json')
  let existingData = { navigationItems: [], replacementHistory: [] }
  if (fs.existsSync(videosFilePath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'))
    } catch (e) {
      console.warn('读取旧 videos.json 异常，创建新结构')
    }
  }

  // 1. 保留原本已置顶的内容
  const existingPinnedMap = new Map()
  for (const cat of existingData.navigationItems || []) {
    const pinnedItems = (cat.items || []).filter(it => it.videoConfig?.pinned)
    if (pinnedItems.length > 0) {
      existingPinnedMap.set(cat.id, pinnedItems)
    }
  }

  const globalBvidSet = new Set()
  const finalCategories = []

  for (const catDef of CATEGORIES) {
    console.log(`\n📂 正在抓取与构建分类: 【${catDef.title}】(${catDef.id})...`)
    const categoryItems = []
    
    // 放入既有置顶视频
    const pinned = existingPinnedMap.get(catDef.id) || []
    for (const p of pinned) {
      if (p.videoConfig?.bvid) globalBvidSet.add(p.videoConfig.bvid)
      categoryItems.push(p)
    }

    let kwIndex = 0
    let page = 1

    while (categoryItems.length < catDef.targetCount && kwIndex < catDef.keywords.length) {
      const kw = catDef.keywords[kwIndex]
      const rawResults = await searchBilibiliKeyword(kw, page)
      
      let addedFromPage = 0
      for (const item of rawResults) {
        if (categoryItems.length >= catDef.targetCount) break
        const bvid = item.bvid
        if (!bvid || globalBvidSet.has(bvid)) continue

        const durationSec = parseDurationToSeconds(item.duration)
        if (durationSec > 0 && durationSec < 150) continue // 过滤过短视频

        const cleanTitle = (item.title || '').replace(/<[^>]+>/g, '').trim()
        const cleanDesc = (item.description || '').replace(/<[^>]+>/g, '').trim()
        if (!cleanTitle) continue

        let cover = item.pic || ''
        if (cover.startsWith('//')) cover = `https:${cover}`
        if (cover.startsWith('http://')) cover = cover.replace('http://', 'https://')

        const play = item.play || 0
        const like = item.like || 0
        const danmaku = item.video_review || 0
        const pubDate = item.pubdate ? new Date(item.pubdate * 1000).toISOString() : new Date().toISOString()

        // 质量评分（0-99）：根据播放量、互动量与时长加权
        const viewScore = Math.min(40, Math.floor(Math.log10(Math.max(1, play)) * 8))
        const interactScore = play > 0 ? Math.min(40, Math.floor((like / play) * 400)) : 20
        const durationScore = Math.min(20, Math.floor((durationSec / 1800) * 20))
        const qualityScore = Math.min(99, Math.max(65, viewScore + interactScore + durationScore + 10))

        const videoItem = {
          id: `v_${bvid}_${categoryItems.length}`,
          title: cleanTitle,
          href: `https://www.bilibili.com/video/${bvid}`,
          description: cleanDesc ? cleanDesc.slice(0, 160) : `【${kw}】前沿技术深度实战讲解`,
          icon: cover || 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800',
          enabled: true,
          videoConfig: {
            type: 'bilibili',
            bvid,
            p: 1,
            author: item.author || '技术导师',
            durationSec,
            publishedAt: pubDate,
            harvestedAt: Date.now(),
            qualityScore,
            freshnessScore: qualityScore > 85 ? 90 : 80,
            sourceType: 'auto_harvest',
            pinned: false,
            healthStatus: 'healthy',
            stats: {
              views: play,
              likes: like,
              danmaku
            }
          }
        }

        categoryItems.push(videoItem)
        globalBvidSet.add(bvid)
        addedFromPage++
      }

      console.log(`  - 关键词 [${kw}] 第 ${page} 页：获取 ${rawResults.length} 条，入库 ${addedFromPage} 条，当前分类总数: ${categoryItems.length}/${catDef.targetCount}`)

      // 翻页或切换下一个关键词
      if (rawResults.length === 0 || page >= 4 || addedFromPage === 0) {
        kwIndex++
        page = 1
      } else {
        page++
      }

      // 友好休眠 80ms 避免过快请求
      await new Promise(r => setTimeout(r, 80))
    }

    finalCategories.push({
      id: catDef.id,
      title: catDef.title,
      icon: catDef.icon,
      description: catDef.description,
      enabled: true,
      harvestPolicy: {
        enabled: true,
        keywords: catDef.keywords.slice(0, 8),
        syncSiteHotTrends: true,
        platforms: ['bilibili', 'youtube'],
        maxItems: 520,
        minQualityScore: 65,
        minDurationSec: 180,
        freshnessHalfLifeDays: 90,
        autoReplaceOutdated: true
      },
      items: categoryItems,
      subCategories: []
    })

    console.log(`✅ 分类【${catDef.title}】构建完成！实际收纳: ${categoryItems.length} 部优质视频`)
  }

  const finalData = {
    navigationItems: finalCategories,
    replacementHistory: existingData.replacementHistory || []
  }

  fs.writeFileSync(videosFilePath, JSON.stringify(finalData, null, 2), 'utf8')
  console.log(`\n🎉 全部 6 大分类构建完成！已写入 ${videosFilePath}`)
  console.log(`📊 统计：全库视频总数 = ${finalCategories.reduce((acc, c) => acc + c.items.length, 0)} 部`)
}

main().catch(err => {
  console.error('执行构建失败:', err)
  process.exit(1)
})
