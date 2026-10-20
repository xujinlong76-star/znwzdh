/**
 * 种子插件：运维与 SRE 看板预设
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const devopsWorkbench: SeedPluginDef = {
  slug: "devops-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "运维与 SRE 看板预设",
    description:
      "面向运维架构师与 SRE 的三看板布局（共 18 个模块）：集群全景监控、故障应急响应、值班复盘台。全部组件取自前端注册表，安装即可用，覆盖指标监控、热榜情报、诊断工具、应急终端与复盘速记。",
    icon: "🛠️",
    author: "NavHub 官方",
    license: "MIT",
    version: "2.0.0",
    tags: ["运维", "SRE", "监控", "工作台"],
    payload: {
      boards: [
        {
          name: "集群全景监控",
          widgets: [
            { type: "system-metrics", customTitle: "集群负载与健康度", colSpan: 4, rowSpan: 2 },
            { type: "trending-radar", customTitle: "技术情报热榜", colSpan: 8, rowSpan: 2 },
            { type: "quick-tools", customTitle: "网络诊断工具箱", colSpan: 4, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "值班常用入口", colSpan: 4, rowSpan: 1 },
            { type: "weather-clock", customTitle: "机房所在地天气", colSpan: 4, rowSpan: 1 },
            { type: "github-heatmap", customTitle: "开源依赖更新热度", colSpan: 12, rowSpan: 2 },
          ],
        },
        {
          name: "故障应急响应",
          widgets: [
            { type: "speculative-terminal", customTitle: "指令交互终端", colSpan: 6, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "SOP 应急手册与速记", colSpan: 6, rowSpan: 2 },
            { type: "quick-search", customTitle: "故障关键词速查", colSpan: 6, rowSpan: 1 },
            { type: "live-api", customTitle: "中枢接口健康探测", colSpan: 6, rowSpan: 1 },
            { type: "rss-feed", customTitle: "云厂商状态页订阅", colSpan: 8, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "值班联系人卡片", colSpan: 4, rowSpan: 2 },
          ],
        },
        {
          name: "值班与复盘",
          widgets: [
            { type: "clock-pomodoro", customTitle: "轮值专注时钟", colSpan: 4, rowSpan: 2 },
            { type: "custom-category", customTitle: "运维知识库入口", colSpan: 8, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "复盘纪要", colSpan: 5, rowSpan: 2 },
            { type: "hyperbolic-radar", customTitle: "开源平替选型雷达", colSpan: 7, rowSpan: 2 },
            { type: "iframe-embed", customTitle: "内嵌 Grafana 面板", colSpan: 12, rowSpan: 2 },
          ],
        },
        {
          name: "容量与变更巡检",
          widgets: [
            { type: "system-metrics", customTitle: "资源水位与配额巡检", colSpan: 4, rowSpan: 2 },
            { type: "github-heatmap", customTitle: "依赖升级变更热力", colSpan: 8, rowSpan: 2 },
            { type: "quick-search", customTitle: "变更单号与服务速查", colSpan: 6, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "巡检与发布入口坞", colSpan: 6, rowSpan: 1 },
            { type: "markdown-notes", customTitle: "变更评审 Checklist", colSpan: 8, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "发布窗口状态卡片", colSpan: 4, rowSpan: 2 },
          ],
        },
      ],
    },
  },
};
