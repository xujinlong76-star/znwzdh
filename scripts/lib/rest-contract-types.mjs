/**
 * JSON Schema -> TypeScript 类型文本（响应契约前端类型的渲染器）。
 *
 * 纯函数、零 IO：生成器 CLI 与漂移门禁测试都调这里，两边渲染结果必须逐字节一致，
 * 否则门禁会因为「两条路径各写一套拼装」而假红。
 *
 * 输入是 `zodSchemaToJsonSchema()` 的产物（与 OpenAPI components 同一次转换），
 * 所以前端拿到的类型和 /api/openapi.json 描述的**是同一份形状**。
 */

const INDENT = "  ";

/** 合法标识符才允许裸写键名，其余加引号（`"group"` 这类词不能靠猜） */
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function pad(depth) {
  return INDENT.repeat(depth);
}

function literal(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return "unknown";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKeys(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

/** 联合类型在数组/括号语境下必须加括号：`(A | B)[]` 与 `A | B[]` 不是一回事 */
function parenthesize(type) {
  return type.includes(" | ") ? "(" + type + ")" : type;
}

function objectType(schema, depth) {
  const props = isPlainObject(schema.properties) ? schema.properties : null;
  const addl = schema.additionalProperties;

  if (!props || Object.keys(props).length === 0) {
    if (hasKeys(addl)) return "Record<string, " + typeOf(addl, depth) + ">";
    return "Record<string, unknown>";
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const lines = [];
  for (const [name, prop] of Object.entries(props)) {
    const key = IDENT.test(name) ? name : JSON.stringify(name);
    const optional = required.has(name) ? "" : "?";
    lines.push(pad(depth + 1) + key + optional + ": " + typeOf(prop, depth + 1) + ";");
  }
  // looseObject 的 additionalProperties 是空 schema（= unknown）：显式写出索引签名，
  // 让前端知道「未列出的字段可能存在且不该依赖具体形状」，而不是以为对象是封闭的。
  if (addl === true || (isPlainObject(addl) && Object.keys(addl).length === 0)) {
    lines.push(pad(depth + 1) + "[key: string]: unknown;");
  } else if (hasKeys(addl)) {
    lines.push(pad(depth + 1) + "[key: string]: " + typeOf(addl, depth + 1) + ";");
  }
  return "{\n" + lines.join("\n") + "\n" + pad(depth) + "}";
}

/** 单个 JSON Schema 节点 -> TS 类型文本 */
export function typeOf(schema, depth = 0) {
  if (!isPlainObject(schema)) return "unknown";

  const union = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (union) {
    const parts = [];
    for (const member of union) {
      const t = typeOf(member, depth);
      if (!parts.includes(t)) parts.push(t);
    }
    if (parts.length === 1) return parts[0];
    if (parts.length === 0) return "unknown";
    return parts.join(" | ");
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map((m) => typeOf(m, depth)).join(" & ");
  }

  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return [...new Set(schema.enum.map(literal))].join(" | ");
  }

  // zod 的 .nullable() 产出的就是 type: ["string","null"] 这种数组形态
  if (Array.isArray(schema.type)) {
    return schema.type.map((t) => typeOf({ ...schema, type: t }, depth)).join(" | ");
  }

  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return parenthesize(typeOf(schema.items ?? {}, depth)) + "[]";
    case "object":
      return objectType(schema, depth);
    default:
      // 没有 type 但有 properties/additionalProperties（zod 的 z.unknown() 是 {}）
      if (schema.properties || schema.additionalProperties !== undefined) return objectType(schema, depth);
      return "unknown";
  }
}

/** 导出声明：根是封闭对象时用 interface（可被 extends），其余用 type 别名 */
function declaration(name, schema) {
  const isObjectRoot = isPlainObject(schema) && schema.type === "object" && hasKeys(schema.properties);
  if (isObjectRoot) return "export interface " + name + " " + typeOf(schema, 0) + "\n";
  return "export type " + name + " = " + typeOf(schema, 0) + ";\n";
}

export const GENERATED_FILE_BANNER = [
  "/**",
  " * 自动生成，请勿手改。",
  " *",
  " * 事实源：packages/core/src/rest-responses.ts 的 RESPONSE_SCHEMA_BINDINGS。",
  " * 重新生成：node --experimental-strip-types scripts/generate-rest-contract-types.mjs",
  " * 漂移门禁：scripts/generate-rest-contract-types.test.ts（生成物与源码不同源即红）。",
  " *",
  " * 这里的形状与 /api/openapi.json 的 components.schemas 是同一次 zod -> JSON Schema",
  " * 转换的产物，所以前端类型、文档、契约测试三者只可能一起变。",
  " */",
  "",
].join("\n");

/**
 * 把 RESPONSE_SCHEMA_BINDINGS 归并成「组件名 -> 路由列表」。
 *
 * GET/POST 共用同一份契约时必须合成一个组件（两次各写一份必然分叉），
 * 所以这里按 name 归并而不是按路由。
 */
export function contractEntries(bindings, toJsonSchema) {
  const byName = new Map();
  for (const [route, binding] of Object.entries(bindings)) {
    const existing = byName.get(binding.name);
    if (existing) {
      existing.routes.push(route);
      continue;
    }
    byName.set(binding.name, {
      name: binding.name,
      routes: [route],
      schema: toJsonSchema(binding.schema),
    });
  }
  return [...byName.values()];
}

/** 生成器与漂移门禁的唯一入口：同一份 zod 契约 + 同一个渲染器 */
export function buildContractTypesText(bindings, toJsonSchema) {
  return renderContractTypes(contractEntries(bindings, toJsonSchema));
}

/** 深度查找 $ref，返回首个命中的 JSON 指针（没有则 null） */
export function findRef(node, pointer) {
  if (!isPlainObject(node) && !Array.isArray(node)) return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const hit = findRef(node[i], pointer + "/" + i);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node.$ref === "string") return pointer;
  for (const [key, value] of Object.entries(node)) {
    const hit = findRef(value, pointer + "/" + key);
    if (hit) return hit;
  }
  return null;
}

/**
 * 渲染整份生成文件。
 * @param entries [{ name: string, routes: string[], schema: unknown }]
 */
export function renderContractTypes(entries) {
  const seen = new Set();
  const blocks = [];

  for (const entry of entries) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    // zod 目前会把重复子结构内联展开；一旦哪天改成 $defs/$ref，渲染器会
    // 把它们当作 unknown 静默降级——前端类型变成一坨 any 而没人发现。
    // 与其猜，不如在这里直接失败（降级必须如实说）。
    const ref = findRef(entry.schema, "#");
    if (ref) throw new Error("响应契约 " + entry.name + " 含 $ref（" + ref + "），渲染器不支持：请改为内联展开或扩展渲染器");
    const header = [
      "/**",
      ...entry.routes.map((route) => " * " + route),
      " */",
    ].join("\n");
    blocks.push(header + "\n" + declaration(entry.name, entry.schema));
  }

  const routeLines = [];
  for (const entry of entries) {
    for (const route of entry.routes) routeLines.push("  " + JSON.stringify(route) + ": " + entry.name + ";");
  }
  blocks.push(
    [
      "/** 路由键 -> 响应类型（前端按端点取类型，避免自己再抄一份接口） */",
      "export interface RestContractRoutes {",
      ...routeLines.sort(),
      "}",
      "",
    ].join("\n"),
  );

  return GENERATED_FILE_BANNER + "\n" + blocks.join("\n");
}

