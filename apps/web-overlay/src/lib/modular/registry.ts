import { RssFeedWidget } from '@/components/modular/modules/rss-feed-widget'
import { LiveApiWidget } from '@/components/modular/modules/live-api-widget'
import React from 'react'
import type { ModularWidgetDefinition, ModularPresetTemplate, WidgetInstance } from '@/types/modular'
import { ClockWidget } from '@/components/modular/modules/clock-widget'
import { QuickToolsWidget } from '@/components/modular/modules/quick-tools-widget'
import { TrendingWidget } from '@/components/modular/modules/trending-widget'
import { HyperbolicRadarWidget } from '@/components/modular/modules/hyperbolic-radar-widget'
import { NotesWidget } from '@/components/modular/modules/notes-widget'
import { SpeculativeTerminalWidget } from '@/components/modular/modules/speculative-terminal-widget'
import { MetricsWidget } from '@/components/modular/modules/metrics-widget'
import { FavoritesDockWidget } from '@/components/modular/modules/favorites-dock-widget'
import { CustomCategoryWidget } from '@/components/modular/modules/custom-category-widget'
import { QuickSearchWidget } from '@/components/modular/modules/quick-search-widget'
import { GithubHeatmapWidget } from '@/components/modular/modules/github-heatmap-widget'
import { WeatherWidget } from '@/components/modular/modules/weather-widget'
import { IframeWidget } from '@/components/modular/modules/iframe-widget'

/**
 * 所有可用独立模块的注册表清单
 */
export const WIDGET_REGISTRY: Record<string, ModularWidgetDefinition & { component: React.ComponentType<any> }> = {
  'clock-pomodoro': {
    type: 'clock-pomodoro',
    title: '数字时钟与番茄专注',
    description: '毫秒级本地数字时钟，内置 25 分钟番茄工作法沉浸专注倒计时。',
    category: 'efficiency',
    icon: 'Clock',
    defaultColSpan: 3,
    defaultRowSpan: 1,
    minColSpan: 3,
    maxColSpan: 6,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '极简时钟',
    component: ClockWidget,
  },
  'quick-tools': {
    type: 'quick-tools',
    title: '微前端极客工具箱',
    description: '端侧瞬时生成 UUID、Unix 时间戳与 Base64 实时编解码。',
    category: 'tools',
    icon: 'Wrench',
    defaultColSpan: 4,
    defaultRowSpan: 1,
    minColSpan: 3,
    maxColSpan: 6,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '0-RTT 本地',
    component: QuickToolsWidget,
  },
  'trending-radar': {
    type: 'trending-radar',
    title: '全网技术飙升热榜',
    description: '聚合全网热度最高与 GitHub Star 增长最快的前沿开源项目。',
    category: 'analytics',
    icon: 'TrendingUp',
    defaultColSpan: 5,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '实时流',
    component: TrendingWidget,
  },
  'hyperbolic-radar': {
    type: 'hyperbolic-radar',
    title: '双曲平替与开源雷达',
    description: 'Poincaré 双曲几何距离平替算法，一键查找商业 SaaS 最佳平替。',
    category: 'ai',
    icon: 'GitCompare',
    defaultColSpan: 4,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '平替算法',
    component: HyperbolicRadarWidget,
  },
  'speculative-terminal': {
    type: 'speculative-terminal',
    title: '0-RTT 意图推断终端',
    description: '击键驱动的本地即时推测执行，支持算式运算与色彩空间解析。',
    category: 'tools',
    icon: 'Zap',
    defaultColSpan: 4,
    defaultRowSpan: 1,
    minColSpan: 3,
    maxColSpan: 6,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '推测计算',
    component: SpeculativeTerminalWidget,
  },
  'markdown-notes': {
    type: 'markdown-notes',
    title: '极客随手备忘便签',
    description: '浏览器本地静止持久化随手笔记，无需登录即可快速保存待办灵感。',
    category: 'content',
    icon: 'FileText',
    defaultColSpan: 5,
    defaultRowSpan: 2,
    minColSpan: 3,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '本地优先',
    component: NotesWidget,
  },
  'system-metrics': {
    type: 'system-metrics',
    title: '认知中枢与引擎监控',
    description: '实时展示 LinUCB 探索率、双曲曲率、端侧缓存率与 E2EE 加密状态。',
    category: 'analytics',
    icon: 'Activity',
    defaultColSpan: 4,
    defaultRowSpan: 2,
    minColSpan: 3,
    maxColSpan: 6,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '中枢指标',
    component: MetricsWidget,
  },
  'favorites-dock': {
    type: 'favorites-dock',
    title: '星标快捷启动坞',
    description: '与主页收藏联动，快速触达最常访问的高频站点。',
    category: 'efficiency',
    icon: 'Bookmark',
    defaultColSpan: 4,
    defaultRowSpan: 1,
    minColSpan: 3,
    maxColSpan: 6,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: 'E2EE 同步',
    component: FavoritesDockWidget,
  },
  'custom-category': {
    type: 'custom-category',
    title: '精选分类导航聚合',
    description: '嵌入指定技术分类（AI工具/开发框架/设计素材等）的精选站点卡片集合。',
    category: 'content',
    icon: 'Folder',
    defaultColSpan: 6,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '分类嵌入',
    component: CustomCategoryWidget,
  },
  'quick-search': {
    type: 'quick-search',
    title: '多引擎聚合快捷搜索',
    description: '聚合 Google、GitHub、npm、MDN 与 Bing，支持一键回车直达检索。',
    category: 'tools',
    icon: 'Search',
    defaultColSpan: 6,
    defaultRowSpan: 1,
    minColSpan: 4,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '多引擎搜索',
    component: QuickSearchWidget,
  },
  'github-heatmap': {
    type: 'github-heatmap',
    title: 'GitHub 提交热力足迹',
    description: '展示 52 周开源贡献方格矩阵，记录连续打卡天数与年度提交热度。',
    category: 'analytics',
    icon: 'GitCommit',
    defaultColSpan: 6,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '提交矩阵',
    component: GithubHeatmapWidget,
  },
  'weather-clock': {
    type: 'weather-clock',
    title: '实时天气与环境气象',
    description: '端侧环境温度、空气质量指数、湿度与多日天气预测胶囊。',
    category: 'efficiency',
    icon: 'CloudSun',
    defaultColSpan: 4,
    defaultRowSpan: 1,
    minColSpan: 3,
    maxColSpan: 6,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '环境气象',
    component: WeatherWidget,
  },
  'iframe-embed': {
    type: 'iframe-embed',
    title: '沙箱应用与网页画板嵌入',
    description: '安全内嵌白板工具、在线画图、API 调试器或任意自定义 Web 应用。',
    category: 'tools',
    icon: 'ExternalLink',
    defaultColSpan: 8,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '安全沙箱',
    component: IframeWidget,
  },
  'live-api': {
    type: 'live-api',
    title: 'REST 动态接口遥测',
    description: '低代码轮询任意外部 REST/JSON API 接口，实时提取并监控关键数据指标。',
    category: 'tools',
    icon: 'Activity',
    defaultColSpan: 4,
    defaultRowSpan: 1,
    minColSpan: 3,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '低代码动态流',
    component: LiveApiWidget,
  },
  'rss-feed': {
    type: 'rss-feed',
    title: '技术动态与社区早报',
    description: '聚合前沿框架 Release、博客动态与社区头条，保持敏锐技术嗅觉。',
    category: 'content',
    icon: 'Rss',
    defaultColSpan: 5,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '技术动态',
    component: RssFeedWidget,
  },
}

/**
 * 开箱即用的预设排版模版
 */
export const PRESET_TEMPLATES: ModularPresetTemplate[] = [
  {
    id: 'developer-workbench',
    name: '💻 全栈极客工作台',
    description: '整合代码工具箱、0-RTT 推测终端、今日技术飙升榜与随手备忘，适合日常研发工作。',
    icon: 'Terminal',
    widgets: [
      { type: 'clock-pomodoro', colSpan: 3, rowSpan: 1, config: {} },
      { type: 'quick-tools', colSpan: 4, rowSpan: 1, config: {} },
      { type: 'speculative-terminal', colSpan: 5, rowSpan: 1, config: {} },
      { type: 'trending-radar', colSpan: 6, rowSpan: 2, config: {} },
      { type: 'markdown-notes', colSpan: 6, rowSpan: 2, config: {} },
      { type: 'favorites-dock', colSpan: 6, rowSpan: 1, config: {} },
      { type: 'system-metrics', colSpan: 6, rowSpan: 1, config: {} },
    ],
  },
  {
    id: 'productive-launchpad',
    name: '⚡ 极速效率启动坞',
    description: '极简专注，核心突出番茄时钟、星标收藏坞与快捷工具，免受信息过载打扰。',
    icon: 'Zap',
    widgets: [
      { type: 'clock-pomodoro', colSpan: 4, rowSpan: 1, config: {} },
      { type: 'favorites-dock', colSpan: 4, rowSpan: 1, config: {} },
      { type: 'quick-tools', colSpan: 4, rowSpan: 1, config: {} },
      { type: 'markdown-notes', colSpan: 12, rowSpan: 2, config: {} },
    ],
  },
  {
    id: 'architect-radar',
    name: '🔬 架构师技术雷达',
    description: '侧重技术选型对比、开源平替方案、全网趋势监测与认知中枢算法健康度。',
    icon: 'Layers',
    widgets: [
      { type: 'hyperbolic-radar', colSpan: 6, rowSpan: 2, config: {} },
      { type: 'trending-radar', colSpan: 6, rowSpan: 2, config: {} },
      { type: 'system-metrics', colSpan: 6, rowSpan: 2, config: {} },
      { type: 'quick-tools', colSpan: 6, rowSpan: 1, config: {} },
      { type: 'clock-pomodoro', colSpan: 6, rowSpan: 1, config: {} },
    ],
  },
  {
    id: 'zen-designer',
    name: '🎨 创意设计与视觉工坊',
    description: '集成沙箱画板、GitHub 贡献热力、实时气象与速记便签，兼顾灵感与专注。',
    icon: 'Palette',
    widgets: [
      { type: 'weather-clock', colSpan: 4, rowSpan: 1, config: {} },
      { type: 'clock-pomodoro', colSpan: 4, rowSpan: 1, config: {} },
      { type: 'favorites-dock', colSpan: 4, rowSpan: 1, config: {} },
      { type: 'github-heatmap', colSpan: 6, rowSpan: 2, config: {} },
      { type: 'markdown-notes', colSpan: 6, rowSpan: 2, config: {} },
      { type: 'iframe-embed', colSpan: 12, rowSpan: 2, config: {} },
    ],
  },
]


/**
 * 根据类型创建一个新的模块实例
 */
export function createWidgetInstance(type: string): WidgetInstance {
  const def = WIDGET_REGISTRY[type]
  if (!def) {
    throw new Error(`未知模块类型: ${type}`)
  }

  return {
    id: `widget-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    colSpan: def.defaultColSpan,
    rowSpan: def.defaultRowSpan,
    config: {},
    createdAt: Date.now(),
  }
}
