/**
 * AI-3 端到端流式对话：中枢侧的 SSE 出口。
 *
 * 这里锁的是「流式不能改变语义」：
 *   1. 逐段推正文，但**终稿仍以 done 为准**——引用校验可能改写原文，编造链接只在
 *      done 里降级成纯文本，前端信草稿就会把坏链渲染成可点击；
 *   2. 降级仍是降级：额度/未配置这两类不开流（没有逐段内容可推），回与旧版字节一致
 *      的 JSON；开了流之后才失败则用同一份兜底正文作为 done 的正文，绝不半截冒充完成；
 *   3. 用量必须是真的：token 只取端点在流尾给的 usage，端点不给就记 0，
 *      绝不按字数估算——否则大盘的「流式调用成本」是编出来的；
 *   4. 取消即停：不打备用池、不写失败用量行，只记一行 copilot_cancel(stage=llm)。
 *
 * 路由用真 HTTP 假网关（逐段可控：分块、间隔、中途掐线），callLlmStream 的预算/轮换
 * 语义用 fetchImpl 直接喂，避免把「传输层怎么报错」混进「业务怎么记账」这两个变量。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { FastifyReply } from "fastify";
import { parseCopilotFrame } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { callLlmStream } from "../src/llm-usage.ts";
import { checkLlmQuota } from "../src/llm-quota.ts";
import { llmProviderReadyAny, resetSystemLlmConfig, saveSystemLlmConfig, type ResolvedLlm } from "../src/llm-config.ts";

const TARGET_URL = "https://obsidian.md";
const HALLUCINATED_HOST = "hallucinated.example.com";
const PARTIAL_TEXT = "这是被腰斩的半截答案，模型还没说完。";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Plan =
  | { kind: "sse"; chunks: string[]; gapMs?: number; breakAfter?: number }
  | { kind: "http"; status: number; message: string };

/* ------------------------------------------------------------------ *
 * OpenAI 兼容流式分块
 * ------------------------------------------------------------------ */

const sse = (payload: unknown) => "data: " + JSON.stringify(payload) + "\n\n";
const contentChunk = (text: string) =>
  sse({
    id: "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: 1,
    model: "fake-stream",
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  });
const reasoningChunk = (text: string) =>
  sse({ model: "fake-stream", choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] });
const usageChunk = (promptTokens: number, completionTokens: number) =>
  sse({
    model: "fake-stream",
    choices: [],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  });
const DONE = "data: [DONE]\n\n";

/**
 * 假模型网关：按命中次序取应答脚本（超出后沿用最后一条），因此
 * 「这条连接只被访问了一次」本身就是「没有轮换备用池」的证据。
 */
function startHub(initialPlans: Plan[] = []) {
  const plans: Plan[] = [...initialPlans];
  const state = { hits: 0, firstChunkAt: 0, bodies: [] as string[] };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", async () => {
      state.hits += 1;
      state.bodies.push(raw);
      const plan = plans[Math.min(state.hits - 1, plans.length - 1)];
      if (plan.kind === "http") {
        res.writeHead(plan.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: plan.message } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      for (let i = 0; i < plan.chunks.length; i += 1) {
        if (i > 0 && plan.gapMs) await sleep(plan.gapMs);
        // 用户挂断后连接已经没了：写失败不是测试失败
        if (res.destroyed || res.writableEnded) return;
        res.write(plan.chunks[i]);
        if (i === 0) state.firstChunkAt = Date.now();
        if (plan.breakAfter === i + 1) {
          // 先让上一块真的落进 socket，再掐线：立刻 destroy 会把没 flush 的
          // 分块一起丢掉，那样测出来的是「一个字节都没收到」而不是「开了流之后断」
          await sleep(40);
          res.destroy();
          return;
        }
      }
      res.end();
    });
    req.resume();
  });
  return {
    server,
    state,
    /** 每条用例换一个应答脚本；hits 只复位到「用例开始时的读数」，不做全局清零 */
    setPlan(plan: Plan) {
      plans.length = 0;
      plans.push(plan);
      // firstChunkAt 是「网关真的开始推流」的闸门，不复零会让下一条用例秒过闸门
      state.firstChunkAt = 0;
    },
    /** 备用池用同一个网关：多一跳就是轮换，hits 的增量能直接分辨 */
    listen() {
      return new Promise<string>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          resolve("http://127.0.0.1:" + (server.address() as { port: number }).port + "/v1");
        });
      });
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/* ------------------------------------------------------------------ *
 * SSE 文本解析
 * ------------------------------------------------------------------ */

interface Frame {
  type: string;
  [key: string]: unknown;
}

function framesOf(body: string): Frame[] {
  return body
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(":"))
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join(""),
    )
    .filter(Boolean)
    .map((text) => JSON.parse(text) as Frame);
}

/* ------------------------------------------------------------------ *
 * 公共夹具
 * ------------------------------------------------------------------ */

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let targetSiteId = "";
let lastReply: FastifyReply | null = null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-copilot-stream-"));
  ctx = await createContext(
    loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }),
  );
  app = await buildServer(ctx);
  // 拿住 reply.raw 才能在确定时序里模拟「用户挂断」
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.includes("/api/copilot/chat")) lastReply = reply;
  });
  await app.ready();

  const cat = await ctx.repo.createCategory({ title: "效率工具", slug: "efficiency" });
  const site = await ctx.repo.createSite({
    url: TARGET_URL,
    title: "Obsidian 离线 Markdown 编辑器",
    description: "本地优先的知识库与 Markdown 写作工具",
    categoryId: cat.id,
    tags: ["markdown", "离线", "编辑器"],
  });
  targetSiteId = site.id;
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function usageRows() {
  return ctx.repo.raw(
    "SELECT ok, prompt_tokens, completion_tokens, thinking, error_code, model, source FROM llm_usage WHERE scenario = 'copilot'",
  ) as Promise<
    Array<{
      ok: number;
      prompt_tokens: number;
      completion_tokens: number;
      thinking: number;
      error_code: string | null;
      model: string;
      source: string;
    }>
  >;
}

async function eventRows(kind: string) {
  return ctx.repo.raw("SELECT kind, meta FROM events WHERE kind = ? ORDER BY created_at", [kind]) as Promise<
    Array<{ kind: string; meta: string | null }>
  >;
}

/** 直接写一行用量：额度用例只关心「窗口里已有消耗」，不必真调一次模型 */
async function insertUsageRow(id: string, scenario: string, identity: string | null) {
  await ctx.repo.run(
    "INSERT INTO llm_usage (id, scenario, source, model, identity, prompt_tokens, completion_tokens, latency_ms, ok, error_code, thinking, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, 10, 1, NULL, 0, ?)",
    [id, scenario, "system", "fake", identity, Date.now()],
  );
}

/** 轮询到条件成立；超时就把现场写进消息，免得只看到一个无声的红 */
async function until(label: string, ms: number, cond: () => boolean | Promise<boolean>, scene: () => unknown = () => ({})) {
  const end = Date.now() + ms;
  for (;;) {
    if (await cond()) return Date.now();
    if (Date.now() >= end) throw new Error(label + " 超时 " + ms + "ms，现场：" + JSON.stringify(scene()));
    await sleep(15);
  }
}

function rawOf(reply: FastifyReply) {
  return reply as unknown as { raw: EventEmitter & { writableEnded: boolean }; statusCode: number };
}

describe("stream:true 但模型不可用：不许开流，回与旧版一致的 JSON 降级体", () => {
  it("未配置密钥 ⇒ content-type 仍是 JSON、没有 data: 帧、degraded=unconfigured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器", stream: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
    expect(res.body).not.toContain("data: ");
    const body = res.json();
    expect(body.degraded).toBe("unconfigured");
    expect(body.model).toBe("local-heuristic-match");
    // 降级正文本身没变：前端按 content-type 分流，两条出口共用一份兜底
    expect(body.reply).toContain(TARGET_URL);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].siteId).toBe(targetSiteId);
    expect(await usageRows()).toHaveLength(0);
  });
});

describe("SSE 出口：逐段增量 + 权威终稿", () => {
  let hub: ReturnType<typeof startHub>;
  let hubBase = "";

  beforeAll(async () => {
    hub = startHub([]);
    hubBase = await hub.listen();
    await saveSystemLlmConfig(
      ctx,
      {
        enabled: true,
        baseUrl: hubBase,
        model: "fake-stream",
        apiKey: "sk-fake",
        timeoutMs: 5000,
        thinking: false,
        allowPrivateNetwork: true,
        // 备用池指向同一个网关：网关命中数因此能直接分辨「有没有轮换」
        fallbacks: [{ baseUrl: hubBase, model: "fake-stream-backup", apiKey: "sk-fake", timeoutMs: 5000, allowPrivateNetwork: true }],
      },
      "test",
    );
  });

  afterAll(async () => {
    await resetSystemLlmConfig(ctx, "test");
    await hub.close();
  });

  it("正文分块抵达，URL 被拆在两块里也能拼回候选；done 是改写后的终稿", async () => {
    hub.setPlan({
      kind: "sse",
      chunks: [
        // 链接故意跨块写：逐段草稿允许出现半条链接，终稿必须已经拼完并过校验
        contentChunk("推荐 [Obsidian](https://obsidian"),
        contentChunk(".md/) 做本地 Markdown 写作。\n"),
        contentChunk("另外 [" + "某个不存在的神器](" + "https://" + HALLUCINATED_HOST + "/download) 也可以。\n\n"),
        contentChunk("💡 试试离线笔记\n💡 看看 Markdown 工具"),
        usageChunk(11, 23),
        DONE,
      ],
    });
    const before = (await usageRows()).length;
    const hitsBefore = hub.state.hits;

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器", stream: true },
    });

    expect(res.statusCode).toBe(200);
    expect(hub.state.hits).toBe(hitsBefore + 1);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    // 首 token 之前先把注释头推出去：中间层（代理/nginx）不能把空闲连接掐掉
    expect(res.body.startsWith(": connected")).toBe(true);

    const frames = framesOf(res.body);
    const deltas = frames.filter((f) => f.type === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(4);
    expect(deltas.map((d) => d.text).join("")).toContain("推荐 [Obsidian](https://obsidian.md/)");

    const done = frames.at(-1);
    expect(done?.type).toBe("done");
    expect(done?.ok).toBe(true);
    expect(done?.model).toBe("fake-stream");
    // 终稿：候选链接保住（原样保留模型写法），编造链接被剥成纯文本
    expect(String(done?.reply)).toContain("https://obsidian.md/");
    expect(String(done?.reply)).not.toContain(HALLUCINATED_HOST);
    expect(String(done?.reply)).toContain("某个不存在的神器");
    expect(done?.citations).toEqual([{ siteId: targetSiteId, title: "Obsidian 离线 Markdown 编辑器", url: TARGET_URL, description: "本地优先的知识库与 Markdown 写作工具" }]);
    expect((done?.retrieval as { unverifiedLinks: number }).unverifiedLinks).toBe(1);
    expect(done?.suggestions).toEqual(["试试离线笔记", "看看 Markdown 工具"]);
    // 降级字段在成功流里绝不出现，否则前端会把模型回答染成兜底色
    expect(done?.degraded).toBeUndefined();

    // 真实用量：token 全部来自流尾 usage（11/23），不是按字数估的
    const added = (await usageRows()).slice(before);
    expect(added).toHaveLength(1);
    // thinking=0 是「管理端关掉深度思考真的关掉了」的证据：
    // 配置读取层曾把 thinking 键剥掉，记账就永远显示「全部调用都在思考」
    expect(added[0]).toMatchObject({
      ok: 1,
      prompt_tokens: 11,
      completion_tokens: 23,
      thinking: 0,
      error_code: null,
      model: "fake-stream",
      source: "system",
    });

    await until("copilot 事件落库", 2000, async () => (await eventRows("copilot")).length > 0);
    const meta = JSON.parse((await eventRows("copilot")).at(-1)!.meta ?? "{}") as Record<string, unknown>;
    expect(meta.model).toBe("fake-stream");
    expect(meta.degraded).toBeNull();
    expect(Number(meta.citations)).toBe(1);
    expect(Number(meta.unverified_links)).toBe(1);
    expect(Number(meta.retrieval_hits)).toBe(1);
  });

  it("真实 SSE 响应逐帧通过共享 schema：类型全在白名单，且恰好一个 done", async () => {
    hub.setPlan({
      kind: "sse",
      chunks: [reasoningChunk("先看候选，"), contentChunk("[Obsidian](https://obsidian.md) 很合适。"), usageChunk(2, 3), DONE],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器", stream: true, thinking: true },
    });

    const blocks = res.body
      .split(/\r?\n\r?\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0 && !block.startsWith(":"));
    const parsed = blocks.map((block) =>
      parseCopilotFrame(
        block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n"),
      ),
    );
    expect(parsed.every((frame) => frame !== null)).toBe(true);
    const types = parsed.map((frame) => frame!.type) as string[];
    expect(types).toContain("reasoning");
    expect(types).toContain("delta");
    expect(types.filter((type) => type === "done")).toHaveLength(1);
    expect(types.filter((type) => !["delta", "reasoning", "done"].includes(type))).toEqual([]);
  });

  it("额度用尽 ⇒ 即使 stream:true 也不开流：JSON 降级 + Retry-After + quota 明细", async () => {
    const hitsBefore = hub.state.hits;
    const usageBefore = (await usageRows()).length;
    const quotaCfg = ctx.config.llmQuota;
    const saved = { ...quotaCfg };
    const rowId = randomUUID();
    try {
      // 匿名合池档：identity IS NULL 的消耗共享一份调用次数上限。
      // 前面的用例已经留下真实用量，基线必须现算，否则断言会写成「固定 1」而误判。
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const before = await ctx.repo.sumLlmUsage({ since, identity: null });
      quotaCfg.anonymousDailyCalls = before.calls + 1;
      await insertUsageRow(rowId, "quota_fixture", null);

      const res = await app.inject({
        method: "POST",
        url: "/api/copilot/chat",
        payload: { message: "离线 Markdown 编辑器", stream: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).not.toContain("text/event-stream");
      expect(res.headers["retry-after"]).toBeTruthy();
      expect(res.body).not.toContain("data: ");
      const body = res.json();
      expect(body.degraded).toBe("quota");
      expect(body.quota).toMatchObject({
        scope: "anonymous",
        metric: "calls",
        limit: before.calls + 1,
        used: before.calls + 1,
      });
      // 额度拦截的目标就是「不再花钱」：网关一跳都不该被访问
      expect(hub.state.hits).toBe(hitsBefore);
      expect(await usageRows()).toHaveLength(usageBefore);
    } finally {
      Object.assign(quotaCfg, saved);
      await ctx.repo.run("DELETE FROM llm_usage WHERE id = ?", [rowId]);
    }
  });

  it("取消发生在准备阶段（检索未完成）⇒ copilot_cancel(stage=pre_llm)，零用量、零网关命中", async () => {
    const usageBefore = (await usageRows()).length;
    const cancelBefore = (await eventRows("copilot_cancel")).length;
    const hitsBefore = hub.state.hits;

    const originalSearch = ctx.search.search.bind(ctx.search);
    let release: (() => void) | null = null;
    ctx.search.search = (async (input: Parameters<typeof originalSearch>[0]) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return originalSearch(input);
    }) as typeof ctx.search.search;

    try {
      const inflight = app
        .inject({
          method: "POST",
          url: "/api/copilot/chat",
          payload: { message: "离线 Markdown 编辑器", stream: true },
        })
        .catch(() => null);

      await until("请求进入检索阶段", 3000, () => release !== null, () => ({ release: release !== null }));
      // 客户端在首 token 之前就走了：这里掐掉连接，再放行检索
      rawOf(lastReply as FastifyReply).raw.emit("close");
      (release as unknown as () => void)();

      await until("pre_llm 取消落库", 3000, async () => (await eventRows("copilot_cancel")).length > cancelBefore);
      await inflight;

      const meta = JSON.parse((await eventRows("copilot_cancel")).at(-1)!.meta ?? "{}") as Record<string, unknown>;
      expect(meta.stage).toBe("pre_llm");
      expect(hub.state.hits).toBe(hitsBefore);
      expect((await usageRows()).length).toBe(usageBefore);
    } finally {
      ctx.search.search = originalSearch as typeof ctx.search.search;
    }
  });

  it("候选池可用性：主模型未就绪但备用池有密钥 ⇒ 仍视为可跑（不再误报 unconfigured）", () => {
    const unready = { apiKey: null, allowPrivateNetwork: false };
    const ready = { apiKey: "sk-x", allowPrivateNetwork: false };
    expect(llmProviderReadyAny({ provider: unready, fallbacks: [ready] })).toBe(true);
    expect(llmProviderReadyAny({ provider: ready, fallbacks: [] })).toBe(true);
    // 本地 Ollama 场景：无密钥但放行私网也算可用
    expect(llmProviderReadyAny({ provider: { apiKey: null, allowPrivateNetwork: true }, fallbacks: [] })).toBe(true);
    expect(llmProviderReadyAny({ provider: unready, fallbacks: [unready] })).toBe(false);
    expect(llmProviderReadyAny(null)).toBe(false);
  });

  it("端点不给 usage ⇒ 记 0，不按字符数估算冒充真实成本", async () => {
    hub.setPlan({
      kind: "sse",
      chunks: [contentChunk("[Obsidian](https://obsidian.md) 很合适，这段故意写得长一些，好暴露「按字数估算 token」的诱惑。"), DONE],
    });
    const before = (await usageRows()).length;

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器", stream: true },
    });
    expect(framesOf(res.body).at(-1)?.type).toBe("done");

    const added = (await usageRows()).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].ok).toBe(1);
    expect(added[0].prompt_tokens).toBe(0);
    expect(added[0].completion_tokens).toBe(0);
  });

  it("思维链走独立 reasoning 事件，不混进正文；done 里给完整 reasoningContent", async () => {
    hub.setPlan({
      kind: "sse",
      chunks: [
        reasoningChunk("先看候选里有没有 Markdown 工具，"),
        reasoningChunk("再决定推荐谁。"),
        contentChunk("[Obsidian](https://obsidian.md) 是站内收录的离线编辑器。"),
        usageChunk(9, 6),
        DONE,
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器", stream: true, thinking: true },
    });
    const frames = framesOf(res.body);
    expect(frames.filter((f) => f.type === "reasoning").map((f) => f.text).join("")).toBe("先看候选里有没有 Markdown 工具，再决定推荐谁。");
    expect(frames.filter((f) => f.type === "delta").map((f) => f.text).join("")).not.toContain("先看候选");
    expect(frames.at(-1)?.reasoningContent).toBe("先看候选里有没有 Markdown 工具，再决定推荐谁。");

    // thinking 记账按实际下发：请求了思考且端点收了 ⇒ 这一行必须算「思考调用」
    const last = (await usageRows()).at(-1)!;
    expect(last.thinking).toBe(1);
  });

  it("开了流之后上游掐线：done 用同一份兜底正文，绝不把半截原文当完成", async () => {
    hub.setPlan({ kind: "sse", chunks: [contentChunk(PARTIAL_TEXT), contentChunk("永远不会到的第二段")], breakAfter: 1 });
    const before = (await usageRows()).length;
    const hitsBefore = hub.state.hits;

    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器", stream: true },
    });

    expect(res.headers["content-type"]).toContain("text/event-stream");
    const frames = framesOf(res.body);
    expect(frames.some((f) => f.type === "delta")).toBe(true);
    const done = frames.at(-1);
    expect(done?.type).toBe("done");
    // 兜底正文顶替草稿：degraded 明确写 error，前端才给「可重试」出口
    expect(done?.degraded).toBe("error");
    expect(String(done?.reply)).toContain("模型暂时不可用，已降级为站内混合检索");
    expect(String(done?.reply)).not.toContain(PARTIAL_TEXT);
    expect(done?.model).toBe("local-heuristic-match");
    expect(done?.citations).toHaveLength(1);

    // 已经开流不再打备用池：一个 provider 的半截答案 + 另一个 provider的后半截
    // 拼在一起，用户会看到一条前后不连贯的回答
    expect(hub.state.hits).toBe(hitsBefore + 1);
    const added = (await usageRows()).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].ok).toBe(0);
    expect(added[0].error_code).toBe("network");
  });

  it("流在飞时用户挂断：不产出终稿、不打备用池、不记失败用量，只记 copilot_cancel(stage=llm)", async () => {
    hub.setPlan({
      kind: "sse",
      // 块间留足间隔：测试要在第一块之后、第二块之前把连接掐掉
      chunks: [contentChunk("第一段已经推给前端了。"), contentChunk("这一段永远不该被写出。"), usageChunk(5, 5), DONE],
      gapMs: 250,
    });
    const usageBefore = (await usageRows()).length;
    const cancelBefore = (await eventRows("copilot_cancel")).length;
    const hitsBefore = hub.state.hits;

    /**
     * 连接没了之后 light-my-request 会判负（真机同理：没人再读得到响应体），
     * 状态码没有意义就不看它。catch 必须在创建的同一段代码里挂上：挂晚了会被
     * Node 当成未处理的 Promise 拒绝报出来，红的不是产品而是 harness。
     */
    const inflight = app
      .inject({
        method: "POST",
        url: "/api/copilot/chat",
        payload: { message: "离线 Markdown 编辑器", stream: true },
      })
      .catch(() => null);
    await until("网关开始推流", 3000, () => hub.state.firstChunkAt > 0, () => hub.state);

    const raw = rawOf(lastReply as FastifyReply);
    expect(raw.raw.writableEnded).toBe(false);
    const abortAt = Date.now();
    raw.raw.emit("close");

    await until("取消收尾写 copilot_cancel", 3000, async () => (await eventRows("copilot_cancel")).length > cancelBefore, () => hub.state);
    await inflight;

    // 中止信号真的穿透了传输层：等满 250ms 间隔说明只是碰巧写完了
    expect(Date.now() - abortAt).toBeLessThan(2000);
    // 备用池（同一个网关）一跳都没打：用户已经走了，不该再花钱问第二个模型
    expect(hub.state.hits).toBe(hitsBefore + 1);
    // 取消不是模型坏：记进 llm_usage 会把「用户等太久放弃」算进失败率
    expect((await usageRows()).length).toBe(usageBefore);

    const meta = JSON.parse((await eventRows("copilot_cancel")).at(-1)!.meta ?? "{}") as Record<string, unknown>;
    expect(meta.stage).toBe("llm");
    expect(meta.quota_limited).toBe(false);
    expect(Number(meta.waited_ms)).toBeGreaterThanOrEqual(1);
  });

  it("每次流式请求都带全库召回的候选，并显式要 usage", async () => {
    const streamBodies = hub.state.bodies.filter((b) => b.includes('"stream":true'));
    expect(streamBodies.length).toBeGreaterThanOrEqual(5);
    const last = streamBodies.at(-1) ?? "";
    expect(last).toContain("Obsidian 离线 Markdown 编辑器");
    expect(last).toContain(TARGET_URL);
    expect(last).toContain("候选站点");
    // 不给这个开关，多数网关不在流尾带 usage ⇒ 用量列全 0，成本面板就是空的
    expect(last).toContain('"stream_options":{"include_usage":true}');
  });
});

/* ------------------------------------------------------------------ *
 * callLlmStream 的预算 / 取消 / 轮换（传输层用 fetchImpl 直接喂）
 * ------------------------------------------------------------------ */

/** 127.0.0.1 + allowPrivateNetwork：过得了 SSRF 闸门，又不真出门 */
function pool(tag: string, fallbackCount = 1): ResolvedLlm {
  const mk = (n: number) => ({
    name: "fake-" + tag + "-" + n,
    baseUrl: "http://127.0.0.1:1143" + n + "/v1",
    model: "fake-" + tag + "-" + n,
    apiKey: "sk-fake",
    allowPrivateNetwork: true,
  });
  return {
    provider: mk(0),
    fallbacks: Array.from({ length: fallbackCount }, (_, i) => mk(i + 1)),
    source: "system",
  } as unknown as ResolvedLlm;
}

const encoder = new TextEncoder();
/** model 非空时把流里的模型名换掉（必须带上引号，否则改出来的不是合法 JSON） */
const streamResponse = (chunks: string[], model?: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(model ? chunk.replace('"fake-stream"', JSON.stringify(model)) : chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

/** 先让第一块真的进流，再掐线：start() 里同步 error() 会把刚 enqueue 的块一起丢掉 */
function midBreakResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(contentChunk("第一段")));
    },
  });
  setTimeout(() => controller?.error(new TypeError("terminated")), 30);
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function usageRowsFor(scenario: string) {
  return ctx.repo.raw("SELECT ok, error_code, model FROM llm_usage WHERE scenario = ?", [scenario]) as Promise<
    Array<{ ok: number; error_code: string | null; model: string }>
  >;
}

describe("callLlmStream：取消即停、开流前可轮换、开流后不轮换", () => {
  it("取消：只试 1 个 provider、零用量行、抛「被取消」", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const fakeFetch = (async (_url: string, init?: { signal?: AbortSignal | null }) => {
      attempts += 1;
      const signal = init?.signal;
      if (!signal) throw new Error("测试要求：外部 signal 必须已经并进真正下发的 fetch signal");
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }) as unknown as typeof fetch;

    const pending = (async () => {
      for await (const _event of callLlmStream(ctx, pool("stream-abort"), {
        scenario: "copilot_stream_unit",
        messages: [{ role: "user", content: "推荐一个 Markdown 编辑器" }],
        signal: controller.signal,
        fetchImpl: fakeFetch,
      })) {
        /* 一个字节都不该出来 */
      }
    })();
    await sleep(20);
    controller.abort();

    await expect(pending).rejects.toThrow(/取消/);
    expect(attempts).toBe(1);
    expect(await usageRowsFor("copilot_stream_unit")).toHaveLength(0);
  });

  it("对照：首个 delta 之前失败 ⇒ 允许轮换备用池，两跳各记一行（ok=0 再 ok=1）", async () => {
    let attempts = 0;
    const fakeFetch = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: "upstream boom" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return streamResponse([contentChunk("备用模型的答复。"), usageChunk(3, 4), DONE], "fake-rotate-backup");
    }) as unknown as typeof fetch;

    const events: string[] = [];
    for await (const event of callLlmStream(ctx, pool("stream-rotate", 1), {
      scenario: "copilot_stream_rotate",
      messages: [{ role: "user", content: "ping" }],
      fetchImpl: fakeFetch,
    })) {
      events.push(event.type);
    }
    expect(attempts).toBe(2);
    expect(events).toEqual(["delta", "end"]);

    const rows = await usageRowsFor("copilot_stream_rotate");
    expect(rows).toHaveLength(2);
    expect(rows[0].ok).toBe(0);
    expect(rows[1].ok).toBe(1);
    // 这一行的模型名来自备用池那次的流本身：证明成功的是第二跳，而不是主模型重试
    expect(rows[1].model).toBe("fake-rotate-backup");
  });

  it("已经开流 ⇒ 不再轮换：一次请求、一行失败用量，错误原样抛出", async () => {
    let attempts = 0;
    const fakeFetch = (async () => {
      attempts += 1;
      return midBreakResponse();
    }) as unknown as typeof fetch;

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of callLlmStream(ctx, pool("stream-midbreak", 2), {
          scenario: "copilot_stream_midbreak",
          messages: [{ role: "user", content: "ping" }],
          fetchImpl: fakeFetch,
        })) {
          seen.push(event.type);
        }
      })(),
    ).rejects.toThrow(/流式/);

    expect(seen).toEqual(["delta"]);
    expect(attempts).toBe(1);
    const rows = await usageRowsFor("copilot_stream_midbreak");
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(0);
    expect(rows[0].error_code).toBe("network");
  });

  it("只吐了 reasoning 也算已开流：不换模型拼接两段思考", async () => {
    let attempts = 0;
    const fakeFetch = (async () => {
      attempts += 1;
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          c.enqueue(encoder.encode(reasoningChunk("先想一段")));
        },
      });
      setTimeout(() => controller?.error(new TypeError("terminated")), 30);
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of callLlmStream(ctx, pool("stream-reasoning", 2), {
          scenario: "copilot_stream_reasoning",
          messages: [{ role: "user", content: "ping" }],
          fetchImpl: fakeFetch,
        })) {
          seen.push(event.type);
        }
      })(),
    ).rejects.toThrow(/流式/);

    expect(seen).toEqual(["reasoning"]);
    // 备胎一跳都没打：思考链已经推给用户，换模型只会把两家的推理拼成一段
    expect(attempts).toBe(1);
    const rows = await usageRowsFor("copilot_stream_reasoning");
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(0);
    expect(rows[0].error_code).toBe("network");
  });

  it("总预算已经耗尽 ⇒ 一个请求都不发（备用池是等待时间的乘法）", async () => {
    let attempts = 0;
    const fakeFetch = (async () => {
      attempts += 1;
      return streamResponse([contentChunk("不该发生"), DONE]);
    }) as unknown as typeof fetch;

    await expect(
      (async () => {
        for await (const _event of callLlmStream(ctx, pool("stream-budget", 2), {
          scenario: "copilot_stream_budget",
          messages: [{ role: "user", content: "ping" }],
          fetchImpl: fakeFetch,
          deadlineAt: Date.now() - 1,
        })) {
          /* 不会进到这里 */
        }
      })(),
    ).rejects.toThrow(/预算/);
    expect(attempts).toBe(0);
    expect(await usageRowsFor("copilot_stream_budget")).toHaveLength(0);
  });
});

describe("额度边界：到上限才拒，档位之间不串", () => {
  it("anonymous 合池：used = limit-1 放行，used = limit 拒；有身份时不命中该档", async () => {
    const cfg = ctx.config.llmQuota;
    const saved = { ...cfg };
    const rows = [randomUUID(), randomUUID()];
    try {
      // 前面的用例已经留下匿名用量，基线必须现算
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const base = (await ctx.repo.sumLlmUsage({ since, identity: null })).calls;
      const limit = base + 2;
      Object.assign(cfg, {
        identityDailyCalls: 0,
        identityDailyTokens: 0,
        anonymousDailyCalls: limit,
        anonymousDailyTokens: 0,
        systemDailyCalls: 0,
        systemDailyTokens: 0,
      });

      await insertUsageRow(rows[0], "quota_boundary", null);
      expect(await checkLlmQuota(ctx, null)).toEqual({ ok: true });

      await insertUsageRow(rows[1], "quota_boundary", null);
      const blocked = await checkLlmQuota(ctx, null);
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error).toMatchObject({ scope: "anonymous", metric: "calls", limit, used: limit });
        expect(blocked.error.retryAfterMs).toBeGreaterThan(0);
      }

      // 有身份时不再落进「无法归属流量」的合池；identity 档为 0 表示关闭
      expect(await checkLlmQuota(ctx, "anon:someone")).toEqual({ ok: true });
    } finally {
      Object.assign(cfg, saved);
      await ctx.repo.run("DELETE FROM llm_usage WHERE id IN (?, ?)", rows);
    }
  });
});
