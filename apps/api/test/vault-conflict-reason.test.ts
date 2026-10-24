/**
 * 云端金库 409 的「原因分流」（data-sovereignty P1）。
 *
 * 带版本的 PUT /api/vault/sync 在两种情况下都返回 409，但成因相反：
 *   A. 云端行已不存在（另一台设备清除/注销过），本地版本号指向一份空备份；
 *   B. 云端行还在，只是版本被别的设备推进了（真正的并发写冲突）。
 * 旧实现统一回「云端金库已被其它设备更新」，A 类用户会照着「先拉取最新」操作，
 * 而云端没有可拉取的内容 → 反复失败且看不出原因（WCAG 3.3.1 / 3.3.3）。
 *
 * 本文件锁三件事：
 *   1. 两种 409 用 code / 文案 / hint 明确区分，且都不带等价的 etag；
 *   2. A 类引导以 version=0 重建，照做后能成功；
 *   3. B 类保留 current + etag，照做（按返回版本号重推）能成功。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const ID = "anon-vaultconflict-0001";
const H = { "x-navhub-anon-id": ID };

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-vault-conflict-"));
  ctx = await createContext(
    loadConfig({ mode: "lite", sqlitePath: join(dir, "conflict.db"), corsOrigins: ["*"] }),
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

const put = (payload: string, version?: number) =>
  app.inject({
    method: "PUT",
    url: "/api/vault/sync",
    headers: H,
    payload: version === undefined ? { payload } : { payload, version },
  });

describe("云端金库 409 原因分流", () => {
  it("云端没有金库却带正版本号 → VAULT_CLEARED，且引导 version=0 重建", async () => {
    const res = await put("cipher-local", 3);
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("VAULT_CLEARED");
    expect(body.current).toBeNull();
    expect(body.error).toContain("已被清除");
    expect(body.hint).toContain("version=0");
    // 没有 current 就不该回 etag：回了会暗示「有版本可对齐」
    expect(res.headers.etag).toBeUndefined();
  });

  it("按引导用 version=0 重建 → 成功", async () => {
    const res = await put("cipher-rebuilt", 0);
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(1);
  });

  it("云端仍有金库但版本被推进 → VERSION_CONFLICT，带 current/etag 与拉取建议", async () => {
    const stale = await put("cipher-stale", 0);
    expect(stale.statusCode).toBe(409);
    const body = stale.json();
    expect(body.code).toBe("VERSION_CONFLICT");
    expect(body.current).toMatchObject({ version: 1 });
    expect(body.error).toContain("已被其它设备更新");
    expect(body.hint).toContain("拉取");
    expect(stale.headers.etag).toBe('"1"');

    // 照建议按返回版本号重推：应成功并推进版本
    const retry = await app.inject({
      method: "PUT",
      url: "/api/vault/sync",
      headers: { ...H, "if-match": stale.headers.etag as string },
      payload: { payload: "cipher-stale" },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().version).toBe(2);
  });

  it("云端被另一台设备清除后，旧版本号再推 → VAULT_CLEARED（不是并发冲突）", async () => {
    const del = await app.inject({ method: "DELETE", url: "/api/vault/sync", headers: H });
    expect(del.statusCode).toBe(200);

    const res = await put("cipher-after-clear", 2);
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("VAULT_CLEARED");
    expect(body.current).toBeNull();
    expect(body.code).not.toBe("VERSION_CONFLICT");
  });
});
