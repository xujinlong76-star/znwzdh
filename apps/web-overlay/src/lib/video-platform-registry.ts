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
    supportsKeywordHarvest: false,
    supportsIframeEmbed: true,
    urlExamples: ['https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv'],
    description: '仅支持实例 API 解析与粘贴 URL 播放；关键词采集已于 2026-11-14 移除（SepiaSearch 播放量天花板远低于入库门槛）',
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
