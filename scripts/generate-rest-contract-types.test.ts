/**
 * 生成物与契约源码同源（漂移门禁）。
 *
 * 前端类型是从 zod 契约生成的，生成文件一旦过期，前端就会拿着**上一天的形状**
 * 去读今天的响应——编译全绿、运行时 undefined。这条门禁跑在现有测试作业里，
 * 不新增 CI 作业、不改 workflow。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESPONSE_SCHEMA_BINDINGS } from "../packages/core/src/rest-responses.ts";
import { zodSchemaToJsonSchema } from "../packages/core/src/json-schema.ts";
import {
  buildContractTypesText,
  contractEntries,
  findRef,
  renderContractTypes,
  typeOf,
} from "./lib/rest-contract-types.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, "../apps/web-overlay/src/lib/rest-contracts.generated.ts");
const REGENERATE = "node --experimental-strip-types scripts/generate-rest-contract-types.mjs";

function readGenerated() {
  // Windows 上 git 可能把换行转成 CRLF；比较的是内容，不是行尾
  return readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n");
}

describe("响应契约前端类型：生成物与源码同源", () => {
  it("已提交的生成文件与当前契约逐字节一致", () => {
    const expected = buildContractTypesText(RESPONSE_SCHEMA_BINDINGS, zodSchemaToJsonSchema);
    expect(readGenerated(), "生成物已过期，请运行：" + REGENERATE).toBe(expected);
  });

  it("每个绑定路由都出现在 RestContractRoutes 里（新增端点必须能被前端取到类型）", () => {
    const text = readGenerated();
    for (const route of Object.keys(RESPONSE_SCHEMA_BINDINGS)) {
      expect(text, "RestContractRoutes 缺少路由：" + route).toContain(JSON.stringify(route) + ":");
    }
  });

  it("GET/POST 共用的组件只生成一次（两份形状必然分叉）", () => {
    const names = contractEntries(RESPONSE_SCHEMA_BINDINGS, zodSchemaToJsonSchema).map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    const text = readGenerated();
    expect(text.match(/^export interface SearchResponse/mg)?.length).toBe(1);
  });

  it("生成文件是自包含的（前端包不能因此引入 core 依赖）", () => {
    const text = readGenerated();
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\brequire\s*\(/);
  });
});

describe("渲染器：JSON Schema 语义不丢", () => {
  it("可空与联合：anyOf 去重、type 数组展开", () => {
    expect(typeOf({ anyOf: [{ type: "null" }, { type: "string" }] })).toBe("null | string");
    expect(typeOf({ type: ["number", "null"] })).toBe("number | null");
    // 同一个成员重复出现不该产生 "string | string"
    expect(typeOf({ anyOf: [{ type: "string" }, { type: "string" }] })).toBe("string");
  });

  it("枚举与字面量保留取值集合", () => {
    expect(typeOf({ enum: ["a", "b", "a"] })).toBe('"a" | "b"');
    expect(typeOf({ const: true })).toBe("true");
  });

  it("数组项是联合时必须加括号", () => {
    expect(typeOf({ type: "array", items: { type: ["number", "null"] } })).toBe("(number | null)[]");
  });

  it("可选属性带 ?，必填属性不带", () => {
    const ts = typeOf({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    });
    expect(ts).toContain("a: string;");
    expect(ts).toContain("b?: number;");
  });

  it("looseObject 产出索引签名（未列出的字段可能存在）", () => {
    const ts = typeOf({ type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: {} });
    expect(ts).toContain("[key: string]: unknown;");
  });

  it("record 产出带值类型的索引签名", () => {
    const ts = typeOf({ type: "object", additionalProperties: { type: "number" } });
    expect(ts).toBe("Record<string, number>");
  });

  it("非标识符键名加引号", () => {
    const ts = typeOf({ type: "object", properties: { "x-y": { type: "string" } }, required: ["x-y"] });
    expect(ts).toContain('"x-y": string;');
  });

  it("未知节点渲染成 unknown 而不是 any（any 会静默吞掉后续漂移）", () => {
    expect(typeOf({})).toBe("unknown");
    expect(typeOf({ type: "string", format: "email" })).toBe("string");
  });
});

describe("渲染器：不支持的结构必须炸，不能静默降级", () => {
  it("含 $ref 的契约直接抛错并指出位置", () => {
    const schema = { type: "object", properties: { a: { $ref: "#/$defs/X" } } };
    expect(findRef(schema, "#")).toBe("#/properties/a");
    expect(() => renderContractTypes([{ name: "Broken", routes: ["GET /x"], schema }])).toThrow(/\$ref/);
  });
});
