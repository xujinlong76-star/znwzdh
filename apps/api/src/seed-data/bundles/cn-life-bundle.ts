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
      "把导航站变成中文家庭门户：中文生活综合导航（日常办事入口）+ 学习与自我提升包（充电学习）+ 购物电商、医疗健康、旅行出行、政务民生四个高频场景包，加中文生活检索与极客检索两套搜索包，配暖阳琥珀与纸质拿铁两套浅色主题，适合家庭或办公共用首页。",
    icon: "🏠",
    author: "NavHub 官方",
    license: "MIT",
    version: "1.1.0",
    tags: ["中文", "生活", "学习", "组合包"],
    payload: {
      items: [
        { slug: "cn-daily-navigation", kind: "site-pack" },
        { slug: "learn-growth-arsenal", kind: "site-pack" },
        { slug: "shopping-ecommerce", kind: "site-pack" },
        { slug: "health-wellness", kind: "site-pack" },
        { slug: "travel-mobility", kind: "site-pack" },
        { slug: "gov-public-service", kind: "site-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};
