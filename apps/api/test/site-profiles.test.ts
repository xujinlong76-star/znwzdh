/**
 * 结构化档案字段（site_profiles / site_profile_provenance）路由测试。
 *
 * 覆盖方案 §2 校验规则与 §9 验收项：必填、枚举、≤140 字、禁最高级、
 * alternatives 目标存在、alternatives 超 5 个失败、verified_at 服务端生成、
 * 草稿态不渲染、profile_source_url 非官网域写失败、审计日志留痕。
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
let catId: string;
let siteAId: string;
let siteBId: string;
let altIds: string[];

const SITE_A_URL = "https://profile-a.example.com";
const SITE_B_URL = "https://profile-b.example.com";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-site-profiles-test-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const c = await ctx.repo.createCategory({ title: "档案测试分类" });
  catId = c.id;

  const a = await ctx.repo.createSite({
    url: SITE_A_URL,
    title: "档案站点 A",
    categoryId: catId,
    status: "active",
  });
  siteAId = a.id;
  const b = await ctx.repo.createSite({
    url: SITE_B_URL,
    title: "档案站点 B",
    categoryId: catId,
    status: "active",
  });
  siteBId = b.id;

  altIds = [];
  for (let i = 1; i <= 6; i++) {
    const s = await ctx.repo.createSite({
      url: `https://alt-${i}.example.com`,
      title: `替代站点 ${i}`,
      categoryId: catId,
      status: "active",
    });
    altIds.push(s.id);
  }
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function putProfile(siteId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PUT",
    url: `/api/sites/${siteId}/profile`,
    payload,
  });
}

function getProfile(siteId: string) {
  return app.inject({ method: "GET", url: `/api/sites/${siteId}/profile` });
}

const BASE_BODY = {
  bestFor: "个人轻量写作",
  notFor: "不支持团队协作",
  license: "MIT",
  profileSourceUrl: `${SITE_A_URL}/about`,
  profileStatus: "verified",
};

describe("GET /api/sites/:id/profile", () => {
  it("未建档的站：profile 为 null、verified 为 false、provenance 为空", async () => {
    const res = await getProfile(siteBId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.siteId).toBe(siteBId);
    expect(body.verified).toBe(false);
    expect(body.profile).toBeNull();
    expect(body.provenance).toEqual([]);
    expect(body.price).toBeNull();
  });

  it("不存在的站回 404", async () => {
    const res = await getProfile("nav-does-not-exist");
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/sites/:id/profile 校验", () => {
  it("必填：缺 profileSourceUrl 回 400", async () => {
    const { profileSourceUrl: _omitted, ...withoutSource } = BASE_BODY;
    void _omitted;
    const res = await putProfile(siteAId, withoutSource);
    expect(res.statusCode).toBe(400);
  });

  it("profile_source_url 非官网域写失败；同源页面放行", async () => {
    const evil = await putProfile(siteAId, {
      ...BASE_BODY,
      profileSourceUrl: "https://evil.example.net/about",
    });
    expect(evil.statusCode).toBe(400);

    const ok = await putProfile(siteAId, {
      ...BASE_BODY,
      profileSourceUrl: `${SITE_A_URL}/pricing`,
    });
    expect(ok.statusCode).toBe(200);
  });

  it("best_for / not_for 超 140 字写失败，140 字放行", async () => {
    const tooLong = await putProfile(siteAId, { ...BASE_BODY, bestFor: "写".repeat(141) });
    expect(tooLong.statusCode).toBe(400);

    const atLimit = await putProfile(siteAId, { ...BASE_BODY, bestFor: "写".repeat(140) });
    expect(atLimit.statusCode).toBe(200);

    const notForTooLong = await putProfile(siteAId, { ...BASE_BODY, notFor: "不".repeat(141) });
    expect(notForTooLong.statusCode).toBe(400);
  });

  it("禁最高级：best_for / not_for 含“最好/最强/第一/首选/顶级”即拒绝", async () => {
    for (const word of ["最好", "最强", "第一", "首选", "顶级"]) {
      const res = await putProfile(siteAId, { ...BASE_BODY, bestFor: `适合${word}的写作` });
      expect(res.statusCode, `bestFor 含 ${word} 必须回 400`).toBe(400);
    }
    const res = await putProfile(siteAId, { ...BASE_BODY, notFor: "不是顶级工具" });
    expect(res.statusCode).toBe(400);
  });

  it("alternatives 含站外 id 写失败，站内 id 放行", async () => {
    const bad = await putProfile(siteAId, { ...BASE_BODY, alternatives: ["nav-not-in-site"] });
    expect(bad.statusCode).toBe(400);

    const ok = await putProfile(siteAId, { ...BASE_BODY, alternatives: [siteBId] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile.alternatives).toEqual([siteBId]);
  });

  it("alternatives 超 5 个写失败，5 个放行", async () => {
    const six = await putProfile(siteAId, { ...BASE_BODY, alternatives: altIds.slice(0, 6) });
    expect(six.statusCode).toBe(400);

    const five = await putProfile(siteAId, { ...BASE_BODY, alternatives: altIds.slice(0, 5) });
    expect(five.statusCode).toBe(200);
    expect(five.json().profile.alternatives).toHaveLength(5);
  });

  it("分面枚举：非法 requires_account / free_trial / data_export 写失败", async () => {
    const badAccount = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { requires_account: "maybe" },
    });
    expect(badAccount.statusCode).toBe(400);

    const badTrial = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { free_trial: "trial_99d" },
    });
    expect(badTrial.statusCode).toBe(400);

    const badExport = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { data_export: ["xml"] },
    });
    expect(badExport.statusCode).toBe(400);
  });

  it("data_export 互斥：none 与其他值互斥，unknown 单独出现时不与其他值并存", async () => {
    const noneMixed = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { data_export: ["none", "csv"] },
    });
    expect(noneMixed.statusCode).toBe(400);

    const unknownMixed = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { data_export: ["unknown", "json"] },
    });
    expect(unknownMixed.statusCode).toBe(400);

    const noneAlone = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { data_export: ["none"] },
    });
    expect(noneAlone.statusCode).toBe(200);

    const multi = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { data_export: ["csv", "api"] },
    });
    expect(multi.statusCode).toBe(200);
  });

  it("不存在的站 PUT 回 404", async () => {
    const res = await putProfile("nav-does-not-exist", BASE_BODY);
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/sites/:id/profile 服务端字段与草稿态", () => {
  it("verified_at 服务端生成：客户端传值被忽略", async () => {
    const before = Date.now();
    const res = await putProfile(siteAId, {
      ...BASE_BODY,
      profileVerifiedAt: 1,
      verifiedAt: 1,
    });
    const after = Date.now();
    expect(res.statusCode).toBe(200);
    const verifiedAt = res.json().profile.profileVerifiedAt as number;
    expect(verifiedAt).not.toBe(1);
    expect(verifiedAt).toBeGreaterThanOrEqual(before);
    expect(verifiedAt).toBeLessThanOrEqual(after);
  });

  it("草稿态不渲染：draft 行 GET 按缺失处理，verified 行才读回", async () => {
    const draft = await putProfile(siteBId, {
      bestFor: "草稿适用陈述",
      profileSourceUrl: `${SITE_B_URL}/about`,
      profileStatus: "draft",
    });
    expect(draft.statusCode).toBe(200);

    const draftGet = await getProfile(siteBId);
    expect(draftGet.json().verified).toBe(false);
    expect(draftGet.json().profile).toBeNull();

    const verified = await putProfile(siteBId, {
      bestFor: "个人轻量写作",
      profileSourceUrl: `${SITE_B_URL}/about`,
      profileStatus: "verified",
    });
    expect(verified.statusCode).toBe(200);
    const verifiedGet = await getProfile(siteBId);
    expect(verifiedGet.json().verified).toBe(true);
    expect(verifiedGet.json().profile.bestFor).toBe("个人轻量写作");
    expect(verifiedGet.json().profile.verifiedBy).toBeTruthy();
  });

  it("分面值与溯源同事务写：facets 落库、provenance 段读回四元组", async () => {
    const before = Date.now();
    const res = await putProfile(siteAId, {
      ...BASE_BODY,
      facets: { requires_account: "none", free_trial: "trial_14d", data_export: ["csv"] },
      provenance: {
        requires_account: { sourceUrl: `${SITE_A_URL}/help/account` },
        free_trial: { sourceUrl: `${SITE_A_URL}/pricing` },
        pricing_model: { sourceUrl: `${SITE_A_URL}/pricing` },
      },
    });
    expect(res.statusCode).toBe(200);
    const after = Date.now();

    // 分面读回
    const facetsRes = await app.inject({ method: "GET", url: `/api/sites/${siteAId}/facets` });
    expect(facetsRes.json().facets.requires_account).toEqual(["none"]);
    expect(facetsRes.json().facets.free_trial).toEqual(["trial_14d"]);
    expect(facetsRes.json().facets.data_export).toEqual(["csv"]);

    // 溯源段读回
    const get = await getProfile(siteAId);
    const provenance = get.json().provenance as Array<{
      fieldKey: string;
      sourceUrl: string;
      verifiedAt: number;
      verifiedBy: string;
    }>;
    const byKey = new Map(provenance.map((p) => [p.fieldKey, p]));
    expect(byKey.get("requires_account")?.sourceUrl).toBe(`${SITE_A_URL}/help/account`);
    expect(byKey.get("free_trial")?.sourceUrl).toBe(`${SITE_A_URL}/pricing`);
    expect(byKey.get("pricing_model")?.sourceUrl).toBe(`${SITE_A_URL}/pricing`);
    for (const row of provenance) {
      expect(row.verifiedAt).toBeGreaterThanOrEqual(before);
      expect(row.verifiedAt).toBeLessThanOrEqual(after);
      expect(row.verifiedBy).toBeTruthy();
    }
  });

  it("溯源 source_url 非官网域写失败", async () => {
    const res = await putProfile(siteAId, {
      ...BASE_BODY,
      provenance: {
        requires_account: { sourceUrl: "https://aggregator.example.net/x" },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("每次 PUT 记审计日志 site.profiles.update，diff 含旧值", async () => {
    await putProfile(siteAId, { ...BASE_BODY, bestFor: "审计前的值" });
    await putProfile(siteAId, { ...BASE_BODY, bestFor: "审计后的值" });
    const logs = await ctx.repo.listAuditLogs({ action: "site.profiles.update", limit: 5 });
    expect(logs.items.length).toBeGreaterThanOrEqual(1);
    const latest = logs.items[0];
    expect(latest.target).toBe(siteAId);
    const diff = typeof latest.diff === "string" ? JSON.parse(latest.diff) : latest.diff;
    expect(JSON.stringify(diff)).toContain("审计前的值");
    expect(JSON.stringify(diff)).toContain("审计后的值");
  });

  it("upsert 只覆盖同站：写 A 站不碰 B 站档案", async () => {
    await putProfile(siteAId, { ...BASE_BODY, bestFor: "只属于 A 站" });
    const b = await getProfile(siteBId);
    expect(b.json().profile.bestFor).not.toBe("只属于 A 站");
  });
});
