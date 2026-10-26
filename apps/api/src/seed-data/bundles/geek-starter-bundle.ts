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
      "极客一站到底的开局包：前端武器库 + 开发者效率精选 + 后端与云原生工程包 + AI 与大模型工具包 + 软件效率工具包，加极客检索与学术文献两套搜索包与两套深色皮肤，约 400 个专业站点与 50 个 !前缀 检索源一次到位，主题可在「已安装」页切换启用。单层组合、不含可执行代码，卸载不级联。",
    icon: "🧩",
    author: "山羊胡官方",
    license: "MIT",
    version: "2.0.0",
    tags: ["起步包", "组合", "极客", "开发"],
    payload: {
      items: [
        { slug: "front-end-arsenal", kind: "site-pack" },
        { slug: "seed-dev-efficiency", kind: "site-pack" },
        { slug: "backend-cloud-arsenal", kind: "site-pack" },
        { slug: "ai-tools-arsenal", kind: "site-pack" },
        { slug: "software-utilities", kind: "site-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "dracula-dark", kind: "theme" },
        { slug: "aurora-emerald", kind: "theme" },
      ],
    },
  },
};
