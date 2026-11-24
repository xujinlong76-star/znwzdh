import { describe, expect, it } from "vitest";
import { evaluatePatchCoverage, parseAddedSourceLines } from "./coverage-patch.mjs";

const diff = [
  "diff --git a/packages/core/src/demo.ts b/packages/core/src/demo.ts",
  "--- a/packages/core/src/demo.ts",
  "+++ b/packages/core/src/demo.ts",
  "@@ -1,0 +1,10 @@",
  ...Array.from({ length: 10 }, (_, index) => "+const value" + index + " = " + index + ";"),
].join("\n");

describe("coverage-patch", () => {
  it("extracts only added source lines and ignores non-source files", () => {
    const parsed = parseAddedSourceLines(diff + [
      "diff --git a/docs/example.md b/docs/example.md",
      "--- a/docs/example.md",
      "+++ b/docs/example.md",
      "@@ -1,0 +1,2 @@",
      "+doc",
      "+doc2",
    ].join("\n"));
    expect([...parsed.get("packages/core/src/demo.ts") ?? []]).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(parsed.has("docs/example.md")).toBe(false);
  });

  it("uses Istanbul line counters and computes patch coverage", () => {
    const result = evaluatePatchCoverage(diff, {
      "/workspace/packages/core/src/demo.ts": {
        l: { "1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1, "8": 1, "9": 1, "10": 0 },
      },
    });
    expect(result.total).toBe(10);
    expect(result.covered).toBe(9);
    expect(result.percent).toBe(90);
    expect(result.skipped).toBe(false);
  });

  it("treats missing coverage entries as uncovered", () => {
    const result = evaluatePatchCoverage(diff, {});
    expect(result.total).toBe(10);
    expect(result.covered).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.files[0]?.coverageEntryMissing).toBe(true);
  });

  it("skips only when executable changed lines are below the configured minimum", () => {
    const result = evaluatePatchCoverage(diff, {
      "/workspace/packages/core/src/demo.ts": { l: { "1": 1 } },
    }, 10);
    expect(result.total).toBe(1);
    expect(result.skipped).toBe(true);
  });
});
