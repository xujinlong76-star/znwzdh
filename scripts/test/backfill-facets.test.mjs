/**
 * backfill-facets.mjs 与 core 的口径守卫（脚本头注释承诺的比对，原先缺失，A3 补上）：
 * 脚本跑在 node 直跑环境、不编译 TS，只能抄一份词表/规则——这里钉住三处同步点，
 * 任一侧单独改动都会让本测试变红：
 *  1. 脚本 ALLOWED.pricing == core facets.ts 的 pricing 受控值集合；
 *  2. 脚本 PRICING_RULES 的正则源 == core pricing.ts PRICING_RULES 的正则源（同序）；
 *  3. pricing-overrides.json 每条值合法且带 evidence（脚本与 core 共用同一数据源）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

function corePricingValues() {
  const src = read("../../packages/core/src/facets.ts");
  const block = src.slice(src.indexOf('key: "pricing"'), src.indexOf('key: "platform"'));
  return [...block.matchAll(/value: "([a-z_]+)"/g)].map((m) => m[1]);
}

function scriptPricingValues() {
  const src = read("../backfill-facets.mjs");
  const m = src.match(/pricing: \[([^\]]+)\]/);
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

function regexSources(src, marker) {
  const start = src.indexOf(marker);
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/\/((?:\\.|[^/\\])+)\/[a-z]*/g)].map((m) => m[1]);
}

describe("backfill-facets 与 core 口径一致", () => {
  it("ALLOWED.pricing 与 CONTROLLED_FACETS pricing 值集合一致（含 unknown）", () => {
    expect(scriptPricingValues().sort()).toEqual(corePricingValues().sort());
    expect(corePricingValues()).toContain("unknown");
  });

  it("脚本与 core 的 pricing 强信号规则逐条一致", () => {
    const core = regexSources(read("../../packages/core/src/pricing.ts"), "const PRICING_RULES");
    const script = regexSources(read("../backfill-facets.mjs"), "const PRICING_RULES");
    expect(script).toEqual(core);
    expect(core.length).toBe(4);
  });

  it("覆盖表条目合法：值在受控集内（不含 unknown）且 evidence 非空", () => {
    const overrides = JSON.parse(read("../../packages/core/src/pricing-overrides.json"));
    const allowed = new Set(corePricingValues());
    const entries = Object.entries(overrides);
    expect(entries.length).toBeGreaterThan(200);
    for (const [key, entry] of entries) {
      expect(allowed.has(entry.pricing), key).toBe(true);
      expect(entry.pricing, key).not.toBe("unknown");
      expect(entry.evidence?.trim().length, key).toBeGreaterThan(0);
    }
  });
});
