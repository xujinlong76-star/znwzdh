/**
 * 种子插件：极客起步组合包
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const geekStarterBundle: SeedPluginDef = {
  slug: "geek-starter-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "极客起步组合包",
    description:
      "极客一站到底的开局包：共 4 个成员——极客开发者检索（40 个 !前缀）与学术文献检索（38 个 !前缀）2 个搜索引擎包，合计 78 个 !前缀；配德古拉与极光青 2 套深色主题。用 !gh、!npm、!mdn、!arxiv、!gs 等前缀直达代码托管、包仓库、文档与论文检索，主题可在「已安装」页切换启用。单层组合、不含可执行代码，卸载不级联。",
    icon: "🧩",
    author: "山羊胡官方",
    license: "MIT",
    version: "2.0.0",
    tags: ["起步包", "组合", "极客", "开发"],
    payload: {
      items: [
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "dracula-dark", kind: "theme" },
        { slug: "aurora-emerald", kind: "theme" },
      ],
    },
  },
};
