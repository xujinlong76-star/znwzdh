/**
 * 插件 URL 体检 API 的集成测试（P0-1）。
 *
 * 为什么用 127.0.0.1 做目标：契约允许 http(s) 绝对地址，而 `guardedFetch` 默认
 * **不放行私网** —— 命中 SSRF 守卫会立即判为不可达且**不产生任何外部网络请求**，
 * 所以这条链路可离线稳定复现，既不依赖外网可用性，也不会真的打别人站点。
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

/** 构造一个合法的网址包清单（URL 指向私网，会被 SSRF 守卫拦下） */
function packManifest(name: string, urls: string[]) {
  const raw = {
    manifestVersion: 1,
    kind: "site-pack",
    name,
    description: "插件 URL 体检 API 测试用网址包：URL 指向私网地址，用于离线复现「不可达」判定。",
    version: "1.0.0",
    tags: ["test"],
    payload: {
      categories: [{ title: "测试类目" }],
      sites: urls.map((url, i) => ({ url, title: `测试站点 ${i}`, category: "测试类目" })),
    },
  };
  const validated = validateAndCleanPluginManifest(raw);
  if (!validated.ok) throw new Error(`测试清单不合法：${validated.errors.join("; ")}`);
  return validated.manifest;
}

async function seedPack(slug: string, name: string, urls: string[]) {
  await ctx.repo.createPlugin(
    { manifest: packManifest(name, urls), slug, status: "published", source: "seed", author: "测试" },
    { actor: "test", actorKind: "system" },
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-audit-"));
  const config = loadConfig({ sqlitePath: join(dir, "audit.db"), embedding: { enabled: false } });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/plugins/:slug/audit", () => {
  it("未知插件 404；非网址包 400（只有 site-pack 才有 URL 可体检）", async () => {
    const miss = await app.inject({ method: "POST", url: "/api/plugins/not-exist-pack/audit" });
    expect(miss.statusCode).toBe(404);

    await ctx.repo.createPlugin(
      {
        manifest: {
          manifestVersion: 1,
          kind: "theme",
          name: "体检测试主题",
          description: "主题没有 URL 可体检，用于验证类型门禁。",
          version: "1.0.0",
          payload: { accent: "violet" },
        },
        slug: "audit-theme-only",
        status: "published",
        source: "seed",
        author: "测试",
      },
      { actor: "test", actorKind: "system" },
    );
    const wrongKind = await app.inject({ method: "POST", url: "/api/plugins/audit-theme-only/audit" });
    expect(wrongKind.statusCode).toBe(400);
  })

  it("私网目标一律判不可达：可达率 0、逐条出明细（离线可复现）", async () => {
    await seedPack("audit-private-pack", "体检测试包", ["https://127.0.0.1/a", "https://127.0.0.1/b", "https://127.0.0.1/c"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/audit-private-pack/audit",
      payload: { timeoutMs: 1000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe("audit-private-pack");
    expect(body.declared).toBe(3);
    expect(body.sampled).toBe(3);
    expect(body.okCount).toBe(0);
    expect(body.brokenCount).toBe(3);
    expect(body.reachability).toBe(0);
    expect(body.brokenItems).toHaveLength(3);
    expect(body.brokenItems[0].url).toBe("https://127.0.0.1/a");
    expect(body.params.timeoutMs).toBe(1000);
    // 口径声明必须随响应返回：避免调用方把「本机测不到」误读成「站点挂了」
    expect(typeof body.caveat).toBe("string");
    expect(body.caveat).toContain("本机网络");
    expect(body.caveat).toContain("拒绝爬虫");
    // 原因归类：私网目标应被记为 ssrf-blocked（而不是笼统的「不可达」）
    expect(body.brokenByReason["ssrf-blocked"]).toBe(3);
    expect(body.params.maxRedirects).toBe(6);
  })

  it("抽样参数被夹紧：limit=9999 → 上限 200，且不超过声明条数", async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://127.0.0.1/x${i}`);
    await seedPack("audit-clamp-pack", "体检抽样包", urls);
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/audit-clamp-pack/audit",
      payload: { limit: 9999, timeoutMs: 500 },
    });
    const body = res.json();
    expect(body.params.sample).toBe(200);
    expect(body.sampled).toBe(12);
  })

  it("默认抽样 30 条：声明 60 条时只测 30 条", async () => {
    const urls = Array.from({ length: 60 }, (_, i) => `https://127.0.0.1/d${i}`);
    await seedPack("audit-default-pack", "体检默认抽样包", urls);
    const res = await app.inject({ method: "POST", url: "/api/plugins/audit-default-pack/audit", payload: { timeoutMs: 500 } });
    const body = res.json();
    expect(body.declared).toBe(60);
    expect(body.params.sample).toBe(30);
    expect(body.sampled).toBe(30);
  })
})
