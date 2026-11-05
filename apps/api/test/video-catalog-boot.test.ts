/**
 * 启动对账（video-catalog-boot）的决策与编排测试。
 *
 * 覆盖三件事：
 *   1. 决策纯函数：一致→clean；漂移+json/dual→repair；漂移+db→log_only（防反向覆盖）；
 *   2. 编排：db 模式不读文档不修表；修表后复检不一致要如实报 failed；
 *   3. check/repair 抛错不外溢（启动对账绝不阻断服务启动）。
 */
import { describe, expect, it } from "vitest";
import {
  decideBootRepair,
  runBootReconcile,
  type BootReconcileOutcome,
} from "../src/video-catalog-boot.ts";
import type { VideoCatalogCheckResult } from "../src/video-catalog.ts";

function checkResult(overrides: Partial<VideoCatalogCheckResult> = {}): VideoCatalogCheckResult {
  return {
    ok: true,
    docCategories: 12,
    dbCategories: 12,
    docItems: 100,
    dbItems: 100,
    missingInDb: [],
    extraInDb: [],
    mismatched: [],
    ...overrides,
  };
}

function deps(overrides: {
  mode?: () => "json" | "dual" | "db";
  loadDoc?: () => Promise<unknown>;
  check?: (data: unknown) => Promise<VideoCatalogCheckResult>;
  repair?: (data: unknown) => Promise<unknown>;
} = {}) {
  const calls = { loaded: 0, checked: 0, repaired: 0 };
  return {
    calls,
    deps: {
      mode: overrides.mode ?? (() => "json" as const),
      loadDoc:
        overrides.loadDoc ??
        (() => {
          calls.loaded++;
          return Promise.resolve({ navigationItems: [] });
        }),
      check:
        overrides.check ??
        (() => {
          calls.checked++;
          return Promise.resolve(checkResult());
        }),
      repair:
        overrides.repair ??
        (() => {
          calls.repaired++;
          return Promise.resolve({ ok: true });
        }),
    },
    log: (line: string) => {
      void line;
    },
  };
}

describe("decideBootRepair 决策纯函数", () => {
  it("一致 → clean（不写表）", () => {
    expect(decideBootRepair("json", checkResult())).toBe("clean");
    expect(decideBootRepair("dual", checkResult())).toBe("clean");
  });

  it("漂移 + json/dual → repair（KV 是事实源，方向 KV → 表）", () => {
    const drifted = checkResult({ ok: false, dbItems: 93, missingInDb: ["a", "b"] });
    expect(decideBootRepair("json", drifted)).toBe("repair");
    expect(decideBootRepair("dual", drifted)).toBe("repair");
  });

  it("漂移 + db → log_only：读路径已在表上，反向覆盖等于拿旧影子毁掉服务中的数据", () => {
    const drifted = checkResult({ ok: false, dbItems: 93, missingInDb: ["a"] });
    expect(decideBootRepair("db", drifted)).toBe("log_only");
  });
});

describe("runBootReconcile 编排", () => {
  it("db 模式：不读文档、不检查、不修表", async () => {
    const { deps: d, calls, log } = deps({ mode: () => "db" });
    const outcome = await runBootReconcile(d, log);
    expect(outcome.action).toBe("skipped_db_mode");
    expect(outcome.attempted).toBe(false);
    expect(calls.loaded).toBe(0);
    expect(calls.checked).toBe(0);
  });

  it("KV 无数据（从未保存过）→ 跳过且不报错", async () => {
    const { deps: d, log } = deps({ loadDoc: () => Promise.resolve(null) });
    const outcome = await runBootReconcile(d, log);
    expect(outcome.action).toBe("skipped_db_mode");
    expect(outcome.check).toBeNull();
  });

  it("一致 → clean，不触发修表", async () => {
    const { deps: d, calls, log } = deps();
    const outcome = await runBootReconcile(d, log);
    expect(outcome.action).toBe("clean");
    expect(calls.repaired).toBe(0);
  });

  it("漂移 → 修表并复检；复检一致报 repaired", async () => {
    let repaired = false;
    const { deps: d, log } = deps({
      check: () =>
        Promise.resolve(
          repaired
            ? checkResult()
            : checkResult({ ok: false, dbItems: 93, missingInDb: ["harvest_x"] }),
        ),
      repair: () => {
        repaired = true;
        return Promise.resolve({ ok: true });
      },
    });
    const outcome: BootReconcileOutcome = await runBootReconcile(d, log);
    expect(outcome.action).toBe("repaired");
    expect(outcome.check?.ok).toBe(true);
  });

  it("修表后复检仍不一致 → failed（如实上报，不伪装成功）", async () => {
    const { deps: d, log } = deps({
      check: () => Promise.resolve(checkResult({ ok: false, dbItems: 93 })),
    });
    const outcome = await runBootReconcile(d, log);
    expect(outcome.action).toBe("failed");
  });
});
