/**
 * 插件市场 API 全链路集成测试：
 * 发布(校验/待审) → 审核(上架/重复 409) → 安装(幂等/索引计数) → 星标/举报 →
 * 卸载(软删站点) → 更新(回待审) → 导入(直接上架/重名 409)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
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
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略 Windows 上 SQLite 文件 handle 异步释放产生的短暂占用
  }
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
      url: "/api/plugins?anonId=author-1",
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

  it("遥测大盘：GET /api/admin/plugins/metrics 返回各维度统计", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/plugins/metrics" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.totalPlugins).toBeGreaterThan(0);
    expect(json.publishedCount).toBeGreaterThan(0);
    expect(json.kindDistribution).toBeDefined();
    expect(Array.isArray(json.topInstalled)).toBe(true);
  });

  it("差异对比：POST /api/plugins/diff 校验并比对两份清单变更", async () => {
    const base = sitePack("对比基准包", [{ url: "https://base.example.com", title: "Base" }]);
    const target = {
      ...sitePack("对比目标包", [
        { url: "https://base.example.com", title: "Base (Updated)" },
        { url: "https://new.example.com", title: "New Added" },
      ]),
      version: "1.1.0",
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/diff",
      payload: { baseManifest: base, targetManifest: target },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.diff.hasChanges).toBe(true);
    expect(body.diff.sitesAddedCount).toBe(1);
    expect(body.diff.sitesModifiedCount).toBe(1);
  });

  it("版本历史接口：GET /api/plugins/:slug/versions 与特定版本清单查询", async () => {
    // 导入一份直接上架插件
    const imported = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: sitePack("版本历史测试包", [{ url: "https://ver.example.com", title: "Ver" }]),
    });
    expect(imported.statusCode).toBe(201);
    const slug = imported.json().slug;

    const listRes = await app.inject({ method: "GET", url: `/api/plugins/${slug}/versions` });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.slug).toBe(slug);
    expect(listBody.versions).toHaveLength(1);
    expect(listBody.versions[0].version).toBe("1.0.0");
    expect(listBody.versions[0].checksum).toBeTruthy();

    const detailRes = await app.inject({ method: "GET", url: `/api/plugins/${slug}/versions/1.0.0` });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json();
    expect(detailBody.version).toBe("1.0.0");
    expect(detailBody.manifest.name).toBe("版本历史测试包");
    expect(detailBody.diffAgainstCurrent.hasChanges).toBe(false);
  });

  it("评价接口：POST 与 GET /api/plugins/:slug/reviews（需活跃安装）", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: sitePack("评价测试包", [{ url: "https://review-test.example.com", title: "Review Test" }]),
    });
    const slug = imported.json().slug;

    // 未安装时打分报 400
    const failRes = await app.inject({
      method: "POST",
      url: `/api/plugins/${slug}/reviews`,
      payload: { rating: 5, identity: "user-uninstalled" },
    });
    expect(failRes.statusCode).toBe(400);

    // 安装
    await app.inject({
      method: "POST",
      url: `/api/plugins/${slug}/install`,
      payload: { identity: "user-buyer" },
    });

    // 提交评价
    const okRes = await app.inject({
      method: "POST",
      url: `/api/plugins/${slug}/reviews`,
      payload: {
        rating: 5,
        title: "十分好用",
        content: "强烈推荐大家使用！",
        identity: "user-buyer",
      },
    });
    expect(okRes.statusCode).toBe(201);
    const okBody = okRes.json();
    expect(okBody.success).toBe(true);
    expect(okBody.review.rating).toBe(5);
    expect(okBody.stats.reviewCount).toBe(1);
    expect(okBody.stats.avgRating).toBe(5);

    // 查评价列表
    const getRes = await app.inject({
      method: "GET",
      url: `/api/plugins/${slug}/reviews?identity=user-buyer`,
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.total).toBe(1);
    expect(getBody.myReview?.title).toBe("十分好用");

    // 详情接口也附带 reviewStats
    const detailRes = await app.inject({
      method: "GET",
      url: `/api/plugins/${slug}?identity=user-buyer`,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().plugin.reviewStats?.reviewCount).toBe(1);
  });

  it("动态 SVG 徽章服务：正确渲染版本、安装量及 404 徽章", async () => {
    const slug = await publishedSlug("评价测试包");

    // 1. 默认 version 徽章
    const vRes = await app.inject({
      method: "GET",
      url: `/api/plugins/${slug}/badge.svg`,
    });
    expect(vRes.statusCode).toBe(200);
    expect(vRes.headers["content-type"]).toContain("image/svg+xml");
    expect(vRes.body).toContain("<svg");
    expect(vRes.body).toContain("v1.0.0");

    // 2. installs 徽章
    const iRes = await app.inject({
      method: "GET",
      url: `/api/plugins/${slug}/badge.svg?metric=installs&label=downloads`,
    });
    expect(iRes.statusCode).toBe(200);
    expect(iRes.body).toContain("downloads");
    expect(iRes.body).toContain("installs");

    // 3. 不存在插件返回 404 错误徽章
    const notFoundRes = await app.inject({
      method: "GET",
      url: "/api/plugins/non-existent-plugin-xyz/badge.svg",
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.body).toContain("not found");
  });

  it("URL 安全检测 check-urls：并发检测与异常防护", async () => {
    const checkRes = await app.inject({
      method: "POST",
      url: "/api/plugins/check-urls",
      payload: {
        urls: [
          "ftp://bad-protocol.com",
          "invalid-url-format",
        ],
      },
    });
    expect(checkRes.statusCode).toBe(200);
    const body = checkRes.json();
    expect(body.success).toBe(true);
    expect(body.total).toBe(2);
    expect(body.okCount).toBe(0);
    expect(body.failedCount).toBe(2);
    expect(body.results[0].ok).toBe(false);
  });

  it("F4 组合包：引用已上架成员、详情解析、一次安装复用管道、失效后拒绝", async () => {
    // 两个已上架成员：site-pack + search-pack
    const siteRes = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: sitePack("组合包站点成员", [{ url: "https://bundle-api-site.example.com", title: "Bundle Site" }]),
    });
    expect(siteRes.statusCode).toBe(201);
    const siteSlug = siteRes.json().slug as string;

    const searchRes = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: {
        manifestVersion: 1,
        kind: "search-pack",
        name: "组合包搜索成员",
        description: "组合包 API 测试搜索引擎",
        version: "1.0.0",
        payload: {
          engines: [{ name: "Bundle Search", prefix: "!bapi", searchUrl: "https://search.example.com/?q={q}" }],
        },
      },
    });
    expect(searchRes.statusCode).toBe(201);
    const searchSlug = searchRes.json().slug as string;

    // 引用不存在成员 -> 409
    const broken = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: {
        manifestVersion: 1,
        kind: "bundle",
        name: "组合包不存在成员",
        description: "应被拒绝",
        version: "1.0.0",
        payload: { items: [{ slug: "ghost-plugin-xyz", kind: "site-pack" }] },
      },
    });
    expect(broken.statusCode).toBe(409);

    // 合法组合包 -> 导入即上架
    const bundleRes = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: {
        manifestVersion: 1,
        kind: "bundle",
        name: "API 组合包",
        description: "API 集成测试组合包",
        version: "1.0.0",
        payload: {
          items: [
            { slug: siteSlug, kind: "site-pack" },
            { slug: searchSlug, kind: "search-pack" },
          ],
        },
      },
    });
    expect(bundleRes.statusCode).toBe(201);
    const bundleSlug = bundleRes.json().slug as string;
    expect(bundleRes.json().status).toBe("published");
    expect(bundleRes.json().summary.bundleItemCount).toBe(2);

    // 详情返回成员解析与 ready 标记
    const detail = await app.inject({ method: "GET", url: `/api/plugins/${encodeURIComponent(bundleSlug)}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().plugin.bundleReady).toBe(true);
    expect(detail.json().plugin.bundleItems).toHaveLength(2);
    expect(detail.json().plugin.bundleItems.every((m: { available: boolean }) => m.available)).toBe(true);

    // 一次安装：聚合 applied.bundleItems，成员站点真实落库且幂等
    const install = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(bundleSlug)}/install?anonId=bundle-api-user`,
    });
    expect(install.statusCode).toBe(200);
    expect(install.json().applied.bundleItems).toHaveLength(2);
    expect(install.json().applied.sitesAdded).toBe(1);
    const installAgain = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(bundleSlug)}/install?anonId=bundle-api-user`,
    });
    expect(installAgain.json().applied.sitesAdded).toBe(0);
    expect(installAgain.json().alreadyInstalled).toBe(true);

    // 成员被下架：详情 ready=false，新用户安装被拒绝
    await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(siteSlug)}/review`,
      payload: { action: "delist", note: "组合包失效演练" },
    });
    const brokenDetail = await app.inject({ method: "GET", url: `/api/plugins/${encodeURIComponent(bundleSlug)}` });
    expect(brokenDetail.json().plugin.bundleReady).toBe(false);
    const blockedInstall = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(bundleSlug)}/install?anonId=bundle-api-user-2`,
    });
    expect(blockedInstall.statusCode).toBe(400);
    expect(blockedInstall.json().error).toContain("组合包暂不可安装");
  });
});



describe("F0 / E1 / E5 / E6 / E4 / E3 / F2 API", () => {
  it("发布必须身份；ownerKey 公开；/mine 与公开作者页按归属隔离", async () => {
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/plugins",
      payload: sitePack("匿名发布应拒绝", [{ url: "https://anon-reject.example.com", title: "Anon" }]),
    });
    expect(anonymous.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/plugins?anonId=api-owner-1",
      payload: sitePack("API 作者归属", [{ url: "https://api-owner.example.com", title: "Owner" }]),
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.ownerIdentity).toBeUndefined();
    expect(body.ownerKey).toMatch(/^[a-f0-9]{24}$/);
    const slug = body.slug as string;
    const ownerKey = body.ownerKey as string;

    const mine = await app.inject({ method: "GET", url: "/api/plugins/mine?anonId=api-owner-1" });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    expect(mine.json().items.find((p: { slug: string }) => p.slug === slug).ownerIdentity).toBeUndefined();

    const otherMine = await app.inject({ method: "GET", url: "/api/plugins/mine?anonId=api-owner-2" });
    expect(otherMine.json().items.some((p: { slug: string }) => p.slug === slug)).toBe(false);

    // pending 不进公开作者页
    const before = await app.inject({ method: "GET", url: `/api/plugins/author/${ownerKey}` });
    expect(before.statusCode).toBe(404);

    await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/review`,
      payload: { action: "approve", note: "API 测试通过" },
    });

    const author = await app.inject({ method: "GET", url: `/api/plugins/author/${ownerKey}` });
    expect(author.statusCode).toBe(200);
    expect(author.json().items.some((p: { slug: string }) => p.slug === slug)).toBe(true);
    expect(author.json().stats.plugins).toBeGreaterThanOrEqual(1);
  });

  it("作者版本提交：非作者 403；作者 202；通过后版本历史带 changelog 且 pendingChangelog 清空", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/plugins?anonId=version-api-owner",
      payload: sitePack("API 版本提交", [{ url: "https://api-version.example.com", title: "V1" }]),
    });
    const slug = created.json().slug as string;
    const firstApprove = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/review`,
      payload: { action: "approve" },
    });
    expect(firstApprove.statusCode).toBe(200);

    const v11 = {
      ...sitePack("API 版本提交", [
        { url: "https://api-version.example.com", title: "V1" },
        { url: "https://api-version-2.example.com", title: "V2" },
      ]),
      version: "1.1.0",
    };
    const forbiddenSubmit = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/versions?anonId=not-the-owner`,
      payload: { manifest: v11, changelog: "冒名提交" },
    });
    expect(forbiddenSubmit.statusCode).toBe(403);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/versions?anonId=version-api-owner`,
      payload: { manifest: v11, changelog: "新增 V2 站点" },
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json().status).toBe("pending");
    expect(submitted.json().pendingChangelog).toBe("新增 V2 站点");

    const approved = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/review`,
      payload: { action: "approve" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().plugin.pendingChangelog).toBeNull();

    const versions = await app.inject({ method: "GET", url: `/api/plugins/${encodeURIComponent(slug)}/versions` });
    const v11Record = versions.json().versions.find((v: { version: string }) => v.version === "1.1.0");
    expect(v11Record).toBeTruthy();
    expect(v11Record.changelog).toBe("新增 V2 站点");
  });

  it("编辑精选：PATCH 开关 + rank，公开列表 featured 过滤与排序生效", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: sitePack("API 精选演示", [{ url: "https://api-featured.example.com", title: "F" }]),
    });
    const slug = created.json().slug as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/plugins/${encodeURIComponent(slug)}/featured`,
      payload: { featured: true, rank: 77 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().plugin.featured).toBe(true);
    expect(patched.json().plugin.featuredRank).toBe(77);
    expect(patched.json().plugin.ownerIdentity).toBeUndefined();

    const list = await app.inject({ method: "GET", url: "/api/plugins?featured=true&sort=featured&limit=100" });
    expect(list.json().items[0].slug).toBe(slug);
    expect(list.json().items[0].featured).toBe(true);

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/plugins/${encodeURIComponent(slug)}/featured`,
      payload: { featured: "yes" },
    });
    expect(bad.statusCode).toBe(400);

    await app.inject({
      method: "PATCH",
      url: `/api/plugins/${encodeURIComponent(slug)}/featured`,
      payload: { featured: false, rank: 0 },
    });
    const after = await app.inject({ method: "GET", url: "/api/plugins?featured=true&limit=100" });
    expect(after.json().items.some((p: { slug: string }) => p.slug === slug)).toBe(false);
  });

  it("评价举报/隐藏/恢复：公开统计剔除隐藏评价，作者仍能看到 myReview.status", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: sitePack("API 评价治理", [{ url: "https://api-review-mod.example.com", title: "R" }]),
    });
    const slug = created.json().slug as string;
    await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/install`,
      payload: { identity: "api-review-buyer" },
    });
    const reviewRes = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/reviews`,
      payload: { rating: 5, title: "不错", content: "真实体验", identity: "api-review-buyer" },
    });
    expect(reviewRes.statusCode).toBe(201);
    const reviewId = reviewRes.json().review.id as string;

    const report = await app.inject({
      method: "POST",
      url: `/api/plugins/${encodeURIComponent(slug)}/reviews/${encodeURIComponent(reviewId)}/report`,
      payload: { reason: "疑似广告" },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().reportCount).toBe(1);

    const adminList = await app.inject({ method: "GET", url: "/api/admin/plugin-reviews?status=visible" });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().items.some((r: { id: string }) => r.id === reviewId)).toBe(true);

    const hidden = await app.inject({
      method: "PATCH",
      url: `/api/admin/plugin-reviews/${encodeURIComponent(reviewId)}`,
      payload: { action: "hide", note: "人工复核后隐藏" },
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().review.status).toBe("hidden");

    const publicList = await app.inject({ method: "GET", url: `/api/plugins/${encodeURIComponent(slug)}/reviews` });
    expect(publicList.json().total).toBe(0);
    expect(publicList.json().stats.reviewCount).toBe(0);

    const mine = await app.inject({
      method: "GET",
      url: `/api/plugins/${encodeURIComponent(slug)}/reviews?identity=api-review-buyer`,
    });
    expect(mine.json().myReview.status).toBe("hidden");

    const restored = await app.inject({
      method: "PATCH",
      url: `/api/admin/plugin-reviews/${encodeURIComponent(reviewId)}`,
      payload: { action: "restore" },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().review.status).toBe("visible");
    const publicAgain = await app.inject({ method: "GET", url: `/api/plugins/${encodeURIComponent(slug)}/reviews` });
    expect(publicAgain.json().total).toBe(1);
  });

  it("漏斗事件与治理告警：/api/admin/plugins/funnel 与 governance 可用", async () => {
    const before = await app.inject({ method: "GET", url: "/api/admin/plugins/funnel?days=1" });
    expect(before.statusCode).toBe(200);
    const beforeTotals = before.json().totals;

    for (const kind of ["plugin_view", "plugin_install_click"] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/events",
        payload: { kind, pluginSlug: "funnel-api-demo", anonId: "funnel-api-user" },
      });
      expect(res.statusCode).toBe(200);
    }
    const after = await app.inject({ method: "GET", url: "/api/admin/plugins/funnel?days=1" });
    expect(after.json().totals.views).toBeGreaterThanOrEqual(beforeTotals.views + 1);
    expect(after.json().totals.installClicks).toBeGreaterThanOrEqual(beforeTotals.installClicks + 1);
    expect(after.json().series).toHaveLength(1);

    // 直接走 store 建 pending，避免触发发布路由的 5 次/小时限流（本文件其余用例已用满）
    const validated = validateAndCleanPluginManifest(
      sitePack("治理 SLA 演示", [{ url: "https://api-governance-sla.example.com", title: "S" }]),
    );
    if (!validated.ok) throw new Error(validated.errors.join(" | "));
    const pending = await ctx.repo.createPlugin({ manifest: validated.manifest, status: "pending" });
    await ctx.repo.run("UPDATE plugins SET created_at = ? WHERE slug = ?", [Date.now() - 80 * 3600_000, pending.slug]);

    const gov = await app.inject({ method: "GET", url: "/api/admin/plugins/governance" });
    expect(gov.statusCode).toBe(200);
    expect(gov.json().alerts.some((a: { kind: string; slug: string }) => a.kind === "pending_sla" && a.slug === pending.slug)).toBe(true);
  });

  it("短链：创建内部目标（保留 install=1）、解析累计点击、拒绝外链", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      payload: sitePack("API 短链演示", [{ url: "https://api-short.example.com", title: "S" }]),
    });
    const slug = created.json().slug as string;

    const link = await app.inject({
      method: "POST",
      url: "/api/shortlinks",
      payload: { slug, install: true },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().path).toMatch(/^\/s\/[a-f0-9]{8}$/);
    expect(link.json().target).toBe(`/marketplace/${encodeURIComponent(slug)}?install=1`);

    const resolved = await app.inject({ method: "GET", url: `/api/shortlinks/${link.json().code}` });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().target).toBe(link.json().target);
    expect(resolved.json().clicks).toBe(1);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/shortlinks",
      payload: { target: "https://evil.example.com" },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({ method: "GET", url: "/api/shortlinks/notthere" });
    expect(missing.statusCode).toBe(404);
  });
});
