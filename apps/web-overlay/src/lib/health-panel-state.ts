/**
 * 体检视图状态机——实现与 `@navhub/core` 的 `health-state.ts` 同构（见 ./health-state.ts）。
 *
 * 这里只做再导出：
 *   1. 面板的 import 路径不变，不必改动 2900 行组件；
 *   2. 后端只读健康 API 用的是同一个函数，「面板 vs 接口」不可能说两套话。
 * （前端不直接依赖 @navhub/core：生产镜像只含 overlay，跨包引用会构建失败。）
 */
export { deriveHealthPanelState, type HealthPanelState, type HealthSnapshotLike } from "./health-state"
