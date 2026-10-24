import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

/**
 * 冷备恢复必须保留「停用」状态。
 *
 * 缺陷：restore 只透传 7 个字段，insertSitesBulk 缺省 enabled=true / status=active。
 * 一份含停用站点的备份恢复后，这些站点会重新出现在公开列表与检索里——
 * 恢复动作意外变成了「批量上线」。
 */
describe("备份恢复保留停用状态", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-backup-enabled-"));
    ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
    app = await buildServer(ctx);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("enabled=false 的站点恢复后仍停用，且不会以 active 状态出现", async () => {
    const backup = {
      version: "1.0",
      generator: "NavHub 2026 Sovereign Backup Engine",
      exportedAt: Date.now(),
      categories: [],
      sites: [
        { id: "old-live", title: "公开站点", url: "https://live.example.com", description: "", tags: [], enabled: true },
        { id: "old-hidden", title: "停用站点", url: "https://hidden.example.com", description: "", tags: [], enabled: false },
      ],
      stats: { categoryCount: 0, siteCount: 2 },
    };

    const res = await app.inject({ method: "POST", url: "/api/backup/restore?dryRun=false", payload: backup });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored.sites).toBe(2);

    const all = await ctx.repo.listAllSites();
    const hidden = all.find((s) => s.url === "https://hidden.example.com");
    const live = all.find((s) => s.url === "https://live.example.com");
    expect(hidden).toBeTruthy();
    expect(live).toBeTruthy();
    expect(hidden!.enabled).toBe(false);
    expect(hidden!.status).toBe("archived");
    expect(live!.enabled).toBe(true);
    expect(live!.status).toBe("active");
  });
});
