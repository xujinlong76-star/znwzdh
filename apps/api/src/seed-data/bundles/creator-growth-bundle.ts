/**
 * 种子插件：创作者增长组合包
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const creatorGrowthBundle: SeedPluginDef = {
  slug: "creator-growth-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "创作者增长组合包",
    description:
      "自媒体与运营的一体化开局：自媒体运营增长包（选题/设计/剪辑/投放/变现）+ 运营营销增长包 + AI 与大模型工具包（AI 提效创作）+ 前端武器库（落地页与作品集）+ 设计师灵感导航与影音娱乐包（素材与配乐），加中文生活检索包与暖阳琥珀、纸质拿铁两套浅色皮肤，从选题到分发一次成型。",
    icon: "🚀",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["创作者", "运营", "增长", "组合包"],
    payload: {
      items: [
        { slug: "creator-ops-arsenal", kind: "site-pack" },
        { slug: "ai-tools-arsenal", kind: "site-pack" },
        { slug: "front-end-arsenal", kind: "site-pack" },
        { slug: "growth-marketing", kind: "site-pack" },
        { slug: "seed-design-inspiration", kind: "site-pack" },
        { slug: "media-entertainment", kind: "site-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};
