/**
 * 冷备下载的权限边界：备份包含 disabled 站点，必须 admin 才能导出。
 * 恢复接口已是 admin；这里把下载侧也锁上，避免匿名批量取走未发布数据。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const BOOTSTRAP = "backup-scope-bootstrap-secret";

describe("冷备导出权限", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-backup-scope-"));
    ctx = await createContext(
      loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "api.db"),
        authRequired: true,
        bootstrapToken: BOOTSTRAP,
        corsOrigins: ["*"],
      }),
    );
    app = await buildServer(ctx);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function mint(name: string, scopes: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { authorization: `Bearer ${BOOTSTRAP}` },
      payload: { name, scopes },
    });
    expect(res.statusCode).toBe(201);
    return res.json().token as string;
  }

  it("匿名不能下载全量冷备", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/backup.json" });
    expect(res.statusCode).toBe(401);
  });

  it("read token 不能下载全量冷备", async () => {
    const token = await mint("backup-reader", "read");
    const res = await app.inject({
      method: "GET",
      url: "/api/export/backup.json",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin token 可以下载全量冷备", async () => {
    const token = await mint("backup-admin", "admin");
    const res = await app.inject({
      method: "GET",
      url: "/api/export/backup.json",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body).version).toBe("1.0");
  });
});
