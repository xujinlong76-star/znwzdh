/**
 * 种子插件：法务与合规组合包（bundle）
 *
 * 场景：企业法务 / 律所 / 创业者的日常——查论文、专利与代码，
 * 配两个专业检索包与三套深色主题。
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
      "面向法务、律师与创业者的专业配置：共 5 个成员——学术文献检索（38 个 !前缀）与极客开发者检索（40 个 !前缀）2 个搜索引擎包，合计 78 个 !前缀；配北欧冰霜、深海蓝与复古暖棕 3 套深色主题。用 !gs、!patents、!cnki、!gh 等前缀查论文、专利与代码。查证、起草、合规三条线一次到位。",
    icon: "⚖️",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["法律", "合规", "法务", "专业", "组合包"],
    payload: {
      items: [
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "nord-frost", kind: "theme" },
        { slug: "ocean-deep", kind: "theme" },
        { slug: "gruvbox-retro", kind: "theme" },
      ],
    },
  },
};
