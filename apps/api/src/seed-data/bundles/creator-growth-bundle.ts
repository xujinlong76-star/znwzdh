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
      "自媒体与运营的一体化开局：共 3 个成员——中文生活检索包（36 个 !前缀）1 个搜索引擎包，配暖阳琥珀与纸感拿铁 2 套浅色主题。用 !xhs、!weibo、!dy、!bili、!zh 等前缀直达社交、短视频与问答检索，从选题到分发一次成型。",
    icon: "🚀",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["创作者", "运营", "增长", "组合包"],
    payload: {
      items: [
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};
