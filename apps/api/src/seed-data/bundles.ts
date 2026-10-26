/**
 * 种子插件：组合包（bundle）×6。
 *
 * 约束（见 docs/PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md 的 F4 受限范围）：
 *   - 单层引用，成员只允许 site-pack / search-pack / theme；
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
      "资讯阅读一站式起步：新闻资讯网址包（深度媒体 + 财经科技）+ 金融理财包（追财经数据）+ 影音娱乐包（视频与播客）+ 政务民生包，加中文生活检索与学术文献两套搜索包，配纸质拿铁与暖阳琥珀两套浅色主题，一次安装即得到「看新闻 → 查背景 → 白天护眼」的完整组合。",
    icon: "🗞️",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "资讯", "阅读", "起步"],
    payload: {
      items: [
        { slug: "news-media-cn", kind: "site-pack" },
        { slug: "finance-wealth", kind: "site-pack" },
        { slug: "media-entertainment", kind: "site-pack" },
        { slug: "gov-public-service", kind: "site-pack" },
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
      "把日常高频场景一次装齐：购物电商、医疗健康、旅行出行、政务民生四个网址包，再加教育学习、影音娱乐与求职招聘三个包，配中文生活检索包与暖阳琥珀、纸质拿铁两套浅色主题；从买东西、挂号看病到办证件、订行程、学习充电与求职都在一个组合里。",
    icon: "🏠",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "生活", "民生", "必备"],
    payload: {
      items: [
        { slug: "shopping-ecommerce", kind: "site-pack" },
        { slug: "health-wellness", kind: "site-pack" },
        { slug: "travel-mobility", kind: "site-pack" },
        { slug: "gov-public-service", kind: "site-pack" },
        { slug: "edu-learning", kind: "site-pack" },
        { slug: "media-entertainment", kind: "site-pack" },
        { slug: "jobs-career", kind: "site-pack" },
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
      "面向学生与自学者的成长组合：教育学习网址包 + 学习与自我提升包（技能充电）+ 软件效率工具包 + 开发者效率精选，搭配学术文献与极客两套搜索包，配纸质拿铁浅色与极光青深色主题，覆盖「上课 → 查文献 → 练工具 → 记笔记」全链路。",
    icon: "🎒",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "学习", "学术", "成长"],
    payload: {
      items: [
        { slug: "edu-learning", kind: "site-pack" },
        { slug: "learn-growth-arsenal", kind: "site-pack" },
        { slug: "software-utilities", kind: "site-pack" },
        { slug: "seed-dev-efficiency", kind: "site-pack" },
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
      "个人投资者的研究组合：金融理财网址包（银行/证券/基金/数据）+ 新闻资讯包 + 求职招聘包（看行业与公司）+ 政务民生包（政策与公开数据）+ 软件效率工具包，配学术文献与中文生活两套检索包，加北欧冰霜与德古拉两套冷色主题，盯盘、查研报、追数据一条链打通。仅作站点导航，不构成投资建议。",
    icon: "📈",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "投资", "财经", "研究"],
    payload: {
      items: [
        { slug: "finance-wealth", kind: "site-pack" },
        { slug: "news-media-cn", kind: "site-pack" },
        { slug: "jobs-career", kind: "site-pack" },
        { slug: "gov-public-service", kind: "site-pack" },
        { slug: "software-utilities", kind: "site-pack" },
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
      "创作者的一站式装备：影音娱乐网址包 + 运营营销增长包 + 自媒体运营增长包 + 设计师灵感包 + AI 与大模型工具包 + 前端武器库（作品集与落地页），配中文生活与极客两套检索包，加复古暖棕与纸质拿铁两套主题；找素材、做增长、追趋势都在同一个组合里。",
    icon: "🎨",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "创作者", "运营", "素材"],
    payload: {
      items: [
        { slug: "media-entertainment", kind: "site-pack" },
        { slug: "growth-marketing", kind: "site-pack" },
        { slug: "seed-design-inspiration", kind: "site-pack" },
        { slug: "creator-ops-arsenal", kind: "site-pack" },
        { slug: "ai-tools-arsenal", kind: "site-pack" },
        { slug: "front-end-arsenal", kind: "site-pack" },
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
      "玩家与电竞爱好者的组合：游戏与电竞网址包（平台商店/攻略库/赛事/开发工具）+ 影音娱乐包（直播与视频）+ 软件效率工具包（加速与录屏）+ AI 与大模型工具包，配中文生活与极客两套检索包，加复古暖棕与德古拉两套深色主题，买游戏、查攻略、追赛事与看直播一次配齐。",
    icon: "🕹️",
    author: "山羊胡官方",
    license: "MIT",
    version: "1.0.0",
    tags: ["组合包", "游戏", "电竞", "玩家"],
    payload: {
      items: [
        { slug: "gaming-esports", kind: "site-pack" },
        { slug: "media-entertainment", kind: "site-pack" },
        { slug: "software-utilities", kind: "site-pack" },
        { slug: "ai-tools-arsenal", kind: "site-pack" },
        { slug: "cn-search-arsenal", kind: "search-pack" },
        { slug: "dev-search-arsenal", kind: "search-pack" },
        { slug: "gruvbox-retro", kind: "theme" },
        { slug: "dracula-dark", kind: "theme" },
      ],
    },
  },
};
