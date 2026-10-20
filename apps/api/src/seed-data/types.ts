/**
 * 种子数据扩展目录（`apps/api/src/seed-data/**`）共用的类型声明。
 *
 * 为什么单独放这里：`seed-plugins.ts` 是「种子事实源 → 聚合入口」，内容扩容按
 * 领域把新插件拆成独立文件（一个网址包一个文件，便于评审与并行维护）。
 * 类型在此声明，新增文件只依赖本文件，不反向依赖聚合入口（避免环形依赖）。
 */
import type { PluginStatus } from "@navhub/core";

export interface SeedPluginDef {
  /** 固定 slug：既是详情页链接，也是幂等去重键 */
  slug: string;
  status: PluginStatus;
  /** 未校验的声明式清单，由 seed.ts 统一走 validateAndCleanPluginManifest */
  manifest: unknown;
}
