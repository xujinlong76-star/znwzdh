/**
 * 种子插件：家庭生活组合包（bundle）
 *
 * 场景：以一个家庭为使用单位——共用一套中文生活检索与三套柔和主题，
 * 在主搜索框用 !前缀直达口碑、比价、订票与出行检索。
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
      "以一个家庭为单位的一次性配置：共 4 个成员——中文生活检索包（39 个 !前缀）1 个搜索引擎包，配樱花薄雾、暖阳琥珀与纸感拿铁 3 套柔和主题。用 !dianping、!meituan、!jd、!mafengwo 等前缀查口碑、比价、订票与出行。装完即可当家庭共用首页。",
    icon: "👨‍👩‍👧",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["家庭", "亲子", "宠物", "生活", "组合包"],
    payload: {
      items: [
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sakura-mist", kind: "theme" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};
