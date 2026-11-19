/**
 * 草稿脚本入库接线（Batch0-02，W3 合流后补）：generate-site-profile-drafts.mjs
 * 的 upsertDraftsToDb 对真实 site_profiles 表（W3 落地）写入/更新行为。
 *
 * 钉住 §4.2 两条硬约束：
 *  1. 只写 draft 行：新站插入 draft 行，已核实的 verified 行永不覆盖；
 *  2. 幂等：重复跑只更新 draft 行，verified 行的来源与核查戳原样保留。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  buildDraftRow,
  upsertDraftsToDb,
} from "../../../scripts/generate-site-profile-drafts.mjs";

let dir: string;
let dbPath: string;
let ctx: AppContext;

const SITE_A = {
  id: "nav-w4-draft-a",
  url: "https://draft-a.example.com",
  title: "草稿入库站点 A",
};
const SITE_B = {
  id: "nav-w4-draft-b",
  url: "https://draft-b.example.com",
  title: "草稿入库站点 B",
};
const VERIFIED_AT_A = 1795104000000;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-draft-upsert-test-"));
  dbPath = join(dir, "api.db");
  const config = loadConfig({
    mode: "lite",
    sqlitePath: dbPath,
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);

  const c = await ctx.repo.createCategory({ title: "草稿入库测试分类" });
  await ctx.repo.createSiteWithId({
    id: SITE_A.id,
    url: SITE_A.url,
    title: SITE_A.title,
    categoryId: c.id,
    status: "active",
  });
  await ctx.repo.createSiteWithId({
    id: SITE_B.id,
    url: SITE_B.url,
    title: SITE_B.title,
    categoryId: c.id,
    status: "active",
  });
  // A 站已有人工核实行（verified），脚本重跑时必须原样保留。
  await ctx.repo.upsertSiteProfile({
    siteId: SITE_A.id,
    bestFor: "已核实文本A",
    notFor: null,
    license: null,
    alternatives: [],
    profileSourceUrl: "https://draft-a.example.com/about",
    profileStatus: "verified",
    verifiedBy: "w4-test",
    profileVerifiedAt: VERIFIED_AT_A,
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function draftRows(generatedAt: number) {
  const overrides = {};
  return [
    buildDraftRow(
      { id: SITE_A.id, title: SITE_A.title, href: SITE_A.url },
      overrides,
      generatedAt,
    ),
    buildDraftRow(
      { id: SITE_B.id, title: SITE_B.title, href: SITE_B.url },
      overrides,
      generatedAt,
    ),
  ];
}

describe("upsertDraftsToDb 对真实 site_profiles 表", () => {
  it("只插入 draft 行，verified 行永不覆盖", async () => {
    const res = upsertDraftsToDb(dbPath, draftRows(1795104100000));
    expect(res.reason).toBeNull();
    expect(res.written).toBe(1);
    expect(res.skipped).toBe(1);

    const a = await ctx.repo.getSiteProfile(SITE_A.id);
    expect(a).not.toBeNull();
    expect(a?.profileStatus).toBe("verified");
    expect(a?.bestFor).toBe("已核实文本A");
    expect(a?.profileVerifiedAt).toBe(VERIFIED_AT_A);
    expect(a?.verifiedBy).toBe("w4-test");

    const b = await ctx.repo.getSiteProfile(SITE_B.id);
    expect(b).not.toBeNull();
    expect(b?.profileStatus).toBe("draft");
    expect(b?.bestFor).toBeNull();
    expect(b?.notFor).toBeNull();
    expect(b?.verifiedBy).toBe("draft-script");
    expect(b?.profileSourceUrl).toBe(SITE_B.url);
    expect(b?.profileVerifiedAt).toBe(1795104100000);
  });

  it("重复跑幂等：只刷新 draft 行的核查戳", async () => {
    const res = upsertDraftsToDb(dbPath, draftRows(1795104200000));
    expect(res.reason).toBeNull();
    expect(res.written).toBe(1);

    const a = await ctx.repo.getSiteProfile(SITE_A.id);
    expect(a?.profileStatus).toBe("verified");
    expect(a?.bestFor).toBe("已核实文本A");
    expect(a?.profileVerifiedAt).toBe(VERIFIED_AT_A);

    const b = await ctx.repo.getSiteProfile(SITE_B.id);
    expect(b?.profileStatus).toBe("draft");
    expect(b?.profileVerifiedAt).toBe(1795104200000);
  });
});
