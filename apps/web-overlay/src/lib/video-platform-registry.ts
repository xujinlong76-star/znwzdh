/**
 * 视频平台能力注册表（**纯数据，客户端安全**）。
 *
 * 为什么单独成文件：这个注册表被 3 个 'use client' 组件消费（新增视频表单、
 * SEO 治理面板、分类条目页），而它原先住在 video-multi-platform-harvester.ts 里——
 * 那个模块同时含服务端采集代码，并 import 了 ssrf-guard（node:dns/promises、
 * node:net）。bundler 按**模块图**打包，客户端只要 import 到那个模块，整条链上的
 * node 内建就会被打进浏览器包（仓库实测首屏 +476 KB），兜底密钥之类还可能被
 * 内联进产物。
 *
 * 口径：客户端只消费「平台能力描述」这份纯数据；真正发起请求的采集逻辑留在服务端。
 * 服务端调用方仍可从 video-multi-platform-harvester 转出同一个常量，导入路径不变。
 */

import type { VideoPlatformType } from '@/types/navigation'

export interface PlatformCapabilityDescriptor {
  id: VideoPlatformType
  name: string
  shortName: string
  region: 'domestic' | 'international' | 'universal'
  badgeColor: string
  supportsUrlResolve: boolean
  supportsKeywordHarvest: boolean
  supportsIframeEmbed: boolean
  urlExamples: string[]
  description: string
}

export const VIDEO_PLATFORM_REGISTRY: Record<VideoPlatformType, PlatformCapabilityDescriptor> = {
  bilibili: {
    id: 'bilibili',
    name: '哔哩哔哩 (Bilibili)',
    shortName: 'B站',
    region: 'domestic',
    badgeColor: '#00A1D6',
    supportsUrlResolve: true,
    supportsKeywordHarvest: true,
    supportsIframeEmbed: true,
    urlExamples: ['https://www.bilibili.com/video/BV1xx411c7mD', 'https://b23.tv/xxxxxx'],
    description: '支持 WBI 签名搜索采集、官方 View 接口 + 6 路高清 MP4 直链解析引擎自动轮换',
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    shortName: 'YouTube',
    region: 'international',
    badgeColor: '#FF0000',
    supportsUrlResolve: true,
    supportsKeywordHarvest: true,
    supportsIframeEmbed: true,
    urlExamples: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ'],
    description: '支持 oEmbed/Noembed 解析、Piped 公共索引搜索采集与 YouTube 隐私增强嵌入播放',
  },
  douyin: {
    id: 'douyin',
    name: '抖音 (Douyin)',
    shortName: '抖音',
    region: 'domestic',
    badgeColor: '#FE2C55',
    supportsUrlResolve: true,
    supportsKeywordHarvest: false,
    supportsIframeEmbed: true,
    urlExamples: ['https://www.douyin.com/video/7321098765432109876', 'https://v.douyin.com/iYxxxx/'],
    description: '支持抖音长短视频链接解析、OpenGraph/JSON-LD 元数据提取与官方开放 iframe 嵌入',
  },
  kuaishou: {
    id: 'kuaishou',
    name: '快手 (Kuaishou)',
    shortName: '快手',
    region: 'domestic',
    badgeColor: '#FF4906',
    supportsUrlResolve: true,
    supportsKeywordHarvest: false,
    supportsIframeEmbed: true,
    urlExamples: ['https://www.kuaishou.com/short-video/3x8a9b2c3d4e5f6'],
    description: '支持快手短视频与知识专栏单链嗅探、封面与创作者元数据自动提取',
  },
  xigua: {
    id: 'xigua',
    name: '西瓜视频 (Xigua)',
    shortName: '西瓜',
    region: 'domestic',
    badgeColor: '#F85959',
    supportsUrlResolve: true,
    supportsKeywordHarvest: false,
    supportsIframeEmbed: true,
    urlExamples: ['https://www.ixigua.com/7291234567890123456'],
    description: '支持西瓜中长视频 ID 识别、结构化元数据抓取与内嵌播放器适配',
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    name: '小红书 (Xiaohongshu)',
    shortName: '小红书',
    region: 'domestic',
    badgeColor: '#FF2442',
    supportsUrlResolve: true,
    supportsKeywordHarvest: false,
    supportsIframeEmbed: false,
    urlExamples: ['https://www.xiaohongshu.com/explore/65a1b2c3000000001e02f3a4'],
    description: '支持小红书视频笔记 OpenGraph 标题/摘要/首图抓取与 SEO 索引卡片生成',
  },
  tencent: {
    id: 'tencent',
    name: '腾讯视频 (Tencent)',
    shortName: '腾讯视频',
    region: 'domestic',
    badgeColor: '#FF7E00',
    supportsUrlResolve: true,
    supportsKeywordHarvest: false,
    supportsIframeEmbed: true,
    urlExamples: ['https://v.qq.com/x/page/u3245abcdef.html', 'https://v.qq.com/x/cover/mzc002001/u3245abcdef.html'],
    description: '支持腾讯视频 VID 提取、网页结构化信息解析与 v.qq.com 官方 txp 播放器嵌入',
  },
  youku: {
    id: 'youku',
    name: '优酷视频 (Youku)',
    shortName: '优酷',
    region: 'domestic',
    badgeColor: '#00A3FF',
    supportsUrlResolve: true,
    supportsKeywordHarvest: false,
    supportsIframeEmbed: true,
    urlExamples: ['https://v.youku.com/v_show/id_XNTk4NzY1NDMyMA==.html'],
    description: '支持优酷 X 编码视频 ID 提取、元数据嗅探与 player.youku.com 通用嵌入播放',
  },
  vimeo: {
    id: 'vimeo',
    name: 'Vimeo',
    shortName: 'Vimeo',
    region: 'international',
    badgeColor: '#1AB7EA',
    supportsUrlResolve: true,
    supportsKeywordHarvest: true,
    supportsIframeEmbed: true,
    urlExamples: ['https://vimeo.com/76979871'],
    description: '支持 Vimeo 官方 oEmbed 接口精准提取高分封面、作者、时长与高清嵌入播放器',
  },
  ted: {
    id: 'ted',
    name: 'TED Talks',
    shortName: 'TED',
    region: 'international',
    badgeColor: '#E62B1E',
    supportsUrlResolve: true,
    supportsKeywordHarvest: true,
    supportsIframeEmbed: true,
    urlExamples: ['https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity'],
    description: '支持 TED 官方 oEmbed 服务解析与 TED Talks RSS 演讲聚合采集，天然适配学术与技术 SEO',
  },
  dailymotion: {
    id: 'dailymotion',
    name: 'Dailymotion',
    shortName: 'Dailymotion',
    region: 'international',
    badgeColor: '#0066DC',
    supportsUrlResolve: true,
    supportsKeywordHarvest: true,
    supportsIframeEmbed: true,
    urlExamples: ['https://www.dailymotion.com/video/x8abcde'],
    description: '支持 Dailymotion 公开 REST 搜索 API 按主题词免密钥批量采集与高清嵌入播放',
  },
  peertube: {
    id: 'peertube',
    name: 'PeerTube (Fediverse)',
    shortName: 'PeerTube',
    region: 'international',
    badgeColor: '#F1680D',
    supportsUrlResolve: true,
    supportsKeywordHarvest: true,
    supportsIframeEmbed: true,
    urlExamples: ['https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv'],
    description: '支持 SepiaSearch 全球开源联邦视频搜索引擎采集（技术会议、Linux/FOSS 讲座）与实例 API 解析',
  },
  custom: {
    id: 'custom',
    name: '自定义视频 / 网页直链',
    shortName: '自定义源',
    region: 'universal',
    badgeColor: '#6366F1',
    supportsUrlResolve: true,
    supportsKeywordHarvest: false,
    supportsIframeEmbed: true,
    urlExamples: ['https://example.com/course/video-1.mp4', 'https://developer.apple.com/videos/play/wwdc2024/101/'],
    description: '支持 MP4/WebM/HLS 直链及任意含 Schema.org VideoObject 或 OpenGraph 标签的技术视频网页采集',
  },
}
