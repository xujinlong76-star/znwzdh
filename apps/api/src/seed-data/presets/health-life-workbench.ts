/**
 * 种子插件：健康生活工作台
 *
 * 面向运动、作息与饮食管理的四看板布局，遵循与其他预设一致的纯声明式写法：
 * 只引用前端注册表中已登记的模块类型，colSpan / rowSpan 均落在允许区间内。
 */
import type { SeedPluginDef } from "../types.ts";

export const healthLifeWorkbench: SeedPluginDef = {
  slug: "health-life-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "健康生活工作台",
    description:
      "面向健身与健康管理人群的四看板布局（共 21 个模块）：每日作息、运动训练、饮食管理、心情与复盘。覆盖作息节律、运动打卡热力、营养换算与习惯记录，把「看状态 → 练一场 → 记一餐 → 做复盘」串在同一个工作台上，安装即用。",
    icon: "🥗",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["工作台", "健康", "运动", "饮食", "作息"],
    payload: {
      boards: [
        {
          name: "每日作息",
          widgets: [
            { type: "weather-clock", customTitle: "今日天气与体感", colSpan: 4, rowSpan: 2 },
            { type: "clock-pomodoro", customTitle: "起居节律钟", colSpan: 4, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "睡眠与起居记录", colSpan: 4, rowSpan: 2 },
            { type: "quick-search", customTitle: "健康知识速查", colSpan: 6, rowSpan: 1 },
            { type: "quick-tools", customTitle: "BMI 与热量换算", colSpan: 6, rowSpan: 1 },
          ],
        },
        {
          name: "运动训练",
          widgets: [
            { type: "github-heatmap", customTitle: "运动打卡热力", colSpan: 8, rowSpan: 2 },
            { type: "system-metrics", customTitle: "身体指标中枢", colSpan: 4, rowSpan: 2 },
            { type: "clock-pomodoro", customTitle: "训练计时器", colSpan: 4, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "训练计划与记录", colSpan: 4, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "周训练量卡片", colSpan: 4, rowSpan: 2 },
          ],
        },
        {
          name: "饮食管理",
          widgets: [
            { type: "custom-category", customTitle: "健康食谱与营养站入口", colSpan: 12, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "每日饮食记录", colSpan: 6, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "营养摄入卡片", colSpan: 6, rowSpan: 2 },
            { type: "quick-tools", customTitle: "热量与克数换算", colSpan: 6, rowSpan: 1 },
            { type: "rss-feed", customTitle: "营养科普订阅", colSpan: 6, rowSpan: 1 },
          ],
        },
        {
          name: "心情与复盘",
          widgets: [
            { type: "trending-radar", customTitle: "健康生活热榜", colSpan: 8, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "习惯与心情日记", colSpan: 4, rowSpan: 2 },
            { type: "rss-feed", customTitle: "健康资讯订阅", colSpan: 8, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "目标达成卡片", colSpan: 4, rowSpan: 2 },
            { type: "clock-pomodoro", customTitle: "专注冥想钟", colSpan: 6, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "健康应用启动坞", colSpan: 6, rowSpan: 1 },
          ],
        },
      ],
    },
  },
};
