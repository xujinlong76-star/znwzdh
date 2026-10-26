/**
 * 种子插件：AI 智能体工作台预设。
 *
 * 「AI 工具包」这类受众名不进类目树（`assertCategoryName` 会按受众轴拒绝），
 * 受众需求改由两个地方承接：`facets.scene=ai` 描述站点本身，
 * 工作台预设描述「人怎么用」——这里就是前者的落地物。
 */
import type { SeedPluginDef } from "../types.ts";

export const aiWorkbench: SeedPluginDef = {
  slug: "ai-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "AI 智能体工作台",
    description:
      "面向 AI 应用开发者与重度用户的四看板布局（共 22 个模块）：模型与情报、提示词与交付、智能体与复盘、学习与评测。把模型速查、热榜、接口探测、提示词库与同类工具雷达收进一屏，装完即用。",
    icon: "🤖",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["工作台", "AI", "智能体", "模型"],
    payload: {
      boards: [
        {
          name: "模型与情报",
          widgets: [
            { type: "quick-search", customTitle: "模型与产品速查", colSpan: 6, rowSpan: 1 },
            { type: "clock-pomodoro", customTitle: "提示词专注钟", colSpan: 3, rowSpan: 1 },
            { type: "weather-clock", customTitle: "时区与天气", colSpan: 3, rowSpan: 1 },
            { type: "trending-radar", customTitle: "AI 热榜雷达", colSpan: 8, rowSpan: 2 },
            { type: "system-metrics", customTitle: "调用与配额监控", colSpan: 4, rowSpan: 2 },
            { type: "rss-feed", customTitle: "模型发布与论文订阅", colSpan: 8, rowSpan: 2 },
            { type: "favorites-dock", customTitle: "常用模型控制台", colSpan: 4, rowSpan: 2 },
          ],
        },
        {
          name: "提示词与交付",
          widgets: [
            { type: "custom-category", customTitle: "AI 工具入口聚合", colSpan: 12, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "提示词库与实验记录", colSpan: 6, rowSpan: 2 },
            { type: "quick-tools", customTitle: "Token 与费用估算", colSpan: 6, rowSpan: 1 },
            { type: "declarative-widget", customTitle: "实验指标卡片", colSpan: 6, rowSpan: 2 },
            { type: "live-api", customTitle: "模型接口探测", colSpan: 6, rowSpan: 1 },
          ],
        },
        {
          name: "智能体与复盘",
          widgets: [
            { type: "speculative-terminal", customTitle: "Agent 指令试跑", colSpan: 5, rowSpan: 1 },
            { type: "clock-pomodoro", customTitle: "深度工作钟", colSpan: 3, rowSpan: 1 },
            { type: "markdown-notes", customTitle: "智能体运行复盘", colSpan: 8, rowSpan: 2 },
            { type: "hyperbolic-radar", customTitle: "同类工具平替雷达", colSpan: 7, rowSpan: 2 },
            { type: "github-heatmap", customTitle: "模型生态更新热度", colSpan: 12, rowSpan: 2 },
            { type: "custom-category", customTitle: "评测与基准入口", colSpan: 8, rowSpan: 2 },
            { type: "favorites-dock", customTitle: "推理与托管平台", colSpan: 4, rowSpan: 2 },
          ],
        },
        {
          name: "学习与评测",
          widgets: [
            { type: "quick-search", customTitle: "基准与论文速查", colSpan: 6, rowSpan: 1 },
            { type: "quick-tools", customTitle: "上下文与成本换算", colSpan: 6, rowSpan: 1 },
            { type: "custom-category", customTitle: "模型与 API 目录", colSpan: 12, rowSpan: 2 },
            { type: "rss-feed", customTitle: "评测与榜单订阅", colSpan: 8, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "跑分与选型记录", colSpan: 4, rowSpan: 2 },
          ],
        },
      ],
    },
  },
};
