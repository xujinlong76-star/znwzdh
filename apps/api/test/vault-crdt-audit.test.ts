/**
 * 金库 / CRDT 删除的可审计性（data-sovereignty P1）。
 *
 * 这两个 DELETE 是终端用户能发起的最不可逆动作：金库与 CRDT 日志都是硬删，
 * 没有 tombstone。此前两条路由的 audit() 调用数均为 0（grep 实测），
 * 于是 /api/me/activity 里永远看不到「我删过云端金库/漫游日志」——
 * 面板上能看到的动作，完全等价于哪些动作落了审计。
 *
 * 本文件锁四件事：
 *   1. 删除成功会写一条 vault.delete / crdt.delete；
 *   2. 审计 diff 记录删除前的真实状态（本来就没有 ≠ 真删掉了 N 条）；
 *   3. 删除动作出现在 /api/me/activity 的返回里（用户可见面）；
 *   4. activity 仍只透出 action / target / 时间，不泄漏 diff 与 IP。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const ID = "anon-vaultaudit-0001";
const H = { "x-navhub-anon-id": ID };

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubAuditTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-vault-audit-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "audit.db") } as never));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄释放有延迟：临时目录交给系统回收，不让清理失败判红
  }
});

describe("云端金库删除写入审计", () => {
  it("删掉存在的金库：记 vault.delete，diff 带 hadVault 与版本", async () => {
    const saved = await ctx.repo.saveUserVault(ID, "cipher-v1");
    expect(saved.version).toBeGreaterThan(0);

    const res = await app.inject({ method: "DELETE", url: "/api/vault/sync", headers: H });
    expect(res.statusCode).toBe(200);

    const page = await ctx.repo.listAuditLogs({ actor: ID, action: "vault.delete", limit: 10 });
    expect(page.items.length).toBe(1);
    expect(page.items[0].target).toBe("vault");
    expect(page.items[0].actorKind).toBe("user");
    expect(page.items[0].diff).toMatchObject({ hadVault: true, version: saved.version });
  });

  it("金库本来就不存在：仍然留痕，但 diff 必须写 hadVault=false（不许谎报删掉了东西）", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/vault/sync", headers: H });
    expect(res.statusCode).toBe(200);

    const page = await ctx.repo.listAuditLogs({ actor: ID, action: "vault.delete", limit: 10 });
    const latest = page.items[0];
    expect(latest.diff).toMatchObject({ hadVault: false, version: null });
  });
});

describe("CRDT 漫游日志删除写入审计", () => {
  it("记 crdt.delete 与删除时的操作条数", async () => {
    const ops = [{ id: "op-1" }, { id: "op-2" }, { id: "op-3" }];
    await ctx.repo.saveUserVault("crdt:" + ID, JSON.stringify({ version: 1, operations: ops }));

    const res = await app.inject({ method: "DELETE", url: "/api/crdt/sync", headers: H });
    expect(res.statusCode).toBe(200);

    const page = await ctx.repo.listAuditLogs({ actor: ID, action: "crdt.delete", limit: 10 });
    expect(page.items.length).toBe(1);
    expect(page.items[0].target).toBe("crdt");
    expect(page.items[0].diff).toMatchObject({ hadLog: true, operations: 3 });

    // 删除后确实读不到了
    const after = await app.inject({ method: "GET", url: "/api/crdt/sync", headers: H });
    expect(after.json().operations).toEqual([]);
  });

  it("日志本来就不存在：diff 写 hadLog=false、operations=0", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/crdt/sync", headers: H });
    expect(res.statusCode).toBe(200);

    const page = await ctx.repo.listAuditLogs({ actor: ID, action: "crdt.delete", limit: 10 });
    expect(page.items[0].diff).toMatchObject({ hadLog: false, operations: 0 });
  });
});

describe("用户可见面：我的操作记录", () => {
  it("两类删除都出现在 /api/me/activity，且不泄漏 diff / IP", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/activity?limit=50", headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>> };
    const actions = body.items.map((i) => i.action);
    expect(actions).toContain("vault.delete");
    expect(actions).toContain("crdt.delete");

    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(["action", "at", "target"]);
    }
  });
});
