/**
 * zod -> JSON Schema 转换（OpenAPI 组件与 MCP inputSchema 共用出口）。
 *
 * 背景：zod 4 内置了官方的 z.toJSONSchema()，不再需要 zod-to-json-schema
 * 社区库——后者 3.25.2 虽在 peerDependencies 里声明支持 zod ^4，但其
 * parseDef 按 def.typeName 分发，而 zod 4 的 _def 只有 type/shape，导致
 * 所有 schema 被静默转换成 {}（不抛错，只是什么都不生成）。迁移到原生
 * 实现后，mcp-schemas.ts 的单一事实源才真正能同时喂给 MCP 与 OpenAPI。
 *
 * 约定：
 *   - io: "input" —— 描述「调用方应该传什么」：带 .default() 的字段
 *     带 default 标注但不进 required（文档不再把可选参数谎报成必填）
 *   - unrepresentable: "any" —— 单个字段无法用 JSON Schema 表达时退化为
 *     {}，不拖垮整份文档的其余字段
 *   - 剥掉根节点 $schema —— 嵌进 OpenAPI components / MCP inputSchema
 *     时它是噪声（dialect 由文档级声明）
 *   - 转换异常时整体退回宽松 object：文档可以少写细节，但不能因为
 *     schema 太新而 500
 */

import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

/** 宽松 object 兜底：宁可不写字段，也不编造 */
const FALLBACK: JsonSchema = { type: "object", additionalProperties: true };

/** zod 契约 -> JSON Schema（input 视角）；失败不抛，退回宽松 object */
export function zodSchemaToJsonSchema(schema: z.ZodType): JsonSchema {
  try {
    const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
    delete js.$schema;
    return js;
  } catch {
    return { ...FALLBACK };
  }
}
