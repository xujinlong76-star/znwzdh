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
      "全栈开发者的完整配置：前端武器库 + 后端与云原生工程包 + 开发者效率精选 + AI 与大模型工具包 + 软件效率工具包 + 设计师灵感导航，加极客检索与学术文献两套搜索包与两套深色主题，覆盖前端、后端、云原生、AI 与设计素材，一次安装成型。",
    icon: "🚀",
    author: "NavHub 官方",
    license: "MIT",
    version: "2.0.0",
    tags: ["全栈", "组合包", "效率", "开发"],
    payload: {
      items: [
        { slug: "front-end-arsenal", kind: "site-pack" },
        { slug: "backend-cloud-arsenal", kind: "site-pack" },
        { slug: "seed-dev-efficiency", kind: "site-pack" },
        { slug: "seed-design-inspiration", kind: "site-pack" },
        { slug: "ai-tools-arsenal", kind: "site-pack" },
        { slug: "software-utilities", kind: "site-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "dracula-dark", kind: "theme" },
        { slug: "seed-dusk-compass", kind: "theme" },
      ],
    },
  },
};
