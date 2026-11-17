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
  // 精选（R2A-2）：市场第一屏精选区第 6 位
  featured: true,
  featuredRank: 6,
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "AI 效率组合包",
    description:
      "AI 工作流一体化开局：共 4 个成员——极客开发者检索（40 个 !前缀）与学术文献检索（38 个 !前缀）2 个搜索引擎包，合计 78 个 !前缀；配极光青与德古拉 2 套深色主题。用 !gh、!npm、!arxiv、!gs 等前缀查文档、论文与代码。",
    icon: "🧠",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["AI", "效率", "组合包"],
    payload: {
      items: [
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "aurora-emerald", kind: "theme" },
        { slug: "dracula-dark", kind: "theme" },
      ],
    },
  },
};
