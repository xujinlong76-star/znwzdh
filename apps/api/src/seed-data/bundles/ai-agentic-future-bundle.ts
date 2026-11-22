/**
 * 种子插件：AI 智能体时代旗舰全家桶 (Agentic Future Bundle)
 *
 * 一站式开启 2026 智能体自主开发与本地私有化推理全流程生态。
 */
import type { SeedPluginDef } from "../types.ts";

export const aiAgenticFutureBundle: SeedPluginDef = {
  slug: "ai-agentic-future-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "AI 智能体时代旗舰全家桶 (Agentic Future Bundle)",
    description: "2026 前沿 AI 智能体与本地推理旗舰级一站式全家桶：共 4 个成员——AI 深度研究（36 个 !前缀）与全栈代码生态检索（38 个 !前缀）2 个搜索引擎包，合计 74 个 !前缀；配 Catppuccin Mocha 与 OLED 纯黑 2 套极客深色主题。用 !ppx、!smithery、!crates、!rs 等前缀直达 AI 模型、MCP 市场与代码仓库检索，一键完成智能体开发工作流初始化。",
    icon: "🌌",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["AI", "Agent", "MCP", "全家桶", "组合包", "前沿生态"],
    payload: {
      items: [
        { slug: "ai-deep-search-pack", kind: "search-pack" },
        { slug: "code-and-package-search-pack", kind: "search-pack" },
        { slug: "catppuccin-mocha", kind: "theme" },
        { slug: "oled-pure-black", kind: "theme" },
      ],
    },
  },
};
