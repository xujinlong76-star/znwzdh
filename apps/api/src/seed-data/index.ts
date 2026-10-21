/**
 * 种子数据聚合入口：把 `seed-data/**` 下的插件定义汇总成一份清单。
 *
 * 目录约定（2026-10-20 内容升级批次定型）：
 *   site-packs/   20 个专业网址包，一包一文件（每包 18~20 分类 / 200~320 站点）
 *   search-packs  3 个搜索引擎包（!前缀全局唯一，可同时安装不互相覆盖）
 *   themes        完整主题皮肤（20 项色板变量 + 圆角）
 *   presets       工作台预设（模块 type 必须在 WIDGET_REGISTRY 且跨度合法）
 *   bundles       组合包（单层引用 site-pack / search-pack / theme）
 *
 * 拆分理由：主文件 `seed-plugins.ts` 峰值 280KB / 1770 行，评审与并发编辑成本都过高；
 * 现在新增或加深内容只动对应那一个文件，本入口只在新增文件时补一行登记。
 * 注意：`search-packs.ts` / `themes.ts` / `presets.ts` / `bundles.ts` 是「一次扩容批次的
 * 多条目文件」，而从主文件迁出的条目落在对应子目录里的一文件一条。
 */
import type { SeedPluginDef } from "./types.ts";

// ---- 网址包（site-pack）×20 ----
import { frontEndArsenal } from "./site-packs/front-end-arsenal.ts";
import { seedDesignInspiration } from "./site-packs/seed-design-inspiration.ts";
import { seedDevEfficiency } from "./site-packs/seed-dev-efficiency.ts";
import { cnDailyNavigation } from "./site-packs/cn-daily-navigation.ts";
import { aiToolsArsenal } from "./site-packs/ai-tools-arsenal.ts";
import { backendCloudArsenal } from "./site-packs/backend-cloud-arsenal.ts";
import { learnGrowthArsenal } from "./site-packs/learn-growth-arsenal.ts";
import { creatorOpsArsenal } from "./site-packs/creator-ops-arsenal.ts";
import { newsMediaPack } from "./site-packs/news-media.ts";
import { shoppingEcommercePack } from "./site-packs/shopping-ecommerce.ts";
import { mediaEntertainmentPack } from "./site-packs/media-entertainment.ts";
import { financeWealthPack } from "./site-packs/finance-wealth.ts";
import { eduLearningPack } from "./site-packs/edu-learning.ts";
import { healthWellnessPack } from "./site-packs/health-wellness.ts";
import { travelMobilityPack } from "./site-packs/travel-mobility.ts";
import { jobsCareerPack } from "./site-packs/jobs-career.ts";
import { gamingEsportsPack } from "./site-packs/gaming-esports.ts";
import { growthMarketingPack } from "./site-packs/growth-marketing.ts";
import { softwareUtilitiesPack } from "./site-packs/software-utilities.ts";
import { govPublicServicePack } from "./site-packs/gov-public-service.ts";
import { officeCollaborationPack } from "./site-packs/office-collaboration.ts";
import { scienceHumanitiesPack } from "./site-packs/science-humanities.ts";
import { petFamilyParentingPack } from "./site-packs/pet-family-parenting.ts";
import { legalCompliancePack } from "./site-packs/legal-compliance.ts";
import { autoDrivingPack } from "./site-packs/auto-driving.ts";
import { foodDrinkPack } from "./site-packs/food-drink.ts";
import { sportsOutdoorPack } from "./site-packs/sports-outdoor.ts";
import { agricultureRuralPack } from "./site-packs/agriculture-rural.ts";
import { lifeCarePack } from "./site-packs/life-care.ts";

// ---- 搜索引擎包（search-pack）×3 ----
import { devSearchArsenal } from "./search-packs/dev-search-arsenal.ts";
import { academicSearchArsenal, cnSearchArsenal } from "./search-packs.ts";

// ---- 主题（theme）----
import { draculaDark } from "./themes/dracula-dark.ts";
import { seedDuskCompass } from "./themes/seed-dusk-compass.ts";
import { auroraEmerald } from "./themes/aurora-emerald.ts";
import { sunlitAmber } from "./themes/sunlit-amber.ts";
import { gruvboxRetroTheme, nordFrostTheme, paperLatteTheme, forestPineTheme, oceanDeepTheme, sakuraMistTheme } from "./themes.ts";

// ---- 工作台预设（workspace-preset）----
import { devopsWorkbench } from "./presets/devops-workbench.ts";
import { seedDataWorkbench } from "./presets/seed-data-workbench.ts";
import { healthLifeWorkbench } from "./presets/health-life-workbench.ts";
import { travelPlannerWorkbench } from "./presets/travel-planner-workbench.ts";
import { contentCreatorWorkbench, investorWorkbench, studentStudyWorkbench } from "./presets.ts";

// ---- 组合包（bundle）----
import { aiPowerBundle } from "./bundles/ai-power-bundle.ts";
import { cnLifeBundle } from "./bundles/cn-life-bundle.ts";
import { creatorGrowthBundle } from "./bundles/creator-growth-bundle.ts";
import { designerStarterBundle } from "./bundles/designer-starter-bundle.ts";
import { fullstackProBundle } from "./bundles/fullstack-pro-bundle.ts";
import { geekStarterBundle } from "./bundles/geek-starter-bundle.ts";
import { familyLifeBundle } from "./bundles/family-life-bundle.ts";
import { legalProBundle } from "./bundles/legal-pro-bundle.ts";
import {
  creatorBundle,
  gamerBundle,
  investorBundle,
  learnerBundle,
  lifeEssentialsBundle,
  newsReaderBundle,
} from "./bundles.ts";

/** 全部种子插件：顺序刻意保持「网址包 → 搜索包 → 主题 → 预设 → 组合包」，便于按 kind 归档阅读。 */
export const allSeedPluginDefs: SeedPluginDef[] = [
  // 网址包
  frontEndArsenal,
  seedDesignInspiration,
  seedDevEfficiency,
  cnDailyNavigation,
  aiToolsArsenal,
  backendCloudArsenal,
  learnGrowthArsenal,
  creatorOpsArsenal,
  newsMediaPack,
  shoppingEcommercePack,
  mediaEntertainmentPack,
  financeWealthPack,
  eduLearningPack,
  healthWellnessPack,
  travelMobilityPack,
  jobsCareerPack,
  gamingEsportsPack,
  growthMarketingPack,
  softwareUtilitiesPack,
  officeCollaborationPack,
  scienceHumanitiesPack,
  petFamilyParentingPack,
  legalCompliancePack,
  autoDrivingPack,
  foodDrinkPack,
  sportsOutdoorPack,
  agricultureRuralPack,
  lifeCarePack,
  govPublicServicePack,
  // 搜索引擎包
  devSearchArsenal,
  cnSearchArsenal,
  academicSearchArsenal,
  // 主题
  draculaDark,
  seedDuskCompass,
  auroraEmerald,
  sunlitAmber,
  nordFrostTheme,
  gruvboxRetroTheme,
  paperLatteTheme,
  forestPineTheme,
  oceanDeepTheme,
  sakuraMistTheme,
  // 工作台预设
  devopsWorkbench,
  seedDataWorkbench,
  contentCreatorWorkbench,
  studentStudyWorkbench,
  investorWorkbench,
  healthLifeWorkbench,
  travelPlannerWorkbench,
  // 组合包
  geekStarterBundle,
  designerStarterBundle,
  fullstackProBundle,
  cnLifeBundle,
  creatorGrowthBundle,
  aiPowerBundle,
  familyLifeBundle,
  legalProBundle,
  newsReaderBundle,
  lifeEssentialsBundle,
  learnerBundle,
  investorBundle,
  creatorBundle,
  gamerBundle,
];
