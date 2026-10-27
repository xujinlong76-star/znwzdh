#!/usr/bin/env node
/**
 * 响应契约 -> 前端类型（生成器 CLI）。
 *
 * 为什么需要这一步：apps/web-overlay/src/lib/navhub-api.ts 一直手抄一份接口，
 * 中枢改了字段它不知道，前端也不会报错——类型漂移就这样静默发生。
 * 现在类型由 zod 契约生成，前端只能引用生成物，漂移会被门禁抓住。
 *
 * 用法：
 *   node --experimental-strip-types scripts/generate-rest-contract-types.mjs          写入
 *   node --experimental-strip-types scripts/generate-rest-contract-types.mjs --check   只校验（不一致 exit 1）
 *
 * 生成物落点固定，前端直接 import；apps/web 的镜像由 vendor-web 自动同步
 * （apps/web/src/lib 是 gitignore 的生成面，不手工维护）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildContractTypesText } from "./lib/rest-contract-types.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT_RELATIVE_PATH = "apps/web-overlay/src/lib/rest-contracts.generated.ts";

/**
 * 通过 Node 的 strip-types 直接加载 core 的 TS 源码。
 * 不引 tsx/ts-node：仓库本来就要求中枢能被 strip-only 直接跑（见
 * apps/api/src/identity-signature.ts 的教训），这条链路顺带把约束也验了。
 */
async function loadCoreContracts() {
  const coreSrc = resolve(ROOT, "packages/core/src");
  const [{ RESPONSE_SCHEMA_BINDINGS }, { zodSchemaToJsonSchema }] = await Promise.all([
    import(pathToFileURL(resolve(coreSrc, "rest-responses.ts")).href),
    import(pathToFileURL(resolve(coreSrc, "json-schema.ts")).href),
  ]);
  return buildContractTypesText(RESPONSE_SCHEMA_BINDINGS, zodSchemaToJsonSchema);
}

export async function generate() {
  return loadCoreContracts();
}

async function main() {
  const check = process.argv.includes("--check");
  const text = await generate();
  const outPath = resolve(ROOT, OUTPUT_RELATIVE_PATH);

  if (check) {
    let current = "";
    try {
      current = readFileSync(outPath, "utf8");
    } catch {
      console.error("[rest-contracts] 生成物不存在：" + OUTPUT_RELATIVE_PATH);
      process.exit(1);
    }
    if (current !== text) {
      console.error("[rest-contracts] 生成物与契约源码不同源：" + OUTPUT_RELATIVE_PATH);
      console.error("[rest-contracts] 修复：node --experimental-strip-types scripts/generate-rest-contract-types.mjs");
      process.exit(1);
    }
    console.log("[rest-contracts] OK " + OUTPUT_RELATIVE_PATH);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text, "utf8");
  console.log("[rest-contracts] 写入 " + OUTPUT_RELATIVE_PATH + "（" + text.length + " 字符）");
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
