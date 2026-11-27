/**
 * 富化结果的字段级审核：REST 层必须按调用方的勾选落库。
 *
 * 背景：富化一次给出标题/描述/标签/类目/图标，可信度各不相同。旧行为是整包写入，
 * 运营要么全收、要么事后逐项手改；`enrichFields` 让「只收我确认的那几项」成为
 * 接口能力。本文件钉住三件事：
 *   1. 勾了的字段真的写进去了，没勾的保持空/原值；
 *   2. 取消 title 又不给标题 → 400，不建半残站点；
 *   3. 拼错的字段名出现在 ignoredFields 里，不静默吞掉。
 *
 * 抓取整段用公网 IP 字面量 + 桩 fetch：guardedFetch 对 IP 字面量跳过 DNS，
 * 因此不需要网络，也不会触碰本机任何服务。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

/** 公网 IP 字面量：SSRF 校验不做 DNS，桩 fetch 也不会真的出网 */
const HOST = "http://93.184.216.34";

const HTML = `<!doctype html>
<html lang="zh-CN"><head>
  <title>Example Tools</title>
  <meta name="description" content="A curated list of developer tools for testing and debugging." />
  <link rel="icon" href="/favicon.ico" />
</head><body>developer tools testing debugging</body></html>`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-enrich-selective-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "enrich.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    // 显式掐掉真实模型：配置里不留密钥、不放行内网，enrichUrl 只会走启发式
    llm: { apiKey: null, allowPrivateNetwork: false, baseUrl: "http://127.0.0.1:9/v1" },
    fetch: {
      timeoutMs: 2000,
      maxBytes: 262144,
      maxRedirects: 2,
      allowPrivateNetworks: false,
      userAgent: "NavHubTest/0.1",
    },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

function stubFetch() {
  const spy = vi.fn(async () =>
    new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("POST /api/sites/auto · enrichFields 选择性应用", () => {
  it("只勾描述与标签：标题用调用方给的，图标/类目不落库", async () => {
    stubFetch();
    const uncategorized = await ctx.repo.ensureUncategorized();

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/auto",
      payload: {
        url: `${HOST}/tools-a`,
        title: "运营手写的标题",
        enrichFields: ["description", "tags"],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.appliedFields).toEqual(["description", "tags"]);
    expect(body.ignoredFields).toEqual([]);

    // 富化结果本身仍完整回传，审核界面据此展示未勾选字段的来源
    expect(body.enrichment.fields.title.source).toBe("scraped");
    expect(body.enrichment.fields.icon.value).toContain("/favicon.ico");

    expect(body.site.title).toBe("运营手写的标题");
    expect(body.site.description).toBe("A curated list of developer tools for testing and debugging.");
    expect(body.site.tags.length).toBeGreaterThan(0);
    // 仓储层会做去重/规范化，顺序不保证；这里钉的是「值来自所选字段」而不是「逐字复制」
    expect([...body.site.tags].sort()).toEqual([...body.enrichment.tags].sort());
    // 没勾图标 → 不落库；没勾类目 → 兜底类目，也不产类目缺口提案
    expect(body.site.iconKey).toBeNull();
    expect(body.site.categoryId).toBe(uncategorized);
    expect(body.categoryGap).toBeNull();
    expect(body.skippedFields).toEqual([]);
  });

  it("只勾标题：描述、标签与图标都不写入", async () => {
    stubFetch();
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/auto",
      payload: { url: `${HOST}/tools-b`, enrichFields: ["title"] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.appliedFields).toEqual(["title"]);
    expect(body.site.title).toBe("Example Tools");
    expect(body.site.description ?? null).toBeNull();
    expect(body.site.tags ?? []).toEqual([]);
    expect(body.site.iconKey).toBeNull();
  });

  it("取消 title 又不提供标题 → 400，且不建站点", async () => {
    stubFetch();
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/auto",
      payload: { url: `${HOST}/tools-c`, enrichFields: ["description"] },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("title");
    expect(body.appliedFields).toEqual(["description"]);
    expect(await ctx.repo.findSiteByUrl(`${HOST}/tools-c`)).toBeNull();
  });

  it("拼错的字段名进 ignoredFields，其余勾选照常生效", async () => {
    stubFetch();
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/auto",
      payload: { url: `${HOST}/tools-d`, title: "手写标题", enrichFields: ["titel", "description"] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ignoredFields).toEqual(["titel"]);
    expect(body.appliedFields).toEqual(["description"]);
  });

  it("页面没有 description 时该字段进 skipped，不用空值覆盖", async () => {
    const spy = vi.fn(async () =>
      new Response("<html><head><title>Only Title</title></head><body>hello</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", spy);

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/auto",
      payload: { url: `${HOST}/tools-e`, title: "手写标题", enrichFields: ["title", "description"] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.appliedFields).toEqual(["title"]);
    expect(body.skippedFields).toContainEqual({
      field: "description",
      reason: "页面没有 description 元数据",
    });
    expect(body.site.description ?? null).toBeNull();
  });
});

describe("POST /api/sites · enrich:true 分支同样受 enrichFields 约束", () => {
  it("只应用指定字段，其余保持空值", async () => {
    stubFetch();
    const res = await app.inject({
      method: "POST",
      url: "/api/sites",
      payload: { url: `${HOST}/tools-f`, enrich: true, title: "插件传来的标题", enrichFields: ["description"] },
    });

    expect(res.statusCode).toBe(201);
    const site = res.json();
    expect(site.title).toBe("插件传来的标题");
    expect(site.description).toBe("A curated list of developer tools for testing and debugging.");
    expect(site.tags ?? []).toEqual([]);
    expect(site.iconKey).toBeNull();
  });

  it("取消 title 又没给标题 → 400", async () => {
    stubFetch();
    const res = await app.inject({
      method: "POST",
      url: "/api/sites",
      payload: { url: `${HOST}/tools-h`, enrich: true, enrichFields: ["tags"] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("title");
    expect(await ctx.repo.findSiteByUrl(`${HOST}/tools-h`)).toBeNull();
  });

  it("不传 enrichFields 时保持旧行为：整包应用", async () => {
    stubFetch();
    const res = await app.inject({
      method: "POST",
      url: "/api/sites",
      payload: { url: `${HOST}/tools-i`, enrich: true },
    });

    expect(res.statusCode).toBe(201);
    const site = res.json();
    expect(site.title).toBe("Example Tools");
    expect(site.description).toBe("A curated list of developer tools for testing and debugging.");
    expect(site.iconKey).toContain("/favicon.ico");
    expect((site.tags ?? []).length).toBeGreaterThan(0);
  });
});

describe("POST /api/enrich · 审核界面依赖的字段级来源契约", () => {
  it("每个字段都带来源与说明，missing 明确标注", async () => {
    stubFetch();
    const res = await app.inject({
      method: "POST",
      url: "/api/enrich",
      payload: { url: `${HOST}/tools-g` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const key of ["title", "description", "category", "tags", "icon"] as const) {
      expect(body.fields[key], key).toBeTruthy();
      expect(["llm", "scraped", "heuristic", "missing"]).toContain(body.fields[key].source);
    }
    expect(body.fields.title.source).toBe("scraped");
    expect(body.fields.description.source).toBe("scraped");
    expect(body.fields.icon.source).toBe("scraped");
    expect(body.fields.tags.source).toBe("heuristic");
    expect(body.fields.category.source).toBe("heuristic");
  });
});
