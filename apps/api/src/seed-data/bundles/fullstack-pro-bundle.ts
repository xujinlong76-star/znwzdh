/**
 * 种子插件：全栈工程组合包
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const fullstackProBundle: SeedPluginDef = {
  slug: "fullstack-pro-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "全栈工程组合包",
    description:
      "全栈开发者的完整配置：共 4 个成员——极客开发者检索（40 个 !前缀）与学术文献检索（38 个 !前缀）2 个搜索引擎包，合计 78 个 !前缀；配德古拉与暮色罗盘 2 套深色主题。用 !gh、!npm、!k8s、!arxiv 等前缀直达代码托管、包仓库、云原生文档与论文检索，一次安装成型。",
    icon: "🚀",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "2.0.0",
    tags: ["全栈", "组合包", "效率", "开发"],
    payload: {
      items: [
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "dracula-dark", kind: "theme" },
        { slug: "seed-dusk-compass", kind: "theme" },
      ],
    },
  },
};
