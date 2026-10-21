/**
 * 插件域身份解析与签名校验必须**同源**的回归（2026-10-21 发现的 P1）。
 *
 * 签名 hook 校验的是 `identityOf`（Header → Query → Body，截 64 字符），
 * 而 `extractPluginIdentity` 自己另有一套顺序：先 body.identity、再 query.identity，
 * 而且截 120。两套顺序不一致，就出现「校验的身份」与「实际使用的身份」不是同一个人：
 *
 *   x-navhub-anon-id: <攻击者自己的身份>   ← BFF 代理签的就是这个
 *   x-navhub-identity-signature: <合法签名>
 *   body/query: identity=<受害者身份>      ← 路由真正拿去用的
 *
 * 于是签名关卡被完整绕过，而 `/api/plugins/mine` 会把受害者的私有草稿
 * （含 pendingChangelog）整批读出来，install/评价/上架也会记到受害者名下。
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

const SECRET = "impersonation-test-secret";

function themeManifest(name: string) {
  const raw = {
    manifestVersion: 1,
    kind: "theme",
    name,
    version: "1.0.0",
    description: "身份测试主题",
    tags: ["测试"],
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%", "--primary-foreground": "0 0% 100%" } },
  } as const;
  const validated = validateAndCleanPluginManifest(raw as never);
  if (!validated.ok) throw new Error("清单不合法：" + validated.errors.join("; "));
  return validated.manifest;
}

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const VICTIM = "anon-victim-77";
const ATTACKER = "anon-attacker-01";
/** 与被签名的 64 字符前缀同源、但更长的身份：旧实现会把它当成另一个用户 */
const LONG_PREFIX = "u".repeat(64);
const LONGER_IDENTITY = LONG_PREFIX + "-tail";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-impersonate-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "impersonate.db"),
      identitySecret: SECRET,
      embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "m"), enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
    } as never),
  );
  for (const [slug, owner] of [
    ["victim-draft", VICTIM],
    ["longer-draft", LONGER_IDENTITY],
  ] as const) {
    await ctx.repo.createPlugin(
      {
        manifest: themeManifest("归属测试主题 " + slug),
        slug,
        status: "published",
        source: "seed",
        author: owner,
        ownerIdentity: owner,
      },
      { actor: "test", actorKind: "system" },
    );
  }
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("签名身份与使用身份必须一致", () => {
  it("签自己的头 + body 塞别人身份：只能列出自己的插件", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins/mine?identity=" + VICTIM,
      headers: {
        "x-navhub-anon-id": ATTACKER,
        "x-navhub-identity-signature": signIdentity(SECRET, ATTACKER),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ slug: string }>; total: number };
    expect(body.items.map((i) => i.slug)).not.toContain("victim-draft");
    expect(body.total).toBe(0);
  });

  it("同样的组合用在 POST body 上也不生效", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/victim-draft/install",
      headers: {
        "x-navhub-anon-id": ATTACKER,
        "x-navhub-identity-signature": signIdentity(SECRET, ATTACKER),
      },
      payload: { identity: VICTIM },
    });
    expect(res.statusCode).toBe(200);

    const plugin = (await ctx.repo.getPluginBySlug("victim-draft"))!;
    expect(await ctx.repo.getPluginInstall(plugin.id, VICTIM)).toBeNull();
    const asAttacker = await ctx.repo.getPluginInstall(plugin.id, ATTACKER);
    expect(asAttacker).not.toBeNull();
  });

  it("64 字符前缀相同的更长身份不能借用签名", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins/mine?identity=" + encodeURIComponent(LONGER_IDENTITY),
      headers: {
        "x-navhub-anon-id": LONG_PREFIX,
        "x-navhub-identity-signature": signIdentity(SECRET, LONG_PREFIX),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ slug: string }> };
    expect(body.items.map((i) => i.slug)).not.toContain("longer-draft");
  });

  it("合法自查仍正常：签名与身份同源 → 读到自己的插件", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins/mine",
      headers: {
        "x-navhub-anon-id": VICTIM,
        "x-navhub-identity-signature": signIdentity(SECRET, VICTIM),
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: Array<{ slug: string }> }).items.map((i) => i.slug)).toContain("victim-draft");
  });
});
