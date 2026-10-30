/**
 * `scripts/lib/test-retry.mjs` 的回归。
 *
 * 钉的是「全量测试失败后只重跑红文件」这条策略的判定逻辑。
 * 2026-10-30 三次实测：全量 566 文件下高并发抖动是常态，连跑两次即绿——
 * 但「抖动放行」必须点名是哪些文件抖过，静默当通过就是把守卫变摆设。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { decideTestOutcome, escalateFlaky, parseFailedTestFiles } from "./test-retry.mjs";

describe("抖动收敛：从 vitest 输出抽失败文件", () => {
  it("抽出去重后的文件路径，保持出现顺序", () => {
    const out = [
      " RUN  v5.0.5",
      " ❯ apps/web/test/a.test.ts (2 tests | 1 failed)",
      " FAIL  apps/web/test/a.test.ts > 套件 > 用例",
      " FAIL  scripts/b.test.ts > 另一套件",
      " FAIL  apps/web/test/a.test.ts > 重复出现",
    ].join("\n");
    expect(parseFailedTestFiles(out)).toEqual(["apps/web/test/a.test.ts", "scripts/b.test.ts"]);
  });

  it("没有 FAIL 行 ⇒ 空数组（调用方据此判「抽不出文件」）", () => {
    expect(parseFailedTestFiles("Test Files  566 passed\nTests  4192 passed")).toEqual([]);
  });

  it("断言文本里的路径不算文件（只认 .test. / .spec. 结尾）", () => {
    const out = " FAIL  apps/web/test/a.test.ts > 断言里提到 apps/api/src/storage.ts 也不算";
    expect(parseFailedTestFiles(out)).toEqual(["apps/web/test/a.test.ts"]);
  });

  it(".spec.tsx 也算（Playwright 那类）", () => {
    expect(parseFailedTestFiles(" FAIL  e2e/x.spec.ts > 标题")).toEqual(["e2e/x.spec.ts"]);
  });
});

describe("抖动收敛：结论判定", () => {
  it("首轮绿 ⇒ pass", () => {
    const v = decideTestOutcome({ firstOk: true, failedFiles: [], retryOk: false });
    expect(v.kind).toBe("pass");
  });

  it("首轮红 + 重跑绿 ⇒ flaky，且必须点名文件", () => {
    const v = decideTestOutcome({ firstOk: false, failedFiles: ["a.test.ts", "b.test.ts"], retryOk: true });
    expect(v.kind).toBe("flaky");
    expect(v.message).toContain("a.test.ts");
    expect(v.message).toContain("b.test.ts");
  });

  it("重跑仍红 ⇒ regression，必须挡下", () => {
    const v = decideTestOutcome({ firstOk: false, failedFiles: ["a.test.ts"], retryOk: false });
    expect(v.kind).toBe("regression");
    expect(v.message).toContain("真回归");
    expect(v.message).toContain("a.test.ts");
  });

  it("抽不出文件名 ⇒ unparseable，不猜、按真失败处理", () => {
    const v = decideTestOutcome({ firstOk: false, failedFiles: [], retryOk: true });
    expect(v.kind).toBe("unparseable");
    expect(v.message).toContain("不重试");
  });
});

describe("抖动收敛：脆弱测试累进", () => {
  it("计数递增，未到阈值不升级", () => {
    const r = escalateFlaky({}, ["a.test.ts"], 3);
    expect(r.counts["a.test.ts"]).toBe(1);
    expect(r.escalated).toHaveLength(0);
  });

  it("累计到阈值 ⇒ 升级为真脆弱，必须转红", () => {
    const r = escalateFlaky({ "a.test.ts": 2 }, ["a.test.ts"], 3);
    expect(r.counts["a.test.ts"]).toBe(3);
    expect(r.escalated).toEqual(["a.test.ts"]);
  });

  it("多个文件各自计数，只升级到阈值的那些", () => {
    const r = escalateFlaky({ "a.test.ts": 2, "b.test.ts": 0 }, ["a.test.ts", "b.test.ts"], 3);
    expect(r.escalated).toEqual(["a.test.ts"]);
    expect(r.counts["b.test.ts"]).toBe(1);
  });

  it("没有历史 ⇒ 从 0 起算", () => {
    const r = escalateFlaky(undefined, ["a.test.ts"], 1);
    expect(r.counts["a.test.ts"]).toBe(1);
    expect(r.escalated).toEqual(["a.test.ts"]);
  });
});
