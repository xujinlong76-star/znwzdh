/**
 * 插件市场种子数据入口（纯聚合器，不含内容）。
 *
 * 2026-10-20 内容升级批次后，全部插件定义都拆到了 `apps/api/src/seed-data/**`：
 *   site-packs/    20 个专业网址包（每包 18~20 分类 / 200~320 个站点，大型导航站规模）
 *   search-packs   3 个搜索引擎包（!前缀全局唯一，可同时安装）
 *   themes         7 套完整主题（20 项色板变量 + 圆角）
 *   presets        5 个工作台预设
 *   bundles        12 个组合包（单层引用，成员均为已上架插件）
 *
 * 本文件只做聚合，不再承载内容——避免「改一条插件要读上千行」，也避免并发编辑冲突。
 *
 * 约束与仓库纪律一致：
 *   - 全部为声明式 JSON（零可执行代码），入库前经 validateAndCleanPluginManifest 校验；
 *   - 幂等：固定 slug 作为去重键，重复执行不会产生副本；
 *   - 预设里的模块 type 全部取自前端 WIDGET_REGISTRY 已验证集，跨度在注册表 min/max 内；
 *   - 数据质量由 apps/api/test/seed-plugins.test.ts 守门。
 */
import type { PluginStatus } from "@navhub/core";
import { allSeedPluginDefs } from "./seed-data/index.ts";

export interface SeedPluginDef {
  /** 固定 slug：既是详情页链接，也是幂等去重键 */
  slug: string;
  status: PluginStatus;
  /** 未校验的声明式清单，由 seed.ts 统一走 validateAndCleanPluginManifest */
  manifest: unknown;
}

/** 全部种子插件（排序见 seed-data/index.ts：网址包 → 搜索包 → 主题 → 预设 → 组合包）。 */
export function seedPluginDefs(): SeedPluginDef[] {
  return allSeedPluginDefs;
}
