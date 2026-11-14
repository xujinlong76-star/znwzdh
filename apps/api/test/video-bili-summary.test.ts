/**
 * B 站视频「问 AI」摘要（POST /api/videos/bili-summary）的硬约束测试：
 *
 *  1. 摘要只依据真实资料——提示词里只有标题、简介、章节、字幕摘录，
 *     超长资料被截断，来源清单与实际用到的资料一致；
 *  2. 没有可用资料时如实 400，不出假摘要；bvid 格式不对也 400；
 *  3. 未配置模型密钥时不崩：mode:"local" + degraded:"unconfigured"，
 *     摘要为 null，简介与章节当原文要点原样下发（不冒充摘要）；
 *  4. 响应永远带「非全文稿」标注。
 *
 * 注意：本文件不测真实模型调用（本机无 LLM 密钥，模型侧由
 * ai-chat/ai-find 的同构路径覆盖）；只测资料收敛、校验与降级。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  buildVideoSummaryMaterial,
  buildVideoSummaryPrompt,
  VIDEO_SUMMARY_NOTE,
} from "../src/routes/video-bili-summary.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-bili-summary-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

const FULL = {
  bvid: "BV1114y1C7Uf",
  title: "PostgreSQL 中 autovacuum 的优化",
  description: "本期讲 PostgreSQL 自动清理的原理与调优，附课件领取方式。",
  chapters: [
    { title: "什么是 autovacuum", startSec: 0 },
    { title: "调优参数", startSec: 300 },
  ],
  transcript: [
    { startSec: 5, text: "大家好，今天讲 autovacuum。" },
    { startSec: 65, text: "先看它什么时候触发。" },
  ],
};

describe("资料收敛 buildVideoSummaryMaterial", () => {
  it("三类资料都进来源清单", () => {
    const m = buildVideoSummaryMaterial(FULL);
    expect(m).not.toBeNull();
    expect(m!.sources).toEqual(["desc", "chapters", "transcript"]);
    expect(m!.title).toBe(FULL.title);
  });

  it("只有标题、其余资料全空时返回 null（不足以做摘要）", () => {
    expect(buildVideoSummaryMaterial({ title: "只有标题" })).toBeNull();
    expect(buildVideoSummaryMaterial({ title: "只有标题", description: "   " })).toBeNull();
  });

  it("简介超长被截断到预算内并带省略号", () => {
    const m = buildVideoSummaryMaterial({ title: "t", description: "啊".repeat(3000) });
    expect(m).not.toBeNull();
    expect(m!.description.length).toBeLessThanOrEqual(1501);
    expect(m!.description.endsWith("…")).toBe(true);
    expect(m!.sources).toEqual(["desc"]);
  });

  it("章节只取前 40 个标题", () => {
    const chapters = Array.from({ length: 80 }, (_, i) => ({ title: `第${i + 1}章`, startSec: i * 60 }));
    const m = buildVideoSummaryMaterial({ title: "t", chapters });
    expect(m!.chapterTitles).toHaveLength(40);
  });

  it("提示词只含给进的资料，不含评论之类没给的东西", () => {
    const prompt = buildVideoSummaryPrompt(buildVideoSummaryMaterial(FULL)!);
    expect(prompt.user).toContain(FULL.title);
    expect(prompt.user).toContain("本期讲 PostgreSQL");
    expect(prompt.user).toContain("什么是 autovacuum");
    expect(prompt.user).toContain("大家好，今天讲 autovacuum");
    expect(prompt.user).not.toContain("评论");
    expect(prompt.system).toContain("只写资料里有的内容");
  });
});

describe("路由 POST /api/videos/bili-summary", () => {
  it("没有资料时 400，不出假摘要", async () => {
    const res = await app.inject({ method: "POST", url: "/api/videos/bili-summary", payload: { title: "只有标题" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_REQUEST");
  });

  it("bvid 格式不对时 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/videos/bili-summary",
      payload: { ...FULL, bvid: "BV123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("未配模型密钥时降级：mode local + degraded unconfigured + 摘要为 null + 原文要点原样下发", async () => {
    const res = await app.inject({ method: "POST", url: "/api/videos/bili-summary", payload: FULL });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("local");
    expect(body.degraded).toBe("unconfigured");
    expect(body.summary).toBeNull();
    expect(body.sources).toEqual(["desc", "chapters", "transcript"]);
    expect(body.note).toBe(VIDEO_SUMMARY_NOTE);
    expect(body.note).toContain("非全文稿");
    expect(body.fallback.description).toContain("本期讲 PostgreSQL");
    expect(body.fallback.chapters).toEqual(["什么是 autovacuum", "调优参数"]);
  });
});
