/**
 * 种子插件：旅行规划工作台
 *
 * 面向行程规划、天气与目的地情报的四看板布局，遵循与其他预设一致的纯声明式写法：
 * 只引用前端注册表中已登记的模块类型，colSpan / rowSpan 均落在允许区间内。
 */
import type { SeedPluginDef } from "../types.ts";

export const travelPlannerWorkbench: SeedPluginDef = {
  slug: "travel-planner-workbench",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "workspace-preset",
    name: "旅行规划工作台",
    description:
      "面向自由行与出行规划人群的四看板布局（共 22 个模块）：行程规划、目的地情报、行前准备、旅途复盘。覆盖天气、订票入口、地图嵌入、签证速查与花费复盘，把「定行程 → 查情报 → 备清单 → 写游记」串在同一个工作台上，安装即用。",
    icon: "🧭",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["工作台", "旅行", "行程", "天气", "攻略"],
    payload: {
      boards: [
        {
          name: "行程规划",
          widgets: [
            { type: "markdown-notes", customTitle: "行程总表与日程", colSpan: 8, rowSpan: 2 },
            { type: "weather-clock", customTitle: "目的地天气", colSpan: 4, rowSpan: 2 },
            { type: "custom-category", customTitle: "订票与住宿入口聚合", colSpan: 12, rowSpan: 2 },
            { type: "quick-search", customTitle: "目的地速查", colSpan: 6, rowSpan: 1 },
            { type: "quick-tools", customTitle: "时差与汇率换算", colSpan: 6, rowSpan: 1 },
          ],
        },
        {
          name: "目的地情报",
          widgets: [
            { type: "rss-feed", customTitle: "旅行攻略订阅", colSpan: 8, rowSpan: 2 },
            { type: "declarative-widget", customTitle: "目的地评分卡片", colSpan: 4, rowSpan: 2 },
            { type: "iframe-embed", customTitle: "地图与街景嵌入", colSpan: 8, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "景点清单与贴士", colSpan: 4, rowSpan: 2 },
            { type: "live-api", customTitle: "航班与汇率接口探测", colSpan: 6, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "旅行工具启动坞", colSpan: 6, rowSpan: 1 },
          ],
        },
        {
          name: "行前准备",
          widgets: [
            { type: "markdown-notes", customTitle: "打包清单与备忘", colSpan: 8, rowSpan: 2 },
            { type: "favorites-dock", customTitle: "出行应用启动坞", colSpan: 4, rowSpan: 2 },
            { type: "quick-search", customTitle: "签证与政策速查", colSpan: 6, rowSpan: 1 },
            { type: "live-api", customTitle: "航班状态接口", colSpan: 6, rowSpan: 1 },
            { type: "custom-category", customTitle: "保险与签证入口", colSpan: 12, rowSpan: 2 },
          ],
        },
        {
          name: "旅途复盘",
          widgets: [
            { type: "clock-pomodoro", customTitle: "旅途节律钟", colSpan: 4, rowSpan: 2 },
            { type: "markdown-notes", customTitle: "旅行日志与花费记录", colSpan: 8, rowSpan: 2 },
            { type: "trending-radar", customTitle: "旅行内容热榜", colSpan: 8, rowSpan: 2 },
            { type: "rss-feed", customTitle: "旅行灵感订阅", colSpan: 4, rowSpan: 2 },
            { type: "quick-tools", customTitle: "花费与汇率复盘", colSpan: 6, rowSpan: 1 },
            { type: "favorites-dock", customTitle: "相册与行程回顾坞", colSpan: 6, rowSpan: 1 },
          ],
        },
      ],
    },
  },
};
