/**
 * API 端到端测试。
 *
 * 刻意不开真实端口，用 Fastify 的 inject：更快、无端口冲突，
 * 但走的是完整的路由 + 校验 + 仓储 + 检索引擎链路。
 *
 * 同时覆盖"降级"这条最容易出事的路径：embedding 关闭时搜索必须仍然可用。
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

const CATS = [
  { id: "cat-ai", title: "AI 工具" },
  { id: "cat-dev", title: "开发运维" },
  { id: "cat-life", title: "生活服务" },
];

const SITES: Array<{ url: string; title: string; description: string; categoryId: string; tags: string[] }> = [
  { url: "https://github.com/features/copilot", title: "GitHub Copilot", description: "AI 代码补全与编程助手", categoryId: "cat-ai", tags: ["ai", "coding"] },
  { url: "https://cursor.com", title: "Cursor", description: "AI 驱动的代码编辑器", categoryId: "cat-ai", tags: ["ai", "coding"] },
  { url: "https://weather.com.cn", title: "中国天气网", description: "全国天气预报查询", categoryId: "cat-life", tags: ["天气"] },
  { url: "https://npmjs.com", title: "npm", description: "JavaScript 包管理器", categoryId: "cat-dev", tags: ["包管理"] },
  { url: "https://example.com/startup", title: "启动脚本", description: "服务启动脚本编写与运行管理", categoryId: "cat-dev", tags: ["devops"] },
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-api-"));
  // 刻意关闭 embedding：验证"无模型也能正常服务"这条降级路径
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  for (const c of CATS) await ctx.repo.createCategory({ id: c.id, title: c.title });
  for (const s of SITES) await ctx.repo.createSite(s);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("健康检查与能力上报", () => {
  it("返回 ok、模式与能力清单", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("lite");
    expect(body.capabilities.semantic).toBe(false); // 已显式关闭
    expect(body.capabilities.fts).toBe(true);
    expect(body.capabilities.llm).toBe(false);
    expect(body.stats.sites).toBe(5);
  });

  it("能力降级时仍在 notes 里说明原因（不静默）", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/health" })).json();
    expect(body.capabilities.notes.join(" ")).toContain("embedding");
  });
});

describe("Prometheus 指标", () => {
  it("返回文本格式指标，含进程/能力/数据规模维度", async () => {
    // 先打几个不同路由，让计数器有内容
    await app.inject({ method: "GET", url: "/api/health" });
    await app.inject({ method: "GET", url: "/api/search?q=" });

    const res = await app.inject({ method: "GET", url: "/api/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    const text = res.body;
    expect(text).toContain("# TYPE navhub_up gauge");
    expect(text).toMatch(/navhub_up 1/);
    expect(text).toContain("navhub_build_info{mode=\"lite\"");
    expect(text).toContain("navhub_capability{name=\"fts\"} 1");
    expect(text).toContain("navhub_capability{name=\"semantic\"} 0");
    expect(text).toContain("navhub_sites{status=\"active\"} 5");
    // 路由模板做标签（有界基数），不是原始 URL
    expect(text).toMatch(/navhub_http_requests_total\{method="GET",route="\/api\/search",status="200"\} \d+/);
    expect(text).toContain("navhub_http_request_duration_seconds_count");
    // 抓取自身不计入
    expect(text).not.toContain('route="/api/metrics"');
  });
});

describe("检索接口", () => {
  it("中文子串命中", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("天气") });
    expect(res.statusCode).toBe(200);
    const hits = res.json().hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].site.title).toBe("中国天气网");
  });

  it("拼音命中（qidong -> 启动脚本）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=qidong" });
    const hits = res.json().hits;
    expect(hits.some((h: any) => h.site.title === "启动脚本")).toBe(true);
  });

  it("首字母命中（zgtqw -> 中国天气网）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=zgtqw" });
    expect(res.json().hits[0].site.title).toBe("中国天气网");
  });

  it("英文前缀命中（curs -> Cursor）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=curs" });
    expect(res.json().hits.some((h: any) => h.site.title === "Cursor")).toBe(true);
  });

  it("每条命中都带上完整站点对象（前端无需二次请求）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=AI" });
    for (const h of res.json().hits) {
      expect(h.site).toBeTruthy();
      expect(typeof h.site.url).toBe("string");
      expect(typeof h.score).toBe("number");
      expect(h.contributions).toBeTruthy();
    }
  });

  it("POST 检索同样工作", async () => {
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { q: "包管理", limit: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits.length).toBeLessThanOrEqual(3);
  });

  it("空查询返回浏览列表而不是错误", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=" });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits.length).toBeGreaterThan(0);
  });

  it("非法参数被拒绝", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?limit=9999" });
    expect(res.json().error).toBe("参数无效");
  });

  /* ---- 零结果兜底 ---- */

  it("零结果时返回 suggestions 与 popular（来自历史搜索，剔除同样搜不到的词）", async () => {
    // 把这两个词的 count 顶到最前（topQueries 按 count 降序，同 count 顺序不稳，
    // slice(0,5) 可能截断——用次数保证它们进前 5）
    for (let i = 0; i < 5; i++) await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("天气") });
    for (let i = 0; i < 4; i++) await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("包管理") });
    // 再制造一条零结果历史（进 zero 集合，应被剔除）
    await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("搜不到的词甲") });

    // 注意用词：FTS 是二元组 OR 匹配，查询里任意二字组合命中语料就会有结果
    //（曾用「完全不存在的查询xyz」，其中「查询」命中了"全国天气预报查询"）
    const q = "量子区块链宇宙xyz";
    const res = await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent(q) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hits).toEqual([]);
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(body.suggestions).toContain("天气");
    expect(body.suggestions).toContain("包管理");
    // 同样零结果的词不能被推荐（否则是把用户送进另一个死胡同）
    expect(body.suggestions).not.toContain("搜不到的词甲");
    expect(body.suggestions).not.toContain(q);
    expect(Array.isArray(body.popular)).toBe(true);
    expect(body.popular).not.toContain("搜不到的词甲");
    expect(body.popular.length).toBeGreaterThan(0);
  });

  it("有结果时不携带 suggestions/popular 字段（前端无需判断）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("天气") });
    const body = res.json();
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.suggestions).toBeUndefined();
    expect(body.popular).toBeUndefined();
  });

  it("类目过滤零结果时引擎兜底放宽并透传 fallback=filter", async () => {
    // 「天气」在 cat-life；限定 cat-ai 后第一轮为零 → 放宽过滤命中
    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=" + encodeURIComponent("天气") + "&categoryId=cat-ai",
    });
    const body = res.json();
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.fallback).toBe("filter");
  });

  /* ---- 分页 ---- */

  it("offset 分页：拼接结果与一次取全一致，且 hasMore 正确透传", async () => {
    const p1 = await app.inject({ method: "GET", url: "/api/search?q=&limit=3&offset=0" });
    const p2 = await app.inject({ method: "GET", url: "/api/search?q=&limit=3&offset=3" });
    const full = await app.inject({ method: "GET", url: "/api/search?q=&limit=100&offset=0" });

    const b1 = p1.json(), b2 = p2.json(), bf = full.json();
    expect(b1.hits.length).toBe(3);
    expect(b1.offset).toBe(0);
    expect(b1.hasMore).toBe(true);
    expect(b1.items).toEqual(b1.hits);   // items 兼容字段同步

    const joined = [...b1.hits, ...b2.hits].map((h: any) => h.siteId);
    const fullIds = bf.hits.map((h: any) => h.siteId);
    expect(joined).toEqual(fullIds.slice(0, joined.length));
    expect(new Set(joined).size).toBe(joined.length);
    expect(b2.hasMore).toBe(joined.length < fullIds.length);
  });

  it("offset 超界返回空数组不报错", async () => {
    // 500 < zod 上限 1000，但远超候选池 → 合法请求、空结果
    const res = await app.inject({ method: "GET", url: "/api/search?q=&limit=5&offset=500" });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits).toEqual([]);
    expect(res.json().hasMore).toBe(false);
  });

  it("非法 offset（负数/小数/超上限）被 zod 拒绝", async () => {
    for (const bad of ["-1", "1.5", "9999"]) {
      const res = await app.inject({ method: "GET", url: "/api/search?q=x&offset=" + bad });
      expect(res.json().error).toBe("参数无效");
    }
  });

  it("翻页不灌水：offset>0 不再记录 search / search_history 事件", async () => {
    const q = "翻页计数防灌水";
    const countEvents = async () => {
      const rows = (ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'search' AND query = ?").get(q)) as any;
      return Number(rows.c);
    };

    await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent(q) + "&limit=2" });
    const afterFirst = await countEvents();
    expect(afterFirst).toBe(1);

    // 翻 3 页，事件数不变
    for (const off of [2, 4, 6]) {
      await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent(q) + "&limit=2&offset=" + off });
    }
    expect(await countEvents()).toBe(1);
  });

  it("翻页不灌水：offset>0 不再记零结果事件（翻到头的空页不是「没搜到」）", async () => {
    const q = "零结果翻页测试xyz";
    const countZero = async () => {
      const rows = (ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'zero_result' AND query = ?").get(q)) as any;
      return Number(rows.c);
    };

    await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent(q) });
    expect(await countZero()).toBe(1);

    await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent(q) + "&offset=20" });
    expect(await countZero()).toBe(1);     // 没有翻倍
  });
});

describe("审计日志查询", () => {
  let createdSiteId: string;

  beforeAll(async () => {
    // 制造几条真实审计（站点创建/更新/删除走的都是同一条 repo.audit 路径）
    const res = await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://audit-probe.example.com", title: "审计探针", categoryId: "cat-ai" },
    });
    createdSiteId = res.json().id;
    await app.inject({ method: "PATCH", url: "/api/sites/" + createdSiteId, payload: { title: "审计探针v2" } });
  });

  it("返回倒序记录，含执行者、动作、diff 与 hasMore 分页字段", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/audit?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(0);
    expect(typeof body.hasMore).toBe("boolean");
    expect(Array.isArray(body.actions)).toBe(true);

    const first = body.items[0];
    expect(typeof first.actor).toBe("string");
    expect(typeof first.action).toBe("string");
    expect(typeof first.createdAt).toBe("number");
    // diff 已解析为对象（不是 JSON 字符串）
    expect(first.diff === null || typeof first.diff === "object").toBe(true);
    // 倒序：第一条 id 应是最大的
    expect(first.id).toBe(Math.max(...body.items.map((i: any) => i.id)));
  });

  it("开放模式下 actor 仍是历史语义 api（与鉴权前一致）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/audit?limit=50" });
    const hit = res.json().items.find((i: any) => i.target === createdSiteId && i.action === "site.create");
    expect(hit).toBeTruthy();
    expect(hit.actor).toBe("api");
    expect(hit.actorKind).toBe("anonymous");
    expect(hit.ip).toBeTruthy();   // ip 已记录（trustProxy 下为对端地址）
  });

  it("按 action 过滤只返回匹配动作", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/audit?action=site.create&limit=50" });
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.action).toBe("site.create");
  });

  it("按 actor 过滤", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/audit?actor=api&limit=50" });
    for (const it of res.json().items) expect(it.actor).toBe("api");

    const none = await app.inject({ method: "GET", url: "/api/admin/audit?actor=不存在的执行者&limit=50" });
    expect(none.json().items).toEqual([]);
    expect(none.json().hasMore).toBe(false);
  });

  it("actions 全集返回出现过的动作名（供过滤下拉）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/audit?limit=1" });
    expect(res.json().actions).toContain("site.create");
  });

  it("分页拼接一致（两页拼起来 == 一次取多）", async () => {
    const p1 = await app.inject({ method: "GET", url: "/api/admin/audit?limit=3&offset=0" });
    const p2 = await app.inject({ method: "GET", url: "/api/admin/audit?limit=3&offset=3" });
    const full = await app.inject({ method: "GET", url: "/api/admin/audit?limit=200&offset=0" });

    const joined = [...p1.json().items, ...p2.json().items].map((i: any) => i.id);
    const fullIds = full.json().items.map((i: any) => i.id);
    expect(joined).toEqual(fullIds.slice(0, joined.length));
    expect(new Set(joined).size).toBe(joined.length);
  });

  it("损坏的 diff（非 JSON）不导致 500，原样返回字符串", async () => {
    await ctx.db.sqlite!.prepare(
      "INSERT INTO audit_logs (actor, actor_kind, action, target, diff, ip, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("tester", "user", "broken.diff", "t1", "{not-valid-json", null, Date.now());
    const res = await app.inject({ method: "GET", url: "/api/admin/audit?action=broken.diff" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].diff).toBe("{not-valid-json");
  });
});

describe("回收站（软删除）", () => {
  it("删除 → 出现在回收站 / 详情 404 / 同 URL 可重新添加", async () => {
    const url = "https://trash-e2e.example.com";
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url, title: "回收站点", categoryId: "cat-ai", tags: ["回收"] },
    })).json();

    const del = await app.inject({ method: "DELETE", url: "/api/sites/" + site.id });
    expect(del.statusCode).toBe(204);

    // 常规查询 404
    expect((await app.inject({ method: "GET", url: "/api/sites/" + site.id })).statusCode).toBe(404);
    // 回收站里有
    const trash = (await app.inject({ method: "GET", url: "/api/trash" })).json();
    const trashed = trash.items.find((t: any) => t.id === site.id);
    expect(trashed).toBeTruthy();
    expect(typeof trashed.deletedAt).toBe("number");
    // 同 URL 立即可重新添加
    const again = await app.inject({ method: "POST", url: "/api/sites", payload: { url, title: "重加站", categoryId: "cat-ai" } });
    expect(again.statusCode).toBe(201);
    // stats：trashed 计数
    expect((await app.inject({ method: "GET", url: "/api/stats" })).json().trashed).toBeGreaterThan(0);
  });

  it("恢复：清 deletedAt 回到常规查询，且出现在审计（site.restore）", async () => {
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://restore-e2e.example.com", title: "待恢复", categoryId: "cat-ai" },
    })).json();
    await app.inject({ method: "DELETE", url: "/api/sites/" + site.id });

    const res = await app.inject({ method: "POST", url: "/api/trash/" + site.id + "/restore" });
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBeNull();
    // 常规查询回来了
    expect((await app.inject({ method: "GET", url: "/api/sites/" + site.id })).statusCode).toBe(200);
    // 不再出现在回收站
    const trash = (await app.inject({ method: "GET", url: "/api/trash" })).json();
    expect(trash.items.find((t: any) => t.id === site.id)).toBeUndefined();
    // 审计记录
    const audit = (await app.inject({ method: "GET", url: "/api/admin/audit?action=site.restore&limit=50" })).json();
    expect(audit.items.some((i: any) => i.target === site.id)).toBe(true);
  });

  it("恢复冲突：同 URL 已有新站点时 409 并给出 existingSiteId", async () => {
    const url = "https://clash-e2e.example.com";
    const oldSite = (await app.inject({ method: "POST", url: "/api/sites", payload: { url, title: "旧站", categoryId: "cat-ai" } })).json();
    await app.inject({ method: "DELETE", url: "/api/sites/" + oldSite.id });
    const newSite = (await app.inject({ method: "POST", url: "/api/sites", payload: { url, title: "新站", categoryId: "cat-ai" } })).json();

    const res = await app.inject({ method: "POST", url: "/api/trash/" + oldSite.id + "/restore" });
    expect(res.statusCode).toBe(409);
    expect(res.json().existingSiteId).toBe(newSite.id);
  });

  it("恢复不存在/已恢复的 id 返回 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/trash/no-such-id/restore" });
    expect(res.statusCode).toBe(404);
  });

  it("永久删除：彻底清除并落审计（site.purge）", async () => {
    const site = (await app.inject({ method: "POST", url: "/api/sites", payload: { url: "https://purge-e2e.example.com", title: "永久删除", categoryId: "cat-ai" } })).json();
    await app.inject({ method: "DELETE", url: "/api/sites/" + site.id });

    const purge = await app.inject({ method: "DELETE", url: "/api/trash/" + site.id });
    expect(purge.statusCode).toBe(204);
    // 行没了
    const rows = (ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM sites WHERE id = ?").get(site.id)) as any;
    expect(Number(rows.c)).toBe(0);
    // 回收站也没有了；再 purge 404
    expect((await app.inject({ method: "DELETE", url: "/api/trash/" + site.id })).statusCode).toBe(404);
    const audit = (await app.inject({ method: "GET", url: "/api/admin/audit?action=site.purge&limit=50" })).json();
    expect(audit.items.some((i: any) => i.target === site.id)).toBe(true);
  });

  it("快照写回用原 id 重建软删站点时不冲突（createSiteWithId 复活）", async () => {
    const NAV_PATH = "src/navsphere/content/navigation.json";
    const snap = (await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV_PATH) })).json();
    const nsId = "trash-revive-" + Date.now();
    const cat = (snap.navigationItems ?? []).find((c: any) => c.id);
    if (!cat) return;
    cat.items = [...(cat.items ?? []), { id: nsId, title: "快照复活站", href: "https://trash-revive.example.com", enabled: true }];
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV_PATH, content: JSON.stringify(snap) } });
    expect((await app.inject({ method: "GET", url: "/api/sites/" + nsId })).statusCode).toBe(200);

    // 从快照移除 → 快照托管站点被对齐删除（软删）
    cat.items = cat.items.filter((i: any) => i.id !== nsId);
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV_PATH, content: JSON.stringify(snap) } });
    expect((await app.inject({ method: "GET", url: "/api/sites/" + nsId })).statusCode).toBe(404);

    // 写回加回同 id → 复活（不主键冲突、不 500）
    cat.items = [...(cat.items ?? []), { id: nsId, title: "快照复活站v2", href: "https://trash-revive.example.com", enabled: true }];
    const put2 = await app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV_PATH, content: JSON.stringify(snap) } });
    expect(put2.statusCode).toBe(200);
    const back = await app.inject({ method: "GET", url: "/api/sites/" + nsId });
    expect(back.statusCode).toBe(200);
    expect(back.json().title).toBe("快照复活站v2");
    expect(back.json().deletedAt).toBeNull();
  });

  it("快照读写对第三方图标服务净化：icon.horse 不落库、不出快照", async () => {
    const NAV_PATH = "src/navsphere/content/navigation.json";
    const snap = (await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV_PATH) })).json();
    const cat = (snap.navigationItems ?? []).find((c: any) => c.id);
    if (!cat) return;
    const nsId = "icon-sanitize-" + Date.now();
    const dirty = "https://icon.horse/icon/icon-sanitize.example.com";
    const clean = "https://icon-sanitize.example.com/favicon.ico";

    // 写入路径：快照里的第三方图标不落库（视同没有自定义图标，回落目标站 favicon）
    cat.items = [...(cat.items ?? []), { id: nsId, title: "图标净化站", href: "https://icon-sanitize.example.com", icon: dirty, enabled: true }];
    const put = await app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV_PATH, content: JSON.stringify(snap) } });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/sites/" + nsId })).json().iconKey).toBe(clean);

    // 读取路径：库里已有的历史脏值同样进不了快照输出
    ctx.db.sqlite!.prepare("UPDATE sites SET icon_key = ? WHERE id = ?").run(dirty, nsId);
    const snap2 = (await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV_PATH) })).json();
    const item2 = (snap2.navigationItems ?? []).flatMap((c: any) => c.items ?? []).find((i: any) => i.id === nsId);
    expect(item2.icon).toBe(clean);
    expect(item2.icon).not.toContain("icon.horse");

    // 清理：从快照移除（快照托管站点被对齐软删）
    cat.items = cat.items.filter((i: any) => i.id !== nsId);
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV_PATH, content: JSON.stringify(snap) } });
  });
});

describe("站点 CRUD", () => {
  it("创建站点并返回 201", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://figma.com", title: "Figma", description: "在线 UI 设计", categoryId: "cat-ai", tags: ["设计"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe("Figma");
  });

  it("重复 URL 返回 409 而不是静默创建副本", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://figma.com", title: "重复", categoryId: "cat-ai" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("已存在");
  });

  it("非法 URL 返回 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "not-a-url", title: "x", categoryId: "cat-ai" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("改名后新词立刻可检索（索引同步）", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/renamed", title: "旧名字", categoryId: "cat-dev" },
    })).json();

    await app.inject({
      method: "PATCH", url: "/api/sites/" + created.id,
      payload: { title: "云原生部署平台" },
    });

    const hits = (await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("云原生") })).json().hits;
    expect(hits.some((h: any) => h.site.title === "云原生部署平台")).toBe(true);
    // 旧名字不应再命中
    const old = (await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("旧名字") })).json().hits;
    expect(old.some((h: any) => h.site.title === "云原生部署平台")).toBe(false);
  });

  it("删除后不再出现在检索结果中", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/todelete", title: "待删除站点", categoryId: "cat-dev" },
    })).json();

    const del = await app.inject({ method: "DELETE", url: "/api/sites/" + created.id });
    expect(del.statusCode).toBe(204);

    const hits = (await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("待删除站点") })).json().hits;
    expect(hits.some((h: any) => h.siteId === created.id)).toBe(false);
  });

  it("查询不存在的站点返回 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("类目与统计", () => {
  it("列出类目", async () => {
    const res = await app.inject({ method: "GET", url: "/api/categories" });
    expect(res.json().length).toBeGreaterThanOrEqual(3);
  });

  it("支持子类目（物化路径）", async () => {
    const parent = (await app.inject({ method: "GET", url: "/api/categories" })).json().find((c: any) => c.id === "cat-ai");
    const res = await app.inject({ method: "POST", url: "/api/categories", payload: { title: "AI 绘图", parentId: "cat-ai" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().anchor.startsWith(parent.anchor + "/")).toBe(true);
  });

  it("子类目站点能被父类目过滤命中", async () => {
    const sub = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "AI 视频" } })).json();
    await app.inject({ method: "POST", url: "/api/sites", payload: { url: "https://example.com/aivideo", title: "AI 视频工具", categoryId: sub.id } });
    const hits = (await app.inject({ method: "POST", url: "/api/search", payload: { q: "", categoryId: sub.id, limit: 20 } })).json().hits;
    expect(hits.some((h: any) => h.site.title === "AI 视频工具")).toBe(true);
  });

  it("统计返回真实计数", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/stats" })).json();
    expect(body.sites).toBeGreaterThan(5);
    expect(body.categories).toBeGreaterThan(3);
  });
});

describe("AI 富化接口（无 Key 时降级）", () => {
  it("拒绝非法 URL", async () => {
    const res = await app.inject({ method: "POST", url: "/api/enrich", payload: { url: "nope" } });
    expect(res.statusCode).toBe(400);
  });

  it("SSRF 目标被拦下，但仍返回可用的启发式结果（不 5xx）", async () => {
    const res = await app.inject({ method: "POST", url: "/api/enrich", payload: { url: "http://127.0.0.1:9/" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provenance).toBe("heuristic");
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it("/api/warmup 在 embedding 关闭时如实返回 false", async () => {
    const body = (await app.inject({ method: "POST", url: "/api/warmup" })).json();
    expect(body.ok).toBe(false);
  });
});

describe("事件与审计", () => {
  it("搜索会记录事件（用于个性化与分析）", async () => {
    await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("测试事件") });
    const row = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = ?").get("search") as { c: number };
    expect(Number(row.c)).toBeGreaterThan(0);
  });

  it("写操作留下审计日志", async () => {
    const row = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number };
    expect(Number(row.c)).toBeGreaterThan(0);
  });

  it("可以接受前端上报的点击事件", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events", payload: { kind: "click", siteId: "x" } });
    expect(res.json().ok).toBe(true);
  });
});

describe("NavSphere 兼容存储接口 (/api/storage)", () => {
  it("读写 videos.json 能正确持久化", async () => {
    const testVideos = { navigationItems: [{ id: "v1", title: "科技视频", items: [] }] };
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/storage",
      payload: { path: "src/navsphere/content/videos.json", content: JSON.stringify(testVideos) },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/api/storage?path=src/navsphere/content/videos.json",
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual(testVideos);
  });
});

describe("中文编码往返（曾因写请求编码被压成问号）", () => {
  it("站点配置中的中文经 HTTP 往返后不丢失", async () => {
    const title = "NavHub 导航 · 中文标题测试";
    const config = {
      basic: { title, description: "含中文的描述 —— 破折号也要保留", keywords: "网址导航,语义检索" },
      appearance: { logo: "/a.webp", favicon: "/b.webp", theme: "system" },
      navigation: { linkTarget: "_blank" },
    };

    const put = await app.inject({
      method: "PUT", url: "/api/storage",
      payload: { path: "src/navsphere/content/site.json", content: JSON.stringify(config), message: "encoding test" },
    });
    expect(put.statusCode).toBe(200);

    const got = (await app.inject({ method: "GET", url: "/api/storage?path=src/navsphere/content/site.json" })).json();
    expect(got.basic.title).toBe(title);
    // 逐字核对码点：问号(3f) 一旦出现就说明编码被破坏
    expect([...got.basic.title].map((c: string) => c.codePointAt(0))).toContain(0x5bfc); // 导
    expect(got.basic.title).not.toContain("?");
    expect(got.basic.description).toContain("——");
  });

  it("通用 JSON 文档（videos.json）的中文同样能往返", async () => {
    const payload = { navigationItems: [{ id: "v1", title: "视频导航·中文", items: [] }] };
    const put = await app.inject({
      method: "PUT", url: "/api/storage",
      payload: { path: "src/navsphere/content/videos.json", content: JSON.stringify(payload), message: "videos" },
    });
    expect(put.statusCode).toBe(200);

    const got = (await app.inject({ method: "GET", url: "/api/storage?path=src/navsphere/content/videos.json" })).json();
    expect(got.navigationItems[0].title).toBe("视频导航·中文");
  });

  it("resource-metadata.json 未写入过时返回 {} 而不是 null（调用方会直接点属性）", async () => {
    // 这条与 videos.json 的语义刻意相反：
    // videos 的消费者是页面（可在 null 时回退），而 resource-metadata 的消费者
    // 是 /api/resource，它会执行 metadata.metadata.unshift(...)，
    // 返回 null 会直接抛错。因此这里保持 {} 并依赖前端基线兜底。
    const res = await app.inject({ method: "GET", url: "/api/storage?path=src/navsphere/content/resource-metadata.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toBeNull();
    expect(typeof body).toBe("object");
  });

  it("未写入过的未知内容文件返回 null（而不是 {}）", async () => {
    // null 与 {} 语义不同：{} 会被前端当成"中枢里存了空对象"而告警，
    // null 表示"该文件从未写入过"，前端据此静默回退到构建期基线。
    const res = await app.inject({ method: "GET", url: "/api/storage?path=src/navsphere/content/never-written.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it("未写入过的文件读取不报错（200 + null）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/storage?path=src/navsphere/content/another-missing.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 导航增强（Phase 0/1/2 新增能力）
 * ------------------------------------------------------------------ */

describe("分类管理增强", () => {
  it("PATCH 修改类目并留下审计", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "待修改类目" } })).json();
    const res = await app.inject({
      method: "PATCH", url: "/api/categories/" + created.id,
      payload: { title: "改好的类目", description: "新描述" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("改好的类目");
    const row = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?").get("category.update") as { c: number };
    expect(Number(row.c)).toBeGreaterThan(0);
  });

  it("删除类目把站点移入未分类而不是级联删除", async () => {
    const cat = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "临时类目" } })).json();
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/in-temp-cat", title: "临时类目里的站", categoryId: cat.id },
    })).json();

    const del = await app.inject({ method: "DELETE", url: "/api/categories/" + cat.id });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/api/sites/" + site.id });
    expect(after.statusCode).toBe(200);
    expect(after.json().categoryId).not.toBe(cat.id);
    const cats = (await app.inject({ method: "GET", url: "/api/categories" })).json();
    expect(cats.some((c: any) => c.title === "未分类")).toBe(true);
  });

  it("移动类目（含子类目 anchor 级联）与防成环", async () => {
    const parent = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "移动父" } })).json();
    const child = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "移动子", parentId: parent.id } })).json();
    const root = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "移动根" } })).json();

    const moved = await app.inject({ method: "POST", url: "/api/categories/" + parent.id + "/move", payload: { parentId: root.id } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().anchor).toBe(root.anchor + "/" + parent.id);

    const childAfter = (await app.inject({ method: "GET", url: "/api/categories/" + child.id })).json();
    expect(childAfter.anchor).toBe(root.anchor + "/" + parent.id + "/" + child.id);

    // 移动到自己下面 -> 400 而不是成环
    const bad = await app.inject({ method: "POST", url: "/api/categories/" + parent.id + "/move", payload: { parentId: parent.id } });
    expect(bad.statusCode).toBe(400);
    const bad2 = await app.inject({ method: "POST", url: "/api/categories/" + parent.id + "/move", payload: { parentId: child.id } });
    expect(bad2.statusCode).toBe(400);
  });

  it("合并类目把站点迁入目标", async () => {
    const src = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "合并源" } })).json();
    const dst = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "合并目标" } })).json();
    const site = (await app.inject({ method: "POST", url: "/api/sites", payload: { url: "https://example.com/merge-me", title: "被合并的站", categoryId: src.id } })).json();

    const res = await app.inject({ method: "POST", url: "/api/categories/merge", payload: { sourceId: src.id, targetId: dst.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().movedSites).toBe(1);
    // 用 id 查询：URL 含斜杠，不能当路径参数（find-my-way 的 :param 不跨段）
    const after = (await app.inject({ method: "GET", url: "/api/sites/" + site.id })).json();
    expect(after.categoryId).toBe(dst.id);
  });
});

describe("标签与专题", () => {
  it("标签云带计数", async () => {
    const tags = (await app.inject({ method: "GET", url: "/api/tags" })).json();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0].count).toBeGreaterThanOrEqual(1);
    expect(typeof tags[0].slug).toBe("string");
  });

  it("删除标签：解除关联并 404 兜底", async () => {
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/tag-del", title: "标签删除目标", categoryId: "cat-ai", tags: ["待删标签xyz"] },
    })).json();
    const tags = (await app.inject({ method: "GET", url: "/api/tags" })).json();
    const tag = tags.find((t: { name: string }) => t.name === "待删标签xyz");
    expect(tag).toBeTruthy();

    const del = await app.inject({ method: "DELETE", url: "/api/tags/" + tag.id });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
    // 站点侧同步剔除
    const after = (await app.inject({ method: "GET", url: "/api/sites/" + site.id })).json();
    expect(after.tags).not.toContain("待删标签xyz");
    // 重复删除 → 404
    const again = await app.inject({ method: "DELETE", url: "/api/tags/" + tag.id });
    expect(again.statusCode).toBe(404);
  });

  it("标签多维分组与概念别名 (SKOS) API 全流程", async () => {
    // 1. 获取既有标签
    const tags = (await app.inject({ method: "GET", url: "/api/tags" })).json();
    const tag = tags[0];
    expect(tag).toBeTruthy();

    // 2. PATCH /api/tags/:id 更新 group 与 color
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/tags/${tag.id}`,
      payload: { group: "platform", color: "#6366f1", description: "主流跨端平台" },
    });
    expect(patchRes.statusCode).toBe(200);

    // 3. GET /api/tags?group=platform 过滤
    const filteredRes = await app.inject({ method: "GET", url: "/api/tags?group=platform" });
    expect(filteredRes.statusCode).toBe(200);
    const filteredTags = filteredRes.json();
    expect(filteredTags.some((t: { id: string }) => t.id === tag.id)).toBe(true);

    // 4. POST /api/tags/:id/aliases 绑定概念别名
    const addAliasRes = await app.inject({
      method: "POST",
      url: `/api/tags/${tag.id}/aliases`,
      payload: { alias: "test-alias-skos" },
    });
    expect(addAliasRes.statusCode).toBe(200);
    expect(addAliasRes.json().alias).toBe("test-alias-skos");

    // 5. GET /api/tags/resolve 解析别名
    const resolveRes = await app.inject({
      method: "GET",
      url: "/api/tags/resolve?q=test-alias-skos",
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().tag.id).toBe(tag.id);

    // 6. DELETE /api/tags/:id/aliases/:alias 解除别名
    const delAliasRes = await app.inject({
      method: "DELETE",
      url: `/api/tags/${tag.id}/aliases/test-alias-skos`,
    });
    expect(delAliasRes.statusCode).toBe(200);

    // 解除后 resolve 报 404
    const resolveAfter = await app.inject({
      method: "GET",
      url: "/api/tags/resolve?q=test-alias-skos",
    });
    expect(resolveAfter.statusCode).toBe(404);
  });

  it("专题列表与详情（空库时是空数组/404，不 5xx）", async () => {
    const list = await app.inject({ method: "GET", url: "/api/collections" });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);
    const missing = await app.inject({ method: "GET", url: "/api/collections/nope" });
    expect(missing.statusCode).toBe(404);
  });
});

describe("收藏夹", () => {
  it("新增 / 列表 / 删除全流程，且重复收藏幂等", async () => {
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/fav-target", title: "收藏目标站", categoryId: "cat-ai" },
    })).json();

    const add1 = await app.inject({ method: "POST", url: "/api/favorites?anonId=t-anon", payload: { siteId: site.id } });
    expect(add1.statusCode).toBe(201);
    const add2 = await app.inject({ method: "POST", url: "/api/favorites?anonId=t-anon", payload: { siteId: site.id } });
    expect(add2.statusCode).toBe(200);
    expect(add2.json().existed).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/favorites?anonId=t-anon" });
    expect(list.json().items.length).toBe(1);
    expect(list.json().items[0].site.title).toBe("收藏目标站");

    const del = await app.inject({ method: "DELETE", url: "/api/favorites/" + site.id + "?anonId=t-anon" });
    expect(del.json().removed).toBe(true);
    const list2 = await app.inject({ method: "GET", url: "/api/favorites?anonId=t-anon" });
    expect(list2.json().items.length).toBe(0);
  });

  it("缺少身份标识时明确报错而不是静默返回空", async () => {
    const res = await app.inject({ method: "GET", url: "/api/favorites" });
    expect(res.json().error).toContain("userId");
  });

  it("收藏不存在的站点返回 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/favorites?anonId=t-anon", payload: { siteId: "no-such-site" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("推荐排序与相似推荐", () => {
  it("热度榜与新品榜可用（embedding 关闭也不 5xx）", async () => {
    const trending = await app.inject({ method: "GET", url: "/api/rank/trending?limit=5" });
    expect(trending.statusCode).toBe(200);
    expect(trending.json().hits.length).toBeGreaterThan(0);
    expect(trending.json().hits[0].trend).toBeTruthy();
    const fresh = await app.inject({ method: "GET", url: "/api/rank/new?limit=3" });
    expect(fresh.statusCode).toBe(200);
  });

  it("相似推荐在无语义能力时如实降级", async () => {
    const res = await app.inject({ method: "GET", url: "/api/rank/similar/whatever" });
    expect(res.statusCode).toBe(200);
    expect(res.json().semanticAvailable).toBe(false);
  });
});

describe("事件与行为闭环", () => {
  it("非法 kind 被白名单拒绝", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events", payload: { kind: "not-a-kind" } });
    expect(res.statusCode).toBe(400);
  });

  it("点击事件联动 visit_count", async () => {
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/visit-target", title: "点击计数站", categoryId: "cat-ai" },
    })).json();
    await app.inject({ method: "POST", url: "/api/events", payload: { kind: "click", siteId: site.id, anonId: "t-anon" } });
    await app.inject({ method: "POST", url: "/api/events", payload: { kind: "click", siteId: site.id, anonId: "t-anon" } });
    const after = (await app.inject({ method: "GET", url: "/api/sites/" + site.id })).json();
    expect(after.visitCount).toBe(2);
    expect(after.lastVisitedAt).toBeGreaterThan(0);
  });
});

describe("用户身份同步与搜索历史", () => {
  it("OAuth 身份 upsert 后可查", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/users/sync",
      payload: { providerId: "u-001", username: "测试用户", email: "t@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("github:u-001");
    expect(res.json().role).toBe("user");
  });

  it("带 anonId 的搜索会记录历史，可清空", async () => {
    await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("历史测试") + "&anonId=t-anon" });
    const list = (await app.inject({ method: "GET", url: "/api/search-history?anonId=t-anon" })).json();
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0].query).toBe("历史测试");
    const clear = await app.inject({ method: "DELETE", url: "/api/search-history?anonId=t-anon" });
    expect(clear.json().ok).toBe(true);
  });
});

describe("D1 缺陷回归：快照全量对齐不得误删其它通道创建的站点", () => {
  const NAV_PATH = "src/navsphere/content/navigation.json";

  it("经 API 创建的站点不在快照里也幸存", async () => {
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/d1-survivor", title: "D1幸存站", categoryId: "cat-ai" },
    })).json();

    // 取当前快照，把幸存站从快照中移除，写回
    const snap = (await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV_PATH) })).json();
    for (const c of snap.navigationItems ?? []) {
      if (c.items) c.items = c.items.filter((i: any) => i.id !== site.id);
      for (const s of c.subCategories ?? []) s.items = (s.items ?? []).filter((i: any) => i.id !== site.id);
    }
    const put = await app.inject({
      method: "PUT", url: "/api/storage",
      payload: { path: NAV_PATH, content: JSON.stringify(snap) },
    });
    expect(put.statusCode).toBe(200);

    // 旧行为：这里会被静默删除（数据丢失）；新行为：幸存
    const after = await app.inject({ method: "GET", url: "/api/sites/" + site.id });
    expect(after.statusCode).toBe(200);
  });

  it("快照托管的站点仍然会被全量对齐删除（管理语义未破坏）", async () => {
    const snap = (await app.inject({ method: "GET", url: "/api/storage?path=" + encodeURIComponent(NAV_PATH) })).json();
    const nsId = "d1-managed-" + Date.now();
    const firstCat = (snap.navigationItems ?? []).find((c: any) => c.id);
    if (!firstCat) return;
    firstCat.items = [...(firstCat.items ?? []), { id: nsId, title: "快照托管站", href: "https://example.com/ns-managed", enabled: true }];
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV_PATH, content: JSON.stringify(snap) } });
    const created = await app.inject({ method: "GET", url: "/api/sites/" + nsId });
    expect(created.statusCode).toBe(200);

    firstCat.items = firstCat.items.filter((i: any) => i.id !== nsId);
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV_PATH, content: JSON.stringify(snap) } });
    const gone = await app.inject({ method: "GET", url: "/api/sites/" + nsId });
    expect(gone.statusCode).toBe(404);
  });
});

describe("投稿（统一到 pending 站点）", () => {
  it("匿名投稿创建 pending + submission 源的站点", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/submissions",
      payload: { title: "投稿的网站", url: "https://example.com/submitted", description: "一个很棒的网站", categoryId: "cat-ai" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);
    const site = (await app.inject({ method: "GET", url: "/api/sites/" + res.json().siteId })).json();
    expect(site.status).toBe("pending");
    expect(site.source).toBe("submission");
    expect(site.title).toBe("投稿的网站");
  });

  it("重复 URL 返回 409", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/submissions",
      payload: { title: "重复投稿", url: "https://example.com/submitted", description: "重复", categoryId: "cat-ai" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain("已存在");
  });

  it("缺少必填字段返回 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/submissions", payload: { title: "缺字段" } });
    expect(res.statusCode).toBe(400);
  });

  it("投稿类目不存在返回 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/submissions",
      payload: { title: "坏类目", url: "https://example.com/bad-cat", description: "x", categoryId: "no-such-cat" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("pending 站点进入审核队列（status 过滤）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites?status=pending" });
    const sites = res.json();
    expect(Array.isArray(sites)).toBe(true);
    expect(sites.some((s: any) => s.source === "submission" && s.status === "pending")).toBe(true);
  });

  it("审核通过：pending -> active 后不再出现在待审核队列", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/submissions",
      payload: { title: "待审核站", url: "https://example.com/to-review", description: "x", categoryId: "cat-ai" },
    })).json();
    await app.inject({ method: "PATCH", url: "/api/sites/" + created.siteId, payload: { status: "active" } });
    const pending = (await app.inject({ method: "GET", url: "/api/sites?status=pending" })).json();
    expect(pending.some((s: any) => s.id === created.siteId)).toBe(false);
  });
});

describe("投稿审核收编中枢（GET/PATCH /api/submissions）", () => {
  function hashNumber(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) || 1;
  }

  it("列表只含投稿来源站点，且 number 与前端 hashNumericId 规则一致", async () => {
    // 用站点 API 造数据：投稿 POST 限流 5 次/小时/IP，前面的投稿测试已占满
    const created = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/queue-item", title: "队列里的投稿", description: "x", categoryId: "cat-ai", status: "pending", source: "submission" },
    })).json();
    const res = await app.inject({ method: "GET", url: "/api/submissions?status=pending" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.submissions)).toBe(true);
    const item = body.submissions.find((s: any) => s.siteId === created.id);
    expect(item).toBeTruthy();
    expect(item.number).toBe(hashNumber(created.id));
    expect(item.submissionData.url).toBe("https://example.com/queue-item");
    // 每条都有数值 number（GitHub Issue 语义形状）
    expect(body.submissions.every((s: any) => typeof s.number === "number")).toBe(true);
    // all 档不该把全库带出来（只留投稿）
    const all = await app.inject({ method: "GET", url: "/api/submissions?status=all" });
    expect(all.statusCode).toBe(200);
    expect(all.json().submissions.every((s: any) => typeof s.siteId === "string")).toBe(true);
    // 非法状态 → 400（不能静默退回 pending）
    const bad = await app.inject({ method: "GET", url: "/api/submissions?status=whatever" });
    expect(bad.statusCode).toBe(400);
  });

  it("按 hash number 审核通过/拒绝，并落审计", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/review-loop", title: "审核闭环站", description: "x", categoryId: "cat-ai", status: "pending", source: "submission" },
    })).json();
    const num = hashNumber(created.id);

    const approve = await app.inject({ method: "PATCH", url: "/api/submissions/" + num, payload: { action: "approve" } });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().success).toBe(true);
    expect(approve.json().siteId).toBe(created.id);
    expect((await app.inject({ method: "GET", url: "/api/sites/" + created.id })).json().status).toBe("active");

    // 审计（此前审核动作不经中枢、无审计——本次收编补齐）
    const audit = (await app.inject({ method: "GET", url: "/api/admin/audit?action=submission.approve&limit=50" })).json();
    expect(audit.items.some((a: any) => a.target === created.id)).toBe(true);

    const reject = await app.inject({ method: "PATCH", url: "/api/submissions/" + num, payload: { action: "reject", reason: "暂不收录" } });
    expect(reject.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/sites/" + created.id })).json().status).toBe("archived");
    const rejectAudit = (await app.inject({ method: "GET", url: "/api/admin/audit?action=submission.reject&limit=50" })).json();
    expect(rejectAudit.items.some((a: any) => a.target === created.id)).toBe(true);
  });

  it("无效 number / 无效 action 分别 404 / 400", async () => {
    const missing = await app.inject({ method: "PATCH", url: "/api/submissions/999999999", payload: { action: "approve" } });
    expect(missing.statusCode).toBe(404);
    const badAction = await app.inject({ method: "PATCH", url: "/api/submissions/123", payload: { action: "nuke" } });
    expect(badAction.statusCode).toBe(400);
  });
});

describe("健康巡检趋势", () => {
  it("按天返回分桶序列：无数据时全零天，有数据时计入今日桶", async () => {
    const empty = await app.inject({ method: "GET", url: "/api/admin/health/trend?days=3" });
    expect(empty.statusCode).toBe(200);
    const body = empty.json();
    expect(body.days).toBe(3);
    expect(body.points).toHaveLength(3);
    // 无检查的日期 rate 是 null（不是 100%——「没巡检」不等于「很健康」）
    expect(body.points[0].checked).toBe(0);
    expect(body.points[0].rate).toBeNull();

    // 写入一次成功 + 一次失败的巡检记录，落到今天
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/health-trend", title: "趋势站点", categoryId: "cat-ai" },
    })).json();
    await ctx.repo.updateSiteHealth(site.id, {
      httpStatus: 200, ok: true, latencyMs: 120, redirectTo: null, error: null, currentStatus: "active",
    });
    await ctx.repo.updateSiteHealth(site.id, {
      httpStatus: null, ok: false, latencyMs: 5000, redirectTo: null, error: "connection refused", currentStatus: "broken",
    });

    const withData = await app.inject({ method: "GET", url: "/api/admin/health/trend?days=1" });
    expect(withData.statusCode).toBe(200);
    const day = withData.json().points[0];
    expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day.checked).toBe(2);
    expect(day.failed).toBe(1);
    expect(day.rate).toBe(50);
    expect(withData.json().total).toBe(2);
    expect(site.id).toBeTruthy();
  });
});

describe("批量操作 /api/sites/bulk", () => {
  async function mkSites(prefix: string, n = 2): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const site = (await app.inject({
        method: "POST", url: "/api/sites",
        payload: { url: `https://example.com/${prefix}-${i}`, title: `${prefix}-${i}`, categoryId: "cat-ai" },
      })).json();
      out.push(site.id);
    }
    return out;
  }

  it("dryRun 默认 true：只返回计划不落库", async () => {
    const [id] = await mkSites("bulk-dry");
    const res = await app.inject({ method: "POST", url: "/api/sites/bulk", payload: { op: "delete", ids: [id] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dryRun).toBe(true);
    expect(body.wouldApply).toBe(1);
    expect(body.plan[0].action).toBe("apply");
    // 没落库
    expect((await app.inject({ method: "GET", url: "/api/sites/" + id })).statusCode).toBe(200);
  });

  it("批量删除（dryRun=false）走软删除并落审计；不存在的 id 计入 skip 不整批失败", async () => {
    const [a, b] = await mkSites("bulk-del", 2);
    const res = await app.inject({
      method: "POST", url: "/api/sites/bulk",
      payload: { op: "delete", ids: [a, b, "no-such-id"], dryRun: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(2);
    expect(body.skipped).toBe(1);
    // 软删除：正常查询 404，但在回收站里
    expect((await app.inject({ method: "GET", url: "/api/sites/" + a })).statusCode).toBe(404);
    const trash = (await app.inject({ method: "GET", url: "/api/trash" })).json();
    expect(trash.items.some((t: any) => t.id === a)).toBe(true);
    // 审计一条汇总记录
    const audit = (await app.inject({ method: "GET", url: "/api/admin/audit?action=site.bulk&limit=50" })).json();
    expect(audit.items.some((it: any) => it.diff.applied === 2)).toBe(true);
  });

  it("批量改类目与改状态", async () => {
    const [a, b] = await mkSites("bulk-move", 2);
    const move = await app.inject({
      method: "POST", url: "/api/sites/bulk",
      payload: { op: "setCategory", ids: [a, b], categoryId: "cat-dev", dryRun: false },
    });
    expect(move.json().applied).toBe(2);
    expect((await app.inject({ method: "GET", url: "/api/sites/" + a })).json().categoryId).toBe("cat-dev");

    const st = await app.inject({
      method: "POST", url: "/api/sites/bulk",
      payload: { op: "setStatus", ids: [a], status: "broken", dryRun: false },
    });
    expect(st.json().applied).toBe(1);
    expect((await app.inject({ method: "GET", url: "/api/sites/" + a })).json().status).toBe("broken");
  });

  it("参数校验：缺 categoryId/status、空 ids、非法 op → 400", async () => {
    const bad1 = await app.inject({ method: "POST", url: "/api/sites/bulk", payload: { op: "setCategory", ids: ["x"] } });
    expect(bad1.statusCode).toBe(400);
    const bad2 = await app.inject({ method: "POST", url: "/api/sites/bulk", payload: { op: "setStatus", ids: ["x"] } });
    expect(bad2.statusCode).toBe(400);
    const bad3 = await app.inject({ method: "POST", url: "/api/sites/bulk", payload: { op: "delete", ids: [] } });
    expect(bad3.statusCode).toBe(400);
    const bad4 = await app.inject({ method: "POST", url: "/api/sites/bulk", payload: { op: "nuke", ids: ["x"] } });
    expect(bad4.statusCode).toBe(400);
  });
});

describe("按 id 或 URL 查站点", () => {
  it("URL 百分号编码后能经 /api/sites/:id 查到（契约锁定）", async () => {
    await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://url-lookup.example.com/app", title: "URL 查询", categoryId: "cat-ai" },
    });
    const res = await app.inject({
      method: "GET", url: "/api/sites/" + encodeURIComponent("https://url-lookup.example.com/app"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe("https://url-lookup.example.com/app");
  });

  it("id 形态同样可查（未回归）", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://id-lookup.example.com", title: "id 查询", categoryId: "cat-ai" },
    })).json();
    const res = await app.inject({ method: "GET", url: "/api/sites/" + created.id });
    expect(res.statusCode).toBe(200);
  });
});

describe("个性化画像：查看与重置", () => {
  it("缺身份返回错误；有身份时可读到画像并在重置后清空", async () => {
    const noId = await app.inject({ method: "GET", url: "/api/profile" });
    expect(noId.statusCode).toBe(200);
    expect(noId.json().error).toBeTruthy();

    // 制造行为：收藏一个站点（favorite 事件带 identity，是画像的聚合素材）
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/profile-target", title: "画像目标站", categoryId: "cat-ai" },
    })).json();
    const userId = "github:test-user-1";
    await app.inject({
      method: "POST", url: "/api/favorites",
      payload: { userId, siteId: site.id },
    });

    // 画像可能还没被聚合（节流），这里直接看端点行为即可
    const before = (await app.inject({ method: "GET", url: "/api/profile?userId=" + userId })).json();
    expect(before).toHaveProperty("profile");

    const reset = await app.inject({ method: "DELETE", url: "/api/profile?userId=" + userId });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().ok).toBe(true);
    // 画像行已清（无论之前有没有，重置后都是 null）
    const after = (await app.inject({ method: "GET", url: "/api/profile?userId=" + userId })).json();
    expect(after.profile).toBeNull();
    // 收藏夹不受影响——它是用户自己的数据，不是被推断的偏好
    const favs = (await app.inject({ method: "GET", url: "/api/favorites?userId=" + userId })).json();
    expect(Array.isArray(favs.favorites ?? favs.items)).toBe(true);
  });
});

describe("OpenAPI 文档", () => {
  it("/api/openapi.json 与真实路由同源（doc 由 onRoute 收集的路由表生成）且带 scope 安全声明", async () => {
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");

    // 文档必须覆盖各分区的代表性路由（新增路由走 onRoute 自动进入，这里锁住覆盖面）
    for (const t of [
      "/api/health", "/api/search", "/api/sites", "/api/sites/{id}", "/api/sites/bulk",
      "/api/trash", "/api/trash/{id}/restore", "/api/submissions", "/api/submissions/{number}",
      "/api/profile", "/api/admin/audit", "/api/admin/health/trend", "/api/tags/{id}",
      "/api/categories/merge", "/api/favorites", "/api/storage", "/api/tokens", "/api/jobs",
    ]) {
      expect(Object.keys(doc.paths), "缺少路径: " + t).toContain(t);
    }
    // HEAD 被过滤（OpenAPI 不描述它），端点数应接近路由数而非翻倍
    const ops = Object.values(doc.paths as Record<string, Record<string, unknown>>)
      .reduce((n, ops) => n + Object.keys(ops).length, 0);
    expect(ops).toBeGreaterThanOrEqual(50);
  });

  it("public 路由无锁，read 路由声明 bearer", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/openapi.json" })).json();
    // public：检索/健康
    expect((doc.paths["/api/search"].get.security)).toEqual([]);
    expect((doc.paths["/api/health"].get.security)).toEqual([]);
    // read：站点列表
    expect((doc.paths["/api/sites"].get.security)).toEqual([{ bearerAuth: [] }]);
    // write：提交类站点
    expect((doc.paths["/api/sites"].post.security).length).toBe(1);
    // path 参数被提取（:id → {id}）
    expect(doc.paths["/api/sites/{id}"]).toBeTruthy();
    expect(doc.paths["/api/sites/{id}"].get.parameters[0].name).toBe("id");
  });

  it("/api/docs 返回 HTML 且包含端点表格", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("/api/openapi.json");
    expect(res.body).toContain("/api/sites");
  });
});

describe("响应缓存头", () => {
  it("声明了缓存策略的 GET 返回 private + TTL 与 ETag", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/^private, max-age=\d+$/);
    expect(res.headers.etag).toBeTruthy();
  });

  it("If-None-Match 命中返回 304 且无 body", async () => {
    const first = await app.inject({ method: "GET", url: "/api/tags" });
    const etag = String(first.headers.etag);
    expect(etag).toBeTruthy();
    const second = await app.inject({ method: "GET", url: "/api/tags", headers: { "if-none-match": etag } });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers["content-type"]).toBeUndefined();
    // ETag 未命中时仍正常返回
    const third = await app.inject({ method: "GET", url: "/api/tags", headers: { "if-none-match": '"stale"' } });
    expect(third.statusCode).toBe(200);
    expect(third.body.length).toBeGreaterThan(0);
  });

  it("未声明策略的 GET 与所有写操作都是 no-store（安全默认，防启发式缓存与数据串用）", async () => {
    const noPolicy = await app.inject({ method: "GET", url: "/api/health" });
    // health 有 15s TTL —— 属于声明过的策略
    expect(noPolicy.headers["cache-control"]).toMatch(/^private, max-age=15$/);

    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/cache-probe", title: "缓存探针", categoryId: "cat-ai" },
    })).json();
    // 单站点详情未声明策略
    const detail = await app.inject({ method: "GET", url: "/api/sites/" + site.id });
    expect(detail.headers["cache-control"]).toBe("no-store");
    // 写操作绝不能被缓存
    const patch = await app.inject({ method: "PATCH", url: "/api/sites/" + site.id, payload: { title: "缓存探针2" } });
    expect(patch.headers["cache-control"]).toBe("no-store");
    // 搜索命中 zero-branch 的属性不受影响
    const search = await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("天气") });
    expect(search.headers["cache-control"]).toMatch(/^private, max-age=20$/);
  });
});

describe("次世代架构配方、选型对比与确定性 Favicon 端点", () => {
  it("GET /api/recipes 支持空查询与关键词子图匹配", async () => {
    const listRes = await app.inject({ method: "GET", url: "/api/recipes" });
    expect(listRes.statusCode).toBe(200);
    const listJson = listRes.json();
    expect(Array.isArray(listJson.items)).toBe(true);
    expect(listJson.items.length).toBeGreaterThanOrEqual(1);

    const matchRes = await app.inject({ method: "GET", url: "/api/recipes?q=" + encodeURIComponent("协同编辑") });
    expect(matchRes.statusCode).toBe(200);
    const matchJson = matchRes.json();
    expect(matchJson.item).toBeTruthy();
    expect(matchJson.item.id).toBe("collaborative-editor");
    expect(matchJson.item.layers.length).toBeGreaterThan(0);
  });

  it("GET /api/comparisons 解析技术对决语法并返回结构化矩阵", async () => {
    const res = await app.inject({ method: "GET", url: "/api/comparisons?q=" + encodeURIComponent("react vs vue") });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.matrix).toBeTruthy();
    expect(json.matrix.id).toBe("react-vs-vue");
    expect(json.matrix.dimensions.length).toBeGreaterThan(0);
    expect(typeof json.matrix.verdict).toBe("string");

    const emptyRes = await app.inject({ method: "GET", url: "/api/comparisons" });
    expect(emptyRes.statusCode).toBe(200);
    expect(emptyRes.json().ok).toBe(false);
  });

  it("GET /api/favicon/:id 生成高质量确定性 SVG 矢量图标", async () => {
    const res = await app.inject({ method: "GET", url: "/api/favicon/site-github" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.body).toContain("<svg");
    expect(res.body).toContain("linearGradient");
    expect(res.headers["cache-control"]).toContain("private, max-age=86400");
  });

  it("POST /api/sites/:id/heal 触发自动诊断并返回自愈报告与落审计", async () => {
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://broken-legacy.example.com", title: "失效站点", categoryId: "cat-ai" },
    })).json();

    const res = await app.inject({ method: "POST", url: "/api/sites/" + site.id + "/heal" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.report).toBeTruthy();
    expect(json.report.waybackFallbackUrl).toContain("web.archive.org");
    expect(typeof json.report.recommendedAction).toBe("string");

    const nonExist = await app.inject({ method: "POST", url: "/api/sites/no-such-site/heal" });
    expect(nonExist.statusCode).toBe(404);
  });

  it("GET /api/sites/:id/wayback 返回 Wayback 历史归档快照与自愈入口", async () => {
    const site = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://wayback-test.example.com", title: "Wayback测试站点", categoryId: "cat-ai" },
    })).json();

    const res = await app.inject({ method: "GET", url: "/api/sites/" + site.id + "/wayback" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.siteId).toBe(site.id);
    expect(json.recoveryUrl).toContain("web.archive.org/web");
    expect(json.saveUrl).toContain("web.archive.org/save");

    const nonExist = await app.inject({ method: "GET", url: "/api/sites/no-such-site/wayback" });
    expect(nonExist.statusCode).toBe(404);
  });

  it("CRDT 本地优先协同漫游网络：多设备原子操作无损合流与状态收敛", async () => {
    // 1. 无 identity 时返回 400
    const noAuth = await app.inject({
      method: "POST",
      url: "/api/crdt/sync",
      payload: { operations: [] },
    });
    expect(noAuth.statusCode).toBe(400);

    // 2. 客户端 A 提交置顶与自定义类目
    const clientAOps = [
      {
        id: "op_1_clientA",
        type: "SET_CATEGORY_PIN",
        entityId: "cat_dev",
        payload: { isPinned: true },
        timestamp: 1000,
        clientId: "client_device_A",
      },
      {
        id: "op_2_clientA",
        type: "UPSERT_CUSTOM_CATEGORY",
        entityId: "cat_ai_tools",
        payload: { id: "cat_ai_tools", title: "AI 常用工具", items: [] },
        timestamp: 1010,
        clientId: "client_device_A",
      },
    ];

    const resA = await app.inject({
      method: "POST",
      url: "/api/crdt/sync",
      headers: { "x-anon-id": "anon_test_user_crdt" },
      payload: { operations: clientAOps },
    });
    expect(resA.statusCode).toBe(200);
    const jsonA = resA.json();
    expect(jsonA.ok).toBe(true);
    expect(jsonA.state.pinnedCategoryIds).toContain("cat_dev");
    expect(jsonA.state.customCategories).toHaveLength(1);
    expect(jsonA.state.customCategories[0].title).toBe("AI 常用工具");

    // 3. 客户端 B 离线添加新站点到该类目并提交合流
    const clientBOps = [
      {
        id: "op_3_clientB",
        type: "UPSERT_CUSTOM_SITE",
        entityId: "site_deepseek",
        payload: {
          categoryId: "cat_ai_tools",
          site: { id: "site_deepseek", title: "DeepSeek", href: "https://chat.deepseek.com" },
        },
        timestamp: 1020,
        clientId: "client_device_B",
      },
    ];

    const resB = await app.inject({
      method: "POST",
      url: "/api/crdt/sync",
      headers: { "x-anon-id": "anon_test_user_crdt" },
      payload: { operations: clientBOps },
    });
    expect(resB.statusCode).toBe(200);
    const jsonB = resB.json();
    expect(jsonB.ok).toBe(true);
    // 双方操作合并，既有 A 的类目又有 B 的站点
    expect(jsonB.state.pinnedCategoryIds).toContain("cat_dev");
    expect(jsonB.state.customCategories[0].items).toHaveLength(1);
    expect(jsonB.state.customCategories[0].items[0].title).toBe("DeepSeek");

    // 4. GET 查询已合流状态
    const getRes = await app.inject({
      method: "GET",
      url: "/api/crdt/sync",
      headers: { "x-anon-id": "anon_test_user_crdt" },
    });
    expect(getRes.statusCode).toBe(200);
    const getJson = getRes.json();
    expect(getJson.operations).toHaveLength(3);
    expect(getJson.state.pinnedCategoryIds).toContain("cat_dev");

    // 5. DELETE 清除
    const delRes = await app.inject({
      method: "DELETE",
      url: "/api/crdt/sync",
      headers: { "x-anon-id": "anon_test_user_crdt" },
    });
    expect(delRes.statusCode).toBe(200);
  });

  it("POST /api/design/harmony 调色板美学与 WCAG 2.1 对比度审计", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/design/harmony",
      payload: {
        palette: ["#0f172a", "#3b82f6", "#10b981"],
        foreground: "#ffffff",
        background: "#0f172a",
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.report).toBeTruthy();
    expect(json.report.wcagContrastRatio).toBeGreaterThan(4.5);
    expect(["AAA", "AA"]).toContain(json.report.wcagPassLevel);
    expect(json.report.harmonyScore).toBeGreaterThanOrEqual(50);
  });

  it("POST /api/mcp 浏览器端 JSON-RPC 2.0 WebMCP 协议网桥", async () => {
    // 1. ping
    const pingRes = await app.inject({
      method: "POST",
      url: "/api/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(pingRes.statusCode).toBe(200);
    const pingJson = pingRes.json();
    expect(pingJson.result.status).toBe("pong");

    // 2. tools/list
    const listRes = await app.inject({
      method: "POST",
      url: "/api/mcp",
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(listRes.statusCode).toBe(200);
    const listJson = listRes.json();
    expect(listJson.result.tools.length).toBeGreaterThanOrEqual(4);
    const toolNames = listJson.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("navhub_echo");
    expect(toolNames).toContain("get_architecture_recipe");
    expect(toolNames).toContain("evaluate_developer_intent");

    // 3. tools/call: navhub_echo
    const callRes = await app.inject({
      method: "POST",
      url: "/api/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "navhub_echo", arguments: { message: "hello-webmcp" } },
      },
    });
    expect(callRes.statusCode).toBe(200);
    const callJson = callRes.json();
    expect(callJson.result.content[0].text).toContain("hello-webmcp");

    // 4. tools/call: evaluate_developer_intent (秒级解析 cron)
    const intentRes = await app.inject({
      method: "POST",
      url: "/api/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "evaluate_developer_intent", arguments: { input: "0 0 * * *" } },
      },
    });
    expect(intentRes.statusCode).toBe(200);
    const intentJson = intentRes.json();
    expect(intentJson.result.content[0].text).toContain("每天午夜 00:00 执行一次");
  });

  it("POST /api/rank/federated 客户端 LDP 差分隐私协同推荐排序", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/rank/federated",
      payload: {
        localVector: [1, 0, 1, 0],
        globalVector: [0.5, 0.5, 0.5, 0.5],
        candidates: [
          { id: "site-ai", name: "AI Tool", featureVector: [1, 0, 1, 0] },
          { id: "site-news", name: "News Site", featureVector: [0, 1, 0, 1] },
        ],
        personalWeight: 0.8,
        privatize: true,
        epsilon: 1.0,
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.count).toBe(2);
    expect(json.recommendations[0].itemId).toBe("site-ai");
    expect(json.recommendations[0].score).toBeGreaterThan(json.recommendations[1].score);
    expect(json.privacy.epsilon).toBe(1.0);
    expect(json.privacy.privatizedVector).toHaveLength(4);

    // 候选缺省时自动基于库内站点生成
    const autoRes = await app.inject({
      method: "POST",
      url: "/api/rank/federated",
      payload: {
        localVector: [0.8, 0.2, 0.9, 0.1],
      },
    });
    expect(autoRes.statusCode).toBe(200);
    const autoJson = autoRes.json();
    expect(autoJson.ok).toBe(true);
    expect(autoJson.count).toBeGreaterThan(0);
  });

  it("POST /api/speculation/rules 原生 W3C Speculation Rules 预渲染编译器", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/speculation/rules",
      payload: {
        candidates: [
          { url: "https://cursor.com", confidence: 0.92, predictedArrivalMs: 110 },
          { url: "https://npmjs.com", confidence: 0.55, predictedArrivalMs: 280 },
          { url: "https://example.com/admin/delete", confidence: 0.99, predictedArrivalMs: 40 }, // 高危拦截
        ],
        prerenderConfidenceThreshold: 0.8,
        prefetchConfidenceThreshold: 0.5,
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.hasRules).toBe(true);
    expect(json.rules.prerender[0].urls).toEqual(["https://cursor.com"]);
    expect(json.rules.prefetch[0].urls).toEqual(["https://npmjs.com"]);
    expect(json.script).toContain("prerender");
    expect(json.fallbackTags.length).toBe(2);
    expect(json.fallbackTags[0]).toContain("rel=\"prerender\"");
  });

  it("POST /api/tools/synthesize 动态智能体工具合成与 WebMCP 实时挂载", async () => {
    // 1. 合成站点站内检索动作
    const siteRes = await app.inject({
      method: "POST",
      url: "/api/tools/synthesize",
      payload: {
        kind: "site_search",
        siteSearchSpec: {
          siteId: "mdn",
          siteName: "MDN Web Docs",
          searchUrlTemplate: "https://developer.mozilla.org/zh-CN/search?q={query}",
          category: "文档",
        },
      },
    });
    expect(siteRes.statusCode).toBe(200);
    const siteJson = siteRes.json();
    expect(siteJson.ok).toBe(true);
    expect(siteJson.registered).toBe(true);
    expect(siteJson.tool.name).toBe("search_mdn");

    // 2. 合成单端点 REST 工具
    const restRes = await app.inject({
      method: "POST",
      url: "/api/tools/synthesize",
      payload: {
        kind: "rest",
        restSpec: {
          name: "get_package_version",
          description: "获取特定 npm 包版本详情",
          url: "https://registry.npmjs.org/{pkg}",
          method: "GET",
          parameters: [
            { name: "pkg", type: "string", in: "path", required: true },
          ],
        },
      },
    });
    expect(restRes.statusCode).toBe(200);
    const restJson = restRes.json();
    expect(restJson.ok).toBe(true);
    expect(restJson.tool.name).toBe("get_package_version");
  });

  it("POST /api/p2p/signal P2P 网格信令与去中心化状态协商 Broker", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/p2p/signal",
      payload: {
        nodeId: "broker-node-primary",
        message: {
          type: "HELLO",
          senderId: "client-peer-alpha",
          seq: 1,
          timestamp: Date.now(),
          payload: { clock: { "client-peer-alpha": 2 }, siteCount: 8 },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.nodeId).toBe("broker-node-primary");
    expect(json.receivedType).toBe("HELLO");
    expect(json.peerState).toBe("SYNCING");
    expect(json.outgoingResponse.type).toBe("SYNC_REQUEST");
  });
});
