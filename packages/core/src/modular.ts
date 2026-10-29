/**
 * 模块化前端系统核心协议与布局计算算法 (Modular Layout Core Engine)
 */

import { z } from 'zod'
import { validateAndCleanPluginManifest, type PluginManifestValidation } from './plugin-manifest.ts'

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
 * 内置模块的元数据清单：前端卡片注册表（apps/web-overlay/src/lib/modular/registry.ts）
 * 的键必须与这里一一对应，API 侧的合法类型、AI 规划提示词都由这里派生。
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
          { label: 'MDN 文档检索', value: 'mdn' },
        ],
      },
    ],
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
      { key: 'title', label: '监控项名称', type: 'text', defaultValue: 'REST 接口动态遥测' },
      {
        key: 'apiUrl',
        label: '请求接口地址 (URL)',
        type: 'text',
        defaultValue: '/api/hub/health',
        description: '支持同源接口或允许 CORS 的公开 JSON API',
      },
      { key: 'jsonKey', label: '提取字段路径 (JSONPath)', type: 'text', defaultValue: 'status', description: '如 status 或 data.count' },
      { key: 'unit', label: '数值单位 (可选)', type: 'text', defaultValue: '', description: '如 ms, %, 个' },
      { key: 'refreshIntervalSeconds', label: '轮询间隔 (秒)', type: 'number', defaultValue: 30 },
    ],
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
      { key: 'title', label: '专栏标题', type: 'text', defaultValue: '', description: '留空则显示源自己的标题。' },
      { key: 'limit', label: '显示条数上限', type: 'number', defaultValue: 8 },
    ],
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
  },
}

/** 模块类型名清单（保持目录插入顺序，便于直接进提示词或错误文案） */
export const WIDGET_TYPE_NAMES: readonly string[] = Object.keys(BUILTIN_WIDGET_CATALOG)

/**
 * 找出插件载荷里本部署没有对应卡片的模块类型（按出现顺序去重）。
 *
 * 清单校验（plugin-manifest.ts）只认 type 的**字面格式**——它必须零依赖，
 * 因为前端有一份字节级镜像；于是 `type: 'clock'` 这种「格式合法、卡片不存在」
 * 的载荷能一路通过校验，安装后只是画布上一个渲染不出来的空位。
 * 这道核对交给持有模块目录的调用方（市场写入边界、AI 规划返回处）。
 */
export function findUnknownWorkspaceWidgetTypes(input: unknown): string[] {
  if (!input || typeof input !== 'object') return []
  const payload = (input as { payload?: unknown }).payload
  const boards = (payload as { boards?: unknown } | undefined)?.boards
  if (!Array.isArray(boards)) return []
  const unknown: string[] = []
  for (const board of boards) {
    const widgets = (board as { widgets?: unknown } | undefined)?.widgets
    if (!Array.isArray(widgets)) continue
    for (const widget of widgets) {
      const type = typeof (widget as { type?: unknown } | undefined)?.type === 'string'
        ? String((widget as { type: string }).type).trim()
        : ''
      if (!type || BUILTIN_WIDGET_CATALOG[type]) continue
      if (!unknown.includes(type)) unknown.push(type)
    }
  }
  return unknown
}

/**
 * core 清单校验 + 模块目录核对的联合入口，插件写入边界（发布/更新/AI 生成）应当用它。
 * 校验失败时把目录错误并进已有错误一起返回，作者一次就能看全问题。
 */
export function validatePluginManifestWithCatalog(input: unknown): PluginManifestValidation {
  const validated = validateAndCleanPluginManifest(input)
  const unknownTypes = findUnknownWorkspaceWidgetTypes(validated.ok ? validated.manifest : input)
  if (unknownTypes.length === 0) return validated
  const detail = `工作台预设的模块类型在本部署没有对应卡片：${unknownTypes.join('、')}。合法类型：${WIDGET_TYPE_NAMES.join(' / ')}`
  return validated.ok ? { ok: false, errors: [detail] } : { ok: false, errors: [...validated.errors, detail] }
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

/* ------------------------- AI 画布结果的逐类型校验 ------------------------- */

/** 一次生成最多采纳多少张卡：模型跑飞时不该产出上百张卡片 */
export const MAX_CANVAS_WIDGETS = 24

/**
 * 校验台账的一条记录。
 *
 * 为什么要有这个结构：模型输出是外部输入，而画布是「用户点一下就整套替换」的写入口。
 * 老实现只做两件事——丢掉不认识的 type、把跨度统一夹到 1~12/1~4。前者只报类型名，
 * 后者会把 `colSpan: 1` 塞给一张最小 4 列的卡、把 `rowSpan: 9` 塞给最高 3 行的卡，
 * 夹完就算成功，用户看不出「规划」和「落地」之间被动过哪些手脚。
 * 现在每一处改动都必须记账，并由调用方展示。
 */
export interface CanvasWidgetIssue {
  /** 模型返回数组里的下标（保底布局本身不产生条目） */
  index: number
  type: string
  field: 'span' | 'config' | 'customTitle' | 'structure'
  /** 被改动的字段：跨度记 colSpan / rowSpan，配置记具体 key */
  key: string
  /** 一句话说明「原本是什么、改成了什么、为什么」 */
  message: string
  action: 'adjusted' | 'defaulted' | 'dropped'
}

export interface CanvasWidgetsValidation {
  widgets: WidgetInstanceData[]
  /** 本部署没有对应卡片的类型（按出现顺序去重） */
  droppedTypes: string[]
  issues: CanvasWidgetIssue[]
  /** true = 没有任何合法模块可用，返回的是保底布局，必须对用户明说 */
  usedFallback: boolean
}

/** 配置里承担「去哪取数」的字段：值必须是可内嵌/可请求的地址 */
const URL_LIKE_CONFIG_KEYS = new Set(['url', 'apiurl', 'feedurl'])

/**
 * 只放行 http(s) 绝对地址与同源相对路径。
 * `//host` 是协议相对的**外部**地址，不能跟着 `/` 一起放过。
 */
function isSafeConfigUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function canvasFieldSchema(item: WidgetConfigSchemaItem): z.ZodTypeAny {
  switch (item.type) {
    case 'select': {
      const values = (item.options ?? []).map((option) => String(option.value))
      return z.enum((values.length > 0 ? values : ['__no_option_defined__']) as [string, ...string[]])
    }
    case 'boolean':
      // 字符串 "true"/"false" 由 coerceFieldValue 统一成布尔；这里不接受 z.coerce.boolean()，
      // 它会把 "false" 变成 true（非空字符串都是 true）。
      return z.boolean()
    case 'number':
      return z.number().finite()
    case 'text':
    default:
      return z.string().trim().max(300)
  }
}

function coerceFieldValue(item: WidgetConfigSchemaItem, value: unknown): unknown {
  if (item.type === 'number' && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  if (item.type === 'boolean' && typeof value === 'string') {
    const t = value.trim().toLowerCase()
    if (t === 'true') return true
    if (t === 'false') return false
  }
  if (item.type === 'text' && typeof value === 'string') return value.trim()
  return value
}

function normalizeCanvasConfig(
  rawConfig: unknown,
  meta: ModularWidgetMeta,
  index: number,
  addIssue: (issue: Omit<CanvasWidgetIssue, 'index' | 'type' | 'field'>) => void,
): Record<string, unknown> {
  const schema = meta.configSchema ?? []
  const rawIsObject = Boolean(rawConfig) && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
  const raw = (rawIsObject ? rawConfig : {}) as Record<string, unknown>

  if (!rawIsObject && rawConfig !== undefined && rawConfig !== null) {
    addIssue({
      key: 'config',
      action: 'defaulted',
      message: '配置不是对象，已按默认值重建',
    })
  }

  if (schema.length === 0) {
    const extra = Object.keys(raw)
    if (extra.length > 0) {
      addIssue({
        key: 'config',
        action: 'dropped',
        message: `该模块没有可配字段，模型给的 ${extra.length} 个字段已丢弃（${extra.slice(0, 4).join('、')}）`,
      })
    }
    return {}
  }

  const known = new Set(schema.map((item) => item.key))
  for (const key of Object.keys(raw)) {
    if (known.has(key)) continue
    addIssue({ key, action: 'dropped', message: `配置字段「${key}」不属于该模块，已丢弃` })
  }

  const config: Record<string, unknown> = {}
  for (const item of schema) {
    if (!(item.key in raw)) {
      // 缺字段是提示词允许的正常情形（「需要外部输入时留空」），静默回默认值
      config[item.key] = item.defaultValue
      continue
    }
    const candidate = coerceFieldValue(item, raw[item.key])
    const parsed = canvasFieldSchema(item).safeParse(candidate)
    if (!parsed.success) {
      config[item.key] = item.defaultValue
      addIssue({
        key: item.key,
        action: 'defaulted',
        message: `「${item.label}」的值 ${JSON.stringify(candidate)?.slice(0, 60) ?? 'undefined'} 不合法，已回退默认值`,
      })
      continue
    }
    let value: unknown = parsed.data
    const urlKey = URL_LIKE_CONFIG_KEYS.has(item.key.toLowerCase())
    if (urlKey && typeof value === 'string' && value !== '' && !isSafeConfigUrl(value)) {
      config[item.key] = item.defaultValue
      addIssue({
        key: item.key,
        action: 'dropped',
        message: `「${item.label}」不是 http(s) 或同源相对地址，已清空（伪协议/私有协议不进画布）`,
      })
      continue
    }
    config[item.key] = value
  }
  return config
}

/** 保底布局：拿不到任何合法模块时使用，调用方必须据此标注「未按原规划生成」 */
function fallbackCanvasWidgets(idPrefix: string): WidgetInstanceData[] {
  const widgets: WidgetInstanceData[] = []
  for (const [offset, type] of ['quick-search', 'favorites-dock', 'markdown-notes'].entries()) {
    const meta = BUILTIN_WIDGET_CATALOG[type]
    // 目录改名时这里跳过而不是抛错：保底布局的意义就是「至少给点能用的」
    if (!meta) continue
    widgets.push({
      id: `${idPrefix}-${offset + 1}`,
      type,
      customTitle: meta.title,
      colSpan: meta.defaultColSpan,
      rowSpan: meta.defaultRowSpan,
      config: {},
      createdAt: Date.now(),
    })
  }
  return widgets
}

/**
 * 把模型返回的画布规划校验成可落地的模块实例。
 *
 * 逐类型校验：合法类型来自模块目录；跨度按该类型自己的 min/max 夹紧；
 * config 按目录里声明的字段类型逐字段校验，非法值回默认而不是整卡作废；
 * 内嵌/取数类字段拒绝伪协议。任何改动都进 issues 台账。
 */
export function validateCanvasWidgets(input: unknown, opts: { idPrefix: string }): CanvasWidgetsValidation {
  const issues: CanvasWidgetIssue[] = []
  const droppedTypes: string[] = []
  const widgets: WidgetInstanceData[] = []
  const addIssue = (index: number, type: string, field: CanvasWidgetIssue['field'], detail: Omit<CanvasWidgetIssue, 'index' | 'type' | 'field'>) => {
    issues.push({ index, type, field, ...detail })
  }

  const rawWidgets = Array.isArray((input as { widgets?: unknown } | undefined)?.widgets)
    ? ((input as { widgets: unknown[] }).widgets)
    : null
  if (!rawWidgets) {
    addIssue(0, '(无)', 'structure', {
      key: 'widgets',
      action: 'dropped',
      message: '模型没有返回模块数组（widgets 缺失或不是数组）',
    })
  }

  const list = rawWidgets ?? []
  if (list.length > MAX_CANVAS_WIDGETS) {
    addIssue(MAX_CANVAS_WIDGETS, '(溢出)', 'structure', {
      key: 'widgets',
      action: 'dropped',
      message: `模块数量 ${list.length} 超过上限 ${MAX_CANVAS_WIDGETS}，多余部分已丢弃`,
    })
  }

  list.slice(0, MAX_CANVAS_WIDGETS).forEach((entry, index) => {
    const candidate = entry as { type?: unknown; customTitle?: unknown; colSpan?: unknown; rowSpan?: unknown; config?: unknown }
    if (!candidate || typeof candidate !== 'object') {
      addIssue(index, '(非法条目)', 'structure', { key: 'widget', action: 'dropped', message: '该条目不是对象，已丢弃' })
      return
    }
    const type = String(candidate.type ?? '').trim()
    const meta = BUILTIN_WIDGET_CATALOG[type]
    if (!meta) {
      const label = type || '(空类型)'
      if (!droppedTypes.includes(label)) droppedTypes.push(label)
      addIssue(index, label, 'structure', { key: 'type', action: 'dropped', message: `本部署没有「${label}」这张卡片，整条已丢弃` })
      return
    }

    const spanOf = (value: unknown, min: number, max: number, fallback: number, field: string, label: string): number => {
      const n = typeof value === 'string' ? Number(value) : (value as number)
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        addIssue(index, type, 'span', { key: field, action: 'defaulted', message: `${label} 不是数字，已用默认值 ${fallback}` })
        return fallback
      }
      const clamped = clampWidgetSpan(Math.round(n), min, max)
      if (clamped !== Math.round(n)) {
        addIssue(index, type, 'span', {
          key: field,
          action: 'adjusted',
          message: `${label} ${Math.round(n)} 超出该卡支持的 ${min}~${max}，已改为 ${clamped}`,
        })
      }
      return clamped
    }

    const customTitle =
      typeof candidate.customTitle === 'string' && candidate.customTitle.trim()
        ? candidate.customTitle.trim().slice(0, 60)
        : undefined
    if (candidate.customTitle !== undefined && customTitle === undefined) {
      addIssue(index, type, 'customTitle', { key: 'customTitle', action: 'dropped', message: '自定义标题不是有效文本，已改用卡片默认标题' })
    }

    widgets.push({
      id: `${opts.idPrefix}-${index + 1}`,
      type,
      ...(customTitle ? { customTitle } : {}),
      colSpan: spanOf(candidate.colSpan, meta.minColSpan, meta.maxColSpan, meta.defaultColSpan, 'colSpan', '宽度'),
      rowSpan: spanOf(candidate.rowSpan, meta.minRowSpan, meta.maxRowSpan, meta.defaultRowSpan, 'rowSpan', '高度'),
      config: normalizeCanvasConfig(candidate.config, meta, index, (detail) => addIssue(index, type, 'config', detail)),
      createdAt: Date.now(),
    })
  })

  if (widgets.length === 0) {
    return { widgets: fallbackCanvasWidgets(opts.idPrefix), droppedTypes, issues, usedFallback: true }
  }
  return { widgets, droppedTypes, issues, usedFallback: false }
}

