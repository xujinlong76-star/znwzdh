/**
 * 扩展多级专业技术视频智库构建引擎
 * 针对新增的 3 大专业技术分类精准执行多关键词深层抓取与结构化入库，
 * 每个分类建立 500 部左右的高水准真实视频，并自动细分为 3 个精准的二级子分类。
 */

import fs from 'node:fs'
import path from 'node:path'

const NEW_CATEGORIES = [
  {
    id: 'cat_mobile_multiplatform',
    title: '移动端与跨平台全栈开发',
    icon: 'Laptop',
    description: '涵盖 Flutter 跨端实战、HarmonyOS 鸿蒙 NEXT 核心开发、React Native 生态与 iOS/Android 原生工程',
    subCategoryDefs: [
      {
        id: 'sub_mob_flutter_rn',
        title: 'Flutter 与 React Native 跨平台开发',
        description: 'Flutter 3 响应式 UI、Dart 3、React Native 新架构与双端性能调优',
        keywords: [
          'Flutter 跨端实战',
          'Flutter 教程 入门到进阶',
          'React Native 实战教程',
          'Flutter 项目实战',
          'React Native 新架构',
          'Dart 语言核心教程'
        ]
      },
      {
        id: 'sub_mob_harmonyos_next',
        title: 'HarmonyOS 鸿蒙 NEXT 原生开发',
        description: 'ArkTS 语言、ArkUI 声明式开发、分布式能力与 HarmonyOS 纯血原生应用实战',
        keywords: [
          'HarmonyOS 鸿蒙开发',
          '鸿蒙 NEXT 开发实战',
          'ArkTS 教程',
          'ArkUI 声明式UI',
          'HarmonyOS 元服务开发',
          '鸿蒙原生应用开发'
        ]
      },
      {
        id: 'sub_mob_ios_android',
        title: 'Android 与 iOS 原生工程进阶',
        description: 'Kotlin 协程与 Jetpack Compose、SwiftUI 现代架构、原生性能极致调优',
        keywords: [
          'Jetpack Compose 实战',
          'Kotlin 协程开发教程',
          'SwiftUI 教程 实战',
          'iOS 现代架构开发',
          'Android 性能优化实战',
          'iOS Swift 进阶教程'
        ]
      }
    ],
    targetCount: 500
  },
  {
    id: 'cat_security_network',
    title: '网络安全与攻防工程',
    icon: 'Shield',
    description: '深入 Web 渗透测试、二进制漏洞挖掘与逆向工程、零信任架构、安全合规与密码学实践',
    subCategoryDefs: [
      {
        id: 'sub_sec_web_penetration',
        title: 'Web 安全与渗透测试实战',
        description: 'OWASP Top 10、SQL注入/XSS防御、Burp Suite 实操与靶场攻防演练',
        keywords: [
          'Web 安全 渗透测试',
          '渗透测试 靶场实战',
          'Burp Suite 实战教程',
          'SQL 注入与漏洞利用',
          'XSS 漏洞原理与防御',
          '网络安全 入门到精通'
        ]
      },
      {
        id: 'sub_sec_reverse_binary',
        title: '逆向工程与二进制安全',
        description: 'IDA Pro 静态反编译、GDB 动态调试、逆向破解与免杀防御技术',
        keywords: [
          '逆向工程 软件安全',
          'IDA Pro 逆向分析',
          '软件逆向与反编译',
          'PWN 漏洞利用教程',
          'GDB 调试深入分析',
          '二进制安全 漏洞挖掘'
        ]
      },
      {
        id: 'sub_sec_crypto_zerotrust',
        title: '零信任安全与企业级防御体系',
        description: '现代现代密码学应用、OAuth 2.0 / OIDC 授权模型、零信任网络与合规体系建设',
        keywords: [
          'OAuth2 零信任安全',
          '现代密码学 应用实践',
          '企业级安全体系建设',
          '身份认证与访问控制 IAM',
          '网络安全应急响应',
          '云原生安全容器加固'
        ]
      }
    ],
    targetCount: 500
  },
  {
    id: 'cat_algorithms_interview',
    title: '算法精粹与系统设计',
    icon: 'BookOpen',
    description: '汇聚高频经典算法与数据结构、LeetCode 进阶思维、大厂系统设计以及 CS 核心底座精讲',
    subCategoryDefs: [
      {
        id: 'sub_algo_leetcode_dsa',
        title: '高频数据结构与核心算法实战',
        description: '动态规划专题、图论与最短路径、树与回溯、LeetCode 经典刷题思路与模版',
        keywords: [
          '算法 LeetCode 面试',
          '动态规划 算法讲解',
          '数据结构与算法 进阶',
          '图论算法 最短路径',
          'LeetCode 高频面试题',
          '代码随想录 算法'
        ]
      },
      {
        id: 'sub_algo_system_design',
        title: '分布式系统架构与高并发设计',
        description: '海量流量架构设计、分布式锁、缓存一致性、消息幂等性与千万级 QPS 系统演进',
        keywords: [
          '系统设计 高并发架构',
          '高并发分布式架构设计',
          '系统设计面试题',
          '架构师实战 系统演进',
          '分布式事务与高可用',
          '秒杀系统架构设计'
        ]
      },
      {
        id: 'sub_algo_cs_foundations',
        title: '计算机体系底座与名校公开课',
        description: 'CSAPP 计算机系统、MIT/伯克利公开课精选、计算机网络 TCP/IP 体系深度拆解',
        keywords: [
          '计算机网络 计算机系统',
          'CSAPP 深入理解计算机系统',
          'TCP IP 协议深度解析',
          '操作系统导论 公开课',
          '编译原理 经典实战',
          '计算机基础 核心通关'
        ]
      }
    ],
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
  console.log('🚀 开始抓取并生成新增 3 大分类 (各 500 部视频) 与 9 个二级子分类...')
  const videosFilePath = path.resolve('apps/web-overlay/src/navsphere/content/videos.json')
  const existingData = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'))

  // 搜集全库已知 bvid 避免跨分类重复
  const globalBvidSet = new Set()
  for (const cat of existingData.navigationItems || []) {
    for (const sub of cat.subCategories || []) {
      for (const it of sub.items || []) {
        if (it.videoConfig?.bvid) globalBvidSet.add(it.videoConfig.bvid)
      }
    }
    for (const it of cat.items || []) {
      if (it.videoConfig?.bvid) globalBvidSet.add(it.videoConfig.bvid)
    }
  }

  console.log(`现有视频总去重 BVID 数量: ${globalBvidSet.size}`)

  for (const catDef of NEW_CATEGORIES) {
    console.log(`\n========================================`)
    console.log(`📂 开始采集一级分类: 【${catDef.title}】 (${catDef.id})`)
    console.log(`========================================`)

    const subCategoriesBuilt = []
    let categoryTotalItems = 0
    const targetPerSub = Math.ceil(catDef.targetCount / catDef.subCategoryDefs.length) // ~167 per sub

    for (const subDef of catDef.subCategoryDefs) {
      console.log(`\n  └── 正在抓取子分类: 【${subDef.title}】 (${subDef.id})...`)
      const subItems = []
      let kwIdx = 0
      let page = 1

      while (subItems.length < targetPerSub && kwIdx < subDef.keywords.length) {
        const kw = subDef.keywords[kwIdx]
        const rawResults = await searchBilibiliKeyword(kw, page)
        let addedThisPage = 0

        for (const item of rawResults) {
          if (subItems.length >= targetPerSub) break
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

          const viewScore = Math.min(40, Math.floor(Math.log10(Math.max(1, play)) * 8))
          const interactScore = play > 0 ? Math.min(40, Math.floor((like / play) * 400)) : 20
          const durationScore = Math.min(20, Math.floor((durationSec / 1800) * 20))
          const qualityScore = Math.min(99, Math.max(65, viewScore + interactScore + durationScore + 10))

          const videoItem = {
            id: `v_${bvid}_${subItems.length}`,
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

          subItems.push(videoItem)
          globalBvidSet.add(bvid)
          addedThisPage++
        }

        console.log(`      [${kw}] 第 ${page} 页: 获得 ${rawResults.length} 条, 新入库 ${addedThisPage} 条, 当前子类: ${subItems.length}/${targetPerSub}`)

        if (rawResults.length === 0 || page >= 4 || addedThisPage === 0) {
          kwIdx++
          page = 1
        } else {
          page++
        }

        await new Promise(r => setTimeout(r, 80))
      }

      categoryTotalItems += subItems.length
      subCategoriesBuilt.push({
        id: subDef.id,
        title: subDef.title,
        description: subDef.description,
        parentId: catDef.id,
        enabled: true,
        items: subItems
      })
      console.log(`  ✅ 子分类【${subDef.title}】完成，收纳 ${subItems.length} 部`)
    }

    const newCategory = {
      id: catDef.id,
      title: catDef.title,
      icon: catDef.icon,
      description: catDef.description,
      enabled: true,
      harvestPolicy: {
        enabled: true,
        keywords: catDef.subCategoryDefs.flatMap(s => s.keywords.slice(0, 2)),
        syncSiteHotTrends: true,
        platforms: ['bilibili', 'youtube'],
        maxItems: 520,
        minQualityScore: 65,
        minDurationSec: 180,
        freshnessHalfLifeDays: 90,
        autoReplaceOutdated: true
      },
      items: [],
      subCategories: subCategoriesBuilt
    }

    existingData.navigationItems.push(newCategory)
    console.log(`🎉 分类【${catDef.title}】构建入库完成！累计 ${categoryTotalItems} 部视频`)
  }

  // 写入 web-overlay
  fs.writeFileSync(videosFilePath, JSON.stringify(existingData, null, 2), 'utf8')
  console.log(`\n💾 已成功保存到 ${videosFilePath}`)
}

main().catch(err => {
  console.error('构建出错:', err)
  process.exit(1)
})
