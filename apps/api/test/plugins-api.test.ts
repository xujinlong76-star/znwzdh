/**
 * 插件市场 API 全链路集成测试：
 * 发布(校验/待审) → 审核(上架/重复 409) → 安装(幂等/索引计数) → 星标/举报 →
 * 卸载(软删站点) → 更新(回待审) → 导入(直接上架/重名 409)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const sitePack = (name: string, sites: Array<{ url: string; title: string }>) => ({
  manifestVersion: 1,
  kind: "site-pack",
  name,
  description: "集成测试用网址包",
  version: "1.0.0",
  tags: ["测试"],
  payload: { categories: [{ title: "插件测试类目" }], sites },
});

async function slugOf(name: string, status?: string): Promise<string> {
  const admin = await app.inject({ method: "GET", url: `/api/admin/plugins?q=${encodeURIComponent(name)}` });
  const item = admin.json().items.find((p: { name: string; status: string }) =>
    p.name === name && (status ? p.status === status : true),
  );
  if (!item) throw new Error(`找不到插件：${name}（status=${status ?? "any"}）`);
  return item.slug;
}

const publishedSlug = (name: string) => slugOf(name, "published");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugins-api-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("插件市场 API 全链路", () => {
  it("发布：非法清单 400；合法清单 201 进待审（公开列表不可见；详情 404）", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/plugins",
      payload: { manifestVersion: 1, kind: "script-pack", name: "x" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors.length).toBeGreaterThan(0);

    const created = await app.inject({
      method: "POST",
      url: "/api/plugins",
      payload: sitePack("集成测试包", [{ url: "https://plugin-a.example.com", title: "A" }]),
    });
    if (created.statusCode !== 201) {
      console.log("[debug] publish failed:", created.statusCode, created.body);
    }
    expect(created.statusCode).toBe(201);
    const { slug, status } = created.json();
    expect(status).toBe("pending");

    const publicList = await app.inject({ method: "GET", url: "/api/plugins" });
    expect(publicList.json().items.some((p: { slug: string }) => p.slug === slug)).toBe(false);

    const adminList = await app.inject({ method: "GET", url: "/api/admin/plugins?status=pending" });
    expect(adminList.json().items.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    expect(adminList.json().pending).toBeGreaterThanOrEqual(1);

    // 开放模式（NAVHUB_AUTH_REQUIRED 关）下匿名自带 admin scope：待审插件对调用方可见
    // （与 detail 门禁一致；鉴权开启时无 scope 的访客才是 404）
    const detail404 = await app.inject({ method: "GET", url: `/api/plugins/${encodeURIComponent(slug)}` });
    expect(detail404.statusCode).toBe(200);
    expect(detail404.json().plugin.status).toBe("pending");
  });

  it("审核：approve 后公开可见；重复 approve 409", async () => {
    const list = await app.inject({ method: "GET", url: "/api/admin/plugins?status=pending" });
    const item = list.json().items.find((p: { name: string }) => p.name === "集成测试包");
    expect(item).toBeTruthy();

    const approved = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(item.slug)}/review`,
      payload: { action: "approve", note: "测试通过" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().plugin.status).toBe("published");

    const again = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(item.slug)}/review`,
      payload: { action: "approve" },
    });
    expect(again.statusCode).toBe(409);

    const publicList = await app.inject({ method: "GET", url: "/api/plugins?q=集成测试包" });
    expect(publicList.json().items.some((p: { slug: string }) => p.slug === item.slug)).toBe(true);
  });

  it("安装：建站点、幂等计数、installed 列表与详情交互态", async () => {
    const slug = await publishedSlug("集成测试包");
    const res = await app.inject({ method: "POST", url: `/api/plugins/${encodeURIComponent(slug)}/install?anonId=anon-test-1` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.applied.sitesAdded).toBe(1);
    expect(body.plugin.installCount).toBe(1);

    const again = await app.inject({ method: "POST", url: `/api/plugins/${encodeURIComponent(slug)}/install?anonId=anon-test-1` });
    expect(again.json().applied.sitesAdded).toBe(0);
    expect(again.json().applied.sitesSkipped).toBe(1);
    expect(again.json().alreadyInstalled).toBe(true);
    expect(again.json().plugin.installCount).toBe(1);

    const installed = await app.inject({ method: "GET", url: "/api/plugins/installed?anonId=anon-test-1" });
    expect(installed.statusCode).toBe(200);
    expect(installed.json().items.some((p: { slug: string }) => p.slug === slug)).toBe(true);

    const detail = await app.inject({ method: "GET", url: `/api/plugins/${encodeURIComponent(slug)}?anonId=anon-test-1` });
    expect(detail.json().plugin.installed).toBe(true);
    expect(detail.json().plugin.starred).toBe(false);
  });

  it("星标/举报：计数与参数校验", async () => {
    const slug = await publishedSlug("集成测试包");
    const star = await app.inject({ method: "POST", url: `/api/plugins/${encodeURIComponent(slug)}/star?anonId=anon-test-1` });
    expect(star.json().starCount).toBe(1);
    const starAgain = await app.inject({ method: "POST", url: `/api/plugins/${encodeURIComponent(slug)}/star?anonId=anon-test-1` });
    expect(starAgain.json().starCount).toBe(1);
    const unstar = await app.inject({ method: "DELETE", url: `/api/plugins/${encodeURIComponent(slug)}/star?anonId=anon-test-1` });
    expect(unstar.json().starCount).toBe(0);

    const bad = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/report?anonId=anon-test-1`,
      payload: { reason: "" },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/report?anonId=anon-test-1`,
      payload: { reason: "链接失效" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().reportCount).toBe(1);
  });

  it("卸载：removeSites=true 只软删导入站点", async () => {
    const slug = await publishedSlug("集成测试包");
    const off = await app.inject({
      method: "DELETE",
      url: `/api/plugins/${encodeURIComponent(slug)}/install?anonId=anon-test-1&removeSites=true`,
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().removed).toBe(true);
    expect(off.json().removedSites).toBe(1);
    const alive = await ctx.repo.raw("SELECT COUNT(*) AS cnt FROM sites WHERE source = ? AND deleted_at IS NULL", [
      "plugin:" + slug,
    ]);
    expect(Number(alive[0]?.cnt ?? 0)).toBe(0);
  });

  it("更新：已发布插件更新后回待审并清空上架时间", async () => {
    const slug = await publishedSlug("集成测试包");
    const put = await app.inject({
      method: "PUT",
      url: `/api/plugins/${encodeURIComponent(slug)}`,
      payload: sitePack("集成测试包", [
        { url: "https://plugin-a.example.com", title: "A" },
        { url: "https://plugin-b.example.com", title: "B" },
      ]),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().status).toBe("pending");

    const admin = await app.inject({ method: "GET", url: "/api/admin/plugins?q=集成测试包" });
    const item = admin.json().items.find((p: { slug: string }) => p.slug === slug);
    expect(item.publishedAt).toBeNull();
  });

  it("导入：直接上架；同名重复导入 409", async () => {
    const payload = sitePack("外部导入包", [{ url: "https://imported.example.com", title: "导入站点" }]);
    const res = await app.inject({ method: "POST", url: "/api/plugins/import", payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("published");
    const dup = await app.inject({ method: "POST", url: "/api/plugins/import", payload });
    expect(dup.statusCode).toBe(409);
  });

  it("守卫：缺身份 400；未上架安装 409", async () => {
    // 第六组用例已把该插件更新为待审：此时安装应 409
    const slug = await slugOf("集成测试包");
    const pendingInstall = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/install?anonId=anon-test-2`,
    });
    expect(pendingInstall.statusCode).toBe(409);

    const imported = await publishedSlug("外部导入包");
    const noIdentity = await app.inject({ method: "POST", url: `/api/plugins/${encodeURIComponent(imported)}/install` });
    expect(noIdentity.statusCode).toBe(400);
  });
});
