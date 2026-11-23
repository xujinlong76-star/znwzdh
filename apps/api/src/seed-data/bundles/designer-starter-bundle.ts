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
      "设计师的一体化开局：共 4 个成员——极客开发者检索（40 个 !前缀）与中文生活检索（36 个 !前缀）2 个搜索引擎包，合计 76 个 !前缀；配暖阳琥珀浅色与极光青深色 2 套主题。用 !gh、!npm、!xhs 等前缀直达代码、设计与生活服务检索。一次安装即可开箱即用。",
    icon: "🎨",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.1",
    tags: ["设计", "起步包", "组合", "灵感"],
    payload: {
      items: [
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "aurora-emerald", kind: "theme" },
      ],
    },
  },
};
