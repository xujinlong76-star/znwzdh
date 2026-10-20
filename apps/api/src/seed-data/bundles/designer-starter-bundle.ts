/**
 * 种子插件：设计师起步组合包
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const designerStarterBundle: SeedPluginDef = {
  slug: "designer-starter-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "设计师起步组合包",
    description:
      "设计师的一体化开局：设计师灵感导航（130+ 素材与工具站点）+ 前端武器库（落地页与作品集）+ 自媒体运营增长包与运营营销包（作品集与宣发）+ 影音娱乐包（视频与配乐素材），加极客与中文两套检索包，配暖阳琥珀浅色与极光青深色皮肤。一次安装即可开箱即用。",
    icon: "🎨",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["设计", "起步包", "组合", "灵感"],
    payload: {
      items: [
        { slug: "seed-design-inspiration", kind: "site-pack" },
        { slug: "front-end-arsenal", kind: "site-pack" },
        { slug: "creator-ops-arsenal", kind: "site-pack" },
        { slug: "growth-marketing", kind: "site-pack" },
        { slug: "media-entertainment", kind: "site-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "aurora-emerald", kind: "theme" },
      ],
    },
  },
};
