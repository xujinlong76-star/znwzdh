/**
 * AI-1：Copilot 的全库检索与可验证引用。
 *
 * 旧实现只把「前 40 个站点里的前 25 个」塞进提示词，回答里的链接也无人校验。
 * 本测试锁定三件事：
 *   1. 检索覆盖全库（目标站点排在浏览序第 40 条之后，仍必须被召回）；
 *   2. 模型回复里的外链必须属于本次候选集，编造链接被降级为纯文本；
 *   3. 本地降级复用同一份混合检索结果，并如实返回 citations。
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
import { retrieveCopilotCandidates } from "../src/routes/copilot.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let targetSiteId = "";

const TARGET_URL = "https://obsidian.md";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-copilot-rag-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      corsOrigins: ["*"],
    }),
  );
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ title: "效率工具", slug: "efficiency" });

  // 45 个高排序填充站点：目标站点排在浏览序第 46 位，旧实现的 limit 40 看不到它
  for (let i = 0; i < 45; i += 1) {
    await ctx.repo.createSite({
      url: `https://filler.example.com/${i}`,
      title: `填充站点 ${String(i + 1).padStart(2, "0")}`,
      description: "与本次提问无关的填充数据",
      categoryId: cat.id,
      sort: i + 1,
    });
  }

  const target = await ctx.repo.createSite({
    url: TARGET_URL,
    title: "Obsidian 离线 Markdown 编辑器",
    description: "本地优先的知识库与 Markdown 写作工具",
    categoryId: cat.id,
    tags: ["markdown", "离线", "编辑器"],
    sort: 999,
  });
  targetSiteId = target.id;
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function eventRows() {
  return ctx.repo.raw(
    "SELECT kind, identity, meta FROM events WHERE kind IN ('copilot', 'copilot_cancel') ORDER BY created_at",
  ) as Promise<Array<{ kind: string; identity: string | null; meta: string | null }>>;
}

async function until(label: string, ms: number, cond: () => boolean | Promise<boolean>) {
  const deadlineAt = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadlineAt) throw new Error(label + " 超时 " + ms + "ms");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("retrieveCopilotCandidates：召回失败与无匹配必须分开", () => {
  it("检索异常 ⇒ failed=true（不是「站内没有」）", async () => {
    const broken = {
      search: {
        search: async () => {
          throw new Error("fts offline");
        },
      },
      repo: {},
    } as unknown as AppContext;
    const result = await retrieveCopilotCandidates(broken, "任意问题");
    expect(result.failed).toBe(true);
    expect(result.sites).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it("检索零命中 ⇒ failed=false、空候选", async () => {
    const empty = {
      search: { search: async () => ({ hits: [] }) },
      repo: { getSitesByIds: async () => new Map() },
    } as unknown as AppContext;
    const result = await retrieveCopilotCandidates(empty, "任意问题");
    expect(result.failed).toBe(false);
    expect(result.sites).toEqual([]);
  });
});

describe("降级路径（未配置模型）：同一份混合检索 + 结构化引用", () => {
  it("目标站点在浏览序第 46 位仍被召回，回复与 citations 都能映射回真实 siteId/URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.ok).toBe(true);
    expect(body.model).toBe("local-heuristic-match");
    expect(body.degraded).toBe("unconfigured");
    // 不是「前 40 条静态切片」里能出现的东西
    expect(body.reply).toContain(TARGET_URL);
    expect(body.reply).toContain("站内混合检索");

    expect(Array.isArray(body.citations)).toBe(true);
    const cited = body.citations.find((c: { siteId: string }) => c.siteId === targetSiteId);
    expect(cited).toMatchObject({
      siteId: targetSiteId,
      title: "Obsidian 离线 Markdown 编辑器",
      url: TARGET_URL,
    });
    expect(body.retrieval).toMatchObject({ failed: false });
    expect(body.retrieval.candidates).toBeGreaterThanOrEqual(1);

    await until("copilot 事件落库", 2000, async () => {
      const rows = await eventRows();
      return rows.length > 0;
    });
    const last = (await eventRows()).at(-1)!;
    const meta = JSON.parse(last.meta ?? "{}") as Record<string, unknown>;
    // 只留维度：引用数/召回数可量化，问题原文绝不进 events
    expect(Number(meta.citations)).toBeGreaterThanOrEqual(1);
    expect(Number(meta.retrieval_hits)).toBeGreaterThanOrEqual(1);
    expect(meta.retrieval_failed).toBe(false);
    expect(JSON.stringify(meta)).not.toContain("离线 Markdown");
  });
});

describe("模型路径：提示词带候选、回复链接过校验", () => {
  let hub: Server;
  let capturedPrompt = "";
  let capturedSystem = "";

  beforeAll(async () => {
    hub = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(raw || "{}") as {
            messages?: Array<{ role: string; content: string }>;
          };
          capturedPrompt = parsed.messages?.map((m) => m.content).join("\n") ?? "";
          capturedSystem = parsed.messages?.find((m) => m.role === "system")?.content ?? "";
        } catch {
          /* 断言会说明没收到合法 JSON */
        }
        const reply =
          "推荐 [Obsidian](https://obsidian.md/) 做本地 Markdown 写作。\n" +
          "另外 [某个不存在的神器](https://hallucinated.example.com/download) 也可以。\n\n" +
          "💡 试试离线笔记\n💡 看看 Markdown 工具";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "fake-grounding",
            choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }),
        );
      });
      req.resume();
    });
    await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
    const port = (hub.address() as { port: number }).port;
    await saveSystemLlmConfig(
      ctx,
      {
        enabled: true,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "fake-grounding",
        apiKey: "sk-fake",
        timeoutMs: 5000,
        thinking: false,
        allowPrivateNetwork: true,
      },
      "test",
    );
  });

  afterAll(async () => {
    await resetSystemLlmConfig(ctx, "test");
    await new Promise<void>((resolve) => hub.close(() => resolve()));
  });

  it("编造外链被降级成纯文本，citations 只保留真实候选", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: { message: "离线 Markdown 编辑器" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.model).toBe("fake-grounding");
    expect(body.degraded).toBeUndefined();
    // 候选链接保留（模型写成带斜杠的变体，服务端仍映射回库里的 URL）
    expect(body.reply).toContain("https://obsidian.md/");
    // 编造链接不再可点击
    expect(body.reply).not.toContain("hallucinated.example.com");
    expect(body.reply).toContain("某个不存在的神器");
    expect(body.retrieval.unverifiedLinks).toBe(1);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]).toMatchObject({ siteId: targetSiteId, url: TARGET_URL });

    // 提示词确实带上了全库召回的目标站点，且不再冒充固定模型身份
    expect(capturedPrompt).toContain("Obsidian 离线 Markdown 编辑器");
    expect(capturedPrompt).toContain(TARGET_URL);
    expect(capturedPrompt).toContain("候选站点");
    expect(capturedSystem).not.toContain("Agnes");
    expect(capturedSystem).toContain("山羊胡");
  });
});
