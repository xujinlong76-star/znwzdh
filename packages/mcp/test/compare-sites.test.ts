/**
 * MCP compare_sites 工具（Batch 4 Phase 1 第 4 项）测试：
 *  - 只比令牌归属用户自己的收藏：一次 listFavorites + 一次 getSitesByIds，
 *    内存求交后统一判定；任一 id 不在本人可比收藏里 → 整单 fail，不点名哪个 id；
 *  - 重复 id 先去重再校验；数量 2–4 个由共用 zod schema 拒绝越界；
 *  - 实例级令牌（无 ownerIdentity）一律拒绝；ALICE/BOB 各看各的 note。
 *
 * 夹具仿 packages/mcp/test/user-center-tools.test.ts：临时 SQLite +
 * userToken / instanceToken。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { createHandlers } from "../src/handlers.ts";
import type { McpScope, ToolContext } from "../src/tools.ts";

let dir: string;
let ctx: AppContext;
let handlers: ReturnType<typeof createHandlers>;

/** A/B/C/E：ALICE 的四站；D：只有 BOB 收藏；P：ALICE 收藏但 pending（不可比）。 */
let siteA: { id: string };
let siteB: { id: string };
let siteC: { id: string };
let siteD: { id: string };
let siteE: { id: string };
let siteP: { id: string };

function userToken(actor: string, ownerIdentity: string): ToolContext {
  const scopes: McpScope[] = ["read"];
  return { actor, scopes, ownerIdentity, has: (s) => s === "read" || s === "write" };
}

/** 只有 write 权限的令牌：requireScope(tc, "read") 应拒绝 */
function writeOnlyToken(): ToolContext {
  const scopes: McpScope[] = ["write"];
  return { actor: "mcp:write-only", scopes, ownerIdentity: "user-alice", has: (s) => s === "write" };
}

/** 实例级令牌：管理员签发、无 owner_identity */
function instanceToken(): ToolContext {
  const scopes: McpScope[] = ["read", "admin"];
  return { actor: "mcp:instance", scopes, ownerIdentity: null, has: () => true };
}

const ALICE = "user-alice";
const BOB = "user-bob";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-compare-"));
  const config = await loadConfig({ sqlitePath: join(dir, "test.db"), dataDir: dir });
  ctx = await createContext(config);
  handlers = createHandlers(ctx);

  siteA = await ctx.repo.createSite({
    title: "对照站 A",
    url: "https://compare-a.example.com",
    categoryId: "dev",
  });
  siteB = await ctx.repo.createSite({
    title: "对照站 B",
    url: "https://compare-b.example.com",
    categoryId: "dev",
  });
  siteC = await ctx.repo.createSite({
    title: "对照站 C",
    url: "https://compare-c.example.com",
    categoryId: "dev",
  });
  siteD = await ctx.repo.createSite({
    title: "对照站 D（仅 BOB）",
    url: "https://compare-d.example.com",
    categoryId: "dev",
  });
  siteE = await ctx.repo.createSite({
    title: "对照站 E（仅 ALICE，第四站）",
    url: "https://compare-e.example.com",
    categoryId: "dev",
  });
  siteP = await ctx.repo.createSite({
    title: "对照站 P（pending）",
    url: "https://compare-p.example.com",
    categoryId: "dev",
    status: "pending",
  });
  await ctx.repo.setSiteFacets(siteA.id, { pricing: ["free"], platform: ["web"], form: ["saas"] });
  await ctx.repo.setSiteFacets(siteB.id, { pricing: ["freemium"], platform: ["web", "macos"], form: ["saas"] });
  await ctx.repo.setSiteFacets(siteC.id, { pricing: ["paid"], form: ["desktop"] });
  await ctx.repo.setSiteFacets(siteE.id, { pricing: ["open_source"], platform: ["web"], form: ["saas"] });

  await ctx.repo.addFavorite({ userId: ALICE, siteId: siteA.id, note: "alice 备注 A", tags: ["好用"] });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: siteB.id, note: "alice 备注 B" });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: siteC.id });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: siteE.id, note: "alice 备注 E" });
  await ctx.repo.addFavorite({ userId: ALICE, siteId: siteP.id, note: "alice 备注 P" });
  await ctx.repo.addFavorite({ userId: BOB, siteId: siteA.id, note: "bob 备注 A" });
  await ctx.repo.addFavorite({ userId: BOB, siteId: siteD.id, note: "bob 备注 D" });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

function payload(res: any): any {
  const item = res?.content?.find((c: any) => c.type === "text");
  return item ? JSON.parse(item.text) : res;
}

function textOf(res: any): string {
  const item = res?.content?.find((c: any) => c.type === "text");
  return item ? String(item.text) : "";
}

describe("MCP compare_sites 工具", () => {
  it("正常对照 2 个：按请求顺序返回逐维对照，note 只取本人收藏", async () => {
    const bound = createBound();
    const out = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteB.id] },
        userToken("mcp:alice-token", ALICE),
      ),
    );
    expect(out.owner).toBe(ALICE);
    expect(out.count).toBe(2);
    expect(out.items.map((i: any) => i.siteId)).toEqual([siteA.id, siteB.id]);
    // 每格 { value, source, verified, verifiedAt }，无 winner
    const a = out.items[0];
    expect(a.title).toBe("对照站 A");
    expect(a.pricing).toMatchObject({ value: "完全免费", source: "站点分面", verified: true });
    expect(typeof a.pricing.verifiedAt).toBe("number");
    expect(a.platform.value).toEqual(["Web 网页端"]);
    expect(a.form.value).toEqual(["在线 SaaS"]);
    expect(a.note).toMatchObject({ value: "alice 备注 A", source: "我的备注", verified: true });
    expect(a.migration.value).toBe("alice 备注 A");
    expect("winner" in a).toBe(false);
    const b = out.items[1];
    expect(b.pricing.value).toBe("免费增值");
    expect(b.note.value).toBe("alice 备注 B");
    // 新建站点从未巡检：maintenance 只能看 lastCheckedAt，如实标未验证
    expect(a.maintenance).toMatchObject({ value: null, verified: false, verifiedAt: null, lastCheckedAt: null });
  });

  it("正常对照 3 个：无备注的站 note 格留空标未验证", async () => {
    const bound = createBound();
    const out = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteB.id, siteC.id] },
        userToken("mcp:alice-token", ALICE),
      ),
    );
    expect(out.count).toBe(3);
    const c = out.items[2];
    expect(c.pricing.value).toBe("商业付费");
    expect(c.note).toMatchObject({ value: null, verified: false, verifiedAt: null });
    expect(c.migration).toMatchObject({ value: null, verified: false });
  });

  it("正常对照 4 个（P2-6）：按请求顺序返回，第四站每格有来源与日期", async () => {
    const bound = createBound();
    const out = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteB.id, siteC.id, siteE.id] },
        userToken("mcp:alice-token", ALICE),
      ),
    );
    expect(out.count).toBe(4);
    expect(out.items.map((i: any) => i.siteId)).toEqual([siteA.id, siteB.id, siteC.id, siteE.id]);
    const e = out.items[3];
    expect(e.pricing).toMatchObject({ value: "开源免费", source: "站点分面", verified: true });
    expect(typeof e.pricing.verifiedAt).toBe("number");
    expect(e.note).toMatchObject({ value: "alice 备注 E", source: "我的备注", verified: true });
    // 4 站 × 6 维：已验证格必须有来源与数字核实时间，未验证格 verifiedAt 为 null
    for (const item of out.items) {
      for (const key of ["pricing", "platform", "form", "maintenance", "note", "migration"]) {
        const cell = item[key];
        expect(typeof cell.source).toBe("string");
        expect(cell.source.length).toBeGreaterThan(0);
        if (cell.verified) expect(typeof cell.verifiedAt).toBe("number");
        else expect(cell.verifiedAt).toBeNull();
      }
    }
  });

  it("越权：他人收藏的 siteId → 整单失败，且不点名是哪个 id、不返回部分结果", async () => {
    const bound = createBound();
    const res: any = await bound.compare_sites(
      { siteIds: [siteA.id, siteD.id] },
      userToken("mcp:alice-token", ALICE),
    );
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).not.toContain(siteD.id);
    expect(text).not.toContain("对照站 D");
    expect(text).not.toContain("alice 备注 A");
    // 同一站换 BOB 调则成功：BOB 的收藏里有 A 与 D
    const bob = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteD.id] },
        userToken("mcp:bob-token", BOB),
      ),
    );
    expect(bob.count).toBe(2);
  });

  it("不存在的 id → 整单失败，不点名该 id", async () => {
    const bound = createBound();
    const missing = "site-does-not-exist";
    const res: any = await bound.compare_sites(
      { siteIds: [siteA.id, missing] },
      userToken("mcp:alice-token", ALICE),
    );
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain(missing);
  });

  it("pending 收藏指向的站点不可比", async () => {
    const bound = createBound();
    const res: any = await bound.compare_sites(
      { siteIds: [siteA.id, siteP.id] },
      userToken("mcp:alice-token", ALICE),
    );
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain(siteP.id);
  });

  it("少于 2 个 / 多于 4 个（去重后）由共用 schema 拒绝", async () => {
    const bound = createBound();
    const alice = userToken("mcp:alice-token", ALICE);
    await expect(bound.compare_sites({ siteIds: [siteA.id] }, alice)).rejects.toThrow();
    await expect(
      bound.compare_sites({ siteIds: [siteA.id, siteB.id, siteC.id, siteE.id, siteD.id] }, alice),
    ).rejects.toThrow();
    // 去重后只剩 1 个同样拒绝
    await expect(bound.compare_sites({ siteIds: [siteA.id, siteA.id] }, alice)).rejects.toThrow();
  });

  it("重复 id 先去重再校验：[a, a, b] 对照 2 站，[a, a, b, c] 对照 3 站，[a, a, b, c, e] 对照 4 站", async () => {
    const bound = createBound();
    const alice = userToken("mcp:alice-token", ALICE);
    const two = payload(
      await bound.compare_sites({ siteIds: [siteA.id, siteA.id, siteB.id] }, alice),
    );
    expect(two.count).toBe(2);
    expect(two.items.map((i: any) => i.siteId)).toEqual([siteA.id, siteB.id]);
    const three = payload(
      await bound.compare_sites({ siteIds: [siteA.id, siteA.id, siteB.id, siteC.id] }, alice),
    );
    expect(three.count).toBe(3);
    const four = payload(
      await bound.compare_sites({ siteIds: [siteA.id, siteA.id, siteB.id, siteC.id, siteE.id] }, alice),
    );
    expect(four.count).toBe(4);
    expect(four.items.map((i: any) => i.siteId)).toEqual([siteA.id, siteB.id, siteC.id, siteE.id]);
  });

  it("实例级令牌（无 ownerIdentity）被拒绝；缺 read 权限也被拒绝", async () => {
    const bound = createBound();
    await expect(
      bound.compare_sites({ siteIds: [siteA.id, siteB.id] }, instanceToken()),
    ).rejects.toThrow(/个人令牌/);
    await expect(
      bound.compare_sites({ siteIds: [siteA.id, siteB.id] }, writeOnlyToken()),
    ).rejects.toThrow(/缺少 read 权限/);
  });

  it("ALICE/BOB 各看各的 note：同一站 A，两人备注互不串", async () => {
    const bound = createBound();
    const alice = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteB.id] },
        userToken("mcp:alice-token", ALICE),
      ),
    );
    expect(alice.items[0].note.value).toBe("alice 备注 A");
    const bob = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteD.id] },
        userToken("mcp:bob-token", BOB),
      ),
    );
    expect(bob.items[0].note.value).toBe("bob 备注 A");
    expect(bob.items[1].note.value).toBe("bob 备注 D");
    // BOB 没有 B：调 [A, B] 应失败，且不泄露 B 是否存在
    const res: any = await bound.compare_sites(
      { siteIds: [siteA.id, siteB.id] },
      userToken("mcp:bob-token", BOB),
    );
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain(siteB.id);
  });

  it("价格数值格（P2-2）：只取令牌归属人自己的记录，无记录的站未验证", async () => {
    // ALICE 与 BOB 各给 A 站写一条价格：ALICE 看到的只能是自己的那条。
    await ctx.repo.upsertSitePrice({
      ownerIdentity: ALICE,
      siteId: siteA.id,
      amountMinor: 1990,
      currency: "CNY",
      period: "month",
      freeTierLimit: "100次/月",
      sourceType: "manual",
      sourceUrl: null,
      verifiedAt: Date.now(),
    });
    await ctx.repo.upsertSitePrice({
      ownerIdentity: BOB,
      siteId: siteA.id,
      amountMinor: 9900,
      currency: "USD",
      period: "year",
      freeTierLimit: null,
      sourceType: "manual",
      sourceUrl: null,
      verifiedAt: Date.now(),
    });
    const bound = createBound();
    const alice = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteB.id] },
        userToken("mcp:alice-token", ALICE),
      ),
    );
    expect(alice.items[0].price).toMatchObject({
      value: "¥19.9/月 · 免费档100次/月",
      source: "手工填写",
      verified: true,
    });
    expect(typeof alice.items[0].price.verifiedAt).toBe("number");
    // B 站无价格记录：price 格未验证
    expect(alice.items[1].price).toMatchObject({ value: null, verified: false, verifiedAt: null });
    // BOB 看到的 A 站价格是自己的 $99/年，不是 ALICE 的 ¥19.9/月
    const bob = payload(
      await bound.compare_sites(
        { siteIds: [siteA.id, siteD.id] },
        userToken("mcp:bob-token", BOB),
      ),
    );
    expect(bob.items[0].price).toMatchObject({ value: "$99/年", verified: true });
  });
});

/** handlers 的绑定形态是 (args, tc)——用任意 deps 建一次 bind（只读工具不触 deps） */
function createBound() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyHandlers = handlers as any;
  return {
    compare_sites: anyHandlers.compare_sites as (a: unknown, t: ToolContext) => Promise<unknown>,
  };
}
