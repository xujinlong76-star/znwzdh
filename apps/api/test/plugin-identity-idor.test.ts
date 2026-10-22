/**
 * 插件域「自报身份」的 IDOR 回归（第八轮，2026-10-22）。
 *
 * 身份轴与票据轴是两件事：
 *   - `NAVHUB_AUTH_REQUIRED` 只把**管理面**（read/write/admin）抬到「必须持票」；
 *   - 插件路由几乎全是 `scope:"public"`，身份靠 `identityOf` 从 Header/Query/Body 读，
 *     **纯自报**。第二道闸 `NAVHUB_IDENTITY_SECRET`（HMAC 签名）只在
 *     `NODE_ENV=production` 时才被 security-readiness 要求。
 *
 * 于是「开了鉴权、没配签名密钥」这套部署（staging / 内网 / compose 默认）里，
 * 不带票、不带签名的请求可以自称任何人：读走 `/api/plugins/mine` 的私有草稿、
 * 以他人身份安装/卸载（卸载默认软删插件带入的站点！）、发评价、点星、投稿，
 * 还能靠猜到 `github:<id>` 这类归属串把未上架插件读出来，
 * 或用 `resolveLlm(identity)` 借他人存的密钥跑 AI 审核。
 *
 * 三套配置各自的行为口径：
 *   A 鉴权 + 无签名密钥 → 被堵（本文件的主案）
 *   B 鉴权 + 签名密钥   → 签名访客照常可用（不许回归）
 *   C 开放模式（默认）  → 与历史版本逐字节一致（不许回归）
 *
 * 非空性：把 `pluginIdentity` / 各路由的 `identityTrusted` 闸门去掉，
 * A 组会全变 200/403 而非 401，本文件立刻失败；把 `identityTrusted` 退回
 * 旧的 `identityAllowed`（不看签名），B 组全变 401，同样立刻失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const BOOTSTRAP = "idor-boot-token";
const SECRET = "idor-signature-secret";
const VICTIM = "anon-victim-42";
const ATTACKER = "anon-attacker-07";

function themeManifest(name: string) {
  const raw = {
    manifestVersion: 1,
    kind: "theme",
    name,
    version: "1.0.0",
    description: "身份边界测试主题",
    tags: ["测试"],
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%", "--primary-foreground": "0 0% 100%" } },
  } as const;
  const validated = validateAndCleanPluginManifest(raw as never);
  if (!validated.ok) throw new Error("清单不合法：" + validated.errors.join("; "));
  return validated.manifest;
}

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, cacheDir: join(tmpdir(), "navhub-idor-models"), enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubIdorTest/0.1" },
  corsOrigins: ["*"],
};

type App = Awaited<ReturnType<typeof buildServer>>;

let dir: string;
let ctxA: AppContext, appA: App;
let ctxB: AppContext, appB: App;
let ctxC: AppContext, appC: App;

/** 每个实例都有：受害者私有草稿（pending）+ 公开可安装插件（published） */
async function seedFixtures(ctx: AppContext) {
  for (const [slug, status, owner] of [
    ["victim-draft", "pending", VICTIM],
    ["open-plugin", "published", "github:someone-else"],
  ] as const) {
    await ctx.repo.createPlugin(
      {
        manifest: themeManifest("身份边界主题 " + slug),
        slug,
        status,
        source: "seed",
        author: owner,
        ownerIdentity: owner,
      },
      { actor: "test", actorKind: "system" },
    );
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-idor-"));

  ctxA = await createContext(loadConfig({
    ...base, sqlitePath: join(dir, "a.db"), authRequired: true, bootstrapToken: BOOTSTRAP,
  } as never));
  appA = await buildServer(ctxA);
  await appA.ready();
  await seedFixtures(ctxA);

  ctxB = await createContext(loadConfig({
    ...base, sqlitePath: join(dir, "b.db"), authRequired: true, bootstrapToken: BOOTSTRAP, identitySecret: SECRET,
  } as never));
  appB = await buildServer(ctxB);
  await appB.ready();
  await seedFixtures(ctxB);

  ctxC = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "c.db") } as never));
  appC = await buildServer(ctxC);
  await appC.ready();
  await seedFixtures(ctxC);
});

afterAll(async () => {
  for (const [app, ctx] of [[appA, ctxA], [appB, ctxB], [appC, ctxC]] as const) {
    await app?.close();
    await ctx?.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `describe` 体在收集阶段就会执行，那时 `beforeAll` 还没跑——所以实例必须
 * 「用到时才取」，不能在 describe 体里提前绑定实例（那时 `appA` 还是 undefined）。
 */
const mkCall = (getApp: () => App) =>
  async (
    method: "GET" | "POST" | "DELETE",
    url: string,
    opts: { token?: string; headers?: Record<string, string>; payload?: unknown } = {},
  ) => getApp().inject({
    method,
    url,
    payload: opts.payload as never,
    headers: {
      ...(opts.token ? { authorization: "Bearer " + opts.token } : {}),
      ...(opts.headers || {}),
    },
  });

/* ------------------------------------------------------------------ *
 * A. 鉴权开着、签名没配：无票自称他人身份必须被堵
 * ------------------------------------------------------------------ */

describe("A 鉴权模式 + 未配置身份签名密钥", () => {
  const call = mkCall(() => appA);

  it("私有草稿列表：匿名自称受害者 → 401", async () => {
    const res = await call("GET", "/api/plugins/mine?identity=" + VICTIM);
    expect(res.statusCode).toBe(401);
    expect(res.payload).not.toContain("victim-draft");
  });

  it("同样内容对持票调用方仍然可见（证明 401 来自闸门而非数据缺失）", async () => {
    const res = await call("GET", "/api/plugins/mine?identity=" + VICTIM, { token: BOOTSTRAP });
    expect(res.statusCode).toBe(200);
    expect(((res.json() as { items: Array<{ slug: string }> }).items).map((i) => i.slug)).toContain("victim-draft");
  });

  it("开放模式默认实例：匿名自称受害者仍能读到（存量行为零变化）", async () => {
    const res = await mkCall(() => appC)("GET", "/api/plugins/mine?identity=" + VICTIM);
    expect(res.statusCode).toBe(200);
    expect(((res.json() as { items: Array<{ slug: string }> }).items).map((i) => i.slug)).toContain("victim-draft");
  });

  it("已安装列表：匿名自称受害者 → 401", async () => {
    const res = await call("GET", "/api/plugins/installed?identity=" + VICTIM);
    expect(res.statusCode).toBe(401);
  });

  it("未上架插件：猜到归属身份也不能把它读出来（回到 404），公开插件不受影响", async () => {
    const draft = await call("GET", "/api/plugins/victim-draft?identity=" + VICTIM);
    expect(draft.statusCode).toBe(404);
    const open = await call("GET", "/api/plugins/open-plugin?identity=" + VICTIM);
    expect(open.statusCode).toBe(200);
    expect((open.json() as { plugin: { status: string } }).plugin.status).toBe("published");
  });

  it("未上架插件：连「不带身份」也不能靠 admin scope 读出来", async () => {
    // server.ts 的 onRequest 无条件把 req.auth 复制成 ANONYMOUS_IDENTITY
    // （scopes 是全量 read,write,admin），只在拿到有效 token 时才覆写。
    // 于是鉴权模式下的无票调用方也「自带 admin」，路由里的
    // `auth.scopes.includes("admin")` 直接放行未发布插件全文。
    const anon = await call("GET", "/api/plugins/victim-draft");
    expect(anon.statusCode).toBe(404);
    const admin = await call("GET", "/api/plugins/victim-draft", { token: BOOTSTRAP });
    expect(admin.statusCode).toBe(200);
    expect((admin.json() as { plugin: { status: string } }).plugin.status).toBe("pending");
  });

  it("AI 自动审核：无票调用方不能靠 admin scope 跳审他人插件", async () => {
    const res = await call("POST", "/api/plugins/victim-draft/ai-audit");
    expect(res.statusCode).toBe(401);
    expect((await ctxA.repo.getPluginBySlug("victim-draft"))!.status).toBe("pending");
  });

  it("安装：匿名以受害者身份安装 → 401，且不写入安装记录", async () => {
    const res = await call("POST", "/api/plugins/open-plugin/install", { payload: { identity: VICTIM } });
    expect(res.statusCode).toBe(401);
    const plugin = (await ctxA.repo.getPluginBySlug("open-plugin"))!;
    expect(await ctxA.repo.getPluginInstall(plugin.id, VICTIM)).toBeNull();
  });

  it("卸载：匿名以受害者身份卸载 → 401，且受害者的安装记录原样保留", async () => {
    const plugin = (await ctxA.repo.getPluginBySlug("open-plugin"))!;
    await ctxA.repo.installPlugin("open-plugin", VICTIM, { actor: VICTIM, actorKind: "identity", ip: "127.0.0.1" });
    expect(await ctxA.repo.getPluginInstall(plugin.id, VICTIM)).not.toBeNull();

    const res = await call("DELETE", "/api/plugins/open-plugin/install?identity=" + VICTIM);
    expect(res.statusCode).toBe(401);
    expect(await ctxA.repo.getPluginInstall(plugin.id, VICTIM)).not.toBeNull();
  });

  it("评价：匿名以受害者身份提交 → 401", async () => {
    const res = await call("POST", "/api/plugins/open-plugin/reviews", {
      payload: { identity: VICTIM, rating: 5, title: "冒名", content: "越权评价" },
    });
    expect(res.statusCode).toBe(401);
    const plugin = (await ctxA.repo.getPluginBySlug("open-plugin"))!;
    expect(await ctxA.repo.getUserPluginReview(plugin.id, VICTIM)).toBeNull();
  });

  it("星标：匿名以受害者身份点星/取星 → 401", async () => {
    const post = await call("POST", "/api/plugins/open-plugin/star?identity=" + VICTIM);
    const del = await call("DELETE", "/api/plugins/open-plugin/star?identity=" + VICTIM);
    expect(post.statusCode).toBe(401);
    expect(del.statusCode).toBe(401);
    const plugin = (await ctxA.repo.getPluginBySlug("open-plugin"))!;
    expect(await ctxA.repo.hasUserStarredPlugin(plugin.id, VICTIM)).toBe(false);
  });

  it("投稿：匿名以受害者身份建立作者归属 → 401，库里不产生插件", async () => {
    const before = (await ctxA.repo.listPluginsByOwner(VICTIM, { limit: 100 })).total;
    const res = await call("POST", "/api/plugins", {
      payload: { manifest: themeManifest("冒名投稿主题"), identity: VICTIM },
    });
    expect(res.statusCode).toBe(401);
    expect((await ctxA.repo.listPluginsByOwner(VICTIM, { limit: 100 })).total).toBe(before);
  });

  it("AI 自动审核：匿名冒充作者发起 → 401（既不越权上架，也不烧他人密钥）", async () => {
    const res = await call("POST", "/api/plugins/victim-draft/ai-audit", { payload: { identity: VICTIM } });
    expect(res.statusCode).toBe(401);
    expect((await ctxA.repo.getPluginBySlug("victim-draft"))!.status).toBe("pending");
  });

  it("预检：匿名不再借用受害者的个人 LLM 配置（降级为系统配置，接口本身仍可用）", async () => {
    const res = await call("POST", "/api/plugins/pre-audit", {
      payload: { manifest: themeManifest("预检主题"), identity: VICTIM },
    });
    expect(res.statusCode).toBe(200);
    const audit = (res.json() as { audit: Record<string, unknown> }).audit;
    expect(JSON.stringify(audit)).not.toContain(VICTIM);
  });

  it("新版本提交：匿名以受害者身份提交 → 401", async () => {
    const res = await call("POST", "/api/plugins/victim-draft/versions", {
      payload: { manifest: { ...themeManifest("身份边界主题 victim-draft"), version: "2.0.0" }, identity: VICTIM },
    });
    expect(res.statusCode).toBe(401);
  });

  it("Taps 订阅源清单：匿名 401、只读票 403、写票 200（与同组 POST/DELETE/sync 同级）", async () => {
    // 订阅源是管理员配置的第三方清单（URL 常带访问凭据），市场列表本身读的是
    // 已导入插件、不会实时拉取订阅清单——它从来不是公开数据。
    expect((await call("GET", "/api/plugins/taps")).statusCode).toBe(401);

    const mint = await call("POST", "/api/tokens", {
      token: BOOTSTRAP,
      payload: { name: "taps-readonly", scopes: "read" },
    });
    expect(mint.statusCode).toBe(201);
    const readToken = (mint.json() as { token: string }).token;
    expect((await call("GET", "/api/plugins/taps", { token: readToken })).statusCode).toBe(403);
    expect((await call("GET", "/api/plugins/taps", { token: BOOTSTRAP })).statusCode).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * B. 鉴权 + 签名密钥：被签名绑定的访客是合法一等公民，不能误伤
 * ------------------------------------------------------------------ */

describe("B 鉴权模式 + 已配置身份签名密钥", () => {
  const call = mkCall(() => appB);
  const signed = (identity: string) => ({
    headers: { "x-navhub-anon-id": identity, "x-navhub-identity-signature": signIdentity(SECRET, identity) },
  });

  it("签名访客读自己的私有草稿 → 200", async () => {
    const res = await call("GET", "/api/plugins/mine", signed(VICTIM));
    expect(res.statusCode).toBe(200);
    expect(((res.json() as { items: Array<{ slug: string }> }).items).map((i) => i.slug)).toContain("victim-draft");
  });

  it("签名访客的安装 / 卸载照常工作", async () => {
    const plugin = (await ctxB.repo.getPluginBySlug("open-plugin"))!;
    const install = await call("POST", "/api/plugins/open-plugin/install", signed(ATTACKER));
    expect(install.statusCode).toBe(200);
    expect(await ctxB.repo.getPluginInstall(plugin.id, ATTACKER)).not.toBeNull();

    const uninstall = await call("DELETE", "/api/plugins/open-plugin/install", signed(ATTACKER));
    expect(uninstall.statusCode).toBe(200);
  });

  it("签名访客未上架归属判定照常生效（作者本人可读自己的草稿）", async () => {
    const res = await call("GET", "/api/plugins/victim-draft", signed(VICTIM));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { plugin: { status: string } }).plugin.status).toBe("pending");
  });

  it("签自己的头 + body 塞受害者：评价只能记在自己名下", async () => {
    const plugin = (await ctxB.repo.getPluginBySlug("open-plugin"))!;
    // 评价要求「活跃安装」，先给攻击者装好
    expect((await call("POST", "/api/plugins/open-plugin/install", signed(ATTACKER))).statusCode).toBe(200);

    const res = await call("POST", "/api/plugins/open-plugin/reviews", {
      ...signed(ATTACKER),
      payload: { identity: VICTIM, rating: 4, title: "冒名尝试", content: "头签自己、body 塞别人" },
    });
    expect(res.statusCode).toBe(201);
    expect(await ctxB.repo.getUserPluginReview(plugin.id, VICTIM)).toBeNull();
    expect(await ctxB.repo.getUserPluginReview(plugin.id, ATTACKER)).not.toBeNull();
  });

  it("签名访客不是管理员：不能替他人插件发起 AI 审核（admin scope 不再白送）", async () => {
    // 这里是 isAdminScope 的判定现场：签名访客过了身份轴（identityTrusted），
    // 但没票就不是管理员——修复前他带着 ANONYMOUS_IDENTITY 的全量 scopes 蒙过
    // `scopes.includes("admin")`，可以直接把他人插件推上 published。
    const res = await call("POST", "/api/plugins/open-plugin/ai-audit", signed(ATTACKER));
    expect(res.statusCode).toBe(403);
    expect((await ctxB.repo.getPluginBySlug("open-plugin"))!.status).toBe("published");
  });

  it("带身份但不带签名 → 401（闸门没被放宽）", async () => {
    const res = await call("GET", "/api/plugins/mine?identity=" + VICTIM);
    expect(res.statusCode).toBe(401);
  });
});

/* ------------------------------------------------------------------ *
 * C. 开放模式（默认）：写路径同样零变化
 * ------------------------------------------------------------------ */

describe("C 开放模式（authRequired=false，个人/NAS 默认）", () => {
  const call = mkCall(() => appC);

  it("匿名自称身份安装/点星照常可用", async () => {
    const install = await call("POST", "/api/plugins/open-plugin/install", { payload: { identity: ATTACKER } });
    expect(install.statusCode).toBe(200);
    const plugin = (await ctxC.repo.getPluginBySlug("open-plugin"))!;
    expect(await ctxC.repo.getPluginInstall(plugin.id, ATTACKER)).not.toBeNull();

    const star = await call("POST", "/api/plugins/open-plugin/star?identity=" + ATTACKER);
    expect(star.statusCode).toBe(200);
    expect(await ctxC.repo.hasUserStarredPlugin(plugin.id, ATTACKER)).toBe(true);
  });

  it("未上架插件在开放模式仍可读（按设计：无凭据即单操作者，管理台靠它审稿件）", async () => {
    // 这条是「别顺手把开放模式也收紧」的锁：`isAdminScope` 在
    // authRequired=false 时必须仍认 admin，否则管理台列会看不到待审插件。
    const res = await call("GET", "/api/plugins/victim-draft");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { plugin: { status: string } }).plugin.status).toBe("pending");
  });

  it("Taps 清单在开放模式仍匿名可读（收紧只对鉴权模式生效）", async () => {
    const res = await call("GET", "/api/plugins/taps");
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { items: unknown[] }).items)).toBe(true);
  });
});
