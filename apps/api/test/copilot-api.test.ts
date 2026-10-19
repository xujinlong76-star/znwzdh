import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

describe("Dimension 3: Agnes 3.0 Flash Copilot API", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-test-copilot-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      corsOrigins: ["*"],
    });

    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();

    // 预置一些测试数据
    const cat = await ctx.repo.createCategory({
      title: "AI 智能应用",
      slug: "ai-tools",
      description: "AI Tools & Models",
    });

    await ctx.repo.createSite({
      title: "Hugging Face",
      url: "https://huggingface.co",
      description: "The AI community building the future",
      categoryId: cat.id,
      tags: ["ai", "models", "transformers"],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("POST /api/copilot/chat 参数为空应返回 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_REQUEST");
  });

  it("POST /api/copilot/chat 正常问答应返回智能答复与建议动作", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat",
      payload: {
        message: "有哪些推荐的 AI 模型平台？",
        history: [],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toBeDefined();
    expect(typeof body.reply).toBe("string");
    expect(body.model).toBeDefined();
    expect(body.suggestions).toBeInstanceOf(Array);
    expect(body.suggestions.length).toBeGreaterThanOrEqual(1);
  });
});
