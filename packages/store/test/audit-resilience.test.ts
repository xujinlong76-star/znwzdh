/**
 * 审计写入容错测试（升级改造方案 P1-1）。
 *
 * 背景：server.ts 有 24 处 repo.audit 调用点。历史上它们全部裸调——
 * audit_logs 插入失败（磁盘满 / 锁竞争 / schema 漂移）会把已成功的写操作
 * 变成 500；delete/rotate 场景甚至造成「状态已改但客户端以为失败」。
 * 修复：仓储层 audit 统一兜底，失败仅 console.error 不外抛。
 *
 * 本测试锁定该语义：audit 抛错时，调用方必须无感完成。
 */
import { describe, expect, it, vi } from "vitest";
import { openDb } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

type RepoInternals = {
  run: (sql: string, params: unknown[]) => Promise<void>;
};

describe("audit 写入容错", () => {
  it("audit_logs 插入失败时不外抛（主操作结果不受影响）", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    await repo.createCategory({ id: "cat-audit", title: "审计容错" });

    // 仅让 audit_logs 的 INSERT 失败，其余 SQL 走原路径
    const internals = repo as unknown as RepoInternals;
    const originalRun = internals.run.bind(repo);
    internals.run = async (sql: string, params: unknown[]) => {
      if (sql.includes("audit_logs")) throw new Error("disk I/O error (simulated)");
      return originalRun(sql, params);
    };

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // 1) 直接调 audit：必须 resolve 而不是 reject
    await expect(
      repo.audit({ actor: "test", actorKind: "user", action: "site.create", target: "x" })
    ).resolves.toBeUndefined();

    // 2) 典型写操作（内部若审计）必须照常成功
    const site = await repo.createSite({
      url: "https://example.com/audit-fault",
      title: "审计故障不影响写入",
      categoryId: "cat-audit",
      source: "test",
    });
    expect(site.id).toBeTruthy();
    expect(await repo.findSiteByUrl("https://example.com/audit-fault")).not.toBeNull();

    // 3) 失败有留痕（不是静默吞掉）
    expect(errSpy).toHaveBeenCalled();
    const firstCall = errSpy.mock.calls[0]!.join(" ");
    expect(firstCall).toContain("审计写入失败");

    errSpy.mockRestore();
    await db.close();
  });

  it("正常路径下审计照常落库（容错不破坏正常功能）", async () => {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    const repo = new Repository(db);
    await repo.audit({ actor: "test", action: "health.check", target: "ok" });
    const logs = await repo.listAuditLogs({ action: "health.check" });
    expect(logs.items).toHaveLength(1);
    expect(logs.items[0]!.actor).toBe("test");
    await db.close();
  });
});
