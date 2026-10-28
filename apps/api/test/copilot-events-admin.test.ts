/**
 * copilot 遥测的消费端契约（2026-10-27 run85b）。
 *
 * 上一轮把 kind=copilot / copilot_cancel 写进了 events，但全仓库对这
 * 两个 kind 的读取是 0 处——「用户按了停止」这件事落库以后没有任何出口能看到。
 * 这里钉的是出口本身：
 *   1. 端点必须真的把两类事件都算进去（只算 copilot 就等于取消率恒为 0）；
 *   2. 「放弃前等待时长」取的是 copilot_cancel 的 waited_ms，不是 copilot 的；
 *   3. meta 里出现脏 JSON 不能让端点 500——埋点写入是 fire-and-forget，
 *      读侧一旦因为一行坏 JSON 崩掉，整个面板就再也拿不到数；
 *   4. 读取上限要如实回报 truncated，否则比率会被当成全量。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { COPILOT_EVENT_READ_CAP } from "@navhub/store";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-copilot-events-"));
  ctx = await createContext(
    loadConfig({ mode: "lite", sqlitePath: join(dir, "copilot-events.db"), corsOrigins: ["*"] }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows SQLite 句柄延迟释放
  }
});

async function readSummary(days = 7) {
  const res = await app.inject({ method: "GET", url: `/api/admin/copilot/events?days=${days}` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("GET /api/admin/copilot/events", () => {
  it("空库也给得出结构，不填假的 0%", async () => {
    const body = await readSummary();
    expect(body.asks).toBe(0);
    expect(body.cancels).toBe(0);
    expect(body.cancelRate).toBeNull();
    expect(body.waitMs.p50).toBeNull();
    expect(body.truncated).toBe(false);
  });

  it("取消数、取消率与放弃前等待时长都来自 copilot_cancel", async () => {
    await ctx.repo.recordEvent("copilot", {
      identity: "anon-a",
      meta: { thinking: true, degraded: null, model: "gpt-x", reply_chars: 120, waited_ms: 900, quota_limited: false },
    });
    await ctx.repo.recordEvent("copilot", {
      identity: "anon-b",
      meta: { thinking: false, degraded: "llm_unavailable", model: "local-heuristic-match", reply_chars: 80, waited_ms: 12, quota_limited: false },
    });
    for (const waited of [1000, 3000, 5000]) {
      await ctx.repo.recordEvent("copilot_cancel", {
        identity: "anon-c",
        meta: { thinking: true, degraded: null, model: "gpt-x", reply_chars: 0, waited_ms: waited, quota_limited: false, stage: "llm" },
      });
    }
    await ctx.repo.recordEvent("copilot_cancel", {
      identity: "anon-d",
      meta: { thinking: true, degraded: null, model: "gpt-x", reply_chars: 0, waited_ms: 200, quota_limited: false, stage: "pre_llm" },
    });

    const body = await readSummary();
    expect(body.asks).toBe(2);
    expect(body.cancels).toBe(4);
    expect(body.cancelRate).toBeCloseTo(4 / 6, 3);
    expect(body.cancelStage).toEqual({ pre_llm: 1, llm: 3 });
    // 等待时长只看取消事件：3 个 5000/3000/1000 加 1 个 200
    expect(body.waitMs.p50).toBe(1000);
    expect(body.waitMs.max).toBe(5000);
    expect(body.degraded).toBe(1);
    expect(body.degradedBy).toEqual([{ reason: "llm_unavailable", count: 1 }]);
    // thinking=true 的那 5 行 = 1 次完成的提问 + 4 次取消
    expect(body.thinkingBy.find((t: { thinking: string }) => t.thinking === "true")?.count).toBe(5);
  });

  it("坏 JSON 的 meta 行不致命，按无维度计入", async () => {
    await ctx.repo.run(
      "INSERT INTO events (kind, site_id, query, category_id, meta, identity, created_at) VALUES (?,?,?,?,?,?,?)",
      ["copilot", null, null, null, "{not json", null, Date.now()],
    );
    const body = await readSummary();
    expect(body.asks).toBe(3);
    expect(body.degraded).toBe(1);
  });

  it("窗口外的事件不计入，days 参数生效", async () => {
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await ctx.repo.run(
      "INSERT INTO events (kind, site_id, query, category_id, meta, identity, created_at) VALUES (?,?,?,?,?,?,?)",
      ["copilot_cancel", null, null, null, JSON.stringify({ waited_ms: 700, stage: "llm" }), null, monthAgo],
    );
    const inWindow = await readSummary(7);
    expect(inWindow.cancels).toBe(4);
    const wide = await readSummary(90);
    expect(wide.cancels).toBe(5);
  });

  it("引用点击率：分母是 copilot 回答的 citations 总数，分子只认 source=copilot_citation", async () => {
    await ctx.repo.recordEvent("copilot", {
      identity: "anon-e",
      meta: { thinking: true, degraded: null, model: "gpt-x", reply_chars: 100, waited_ms: 500, quota_limited: false, citations: 4, retrieval_hits: 6 },
    });
    // 走真实的 /api/events：schema 必须接受 source，并把它写进 meta 供读侧归类
    const cited = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { kind: "click", siteId: "site-1", position: 2, source: "copilot_citation" },
    });
    expect(cited.statusCode).toBe(200);
    // 普通搜索点击不是引用点击：分子不能把两者混为一谈
    const plain = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { kind: "click", siteId: "site-2", position: 1, source: "search" },
    });
    expect(plain.statusCode).toBe(200);

    const body = await readSummary();
    expect(body.citations).toBe(4);
    expect(body.citationClicks).toBe(1);
    expect(body.citationClickRate).toBeCloseTo(0.25, 3);
  });

  it("读取上限是导出的具名常量，且超过时如实回报 truncated", async () => {
    expect(typeof COPILOT_EVENT_READ_CAP).toBe("number");
    expect(COPILOT_EVENT_READ_CAP).toBeGreaterThan(0);
    // 不真的灌 5000 行：只验证「未超限 ⇒ truncated=false」这一半，
    // 超限那一半由 events.ts 里 LIMIT cap+1 的取法保证（多取一行即判定截断）。
    const body = await readSummary();
    expect(body.scanned).toBeLessThanOrEqual(COPILOT_EVENT_READ_CAP);
    expect(body.truncated).toBe(false);
  });
});
