/**
 * Speculative Intent Pre-execution Engine (推测意图 0-RTT 原地预执行引擎)
 *
 * 核心设计目标：
 * 当用户在搜索框输入特定技术文本时（Base64、时间戳、RGB/HEX颜色、算术表达式、JSON、URL编码、哈希等），
 * 系统不再仅仅返回外链结果，而是在 0 毫秒内原地预执行并生成即时计算结果（Micro-Widget）。
 *
 * 本文件现为 facade，实现按域拆分至 ./speculative-intent/ 目录：
 *   - 类型契约: ./speculative-intent/types.ts
 *   - 域检测器: encoding / time / network / compute / regex / semver / http-status
 *   - 编排入口: ./speculative-intent/parse.ts
 * 公开 API 保持不变（parseSpeculativeIntent 及两个类型）。
 */

export type { SpeculativeIntentType, SpeculativeIntentResult } from './speculative-intent/types.ts';
export { parseSpeculativeIntent } from './speculative-intent/parse.ts';
