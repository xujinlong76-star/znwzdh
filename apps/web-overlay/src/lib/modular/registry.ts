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
import { DeclarativeWidget } from '@/components/modular/modules/declarative-widget'

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
    title: '站内热度榜',
    description:
      '按本站自己的访问与收藏加权排序：热度指数 = log1p(近 7 天访问) + 1.5·log1p(收藏) − 0.1·站点天数（中枢 recompute_rank 任务产出）。不是 GitHub Star 增长榜；中枢不可用时回退到明确标注的演示数据。',
    category: 'analytics',
    icon: 'TrendingUp',
    defaultColSpan: 5,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '站内实测',
    component: TrendingWidget,
  },
  'hyperbolic-radar': {
    type: 'hyperbolic-radar',
    title: '双曲平替雷达',
    description:
      '输入产品名，用中枢 /api/rank/alternatives 的洛伦兹双曲投影算近邻平替与得分；无向量时走同分类+标签启发式，卡片会标明口径，不给编造的对比数字。',
    category: 'ai',
    icon: 'GitCompare',
    defaultColSpan: 4,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '双曲投影',
    configSchema: [
      {
        key: 'site',
        label: '预查产品名',
        type: 'text',
        defaultValue: '',
        description: '卡片打开时自动检索这个词；留空则等你输入',
      },
      {
        key: 'limit',
        label: '候选数量（3-8）',
        type: 'number',
        defaultValue: 4,
      },
    ],
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
    title: '中枢分类精选站点',
    description:
      '按中枢类目实时检索该分类下的存活站点卡片；页签取站点数最多的叶子类目，取不到数据时明确报错而不是回落到内置示例。',
    category: 'content',
    icon: 'Folder',
    defaultColSpan: 6,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '分类嵌入',
    configSchema: [
      {
        key: 'categoryId',
        label: '类目标识',
        type: 'text',
        defaultValue: '',
        description: '填类目 slug（如 ai-tools）、id 或唯一标题；留空则自动选中枢里存活站点最多的叶子类目',
      },
      {
        key: 'limit',
        label: '显示站点数（3-12）',
        type: 'number',
        defaultValue: 6,
      },
    ],
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
    configSchema: [
      {
        key: 'defaultEngine',
        label: '默认搜索引擎',
        type: 'select',
        defaultValue: 'google',
        description: '卡片打开时先选中哪个引擎；卡内点页签只是临时切换，不会写回配置',
        options: [
          { label: 'Google 搜索', value: 'google' },
          { label: 'GitHub 代码仓库', value: 'github' },
          { label: 'npm 包检索', value: 'npm' },
          { label: 'Bing 必应搜索', value: 'bing' },
          { label: 'MDN 文档检索', value: 'mdn' },
        ],
      },
    ],
    component: QuickSearchWidget,
  },
  'github-heatmap': {
    type: 'github-heatmap',
    title: 'GitHub 提交热力足迹',
    description: '读取指定账号的 GitHub 公开事件，画近 13 周真实提交热力与连续打卡；取不到数据时明确标注，不编提交记录。',
    category: 'analytics',
    icon: 'GitCommit',
    defaultColSpan: 6,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '提交矩阵',
    configSchema: [
      {
        key: 'username',
        label: 'GitHub 用户名',
        type: 'text',
        defaultValue: '',
        description: '留空则不取数（不预填他人账号）',
      },
      {
        key: 'theme',
        label: '色板',
        type: 'select',
        defaultValue: 'emerald',
        options: [
          { label: '翠绿', value: 'emerald' },
          { label: '琥珀', value: 'amber' },
          { label: '紫罗兰', value: 'purple' },
          { label: '青色', value: 'cyan' },
        ],
      },
    ],
    component: GithubHeatmapWidget,
  },
  'weather-clock': {
    type: 'weather-clock',
    title: '实时天气与环境气象',
    description:
      '由服务端 /api/weather 代取 Open-Meteo 的实况气温、体感、湿度、风力与近三日预报，空气指数单独取自空气质量上游；取不到时明确报错或标注旧观测，不用写死的示例温度冒充实时。',
    category: 'efficiency',
    icon: 'CloudSun',
    defaultColSpan: 4,
    defaultRowSpan: 1,
    minColSpan: 3,
    maxColSpan: 6,
    minRowSpan: 1,
    maxRowSpan: 2,
    badge: '环境气象',
    configSchema: [
      {
        key: 'city',
        label: '城市',
        type: 'select',
        defaultValue: 'shanghai',
        description: '城市为内置坐标表（只支持下列城市），换城市不需要填地址',
        options: [
          { label: '北京', value: 'beijing' },
          { label: '上海', value: 'shanghai' },
          { label: '广州', value: 'guangzhou' },
          { label: '深圳', value: 'shenzhen' },
          { label: '杭州', value: 'hangzhou' },
          { label: '成都', value: 'chengdu' },
          { label: '东京', value: 'tokyo' },
          { label: '旧金山', value: 'sf' },
        ],
      },
      {
        key: 'unit',
        label: '温度单位',
        type: 'select',
        defaultValue: 'celsius',
        description: '卡上按钮只是本卡临时切换，要长期生效改这里',
        options: [
          { label: '摄氏度 (°C)', value: 'celsius' },
          { label: '华氏度 (°F)', value: 'fahrenheit' },
        ],
      },
    ],
    component: WeatherWidget,
  },
  'iframe-embed': {
    type: 'iframe-embed',
    title: '沙箱应用与网页画板嵌入',
    description:
      '内嵌白板、在线画图或自己部署的 Web 应用；沙箱不含同源与顶层跳转权限。注意 Google、GitHub 等站点会用 X-Frame-Options 拒绝被内嵌，卡上会明确提示。',
    category: 'tools',
    icon: 'ExternalLink',
    defaultColSpan: 8,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '安全沙箱',
    configSchema: [
      {
        key: 'url',
        label: '嵌入地址',
        type: 'text',
        defaultValue: '',
        description: '填完整 http(s) 地址；留空用预设白板。伪协议与非 http(s) 一律拒绝内嵌。',
      },
      {
        key: 'allowFullscreen',
        label: '允许嵌入页全屏',
        type: 'boolean',
        defaultValue: true,
        description: '视频/白板类站点需要全屏时保持开启；纯预览可以关掉。',
      },
    ],
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
    configSchema: [
      {
        key: 'title',
        label: '监控项名称',
        type: 'text',
        defaultValue: 'REST 接口动态遥测',
      },
      {
        key: 'apiUrl',
        label: '请求接口地址 (URL)',
        type: 'text',
        defaultValue: '/api/hub/health',
        description: '支持同源接口或允许 CORS 的公开 JSON API',
      },
      {
        key: 'jsonKey',
        label: '提取字段路径 (JSONPath)',
        type: 'text',
        defaultValue: 'status',
        description: '如 status 或 data.count',
      },
      {
        key: 'unit',
        label: '数值单位 (可选)',
        type: 'text',
        defaultValue: '',
        description: '如 ms, %, 个',
      },
      {
        key: 'refreshIntervalSeconds',
        label: '轮询间隔 (秒)',
        type: 'number',
        defaultValue: 30,
      },
    ],
    component: LiveApiWidget,
  },
  'rss-feed': {
    type: 'rss-feed',
    title: '自定义 RSS/Atom 订阅',
    description:
      '由服务端代取指定订阅源并解析条目（绕开浏览器 CORS）。必须自己填订阅地址；未填时卡片只说明如何配置，不展示示例新闻。',
    category: 'content',
    icon: 'Rss',
    defaultColSpan: 5,
    defaultRowSpan: 2,
    minColSpan: 4,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '订阅源',
    configSchema: [
      {
        key: 'feedUrl',
        label: '订阅地址',
        type: 'text',
        defaultValue: '',
        description: 'RSS 2.0 / Atom / RDF 均可，需公网可访问的 http(s) 地址；内网与元数据地址会被 SSRF 防护拒绝。',
      },
      {
        key: 'title',
        label: '专栏标题',
        type: 'text',
        defaultValue: '',
        description: '留空则显示源自己的标题。',
      },
      {
        key: 'limit',
        label: '显示条数上限',
        type: 'number',
        defaultValue: 8,
      },
    ],
    component: RssFeedWidget,
  },
  'declarative-widget': {
    type: 'declarative-widget',
    title: '声明式微组件沙箱',
    description: '通过安全声明式 JSON Schema 渲染 KPI 指标、状态指示器与动态内容流，0 代码安全隔离。',
    category: 'tools',
    icon: 'Layers',
    defaultColSpan: 4,
    defaultRowSpan: 2,
    minColSpan: 3,
    maxColSpan: 8,
    minRowSpan: 1,
    maxRowSpan: 3,
    badge: '0-Eval 沙箱',
    component: DeclarativeWidget,
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
