/**
 * 种子插件：组合包（bundle）×6。
 *
 * 约束（见 docs/PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md 的 F4 受限范围）：
 *   - 单层引用，成员只允许 search-pack / theme（2026-11-15 卸载 34 个 site-packs 后不再引用网址包）；
 *   - 成员必须已上架且 kind 与真实清单一致（apps/api/test/seed-plugins.test.ts 守门）；
 *   - 单个组合包最多 12 个成员。
 *
 * 既有的 5 个组合包覆盖「极客 / 设计师 / 全栈 / 中文生活 / AI」，
 * 本批按人群补齐：资讯读者、生活必备、学习成长、投资研究、内容创作者、玩家。
 */
import type { SeedPluginDef } from "./types.ts";

export const newsReaderBundle: SeedPluginDef = {
  slug: "news-reader-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "资讯读者起步组合包",
    description:
      "资讯阅读一站式起步：共 4 个成员——中文生活检索（36 个 !前缀）与学术文献检索（38 个 !前缀）2 个搜索引擎包，合计 74 个 !前缀；配纸感拿铁与暖阳琥珀 2 套浅色主题。一次安装即得到「看新闻 → 查背景 → 白天护眼」的完整组合。",
    icon: "🗞️",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "资讯", "阅读", "起步"],
    payload: {
      items: [
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "paper-latte", kind: "theme" },
        { slug: "sunlit-amber", kind: "theme" },
      ],
    },
  },
};

export const lifeEssentialsBundle: SeedPluginDef = {
  slug: "life-essentials-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "生活必备组合包",
    description:
      "把日常高频检索一次装齐：共 3 个成员——中文生活检索包（36 个 !前缀）1 个搜索引擎包，配暖阳琥珀与纸感拿铁 2 套浅色主题；用 !tb、!jd、!xhs、!zhipin 等前缀直达购物、口碑、出行与职位检索。",
    icon: "🏠",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "生活", "民生", "必备"],
    payload: {
      items: [
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "sunlit-amber", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};

export const learnerBundle: SeedPluginDef = {
  slug: "learner-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "学习成长组合包",
    description:
      "面向学生与自学者的成长组合：共 4 个成员——学术文献检索（38 个 !前缀）与极客开发者检索（40 个 !前缀）2 个搜索引擎包，合计 78 个 !前缀；配纸感拿铁浅色与极光青深色 2 套主题。覆盖「上课 → 查文献 → 练工具 → 记笔记」全链路。",
    icon: "🎒",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "学习", "学术", "成长"],
    payload: {
      items: [
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "paper-latte", kind: "theme" },
        { slug: "aurora-emerald", kind: "theme" },
      ],
    },
  },
};

export const investorBundle: SeedPluginDef = {
  slug: "investor-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "投资研究组合包",
    description:
      "个人投资者的研究组合：共 4 个成员——学术文献检索（38 个 !前缀）与中文生活检索（36 个 !前缀）2 个搜索引擎包，合计 74 个 !前缀；配北欧冰霜与德古拉 2 套冷色主题。用 !gs、!wb、!xhs、!zh 等前缀查研报、数据与舆情，盯盘、查研报、追数据一条链打通。仅作导航参考，不构成投资建议。",
    icon: "📈",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "投资", "财经", "研究"],
    payload: {
      items: [
        { slug: "academic-search-arsenal", kind: "search-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "nord-frost", kind: "theme" },
        { slug: "dracula-dark", kind: "theme" },
      ],
    },
  },
};

export const creatorBundle: SeedPluginDef = {
  slug: "creator-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "内容创作者组合包",
    description:
      "创作者的一站式装备：共 4 个成员——中文生活检索（36 个 !前缀）与极客开发者检索（40 个 !前缀）2 个搜索引擎包，合计 76 个 !前缀；配复古暖棕与纸感拿铁 2 套主题。找素材、做增长、追趋势都在同一个组合里。",
    icon: "🎨",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "创作者", "运营", "素材"],
    payload: {
      items: [
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "gruvbox-retro", kind: "theme" },
        { slug: "paper-latte", kind: "theme" },
      ],
    },
  },
};

export const gamerBundle: SeedPluginDef = {
  slug: "gamer-bundle",
  status: "published",
  manifest: {
    manifestVersion: 1,
    kind: "bundle",
    name: "玩家组合包",
    description:
      "玩家与电竞爱好者的组合：共 4 个成员——中文生活检索（36 个 !前缀）与极客开发者检索（40 个 !前缀）2 个搜索引擎包，合计 76 个 !前缀；配复古暖棕与德古拉 2 套深色主题。用 !bili、!dy、!gh 等前缀查攻略、看直播与找代码。",
    icon: "🕹️",
    author: "山羊胡官方",
    homepage: "https://www.shanyanghu.com/",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "游戏", "电竞", "玩家"],
    payload: {
      items: [
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "gruvbox-retro", kind: "theme" },
        { slug: "dracula-dark", kind: "theme" },
      ],
    },
  },
};
