/**
 * 「拒绝爬虫 ≠ 死链」的回归测试（2026-11-03 真实缺陷修复）。
 *
 * 事故数据（来自真实库 data/navhub.db）：
 *   - 16 个 broken 站点里 13 个实为 403/401 —— Claude、ChatGPT、Midjourney、npm、
 *     Unsplash、Uiverse、Grok、AlternativeTo、CodePen、JSBin、Enpass、CCleaner、
 *     Macrium Reflect。它们活着，只是不让爬虫看，却被推给用户显示「已失效」。
 *   - 真死链（404/410/451）为 0。
 *   - 243 次失败巡检里 133 次 error 为空 —— 运维完全无法诊断。
 *
 * 本测试用真实库路径（sqlite :memory: + 完整迁移）验证：
 *   1. blocked 记录不推进连续失败计数 → 站点不会因此变 broken；
 *   2. blocked 记录能自愈已 broken 的站点 → 回到 active；
 *   3. 真正的失败（超时/404）仍然会按阈值把站点判死；
 *   4. 每条失败都带非空原因。
 */
import { describe, expect, it } from "vitest";
import { openDb } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

async function freshRepo(): Promise<Repository> {
  const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  return new Repository(db);
}

describe("健康巡检：拒绝爬虫不判死", () => {
  it("blocked 行不推进连续失败计数（403 站点保持 active）", async () => {
    const repo = await freshRepo();
    const cat = await repo.createCategory({ id: "c1", title: "分类" });
    const site = await repo.createSiteWithId({
      id: "s1",
      url: "https://claude.ai",
      title: "Claude",
      categoryId: cat.id,
    });

    // 模拟连续 3 次「403 拒绝爬虫」
    for (let i = 0; i < 3; i++) {
      await repo.updateSiteHealth("s1", {
        httpStatus: 403,
        ok: false,
        blocked: true,
        latencyMs: 100,
        redirectTo: null,
        error: "HTTP 403：拒绝爬虫，无法验证内容",
        currentStatus: site.status,
        markBroken: false, // 巡检侧对 blocked 显式传 false
      });
    }

    const after = await repo.getSite("s1");
    expect(after!.status).toBe("active");

    // recentHealthChecks 应跳过这 3 条 blocked，返回空
    const recent = await repo.recentHealthChecks("s1", 5);
    expect(recent).toEqual([]);
  });

  it("blocked 能自愈已 broken 的站点（回到 active）", async () => {
    const repo = await freshRepo();
    const cat = await repo.createCategory({ id: "c1", title: "分类" });
    await repo.createSiteWithId({
      id: "s2",
      url: "https://chatgpt.com",
      title: "ChatGPT",
      categoryId: cat.id,
      status: "broken",
    });

    await repo.updateSiteHealth("s2", {
      httpStatus: 403,
      ok: false,
      blocked: true,
      latencyMs: 100,
      redirectTo: null,
      error: "HTTP 403：拒绝爬虫，无法验证内容",
      currentStatus: "active",
      markBroken: false,
    });

    const after = await repo.getSite("s2");
    expect(after!.status).toBe("active");
  });

  it("真正的失败（非 blocked）仍按阈值判死", async () => {
    const repo = await freshRepo();
    const cat = await repo.createCategory({ id: "c1", title: "分类" });
    await repo.createSiteWithId({
      id: "s3",
      url: "https://dead.example.com",
      title: "死站",
      categoryId: cat.id,
    });

    // 第 1、2 次失败：未达阈值(3)，保持 active
    for (let i = 0; i < 2; i++) {
      await repo.updateSiteHealth("s3", {
        httpStatus: null,
        ok: false,
        blocked: false,
        latencyMs: 9000,
        redirectTo: null,
        error: "10.0 秒内未响应（慢不等于死，建议稍后复检）",
        currentStatus: "active",
        markBroken: false,
      });
    }
    expect((await repo.getSite("s3"))!.status).toBe("active");

    // 第 3 次：达到阈值 → broken
    await repo.updateSiteHealth("s3", {
      httpStatus: null,
      ok: false,
      blocked: false,
      latencyMs: 9000,
      redirectTo: null,
      error: "10.0 秒内未响应（慢不等于死，建议稍后复检）",
      currentStatus: "active",
      markBroken: true,
    });
    expect((await repo.getSite("s3"))!.status).toBe("broken");
  });

  it("每条失败记录都带非空原因（不再出现「失败但无原因」）", async () => {
    const repo = await freshRepo();
    const cat = await repo.createCategory({ id: "c1", title: "分类" });
    await repo.createSiteWithId({ id: "s4", url: "https://x.example.com", title: "X", categoryId: cat.id });

    await repo.updateSiteHealth("s4", {
      httpStatus: 403,
      ok: false,
      blocked: true,
      latencyMs: 50,
      redirectTo: null,
      error: "HTTP 403：拒绝爬虫，无法验证内容",
      currentStatus: "active",
      markBroken: false,
    });

    const rows = await repo.raw(
      "SELECT error, blocked FROM health_checks WHERE site_id = ? AND ok = 0",
      ["s4"],
    );
    expect(rows.length).toBe(1);
    const reason = String(rows[0]!.error ?? "");
    expect(reason.trim().length).toBeGreaterThan(0);
    expect(Number(rows[0]!.blocked)).toBe(1);
  });

  it("blocked 记录仍然写进 health_checks（可观测，只是不计数）", async () => {
    const repo = await freshRepo();
    const cat = await repo.createCategory({ id: "c1", title: "分类" });
    await repo.createSiteWithId({ id: "s5", url: "https://y.example.com", title: "Y", categoryId: cat.id });

    await repo.updateSiteHealth("s5", {
      httpStatus: 429,
      ok: false,
      blocked: true,
      latencyMs: 80,
      redirectTo: null,
      error: "HTTP 429：拒绝爬虫，无法验证内容",
      currentStatus: "active",
      markBroken: false,
    });

    const total = await repo.raw("SELECT COUNT(*) c FROM health_checks WHERE site_id = ?", ["s5"]);
    expect(Number(total[0]!.c)).toBe(1);
  });
});
