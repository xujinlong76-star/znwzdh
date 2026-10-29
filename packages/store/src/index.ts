export * from "./schema.ts";
export * from "./driver.ts";
export * from "./migrate.ts";
export * from "./fts.ts";
export * from "./sql-in.ts";
export * from "./fts-pg.ts";
export * from "./search.ts";
export * from "./vector/index.ts";
export * from "./repository.ts";
export * from "./repository/videos.ts";
// 数据治理（events / audit_logs 的保留与聚合）：被 apps/api 的 data_retention
// 任务复用，与 scripts/data-retention.mjs 共用同一份实现（方言无关）
export * from "./retention.ts";
export * from "./rollup.ts";
export * from "./data-inventory.ts";
// copilot 事件的读取侧（取消数 / 放弃前等待时长）：写在 repository/events.ts，
// 但 Repository 类上没有对应方法，管理端路由需要这个函数，故在此显式具名导出
export { copilotEventSummary, COPILOT_EVENT_READ_CAP, canvasQualitySummary } from "./repository/events.ts";
export type { LlmUsagePrice } from "./repository/llm-usage.ts";
// 收藏写路径的归属越界信号（BOLA）：apps/api 的 POST /api/favorites 需要 instanceof 它
// 才能把「别人的文件夹」映射成 400，而不是笼统的 500。
export { FavoriteFolderNotOwnedError } from "./repository/favorites.ts";
