/**
 * `/api/sites/:id/recommend-alternative` 的「每条候选都实测」契约（[AI-4b]）。
 *
 * 要锁的缺陷：改造前这条路由**一个探活请求都不发**，模型说什么就返回什么。
 * 于是模型推荐的停放页、404 页、拼错的域名，都能顶着「智能平替」的标签出现在后台，
 * 并被一键写进 `sites` 置为 active。插件那条链路早就有候选探活（原注释写着
 * 「模型推荐的 200 也可能是停放页」），只是那份实现留在 `routes/plugin-audit.ts` 里，
 * 普通站点享受不到 —— 现在两边共用 `src/candidate-probe.ts`。
 *
 * 全程不触网，两个通道各用一个 fetch 桩：
 *  - 大模型：`globalThis.fetch` 换成固定应答（与 `ai-config-api.test.ts` 同一手法）；
 *  - 候选探活：URL 用**公网 IP 字面量**，`resolveAndCheck` 判完 IP 就放行、不需要 DNS，
 *    真正的响应同样来自这个桩（按路径分别返回 200 正常页 / 200 停放页 / 404）。
 *  - 内网地址那条用例反过来用：它必须在 `resolveAndCheck` 就被拒绝，
 *    所以断言里明确要求「桩没有被拿 127.0.0.1 调过一次」。
 *  - 探活缓存指向本用例临时文件：既不复用上一轮结论，也不污染开发栈的 data/probe-cache.json。
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
let brokenSiteId: string;
const fetchCalls: string[] = [];

const OK_IP = "93.184.216.34";
const PARKED_IP = "93.184.216.35";
const GONE_IP = "93.184.216.36";

/** 正文足够长且字符分布足够杂，否则内容层会判 THIN_CONTENT / 低熵停放 */
const HEALTHY_HTML =
  "<html><head><title>可用工具站</title></head><body><h1>可用工具站</h1>" +
  "<p>这个在线工具提供导出、协作与版本历史，适合团队日常使用。An online suite with export, " +
  "collaboration and version history for product teams; pricing, docs and changelog are all public.</p>" +
  "<p>另有模板中心与快捷键说明，可离线导出 PDF 与 Markdown。</p></body></html>";

/** 命中 ≥2 个停放关键词（domain for sale / buy this domain）→ SUSPICIOUS_PARKED */
const PARKED_HTML =
  "<html><head><title>Domain Page</title></head><body>" +
  "<p>This domain for sale. Contact us to buy this domain today.</p>" +
  "<p>Advertisement and related links.</p></body></html>";

/** LLM 应答里的候选顺序刻意与档位相反：dead / verified / suspicious */
function llmContent(items: Array<{ title: string; url: string }>) {
  return JSON.stringify(
    items.map((item, i) => ({ title: item.title, url: item.url, reason: `模型推荐理由 ${i}` })),
  );
}

function stubFetch(llmBody: unknown) {
  const original = globalThis.fetch;
  fetchCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("/chat/completions")) {
      return new Response(JSON.stringify(llmBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/parked") || url.includes("/fallback-parked")) {
      return new Response(PARKED_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.includes("gone")) {
      return new Response("<html><body><p>no such page</p></body></html>", {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response(HEALTHY_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const MODEL_BODY = {
  model: "probe-test-model",
  choices: [{ message: { role: "assistant", content: "" } }],
  usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 },
};

async function recommend(items: Array<{ title: string; url: string }> | "empty") {
  const content = items === "empty" ? "[]" : llmContent(items);
  const llmBody = { ...MODEL_BODY, choices: [{ message: { role: "assistant", content } }] };
  const restore = stubFetch(llmBody);
  try {
    const res = await app.inject({ method: "POST", url: `/api/sites/${brokenSiteId}/recommend-alternative` });
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  } finally {
    restore();
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-site-alt-probe-"));
  // 必须在建 app 之前指好：探活缓存单例是懒加载的，路径在每次取用时才读 env
  process.env.NAVHUB_PROBE_CACHE_PATH = join(dir, "probe-cache.json");
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "alt.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    llm: {
      name: "Probe Test Model",
      baseUrl: `http://${OK_IP}/v1`,
      apiKey: "sk-probe-test",
      model: "probe-test-model",
      timeoutMs: 2000,
      allowPrivateNetwork: true,
    },
    fetch: {
      timeoutMs: 2000,
      maxBytes: 262144,
      maxRedirects: 2,
      // 候选探活**不吃这个开关**（candidate profile 固定不放行私网），这里只是保持默认测试口径
      allowPrivateNetworks: false,
      userAgent: "NavHubTest/0.1",
    },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const cat = await ctx.repo.createCategory({ title: "探活用类目", slug: "probe-alt-cat" });
  const broken = await ctx.repo.createSite({
    title: "已失效工具",
    url: "https://old-tool.example/",
    categoryId: cat.id,
    status: "broken",
  });
  brokenSiteId = broken.id;
  // 两个同类目活跃站点：只在模型没参与时作为兜底候选出现
  await ctx.repo.createSite({ title: "兜底可达", url: `http://${OK_IP}/fallback-ok`, categoryId: cat.id, status: "active" });
  await ctx.repo.createSite({ title: "兜底已下线", url: `http://${GONE_IP}/fallback-gone`, categoryId: cat.id, status: "active" });
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  delete process.env.NAVHUB_PROBE_CACHE_PATH;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 文件可能被短暂占用
  }
});

describe("普通站点平替推荐：候选必须实测后再出现在列表里", () => {
  it("模型给的三条候选逐条定档，并按实测档位重排（不是模型给什么就照抄）", async () => {
    const { status, body } = await recommend([
      { title: "已下线", url: `http://${GONE_IP}/gone` },
      { title: "可用工具", url: `http://${OK_IP}/healthy` },
      { title: "停放域名", url: `http://${PARKED_IP}/parked` },
    ]);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.model).toBe("probe-test-model");
    expect(body.recommendations.map((r: any) => r.url)).toEqual([
      `http://${OK_IP}/healthy`,
      `http://${PARKED_IP}/parked`,
      `http://${GONE_IP}/gone`,
    ]);
    expect(body.recommendations.map((r: any) => r.grade)).toEqual(["verified", "suspicious", "dead"]);
    // 只有实测通过的那条才允许自称 verified
    expect(body.recommendations.map((r: any) => r.verified)).toEqual([true, false, false]);
    expect(body.recommendations[0].confidence).toMatchObject({ reachability: 100, contentHealth: 100, domainFit: 75 });
    expect(body.recommendations[2].confidence.reachability).toBe(0);
    expect(body.recommendations[2].gradeReason).toContain("404");
    // 汇总读数：让前端能一句话交代「3 条里 1 条实测可达」
    expect(body.probe).toMatchObject({ checked: 3, verified: 1, unreachable: 2, inconclusive: 0, pending: 0, hasVerified: true });
    expect(body.probe.caveat).toContain("本机");
    // 三条都真发过探测请求（停放页与 404 页也各发一次），不是只探第一条
    expect(fetchCalls.filter((u) => !u.includes("/chat/completions"))).toHaveLength(3);
  });

  it("模型推荐内网地址：守卫拒绝探测并标注不可用，且一次都不碰内网", async () => {
    const { body } = await recommend([{ title: "内网服务", url: "http://127.0.0.1:8080/internal" }]);

    expect(body.model).toBe("probe-test-model");
    // httpUrl() 允许 127.0.0.1 通过（它是合法绝对地址），拦下它的是探活层
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].url).toBe("http://127.0.0.1:8080/internal");
    expect(body.recommendations[0].grade).toBe("dead");
    expect(body.recommendations[0].verified).toBe(false);
    expect(body.recommendations[0].gradeReason).toContain("内网");
    expect(body.probe).toMatchObject({ checked: 1, verified: 0, unreachable: 1, hasVerified: false });
    // 安全性硬证据：fetch 桩只被大模型调过一次，内网地址从未被真的请求
    expect(fetchCalls.filter((u) => u.includes("127.0.0.1"))).toEqual([]);
    expect(fetchCalls.filter((u) => u.includes("/chat/completions"))).toHaveLength(1);
  });

  it("模型没参与时，站内兜底候选同样实测（不是只有成功分支才探活）", async () => {
    const { status, body } = await recommend("empty");

    expect(status).toBe(200);
    // 模型回了个空数组：这是一次降级，且列表来源必须如实说是兜底
    expect(body.model).toBe("fallback-heuristics");
    expect(body.aiDegraded).toBe("error");
    expect(body.degradedReason).toBe("invalid-model-output");
    expect(body.recommendations.map((r: any) => r.url)).toEqual([
      `http://${OK_IP}/fallback-ok`,
      `http://${GONE_IP}/fallback-gone`,
    ]);
    expect(body.recommendations.map((r: any) => r.grade)).toEqual(["verified", "dead"]);
    expect(body.recommendations.map((r: any) => r.verified)).toEqual([true, false]);
    // 站内来源的领域匹配按「同类目 85」计，不冒充模型筛选
    expect(body.recommendations[0].confidence.domainFit).toBe(85);
    expect(body.probe).toMatchObject({ checked: 2, verified: 1, unreachable: 1 });
  });

  it("站点不存在时不探测、不返回探活读数", async () => {
    const restore = stubFetch(MODEL_BODY);
    try {
      const res = await app.inject({ method: "POST", url: "/api/sites/not-a-site/recommend-alternative" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ok: false, error: "站点不存在" });
      // 一个请求都不该发：既不问模型，也不替一个不存在的站点探活
      expect(fetchCalls).toEqual([]);
    } finally {
      restore();
    }
  });
});
