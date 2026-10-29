/**
 * 批次采集并入库 3 大前沿领域：
 * 1. 游戏引擎与 3D 图形学 (cat_game_graphics)
 * 2. 嵌入式系统与智能硬件物联网 (cat_embedded_iot)
 * 3. 软件测试与质量效能工程 (cat_qa_performance)
 * 各 350+ 部优质视频，分 3 个精细二级子分类。
 */

import fs from 'node:fs'
import path from 'node:path'

const BATCH_CATEGORIES = [
  {
    id: 'cat_game_graphics',
    title: '游戏开发与 3D 图形渲染',
    icon: 'Gamepad2',
    description: '涵盖 Unity 3D、Unreal Engine 5 虚幻引擎、Godot 开源引擎、WebGL/Three.js 与 Shader 着色器渲染',
    subCategoryDefs: [
      {
        id: 'sub_game_unity_unreal',
        title: 'Unity 3D 与 UE5 虚幻引擎实战',
        description: 'Unity C# 游戏逻辑架构、UE5 蓝图与 Lumen/Nanite 渲染管线、独立游戏完整开发',
        keywords: [
          'Unity 3D 游戏开发',
          'Unreal Engine 虚幻引擎',
          'Unity 教程 实战',
          'UE5 虚幻5 游戏开发',
          '独立游戏开发 经验分享'
        ]
      },
      {
        id: 'sub_game_godot_engine',
        title: 'Godot 开源引擎与独立游戏制作',
        description: 'Godot 4 GDScript 核心实战、2D/3D 轻量游戏制作、多平台跨端打包发布',
        keywords: [
          'Godot 游戏开发',
          'Godot 4 入门教程',
          'GDScript 游戏实战',
          'Godot 独立游戏制作'
        ]
      },
      {
        id: 'sub_game_graphics_shader',
        title: 'WebGL、Three.js 与 Shader 着色器',
        description: 'Three.js 网页 3D 交互、GLSL Shader 着色器特效、图形学光照渲染算法',
        keywords: [
          'WebGL Three.js 3D',
          'Shader 着色器图形学',
          'Three.js 实战教程',
          'GLSL 着色器编程',
          '计算机图形学 渲染'
        ]
      }
    ],
    targetCount: 360
  },
  {
    id: 'cat_embedded_iot',
    title: '嵌入式系统与物联网硬件',
    icon: 'Cpu',
    description: '深入 STM32 单片机微控制器、ESP32 极速物联网开发、Linux 嵌入式驱动与 ROS 机器人操作系统',
    subCategoryDefs: [
      {
        id: 'sub_emb_stm32_mcu',
        title: 'STM32 单片机与微控制器实战',
        description: 'STM32 HAL库开发、FreeRTOS 实时操作系统移植、串口通信与传感器外设实操',
        keywords: [
          '嵌入式开发 单片机 STM32',
          'STM32 HAL库实战',
          'FreeRTOS 实时操作系统',
          '单片机 项目开发实战'
        ]
      },
      {
        id: 'sub_emb_esp32_iot',
        title: 'ESP32 物联网与智能硬件开发',
        description: 'ESP-IDF/Arduino 编程、WiFi/蓝牙无线通信、MQTT 物联网云平台对接实战',
        keywords: [
          'ESP32 物联网实战',
          'ESP32 Arduino 教程',
          '物联网 智能家居实战',
          'MQTT 物联网开发'
        ]
      },
      {
        id: 'sub_emb_ros_robotics',
        title: 'ROS 机器人操作系统与嵌入式 Linux',
        description: 'ROS2 机器人运动控制、SLAM 激光雷达建图导航、嵌入式 Linux 内核驱动移植',
        keywords: [
          'ROS2 机器人操作系统',
          'SLAM 导航建图实战',
          '嵌入式 Linux 驱动开发',
          '机器人开发 仿真实战'
        ]
      }
    ],
    targetCount: 360
  },
  {
    id: 'cat_qa_performance',
    title: '软件测试与自动化效能工程',
    icon: 'Shield',
    description: '聚焦 Playwright/Cypress 端到端自动化测试、JMeter/K6 性能压测与测试开发工程化体系',
    subCategoryDefs: [
      {
        id: 'sub_qa_e2e_automation',
        title: 'Web 与移动端自动化测试实战',
        description: 'Playwright 现代化端到端测试、Selenium/Appium 跨端自动化、CI 流水线自动化回归',
        keywords: [
          'Playwright 自动化测试',
          '自动化测试 实战教程',
          'Selenium 自动化测试',
          'Appium 移动端自动化'
        ]
      },
      {
        id: 'sub_qa_perf_pressure',
        title: '接口测试与性能压测调优',
        description: 'JMeter 高并发接口压测、K6 性能测试脚手架、JVM 内存泄漏与瓶颈定位分析',
        keywords: [
          'JMeter 性能测试 压测',
          '接口自动化测试 实战',
          'K6 性能压测',
          '性能测试 瓶颈调优'
        ]
      },
      {
        id: 'sub_qa_test_dev_ops',
        title: '测试开发与效能平台建设',
        description: 'PyTest 框架封装、测试用例智能生成、自研自动化测试平台与质量门禁落地',
        keywords: [
          '测试开发 实战教程',
          'Pytest 测试框架进阶',
          '测试效能平台 开发',
          '质量工程 体系建设'
        ]
      }
    ],
    targetCount: 360
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
  console.log('🚀 开始抓取并生成新增 3 大前沿技术分类及 9 个精选二级子分类...')
  const videosFilePath = path.resolve('apps/web-overlay/src/navsphere/content/videos.json')
  const existingData = JSON.parse(fs.readFileSync(videosFilePath, 'utf8'))

  // 搜集全库已知 bvid 避免重复
  const globalBvidSet = new Set()
  for (const cat of existingData.navigationItems || []) {
    for (const sub of cat.subCategories || []) {
      for (const it of sub.items || []) {
        if (it.videoConfig?.bvid) globalBvidSet.add(it.videoConfig.bvid)
      }
    }
  }

  console.log(`现有视频总去重 BVID 数量: ${globalBvidSet.size}`)

  for (const catDef of BATCH_CATEGORIES) {
    console.log(`\n========================================`)
    console.log(`📂 开始采集一级分类: 【${catDef.title}】 (${catDef.id})`)
    console.log(`========================================`)

    const subCategoriesBuilt = []
    let categoryTotalItems = 0
    const targetPerSub = Math.ceil(catDef.targetCount / catDef.subCategoryDefs.length) // ~120 per sub

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
          if (durationSec > 0 && durationSec < 150) continue

          const cleanTitle = (item.title || '').replace(/<[^>]+>/g, '').trim()
          let cleanDesc = (item.description || '').replace(/<[^>]+>/g, '').trim()
          if (!cleanTitle) continue
          if (cleanDesc.length > 50) cleanDesc = cleanDesc.slice(0, 50).trim()

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
            description: cleanDesc || `【${kw}】前沿技术深度实战讲解`,
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
        maxItems: 400,
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

  fs.writeFileSync(videosFilePath, JSON.stringify(existingData, null, 2), 'utf8')
  console.log(`\n💾 已成功保存到 ${videosFilePath}`)
}

main().catch(err => {
  console.error('构建出错:', err)
  process.exit(1)
})
