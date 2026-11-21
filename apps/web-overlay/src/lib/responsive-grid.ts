/**
 * 容器驱动的响应式网格 Token（2026-11-21）。
 *
 * ## 为什么不用视口断点
 *
 * 本站左侧栏可折叠且用户可拖拽调宽。用 `md:grid-cols-3` 这类视口断点意味着
 * 「屏幕 1280px 就 3 列」——但同一块屏幕在侧栏展开时主区只剩 1020px，
 * 卡片被压扁；侧栏收起时主区 1400px，又显得太宽。列数必须跟**容器真实宽度**
 * 走，不能跟视口走。
 *
 * ## 断点标定（Tailwind v4 容器断点）
 *
 *   @xl   576px   → 2 列（手机横屏 / 小平板）
 *   @4xl  896px   → 3 列（1280-1366 笔记本展开侧栏：主区 1020-1120px）
 *   @6xl  1152px  → 4 列（宽屏 / 侧栏收起）
 *
 * 关键校准点：3 列断点取 896 而非 1024。取 1024 时，主区宽度恰好落在
 * 1020-1120 区间的机器会在临界点反复抖动（拖一下侧栏就 2↔3 列跳），
 * 取 896 让整个主流笔记本区间稳定为 3 列。
 *
 * ## 用法
 *
 * 容器（祖先元素）需有 `@container`，然后在网格上用这些 token。
 */

/** 站点卡片主网格：1 → 2 → 3 → 4 列 */
export const CARD_GRID =
  'grid grid-cols-1 gap-[var(--density-grid-gap,0.875rem)] @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4'

/** 紧凑变体：小卡片/插件卡，起步更早进 2 列 */
export const CARD_GRID_COMPACT =
  'grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4'

/** 面板网格：用于 /me、/algorithms 这类内容面板 */
export const PANEL_GRID = 'grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3'

/**
 * 卡片内部的自适应均衡骨架。
 *
 * 用途：同一行里有的卡片带标签、有的不带（如 Google Firebase / WABT / Binaryen），
 * 内容高度不同会让整行视觉重心参差不齐。统一用 flex-col + justify-between
 * 让「标题+简介」在上、标签在下，配合 min-h 保证同行等高。
 */
export const CARD_BODY = 'flex h-full min-h-[7.5rem] flex-col justify-between gap-2'

/** 简介统一钳制两行，避免长简介把卡片撑高破坏对齐 */
export const CARD_DESC = 'line-clamp-2 text-xs leading-relaxed text-muted-foreground'

/** 数字指标统一等宽对齐 */
export const NUMERIC = 'tabular-nums'

/**
 * 折叠态预览张数：复用 lib/preview-count 的既有实现（勿重复造）。
 *
 * 本文件只负责**网格 token**，预览张数的语义（cols × PREVIEW_ROWS、
 * 脏输入回退 1）已在 preview-count.ts 定义并有单测，这里仅做转发，
 * 让调用方可以只 import 一个模块。
 */
export { PREVIEW_ROWS, previewCountForColumns } from './preview-count'
