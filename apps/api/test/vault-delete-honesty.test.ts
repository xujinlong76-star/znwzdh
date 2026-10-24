/**
 * DELETE /api/vault/sync 的删除回执（data-sovereignty P2·诚实度）。
 *
 * 旧实现无论云端有没有金库都回 {ok:true}，客户端把它折叠成 boolean 后
 * 一律提示「已删除云端备份」——「本来就没有」与「真删掉了」在 UI 上同形，
 * 等于用假成功消耗用户对删除能力的信任（WCAG 3.3.1 错误识别）。
 *
 * 本文件锁四件事：
 *   1. 本来没有 → deleted:false，且不凭空造行；
 *   2. 确实有 → deleted:true，读回为空；
 *   3. 重复删除 → 第二次 deleted:false（幂等，不报错）；
 *   4. 回执与审计 diff.hadVault 同源；别的身份删不到我的金库。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const ID = "anon-vaultdelete-0001";
const OTHER = "anon-vaultdelete-0002";
const H = { "x-navhub-anon-id": ID };
const H_OTHER = { "x-navhub-anon-id": OTHER };

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-vault-delete-"));
  ctx = await createContext(
    loadConfig({ mode: "lite", sqlitePath: join(dir, "delete.db"), corsOrigins: ["*"] }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows SQLite 句柄延迟释放
  }
});

const put = (payload: string, headers = H) =>
  app.inject({ method: "PUT", url: "/api/vault/sync", headers, payload: { payload } });

const del = (headers = H) =>
  app.inject({ method: "DELETE", url: "/api/vault/sync", headers });

const get = (headers = H) =>
  app.inject({ method: "GET", url: "/api/vault/sync", headers });

describe("云端金库删除回执", () => {
  it("云端本来没有备份 → deleted:false，且不凭空建行", async () => {
    const res = await del();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(false);

    const after = await get();
    expect(after.statusCode).toBe(200);
    expect(after.json().vault).toBeNull();
  });

  it("真删掉时 → deleted:true，读回为空；重复删除 → deleted:false", async () => {
    const created = await put("cipher-v1");
    expect(created.statusCode).toBe(200);

    const first = await del();
    expect(first.statusCode).toBe(200);
    expect(first.json().deleted).toBe(true);

    const after = await get();
    expect(after.json().vault).toBeNull();

    const second = await del();
    expect(second.statusCode).toBe(200);
    expect(second.json().deleted).toBe(false);
  });

  it("回执与审计同源：diff.hadVault 与 deleted 一致", async () => {
    const { items } = await ctx.repo.listAuditLogs({ action: "vault.delete", actor: ID, limit: 10 });
    const diffs = items.map((it) => it.diff as { hadVault?: boolean; version?: number | null });
    // 最新两条：一次删掉真数据（hadVault=true），一次本来就没有（hadVault=false）
    expect(diffs[0]).toMatchObject({ hadVault: false });
    expect(diffs[1]).toMatchObject({ hadVault: true, version: 1 });
  });

  it("别的身份删不到我的金库", async () => {
    const created = await put("cipher-mine");
    expect(created.statusCode).toBe(200);

    const foreign = await del(H_OTHER);
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().deleted).toBe(false);

    const mine = await get();
    expect(mine.json().vault?.payload).toBe("cipher-mine");
  });
});
