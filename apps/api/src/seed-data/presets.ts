/**
 * 种子插件：工作台预设（workspace-preset）×3。
 *
 * 约束（与 apps/api/test/seed-plugins.test.ts 的 WIDGET_REGISTRY 快照一致）：
 *   - 每个看板至少 4 个模块，每个预设至少 2 个看板；
 *   - 模块 type 必须已在前端注册表登记，且 colSpan / rowSpan 落在该模块区间内；
 *   - 栅格宽度 12 列，每行模块 colSpan 之和尽量凑满 12。
 *
 * 既有两个预设偏「运维」与「数据」，本批补上内容创作者、学生自习、投资研究三类人群。
 */
import type { SeedPluginDef } from "./types.ts";

export const contentCreatorWorkbench: SeedPluginDef = {
  slug: "content-creator-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "内容创作者工作台",
    description:
      "面向自媒体与内容创作者的三看板布局（共 12 个模块）：选题与灵感、素材与产出、数据复盘。安装即用，把「找选题 → 写稿 → 拍素材 → 看数据」串在同一个工作台上。",
    icon: "✍️",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["工作台", "创作者", "内容", "自媒体"],
    payload: {
      boards: [
        {
          name: "选题与灵感",
          widgets: [
            { type: "quick-search", customTitle: "全网选题速查", colSpan: 6, rowSpan: 1 },
            { type: "quick-tools", customTitle: "标题与标签打磨工具", colSpan: 6, rowSpan: 1 },
            { type: "trending-radar", customTitle: "全网热榜雷达", colSpan: 6, rowSpan: 2 },
            { type: "rss-feed", customTitle: "行业资讯订阅", colSpan: 6, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "选题池与脚本草稿", colSpan: 6, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "选题热度卡片", colSpan: 6, rowSpan: 2 },
          ],
        },
        {
          name: "素材与产出",
          widgets: [
            { type: "custom-category", customTitle: "素材站入口聚合", colSpan: 12, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "文案与脚本成稿", colSpan: 5, rowSpan: 2 },
            { type: "clock-pomodoro", customTitle: "写作专注钟", colSpan: 3, rowSpan: 2 },
            { type: "favorites-dock", customTitle: "常用后台入口", colSpan: 4, rowSpan: 1 },
            { type: "quick-tools", customTitle: "文案字数与格式工具", colSpan: 4, rowSpan: 1 },
          ],
        },
        {
          name: "数据复盘",
          widgets: [
            { type: "declarative-widget", customTitle: "KPI 指标卡片", colSpan: 6, rowSpan: 1 },
            { type: "live-api", customTitle: "账号数据接口探测", colSpan: 6, rowSpan: 1 },
            { type: "github-heatmap", customTitle: "更新节奏热力", colSpan: 6, rowSpan: 3 },
            { type: "weather-clock", customTitle: "拍摄地天气", colSpan: 3, rowSpan: 1 },
            { type: "clock-pomodoro", customTitle: "复盘专注钟", colSpan: 3, rowSpan: 1 },
            { type: "rss-feed", customTitle: "平台数据订阅", colSpan: 6, rowSpan: 2 },
          ],
        },
        {
          name: "发布与互动",
          widgets: [
            { type: "custom-category", customTitle: "分发平台入口聚合", colSpan: 12, rowSpan: 2 },
            { type: "quick-search", customTitle: "评论关键词速查", colSpan: 6, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "多平台后台启动坞", colSpan: 6, rowSpan: 1 },
            { type: "markdown-notes", customTitle: "互动回复模板", colSpan: 6, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "涨粉与互动卡片", colSpan: 6, rowSpan: 2 },
          ],
        },
      ],
    },
  },
};

export const studentStudyWorkbench: SeedPluginDef = {
  slug: "student-study-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "学习自习工作台",
    description:
      "面向学生与自学者的三看板布局（共 12 个模块）：今日学习、课程与资料、复习与沉淀。番茄钟、笔记、资料速查与学术订阅一次就位，装完即可开始自习。",
    icon: "📖",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["工作台", "学习", "自习", "学生"],
    payload: {
      boards: [
        {
          name: "今日学习",
          widgets: [
            { type: "clock-pomodoro", customTitle: "番茄自习钟", colSpan: 4, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "课堂笔记", colSpan: 8, rowSpan: 2 },
            { type: "quick-search", customTitle: "资料速查", colSpan: 6, rowSpan: 1 },
            { type: "weather-clock", customTitle: "自习室天气", colSpan: 3, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "自习常用资料夹", colSpan: 3, rowSpan: 1 },
          ],
        },
        {
          name: "课程与资料",
          widgets: [
            { type: "custom-category", customTitle: "课程与题库入口", colSpan: 12, rowSpan: 2 },
            { type: "rss-feed", customTitle: "学术与课程订阅", colSpan: 6, rowSpan: 2 },
            { type: "favorites-dock", customTitle: "常用资料夹", colSpan: 4, rowSpan: 1 },
            { type: "declarative-widget", customTitle: "学习进度卡片", colSpan: 6, rowSpan: 2 },
            { type: "quick-tools", customTitle: "公式与单位换算", colSpan: 4, rowSpan: 1 },
            { type: "weather-clock", customTitle: "自习室天气速览", colSpan: 4, rowSpan: 1 },
          ],
        },
        {
          name: "复习与沉淀",
          widgets: [
            { type: "markdown-notes", customTitle: "错题与复盘", colSpan: 8, rowSpan: 2 },
            { type: "quick-tools", customTitle: "计算与单位换算", colSpan: 4, rowSpan: 1 },
            { type: "trending-radar", customTitle: "领域热榜", colSpan: 8, rowSpan: 2 },
            { type: "clock-pomodoro", customTitle: "晚间专注钟", colSpan: 4, rowSpan: 2 },
            { type: "weather-clock", customTitle: "自习室气温与湿度", colSpan: 4, rowSpan: 1 },
          ],
        },
        {
          name: "目标与自习室",
          widgets: [
            { type: "markdown-notes", customTitle: "周计划与目标复盘", colSpan: 8, rowSpan: 2 },
            { type: "clock-pomodoro", customTitle: "晨读专注钟", colSpan: 4, rowSpan: 2 },
            { type: "custom-category", customTitle: "自习资料与题库入口", colSpan: 8, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "周目标达成卡片", colSpan: 4, rowSpan: 2 },
            { type: "quick-search", customTitle: "疑难问题速查", colSpan: 6, rowSpan: 1 },
            { type: "quick-tools", customTitle: "常用公式速算", colSpan: 6, rowSpan: 1 },
          ],
        },
      ],
    },
  },
};

export const investorWorkbench: SeedPluginDef = {
  slug: "investor-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "投资研究盯盘工作台",
    description:
      "面向个人投资者与研究者的三看板布局（共 12 个模块）：市场全景、研究与盯盘、复盘与资讯。行情面板、财经热榜、数据源入口与复盘笔记集中在一屏，减少来回切页。",
    icon: "📊",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["工作台", "投资", "财经", "研究"],
    payload: {
      boards: [
        {
          name: "市场全景",
          widgets: [
            { type: "trending-radar", customTitle: "财经热榜", colSpan: 8, rowSpan: 2 },
            { type: "system-metrics", customTitle: "中枢指标", colSpan: 4, rowSpan: 2 },
            { type: "quick-search", customTitle: "公告与新闻速查", colSpan: 8, rowSpan: 1 },
            { type: "weather-clock", customTitle: "时区与天气", colSpan: 4, rowSpan: 1 },
            { type: "rss-feed", customTitle: "研报与快讯订阅", colSpan: 8, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "自选股提醒卡片", colSpan: 4, rowSpan: 2 },
          ],
        },
        {
          name: "研究与盯盘",
          widgets: [
            { type: "iframe-embed", customTitle: "行情面板嵌入", colSpan: 8, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "持仓与逻辑笔记", colSpan: 4, rowSpan: 2 },
            { type: "live-api", customTitle: "数据接口探测", colSpan: 6, rowSpan: 1 },
            { type: "declarative-widget", customTitle: "关注标的卡片", colSpan: 6, rowSpan: 1 },
            { type: "quick-search", customTitle: "行业新闻速查", colSpan: 6, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "数据源启动坞", colSpan: 6, rowSpan: 1 },
          ],
        },
        {
          name: "复盘与资讯",
          widgets: [
            { type: "custom-category", customTitle: "数据源入口", colSpan: 12, rowSpan: 2 },
            { type: "rss-feed", customTitle: "财经研报订阅", colSpan: 8, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "交易复盘纪要", colSpan: 4, rowSpan: 2 },
            { type: "clock-pomodoro", customTitle: "复盘专注钟", colSpan: 3, rowSpan: 1 },
            { type: "weather-clock", customTitle: "时区与天气速览", colSpan: 4, rowSpan: 1 },
            { type: "speculative-terminal", customTitle: "估值与收益率速算", colSpan: 5, rowSpan: 1 },
          ],
        },
        {
          name: "持仓与风控",
          widgets: [
            { type: "system-metrics", customTitle: "组合风险指标", colSpan: 4, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "持仓与交易纪律笔记", colSpan: 8, rowSpan: 2 },
            { type: "live-api", customTitle: "净值与持仓接口探测", colSpan: 6, rowSpan: 1 },
            { type: "declarative-widget", customTitle: "止损止盈卡片", colSpan: 6, rowSpan: 1 },
            { type: "trending-radar", customTitle: "持仓相关热榜", colSpan: 8, rowSpan: 2 },
            { type: "favorites-dock", customTitle: "交易与数据入口坞", colSpan: 4, rowSpan: 2 },
          ],
        },
      ],
    },
  },
};
