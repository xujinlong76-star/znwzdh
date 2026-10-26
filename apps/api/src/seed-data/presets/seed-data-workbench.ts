/**
 * 种子插件：数据洞察工作台
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const seedDataWorkbench: SeedPluginDef = {
  slug: "seed-data-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "数据洞察工作台",
    description:
      "面向技术趋势观察者与数据同学的三看板布局（共 17 个模块）：数据洞察、极客速查、沉淀复盘。热榜雷达、中枢监控、速查终端、双曲雷达与专注时钟一次到位。",
    icon: "📊",
    author: "山羊胡官方",
    license: "MIT",
    version: "2.0.0",
    tags: ["工作台", "看板", "效率", "数据"],
    payload: {
      boards: [
        {
          name: "数据洞察",
          widgets: [
            { type: "trending-radar", customTitle: "全网技术热榜", colSpan: 8, rowSpan: 2 },
            { type: "system-metrics", customTitle: "中枢运行监控", colSpan: 4, rowSpan: 2 },
            { type: "quick-search", customTitle: "多引擎聚合检索", colSpan: 6, rowSpan: 1 },
            { type: "github-heatmap", customTitle: "开源项目活跃度", colSpan: 6, rowSpan: 2 },
            { type: "quick-tools", customTitle: "常用工具速达", colSpan: 4, rowSpan: 1 },
            { type: "clock-pomodoro", customTitle: "专注时钟", colSpan: 4, rowSpan: 1 },
          ],
        },
        {
          name: "极客速查",
          widgets: [
            { type: "speculative-terminal", customTitle: "预判终端", colSpan: 6, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "速记台", colSpan: 6, rowSpan: 2 },
            { type: "hyperbolic-radar", customTitle: "双曲技术雷达", colSpan: 7, rowSpan: 2 },
            { type: "live-api", customTitle: "接口实时探测", colSpan: 5, rowSpan: 2 },
            { type: "favorites-dock", customTitle: "高频站点启动坞", colSpan: 4, rowSpan: 1 },
            { type: "weather-clock", customTitle: "天气与日程", colSpan: 4, rowSpan: 1 },
          ],
        },
        {
          name: "沉淀复盘",
          widgets: [
            { type: "custom-category", customTitle: "专题资料入口", colSpan: 8, rowSpan: 2 },
            { type: "rss-feed", customTitle: "订阅源快读", colSpan: 4, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "周报复盘", colSpan: 5, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "指标卡片墙", colSpan: 7, rowSpan: 2 },
            { type: "quick-tools", customTitle: "字段口径与换算工具", colSpan: 6, rowSpan: 1 },
            { type: "weather-clock", customTitle: "复盘时段与天气", colSpan: 6, rowSpan: 1 },
          ],
        },
        {
          name: "自动化与标注",
          widgets: [
            { type: "custom-category", customTitle: "数据源与工具入口", colSpan: 12, rowSpan: 2 },
            { type: "live-api", customTitle: "数据管道接口探测", colSpan: 6, rowSpan: 1 },
            { type: "quick-search", customTitle: "字段与口径速查", colSpan: 6, rowSpan: 1 },
            { type: "markdown-notes", customTitle: "数据字典与口径笔记", colSpan: 6, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "数据质量卡片", colSpan: 6, rowSpan: 2 },
          ],
        },
      ],
    },
  },
};
