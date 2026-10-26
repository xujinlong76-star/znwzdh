/**
 * 种子插件：家庭生活组合包（bundle）
 *
 * 场景：以一个家庭为使用单位——上有老人健康、下有孩子养育、还要管宠物、采购、出行与日常办事。
 * 把「宠物家庭育儿 + 医疗健康 + 教育学习 + 购物 + 出行 + 政务」六个高频场景包一次装满，
 * 再配中文检索包与三套柔和主题。
 *
 * 单层组合，成员全部为已上架插件；不含可执行代码，卸载不级联。
 */
import type { SeedPluginDef } from "../types.ts";

export const familyLifeBundle: SeedPluginDef = {
  slug: "family-life-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "家庭生活组合包",
    description:
      "以一个家庭为单位的一次性配置：宠物与育儿全场景包（含宠物医疗、领养、母婴、孕期、早教、亲子场馆与儿童安全）+ 医疗健康 + 教育学习 + 购物电商 + 旅行出行 + 政务民生办事，再配中文生活检索包与三套柔和主题。装完即可当家庭共用首页。",
    icon: "👨‍👩‍👧",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["家庭", "亲子", "宠物", "生活", "组合包"],
    payload: {
      items: [
        { slug: "pet-family-parenting", kind: "site-pack" },
        { slug: "health-wellness", kind: "site-pack" },
        { slug: "edu-learning", kind: "site-pack" },
        { slug: "learn-growth-arsenal", kind: "site-pack" },
        { slug: "shopping-ecommerce", kind: "site-pack" },
        { slug: "cn-daily-navigation", kind: "site-pack" },
        { slug: "travel-mobility", kind: "site-pack" },
        { slug: "gov-public-service", kind: "site-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sakura-mist", kind: "theme" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};
