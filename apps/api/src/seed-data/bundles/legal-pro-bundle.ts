/**
 * 种子插件：法务与合规组合包（bundle）
 *
 * 场景：企业法务 / 律所 / 创业者的日常——查法条、查案例、查主体、管合同、控税务与数据合规、
 * 处理劳动人事与争议解决。把「法律合规 + 金融投资 + 办公协作 + 政务办事 + 求职职场 + 软件工具」
 * 六个包配齐，再加新闻资讯包、两个专业检索包与三套深色主题。
 *
 * 单层组合，成员全部为已上架插件；不含可执行代码，卸载不级联。
 */
import type { SeedPluginDef } from "../types.ts";

export const legalProBundle: SeedPluginDef = {
  slug: "legal-pro-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "法务与合规组合包",
    description:
      "面向法务、律师与创业者的专业配置：法律合规全场景包（法条库、裁判文书、工商信用、合同签署、知产专利、劳动税务与数据隐私、仲裁公证、涉外合规）+ 金融投资 + 办公协作 + 政务办事 + 求职职场 + 软件工具，配新闻资讯包、两个专业检索包与三套深色主题。查证、起草、合规三条线一次到位。",
    icon: "⚖️",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["法律", "合规", "法务", "专业", "组合包"],
    payload: {
      items: [
        { slug: "legal-compliance", kind: "site-pack" },
        { slug: "finance-wealth", kind: "site-pack" },
        { slug: "office-collaboration", kind: "site-pack" },
        { slug: "gov-public-service", kind: "site-pack" },
        { slug: "jobs-career", kind: "site-pack" },
        { slug: "software-utilities", kind: "site-pack" },
        { slug: "news-media-cn", kind: "site-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "nord-frost", kind: "theme" },
        { slug: "ocean-deep", kind: "theme" },
        { slug: "gruvbox-retro", kind: "theme" },
      ],
    },
  },
};
