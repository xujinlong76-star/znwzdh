/**
 * 种子插件：AI 效率组合包
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const aiPowerBundle: SeedPluginDef = {
  slug: "ai-power-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "AI 效率组合包",
    description:
      "AI 工作流一体化开局：AI 与大模型工具包（120 个 AI 站点）+ 前端武器库（便于落地 AI 应用）+ 后端与云原生工程包（推理服务与部署）+ 开发者效率精选 + 软件效率工具包，加极客检索与学术文献两套搜索包（查文档与论文），配极光青与德古拉两套深色皮肤。",
    icon: "🧠",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["AI", "效率", "组合包"],
    payload: {
      items: [
        { slug: "ai-tools-arsenal", kind: "site-pack" },
        { slug: "front-end-arsenal", kind: "site-pack" },
        { slug: "backend-cloud-arsenal", kind: "site-pack" },
        { slug: "seed-dev-efficiency", kind: "site-pack" },
        { slug: "software-utilities", kind: "site-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "aurora-emerald", kind: "theme" },
        { slug: "dracula-dark", kind: "theme" },
      ],
    },
  },
};
