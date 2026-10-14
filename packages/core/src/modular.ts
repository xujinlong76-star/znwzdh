/**
 * 模块化前端系统核心协议与布局计算算法 (Modular Layout Core Engine)
 */

export type WidgetCategory = 'tools' | 'efficiency' | 'analytics' | 'content' | 'ai'

export interface WidgetConfigSchemaItem {
  key: string
  label: string
  type: 'select' | 'boolean' | 'number' | 'text'
  options?: Array<{ label: string; value: any }>
  defaultValue: any
  description?: string
}

export interface ModularWidgetMeta {
  type: string
  title: string
  description: string
  category: WidgetCategory
  icon: string
  defaultColSpan: number
  defaultRowSpan: number
  minColSpan: number
  maxColSpan: number
  minRowSpan: number
  maxRowSpan: number
  badge?: string
  configSchema?: WidgetConfigSchemaItem[]
}

export interface WidgetInstanceData {
  id: string
  type: string
  customTitle?: string
  colSpan: number
  rowSpan: number
  config: Record<string, unknown>
  createdAt: number
}

export interface ModularPresetTemplateData {
  id: string
  name: string
  description: string
  icon: string
  widgets: Omit<WidgetInstanceData, 'id' | 'createdAt'>[]
}

/**
 * 8 大内置业务模块纯元数据清单
 */
export const BUILTIN_WIDGET_CATALOG: Record<string, ModularWidgetMeta> = {
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
    configSchema: [
      {
        key: 'categoryId',
        label: '默认展示技术分类',
        type: 'select',
        defaultValue: 'ai',
        options: [
          { label: '🤖 AI 与大模型', value: 'ai' },
          { label: '💻 前端与工程化', value: 'dev' },
          { label: '⚡ 效率与灵感', value: 'tools' },
        ],
      },
    ],
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
        label: '默认搜索服务商',
        type: 'select',
        defaultValue: 'google',
        options: [
          { label: 'Google 搜索', value: 'google' },
          { label: 'GitHub 代码仓库', value: 'github' },
          { label: 'npm 包检索', value: 'npm' },
          { label: 'Bing 必应搜索', value: 'bing' },
        ],
      },
    ],
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
    configSchema: [
      {
        key: 'username',
        label: 'GitHub 账号用户名',
        type: 'text',
        defaultValue: 'torvalds',
        description: '输入公开的 GitHub 用户名以生成贡献活跃度',
      },
      {
        key: 'theme',
        label: '热力图颜色主题',
        type: 'select',
        defaultValue: 'emerald',
        options: [
          { label: '翡翠极光绿 (Emerald)', value: 'emerald' },
          { label: '日落琥珀橙 (Amber)', value: 'amber' },
          { label: '赛博霓虹紫 (Purple)', value: 'purple' },
          { label: '冰晶天青蓝 (Cyan)', value: 'cyan' },
        ],
      },
    ],
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
    configSchema: [
      {
        key: 'city',
        label: '城市位置',
        type: 'select',
        defaultValue: 'shanghai',
        options: [
          { label: '北京 (Beijing)', value: 'beijing' },
          { label: '上海 (Shanghai)', value: 'shanghai' },
          { label: '广州 (Guangzhou)', value: 'guangzhou' },
          { label: '深圳 (Shenzhen)', value: 'shenzhen' },
          { label: '杭州 (Hangzhou)', value: 'hangzhou' },
          { label: '成都 (Chengdu)', value: 'chengdu' },
          { label: '东京 (Tokyo)', value: 'tokyo' },
          { label: '旧金山 (San Francisco)', value: 'sf' },
        ],
      },
      {
        key: 'unit',
        label: '温度单位',
        type: 'select',
        defaultValue: 'celsius',
        options: [
          { label: '摄氏度 (°C)', value: 'celsius' },
          { label: '华氏度 (°F)', value: 'fahrenheit' },
        ],
      },
    ],
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
    configSchema: [
      {
        key: 'url',
        label: '嵌入网址 URL',
        type: 'text',
        defaultValue: 'https://excalidraw.com',
        description: '请输入支持 iframe 嵌入的安全 HTTPS 页面链接',
      },
      {
        key: 'allowFullscreen',
        label: '允许全屏扩展',
        type: 'boolean',
        defaultValue: true,
      },
    ],
  },
}

/**
 * 多看板工作台系统契约
 */
export interface ModularBoardData {
  id: string
  name: string
  widgets: WidgetInstanceData[]
}

export interface ModularWorkspaceState {
  version: number
  activeBoardId: string
  boards: ModularBoardData[]
}

/**
 * 官方预设模版纯元数据
 */
export const BUILTIN_PRESET_TEMPLATES: ModularPresetTemplateData[] = [
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
 * 列表重排纯函数
 */
export function reorderWidgetsList<T>(list: T[], sourceIndex: number, destinationIndex: number): T[] {
  if (sourceIndex === destinationIndex) return [...list]
  if (sourceIndex < 0 || sourceIndex >= list.length) return [...list]
  if (destinationIndex < 0 || destinationIndex >= list.length) return [...list]
  const next = [...list]
  const removed = next.splice(sourceIndex, 1)
  const moved = removed[0]
  if (moved !== undefined) {
    next.splice(destinationIndex, 0, moved)
  }
  return next
}

/**
 * 移动端方向位移辅助函数 (上移 / 下移)
 */
export function shiftWidgetPosition<T>(list: T[], index: number, direction: 'up' | 'down'): T[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= list.length) return [...list]
  return reorderWidgetsList(list, index, targetIndex)
}

/**
 * 栅格跨度裁剪约束
 */
export function clampWidgetSpan(span: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, span))
}

/**
 * 创建新实例数据
 */
export function createWidgetInstanceData(type: string): WidgetInstanceData {
  const meta = BUILTIN_WIDGET_CATALOG[type]
  if (!meta) {
    throw new Error(`未知模块类型: ${type}`)
  }

  return {
    id: `widget-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    colSpan: meta.defaultColSpan,
    rowSpan: meta.defaultRowSpan,
    config: {},
    createdAt: Date.now(),
  }
}

/**
 * 安全合并模块配置补丁
 */
export function mergeWidgetConfig(
  prevConfig: Record<string, unknown> = {},
  patchConfig: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...prevConfig,
    ...patchConfig,
  }
}

/**
 * 智能紧凑重排算法 (Auto-Compact Grid)
 * 基于 12 栅格行容器的贪心紧凑打包算法，尽可能填满每一行 (合计 12 列)，减少布局碎片空隙。
 */
export function compactWidgetsGrid<T extends { colSpan: number }>(widgets: T[]): T[] {
  if (widgets.length <= 1) return [...widgets]

  const remaining = [...widgets]
  const compacted: T[] = []

  while (remaining.length > 0) {
    let currentRowCols = 0
    const rowItems: T[] = []

    for (let i = 0; i < remaining.length; ) {
      const item = remaining[i]
      if (!item) {
        i++
        continue
      }
      const span = Math.min(12, Math.max(1, item.colSpan || 4))

      if (currentRowCols + span <= 12) {
        rowItems.push(item)
        currentRowCols += span
        remaining.splice(i, 1)
      } else {
        i++
      }
    }

    if (rowItems.length === 0 && remaining.length > 0) {
      const first = remaining.shift()
      if (first) {
        compacted.push(first)
      }
    } else {
      compacted.push(...rowItems)
    }
  }

  return compacted
}

