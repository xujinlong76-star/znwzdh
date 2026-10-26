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

describe("GET /api/plugins/:slug/url-health（详情页徽标的数据源）", () => {
  it("没有体检记录时如实返回 checked=false，而不是拿 0 冒充全挂", async () => {
    await seedPack("health-none-pack", "未体检包", ["https://127.0.0.1/h1"]);
    const res = await app.inject({ method: "GET", url: "/api/plugins/health-none-pack/url-health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().checked).toBe(false);
  })

  it("体检后能读到最近一次的聚合结果，且与 POST 口径一致", async () => {
    await seedPack("health-done-pack", "已体检包", ["https://127.0.0.1/p1", "https://127.0.0.1/p2"]);
    const posted = await app.inject({
      method: "POST",
      url: "/api/plugins/health-done-pack/audit",
      payload: { timeoutMs: 500 },
    });
    const postedBody = posted.json();

    const res = await app.inject({ method: "GET", url: "/api/plugins/health-done-pack/url-health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checked).toBe(true);
    expect(body.sampled).toBe(postedBody.sampled);
    expect(body.declared).toBe(postedBody.declared);
    expect(body.brokenCount).toBe(postedBody.brokenCount);
    expect(body.reachability).toBe(postedBody.reachability);
    expect(body.auditedAt).toBeGreaterThan(0);
    // 徽标的 tooltip 要用到口径声明，别在读取路径上丢掉
    expect(body.caveat).toContain("拒绝爬虫");
  })

  it("未知插件 404", async () => {
    const miss = await app.inject({ method: "GET", url: "/api/plugins/nope-health/url-health" });
    expect(miss.statusCode).toBe(404);
  })
})

describe("GET /api/plugins/url-health/summary", () => {
  it("批量汇总所有包的最近一次体检结果", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/url-health/summary" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.summaries).toBeDefined();
    expect(body.summaries["health-done-pack"]).toBeDefined();
    expect(body.summaries["health-done-pack"].declared).toBe(2);
  });
});

describe("POST /api/plugins/:slug/ai-heal", () => {
  it("针对死链与疑似停放生成自愈诊断与替代方案", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/health-done-pack/ai-heal",
      payload: {
        brokenUrls: ["https://127.0.0.1/p1"],
        suspiciousUrls: ["https://127.0.0.1/p2"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("health-done-pack");
    expect(body.diagnoses).toHaveLength(2);
    expect(body.diagnoses[0].waybackUrl).toContain("web.archive.org");
    expect(body.diagnoses[1].kind).toBe("suspicious");
  });

  it("支持 autoApply=true 傻瓜式一键全自动匹配垂类权威标杆并去重采纳最优平替更新 Manifest", async () => {
    await seedPack("news-media-cn-test", "中文新闻资讯与深度阅读测试包", [
      "https://127.0.0.1/dead-news-1",
      "https://127.0.0.1/dead-news-2",
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/news-media-cn-test/ai-heal",
      payload: {
        brokenUrls: ["https://127.0.0.1/dead-news-1", "https://127.0.0.1/dead-news-2"],
        autoApply: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.autoApplied).toBeDefined();
    expect(body.autoApplied.replacedCount).toBe(2);

    const updated = await ctx.repo.getPluginBySlug("news-media-cn-test");
    const sites = (updated?.manifest.payload as any).sites;
    expect(sites).toHaveLength(2);
    expect(sites[0].url).not.toContain("127.0.0.1");
    expect(sites[1].url).not.toContain("127.0.0.1");
    // 确保两条平替 URL 自动去重不重复
    expect(sites[0].url).not.toBe(sites[1].url);
  });
});

describe("POST /api/plugins/:slug/apply-health-fix", () => {
  it("一键剔除死链并持久化更新 Manifest", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/health-done-pack/apply-health-fix",
      payload: {
        removeUrls: ["https://127.0.0.1/p1"],
        replaceUrls: [{ oldUrl: "https://127.0.0.1/p2", newUrl: "https://example.com/clean", newTitle: "净网替换站" }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.removedCount).toBe(1);
    expect(body.replacedCount).toBe(1);
    expect(body.remainingSites).toBe(1);

    const plugin = await ctx.repo.getPluginBySlug("health-done-pack");
    const sites = (plugin?.manifest.payload as any).sites;
    expect(sites).toHaveLength(1);
    expect(sites[0].url).toBe("https://example.com/clean");
    expect(sites[0].title).toBe("净网替换站");
  });
});

describe("治愈后不得伪造健康度（stale 语义）", () => {
  beforeAll(async () => {
    await seedPack("deep-stale-pack", "深检与待复检测试包", ["https://127.0.0.1/d1", "https://127.0.0.1/d2"]);
  });

  it("apply-health-fix 之后读取到 stale：健康计数全为 null，不写假快照", async () => {
    const fix = await app.inject({
      method: "POST",
      url: "/api/plugins/deep-stale-pack/apply-health-fix",
      payload: { removeUrls: ["https://127.0.0.1/d1"] },
    });
    expect(fix.statusCode).toBe(200);
    expect(fix.json().stale).toBe(true);

    const health = await app.inject({ method: "GET", url: "/api/plugins/deep-stale-pack/url-health" });
    expect(health.statusCode).toBe(200);
    const body = health.json();
    expect(body.checked).toBe(true);
    expect(body.stale).toBe(true);
    // 这四项是本轮修复的核心：旧实现会写 reachability=1 / okCount=min(n,30)
    expect(body.reachability).toBeNull();
    expect(body.okCount).toBeNull();
    expect(body.brokenCount).toBeNull();
    expect(body.declared).toBe(1);
    expect(body.caveat).toContain("没有有效的健康度数据");
  });

  it("批量快照同样把 stale 包置为无有效计数（不能回退到旧快照）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/url-health/summary" });
    const entry = res.json().summaries["deep-stale-pack"];
    expect(entry.stale).toBe(true);
    expect(entry.auditedAt).toBeNull();
    expect(entry.reachability).toBeNull();
    expect(entry.okCount).toBeNull();
  });
});

describe("POST /api/plugins/:slug/url-deep-diagnose", () => {
  it("包外 URL 被拒（否则这个端点等于任意 URL 探活器）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/deep-stale-pack/url-deep-diagnose",
      payload: { url: "https://example.com/not-in-pack" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message ?? res.json().error ?? "").toContain("不属于");
  });

  it("私网目标给出 SSRF 证据，而不是误判成「域名过期」", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/deep-stale-pack/url-deep-diagnose",
      payload: { url: "https://127.0.0.1/d2" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.diagnosis.verdict).toBe("unreachable");
    expect(body.diagnosis.evidence.some((e: any) => String(e.detail).includes("SSRF"))).toBe(true);
    // DNS 解析是成功的，只是落在私网；不能记成 expired-domain
    expect(body.diagnosis.verdict).not.toBe("expired-domain");
  });

  it("任何结论都带齐六层证据（缺层是 skip，不是缺失）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/deep-stale-pack/url-deep-diagnose",
      payload: { url: "https://127.0.0.1/d2" },
    });
    const layers = res.json().diagnosis.evidence.map((e: any) => e.layer);
    for (const layer of ["url", "dns", "redirect", "http", "content", "wayback"]) {
      expect(layers, `缺少 ${layer} 层`).toContain(layer);
    }
    // 未采集内容层：必须是 skip，不能伪装成 pass
    const content = res.json().diagnosis.evidence.find((e: any) => e.layer === "content");
    expect(content.status).toBe("skip");
  });
});

describe("GET /api/plugins/:slug/url-health/history", () => {
  it("stale 记录不参与趋势；真实体检后才产生有效点", async () => {
    const before = await app.inject({ method: "GET", url: "/api/plugins/deep-stale-pack/url-health/history?limit=10" });
    expect(before.statusCode).toBe(200);
    const b = before.json();
    expect(b.trend).toBe("insufficient");
    expect(b.points).toHaveLength(0);
    // 治愈写入的 stale 记录被跳过了 —— 这正是它不该污染趋势的证据
    expect(b.skippedStale).toBeGreaterThan(0);

    const audit = await app.inject({ method: "POST", url: "/api/plugins/deep-stale-pack/audit", payload: { limit: 2 } });
    expect(audit.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/plugins/deep-stale-pack/url-health/history?limit=10" });
    const a = after.json();
    expect(a.points.length).toBe(1);
    expect(a.points[0].reachability).toBe(0); // 私网全部不可达
    expect(a.trend).toBe("insufficient"); // 单点无法判趋势，不能用 0 冒充「恶化」
  });
});

describe("ai-heal 的 autoApply 写分支必须要求写权限", () => {
  const authDir = mkdtempSync(join(tmpdir(), "navhub-audit-auth-"));
  const BOOTSTRAP = "boot-audit-please-rotate";
  let authCtx: AppContext;
  let authApp: Awaited<ReturnType<typeof buildServer>>;

  async function mint(name: string, scopes: string): Promise<string> {
    const res = await authApp.inject({
      method: "POST",
      url: "/api/tokens",
      payload: { name, scopes } as never,
      headers: { authorization: "Bearer " + BOOTSTRAP },
    });
    expect(res.statusCode).toBe(201);
    return res.json().token as string;
  }

  beforeAll(async () => {
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(authDir, "audit-auth.db"),
      embedding: { enabled: false },
      authRequired: true,
      bootstrapToken: BOOTSTRAP,
    });
    authCtx = await createContext(config);
    authApp = await buildServer(authCtx);
    await authApp.ready();
    await authCtx.repo.createPlugin(
      {
        manifest: packManifest("鉴权测试网址包", ["https://127.0.0.1/s1", "https://127.0.0.1/s2"]),
        slug: "auth-heal-pack",
        status: "published",
        source: "seed",
        author: "测试",
      },
      { actor: "test", actorKind: "system" },
    );
  });

  afterAll(async () => {
    await authApp?.close();
    await authCtx?.close();
    rmSync(authDir, { recursive: true, force: true });
  });

  it("只读令牌带 autoApply → 403，且清单版本未被改动", async () => {
    const readToken = await mint("只读体检令牌", "read");
    const before = await authCtx.repo.getPluginBySlug("auth-heal-pack");

    const res = await authApp.inject({
      method: "POST",
      url: "/api/plugins/auth-heal-pack/ai-heal",
      payload: { brokenUrls: ["https://127.0.0.1/s1"], autoApply: true } as never,
      headers: { authorization: "Bearer " + readToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden_scope");

    const after = await authCtx.repo.getPluginBySlug("auth-heal-pack");
    expect(after?.manifest.version).toBe(before?.manifest.version);
    expect((after?.manifest.payload as any).sites).toHaveLength(2);
  });

  it("只读令牌不带 autoApply 仍可诊断（读语义不被连坐），且诊断标注未实测", async () => {
    const readToken = await mint("只读诊断令牌", "read");
    const res = await authApp.inject({
      method: "POST",
      url: "/api/plugins/auth-heal-pack/ai-heal",
      payload: { brokenUrls: ["https://127.0.0.1/s1"] } as never,
      headers: { authorization: "Bearer " + readToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.autoApplied).toBeUndefined();
    // 调用方声称的坏链没有实测证据：结论必须标 UNVERIFIED，不能借用 404 的措辞
    expect(body.diagnoses[0].evidence.source).toBe("client-claimed");
    expect(body.diagnoses[0].cause).toBe("UNVERIFIED");
  });

  it("包外 URL 被丢弃并回传（不能用任意 URL 诱导模型）", async () => {
    const readToken = await mint("只读诊断令牌2", "read");
    const res = await authApp.inject({
      method: "POST",
      url: "/api/plugins/auth-heal-pack/ai-heal",
      payload: { brokenUrls: ["https://evil.example/x", "https://127.0.0.1/s2"] } as never,
      headers: { authorization: "Bearer " + readToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ignoredUrls).toContain("https://evil.example/x");
    expect(body.diagnoses.every((d: any) => d.url !== "https://evil.example/x")).toBe(true);
  });
});
