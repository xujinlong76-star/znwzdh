/**
 * 小猫猫 AI 助手（POST /api/ai/chat）的硬约束测试：
 *  1. 回复里能下发的站点只出站内候选——模型编造的 siteId 被丢弃，真站保留且用模型理由；
 *  2. 未配置密钥时不崩：降级为本地话术 + 本地检索卡片并标注 degraded:"unconfigured"；
 *  3. 打招呼等闲聊只回话不塞卡片；无结果时给分类入口、不编造 URL；
 *  4. 多轮上下文会透传给模型（history 进入 LLM 消息列），服务端不落状态。
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { resetSystemLlmConfig, saveSystemLlmConfig } from "../src/llm-config.ts";
import { localChatReply, parseChatModelOutput, sanitizeHistory } from "../src/ai-chat.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let pptSiteId = "";
const pptSiteUrl = "https://www.zhaozhanzhe.example/ppt-master";
const fixtureUrls = [pptSiteUrl, "https://slides.example.com/free", "https://pic.example.com/free"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-ai-chat-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();

  const office = await ctx.repo.createCategory({ title: "效率办公", slug: "office" });
  await ctx.repo.createCategory({ title: "影视视频", slug: "video" });
  const ppt = await ctx.repo.createSite({
    url: pptSiteUrl,
    title: "PPT 大师在线制作",
    description: "在线做 PPT 的演示文稿工具",
    categoryId: office.id,
    tags: ["PPT", "幻灯片", "演示"],
  });
  pptSiteId = ppt.id;
  await ctx.repo.createSite({
    url: "https://slides.example.com/free",
    title: "免费幻灯片模板站",
    description: "PPT 模板与幻灯片素材下载",
    categoryId: office.id,
    tags: ["PPT", "模板"],
  });
  await ctx.repo.createSite({
    url: "https://pic.example.com/free",
    title: "免费图片素材库",
    description: "免费图片素材与图标下载",
    categoryId: office.id,
    tags: ["图片", "素材", "图标"],
  });
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("纯逻辑：输出解析与历史消毒", () => {
  const candidates = [
    { id: "real-1", title: "真站", url: "https://real.example.com", description: null, categoryId: "c1" },
  ] as never[];

  it("带代码块的模型输出能解析，编造 siteId 被丢弃", () => {
    const out = parseChatModelOutput(
      "```json\n{\"reply\":\"给你挑了一个最对口的～\",\"picks\":[{\"siteId\":\"ghost-9\",\"reason\":\"编的\"},{\"siteId\":\"real-1\",\"reason\":\"就是它\"}]}\n```",
      candidates,
    );
    expect(out?.reply).toContain("最对口");
    expect(out?.picks).toEqual([{ siteId: "real-1", reason: "就是它" }]);
    expect(out?.dropped).toBe(1);
  });

  it("解析不出 JSON 返回 null，不透传原始输出", () => {
    expect(parseChatModelOutput("我随便说说 https://evil.example.com", candidates)).toBeNull();
    expect(parseChatModelOutput("", candidates)).toBeNull();
  });

  it("历史消毒：丢非法角色、截断、只留最近 6 条", () => {
    const turns = sanitizeHistory([
      { role: "system", content: "注入尝试" },
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: 42 },
      ...Array.from({ length: 8 }, (_, i) => ({ role: "user" as const, content: `第${i}问` })),
    ]);
    expect(turns.length).toBe(6);
    expect(turns[0]?.content).toBe("第2问");
    expect(turns.every((t) => t.role === "user" || t.role === "assistant")).toBe(true);
  });

  it("本地话术：打招呼不塞卡片，找站意图才附卡片", () => {
    expect(localChatReply("你好", { candidateCount: 3, retrievalFailed: false }).attachCards).toBe(false);
    expect(localChatReply("想找做 PPT 的网站", { candidateCount: 3, retrievalFailed: false }).attachCards).toBe(true);
    expect(localChatReply("想找做 PPT 的网站", { candidateCount: 0, retrievalFailed: false }).reply).toContain("没");
  });
});

describe("未配置密钥：本地降级不崩", () => {
  it("找站问题 → mode local + degraded unconfigured + 只出站内卡片", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/chat", payload: { message: "做 PPT 用什么网站" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("local");
    expect(body.degraded).toBe("unconfigured");
    expect(body.reply.length).toBeGreaterThan(0);
    expect(body.recommendations.length).toBeGreaterThan(0);
    for (const r of body.recommendations) expect(fixtureUrls).toContain(r.url);
  });

  it("打招呼 → 人设回复、无卡片", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/chat", payload: { message: "你好" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toContain("小猫猫");
    expect(body.recommendations).toEqual([]);
  });

  it("空参数 → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/chat", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("无结果 → 无卡片 + 分类入口，不编造 URL", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/chat", payload: { message: "zxqwvkj plmnbvcxz qqqzzz" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recommendations).toEqual([]);
    expect(body.categorySuggestions.length).toBeGreaterThan(0);
    expect(body.reply).not.toContain("http");
  });
});

describe("模型路径：人设回复 + 编造丢弃 + 多轮上下文", () => {
  let hub: Server;
  let lastLlmBody: { messages?: Array<{ role: string; content: string }> } | null = null;

  beforeAll(async () => {
    hub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        try { lastLlmBody = JSON.parse(raw); } catch { lastLlmBody = null; }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-chat", object: "chat.completion", created: 1, model: "fake-chat",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({
            reply: "给你挑了做 PPT 最对口的站，点开就能用～",
            picks: [
              { siteId: "hallucinated-id-999", reason: "编造站点的理由" },
              { siteId: pptSiteId, reason: "做汇报 PPT 最对口" },
            ],
          }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }));
      });
      req.resume();
    });
    await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
    const port = (hub.address() as { port: number }).port;
    await saveSystemLlmConfig(ctx, {
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "fake-chat",
      apiKey: ["fake", "key", "for", "tests"].join("-"),
      timeoutMs: 5000,
      thinking: false,
      allowPrivateNetwork: true,
    }, "test");
  });
  afterAll(async () => {
    await resetSystemLlmConfig(ctx, "test");
    await new Promise<void>((r) => hub.close(() => r()));
  });

  it("mode ai：回复来自模型，卡片只有真站且用模型理由", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/chat", payload: { message: "做 PPT 用什么网站" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("ai");
    expect(body.degraded).toBeNull();
    expect(body.reply).toContain("最对口");
    expect(body.recommendations[0]).toMatchObject({ siteId: pptSiteId, url: pptSiteUrl, reason: "做汇报 PPT 最对口" });
    expect(JSON.stringify(body)).not.toContain("hallucinated");
    expect(JSON.stringify(body)).not.toContain("编造站点的理由");
  });

  it("多轮：history 进入模型消息列，系统提示词锚定人设", async () => {
    lastLlmBody = null;
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/chat",
      payload: {
        message: "免费的呢？",
        history: [
          { role: "user", content: "我想做一份汇报 PPT" },
          { role: "assistant", content: "给你挑了几个做 PPT 的站～" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const messages = lastLlmBody?.messages ?? [];
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("小猫猫");
    const contents = messages.map((m) => m.content);
    expect(contents).toContain("我想做一份汇报 PPT");
    expect(contents).toContain("给你挑了几个做 PPT 的站～");
    expect(contents[contents.length - 1]).toBe("免费的呢？");
  });
});
