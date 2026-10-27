/**
 * 体检视图状态机——**实现已迁到 `@navhub/core` 的 `health-state.ts`**。
 *
 * 这里只做再导出：
 *   1. 面板的 import 路径不变，不必改动 2900 行组件；
 *   2. 后端只读健康 API 用的是同一个函数，「面板 vs 接口」不可能说两套话。
 * （vitest 已为 `@navhub/core` 配了指向源码的 alias，测试环境也能解析。）
 */
export { deriveHealthPanelState, type HealthPanelState, type HealthSnapshotLike } from "@navhub/core"
