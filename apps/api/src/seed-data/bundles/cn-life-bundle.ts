/**
 * 种子插件：中文生活组合包
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const cnLifeBundle: SeedPluginDef = {
  slug: "cn-life-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "中文生活组合包",
    description:
      "把导航站变成中文家庭门户：共 4 个成员——中文生活检索（36 个 !前缀）与极客开发者检索（40 个 !前缀）2 个搜索引擎包，合计 76 个 !前缀；配暖阳琥珀与纸感拿铁 2 套浅色主题。用 !xhs、!weibo、!gh 等前缀查口碑、比价、找攻略、订票与查文档，适合家庭或办公共用首页。",
    icon: "🏠",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.1.1",
    tags: ["中文", "生活", "学习", "组合包"],
    payload: {
      items: [
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};
