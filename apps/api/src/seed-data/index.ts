/**
 * 种子数据聚合入口：把 `seed-data/**` 下的插件定义汇总成一份清单。
 *
 * 目录约定（2026-10-20 内容升级批次定型）：
 *   site-packs/  已删除（2026-11-15 卸载 34 个网址包，种子不再包含网址包；
 *                 当前种子只有搜索包、主题、预设与组合包）。
 *   search-packs  5 个搜索引擎包（同一服务跨包共用同一 !前缀；同前缀只许指向同一检索 URL，
 *                 多包可同时安装不互相覆盖）
 *   themes        完整主题皮肤（20 项色板变量 + 圆角）
 *   presets       工作台预设（模块 type 必须在 WIDGET_REGISTRY 且跨度合法）
 *   bundles       组合包（单层引用 search-pack / theme）
 *
 * 拆分理由：主文件 `seed-plugins.ts` 峰值 280KB / 1770 行，评审与并发编辑成本都过高；
 * 现在新增或加深内容只动对应那一个文件，本入口只在新增文件时补一行登记。
 * 注意：`search-packs.ts` / `themes.ts` / `presets.ts` / `bundles.ts` 是「一次扩容批次的
 * 多条目文件」，而从主文件迁出的条目落在对应子目录里的一文件一条。
 */
import type { SeedPluginDef } from "./types.ts";


// ---- 搜索引擎包（search-pack）----
import { devSearchArsenal } from "./search-packs/dev-search-arsenal.ts";
import { academicSearchArsenal, cnSearchArsenal } from "./search-packs.ts";
import { aiDeepSearchPack } from "./search-packs/ai-deep-search-pack.ts";
import { codeSearchPack } from "./search-packs/code-search-pack.ts";

// ---- 主题（theme）----
import { draculaDark } from "./themes/dracula-dark.ts";
import { seedDuskCompass } from "./themes/seed-dusk-compass.ts";
import { auroraEmerald } from "./themes/aurora-emerald.ts";
import { sunlitAmber } from "./themes/sunlit-amber.ts";
import { catppuccinMocha } from "./themes/catppuccin-mocha.ts";
import { oledPureBlack } from "./themes/oled-pure-black.ts";
import { nordicGlacier } from "./themes/nordic-glacier.ts";
import { macSonomaGlass } from "./themes/mac-sonoma-glass.ts";
import { gruvboxRetroTheme, nordFrostTheme, paperLatteTheme, forestPineTheme, oceanDeepTheme, sakuraMistTheme } from "./themes.ts";

// ---- 工作台预设（workspace-preset）----
import { devopsWorkbench } from "./presets/devops-workbench.ts";
import { seedDataWorkbench } from "./presets/seed-data-workbench.ts";
import { healthLifeWorkbench } from "./presets/health-life-workbench.ts";
import { travelPlannerWorkbench } from "./presets/travel-planner-workbench.ts";
import { aiWorkbench } from "./presets/ai-workbench.ts";
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
import { aiAgenticFutureBundle } from "./bundles/ai-agentic-future-bundle.ts";
import {
  creatorBundle,
  gamerBundle,
  investorBundle,
  learnerBundle,
  lifeEssentialsBundle,
  newsReaderBundle,
} from "./bundles.ts";

/** 全部种子插件：顺序刻意保持「搜索包 → 主题 → 预设 → 组合包」，便于按 kind 归档阅读。 */
export const allSeedPluginDefs: SeedPluginDef[] = [
  // 搜索引擎包
  devSearchArsenal,
  cnSearchArsenal,
  academicSearchArsenal,
  aiDeepSearchPack,
  codeSearchPack,
  // 主题
  draculaDark,
  seedDuskCompass,
  auroraEmerald,
  sunlitAmber,
  catppuccinMocha,
  oledPureBlack,
  nordicGlacier,
  macSonomaGlass,
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
  aiWorkbench,
  // 组合包
  aiAgenticFutureBundle,
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
