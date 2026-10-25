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
    description: "2026 前沿 AI 智能体与本地推理旗舰级一站式全家桶：集齐 AI Agentic 编码包 + MCP 协议与工具库生态包 + 开源大模型与本地推理包 + 经典 AI 工具库，加配 AI 深度研究与全栈代码双搜索引擎包，外加 Catppuccin Mocha 与 OLED 纯黑两套极客深色皮肤，一键完成智能体未来开发工作流初始化。",
    icon: "🌌",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["AI", "Agent", "MCP", "全家桶", "组合包", "前沿生态"],
    payload: {
      items: [
        { slug: "ai-agentic-coding", kind: "site-pack" },
        { slug: "mcp-ecosystem-arsenal", kind: "site-pack" },
        { slug: "open-models-local-inference", kind: "site-pack" },
        { slug: "ai-tools-arsenal", kind: "site-pack" },
        { slug: "ai-deep-search-pack", kind: "search-pack" },
        { slug: "code-and-package-search-pack", kind: "search-pack" },
        { slug: "catppuccin-mocha", kind: "theme" },
        { slug: "oled-pure-black", kind: "theme" },
        { slug: "indie-hacker-global-saas", kind: "site-pack" },
      ],
    },
  },
};
