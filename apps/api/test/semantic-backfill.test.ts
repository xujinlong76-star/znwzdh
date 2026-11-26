/**
 * U-369 语义通道向量冷启动补齐。
 *
 * 前态（纯 main be8fb8c5 已证实，见 verify-logs B4-SEMANTIC-REINDEX）：
 *  - `reindex` 的 cron 是 `NOT_SCHEDULED` 且不在 `DEFAULT_CRON_SCHEDULES` 里；
 *  - `index-site.ts` 无 embedding 时直接 return；
 *  - 启用 embedding 后跑两轮 tick 也无任何 reindex 入队、缺失数不动。
 *
 * 本文件验证修复后的行为（真实 SQLite + 真实 JobRunner tick + 假编码器，
 * 不下载模型；编码器只替换 `ctx.embedding`，config 仍走真实路径）：
 *  - 覆盖率三数现算；仅补缺失（已有的向量原样保留）；
 *  - `ensureSemanticVectorBackfill` 入队后 tick 真把缺失补到 0；
 *  - 重复触发幂等（已有未跑完的 reindex 时不重复入队）；
 *  - 换模型（改 config.embedding.model）后全部重新缺失、再次触发即补齐；
 *  - embedding 关闭时不入队；管理端 GET/POST 路由走通。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateJobPayload } from "@navhub/core";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";
import {
  ensureSemanticVectorBackfill,
  getSemanticVectorCoverage,
} from "../src/semantic-backfill.ts";
import type { EmbeddingService } from "@navhub/ai";
import { buildServer } from "../src/server.ts";

const MODEL = "Xenova/bge-small-zh-v1.5";
const NEW_MODEL = "Xenova/bge-m3";
const DIM = 512;

/** 确定性假编码器：同一文本永远同一向量，不同文本大概率不同向量。 */
function fakeEmbedding(): EmbeddingService {
  const vecFor = (text: string) => {
    const v = new Float32Array(DIM);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    for (let i = 0; i < DIM; i++) {
      h = Math.imul(h ^ (h >>> 15), 2246822519);
      h = Math.imul(h ^ (h >>> 13), 3266489917);
      v[i] = ((h ^= h >>> 16) >>> 0) / 4294967295 - 0.5;
    }
    return v;
  };
  return {
    dim: DIM,
    model: MODEL,
    encode: async (text: string) => vecFor(text),
    encodeBatch: async (texts: string[]) => texts.map(vecFor),
    ready: () => true,
    warmup: async () => true,
  };
}

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let siteIds: string[] = [];
let preseededSiteId = "";
let preseededVector: Buffer;

async function readStoredVector(siteId: string): Promise<Buffer | null> {
  const rows = await ctx.repo.raw("SELECT vector FROM embeddings WHERE site_id = ?", [siteId]);
  const buf = rows[0]?.vector as Buffer | Uint8Array | null | undefined;
  if (!buf) return null;
  return Buffer.from(buf);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-u369-"));
  // enabled:true 走真实 config 路径；真实服务是惰性加载（不 warmup 不下载），
  // 下面立刻换成假编码器，测试全程不触网。
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "u369.db"),
    embedding: { model: MODEL, endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: DIM, enabled: true },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  (ctx as unknown as { embedding: EmbeddingService }).embedding = fakeEmbedding();
  app = await buildServer(ctx);
  await app.ready();

  await ctx.repo.createCategory({ id: "u369", title: "补齐类目" });
  for (let i = 1; i <= 5; i++) {
    const site = await ctx.repo.createSite({ url: `https://example.com/u369-${i}`, title: `补齐站 ${i}`, categoryId: "u369" });
    siteIds.push(site.id);
  }
  // 预置一条现成向量：补齐必须只动缺失的 4 条，这条原样保留。
  preseededSiteId = siteIds[0]!;
  const fake = fakeEmbedding();
  const vec = await fake.encode("seed");
  await ctx.repo.saveEmbedding(preseededSiteId, MODEL, vec);
  preseededVector = Buffer.from(new Float32Array(vec).buffer);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("覆盖率现算与仅补缺失", () => {
  it("5 站、1 条现成向量 → 缺失 4（现算，非硬编码）", async () => {
    const coverage = await getSemanticVectorCoverage(ctx);
    console.info("[u369] coverage before backfill:", JSON.stringify(coverage));
    expect(coverage).toMatchObject({ enabled: true, model: MODEL, dim: DIM, total: 5, withVector: 1, missing: 4 });
  });

  it("ensure 入队一条 missing-only reindex；重复触发不重复入队；tick 后缺失归零", async () => {
    const first = await ensureSemanticVectorBackfill(ctx);
    console.info("[u369] first ensure:", JSON.stringify(first));
    expect(first.enqueued).toBe(true);
    expect(first.reason).toBe("enqueued");
    expect(first.missing).toBe(4);
    expect(first.jobId).toBeTruthy();

    const second = await ensureSemanticVectorBackfill(ctx);
    expect(second).toMatchObject({ enqueued: false, reason: "reindex-already-queued", missing: 4 });
    const pending = await ctx.repo.listJobs("pending", 50);
    expect(pending.filter((j) => j.kind === "reindex")).toHaveLength(1);

    // 管理端 dry-run 口径：GET 看到缺失 4 与已入队的补齐任务。
    const getRes = await app.inject({ method: "GET", url: "/api/admin/semantic-coverage" });
    expect(getRes.statusCode).toBe(200);
    const coverageBody = getRes.json() as { missing: number; queuedBackfillJobId: string | null };
    expect(coverageBody.missing).toBe(4);
    expect(coverageBody.queuedBackfillJobId).toBe(first.jobId);

    // 入队的是 missing-only 任务，不是全量重建。
    const job = await ctx.repo.getJob(first.jobId!);
    expect((job!.payload as { missingVectorsOnly?: unknown }).missingVectorsOnly).toBe(true);

    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);
    const done = await ctx.repo.listJobs("done", 10);
    expect(done.some((j) => j.id === first.jobId)).toBe(true);

    const after = await getSemanticVectorCoverage(ctx);
    console.info("[u369] coverage after backfill tick:", JSON.stringify(after));
    expect(after).toMatchObject({ total: 5, withVector: 5, missing: 0 });

    // 仅补缺失：预置的那条向量字节级不变。
    expect(await readStoredVector(preseededSiteId)).toEqual(preseededVector);

    // 缺失归零后再次触发不再入队。
    const third = await ensureSemanticVectorBackfill(ctx);
    expect(third).toMatchObject({ enqueued: false, reason: "none-missing", missing: 0 });
  });

  it("换模型（改 config.embedding.model）后全部重新缺失，管理端 POST 再次触发即补齐", async () => {
    // 换模型走真实 config 路径：覆盖率按新模型现算，旧行不再匹配。
    ctx.config.embedding.model = NEW_MODEL;
    const coverage = await getSemanticVectorCoverage(ctx);
    console.info("[u369] coverage after model change:", JSON.stringify(coverage));
    expect(coverage).toMatchObject({ model: NEW_MODEL, total: 5, withVector: 0, missing: 5 });

    const postRes = await app.inject({ method: "POST", url: "/api/admin/semantic-coverage/backfill" });
    expect(postRes.statusCode).toBe(200);
    const body = postRes.json() as { enqueued: boolean; reason: string; missing: number; jobId: string | null };
    console.info("[u369] admin backfill POST after model change:", JSON.stringify(body));
    expect(body).toMatchObject({ enqueued: true, reason: "enqueued", missing: 5 });
    expect(body.jobId).toBeTruthy();

    const runner = new JobRunner(ctx);
    await runner.tick();

    const after = await getSemanticVectorCoverage(ctx);
    console.info("[u369] coverage after model-change backfill:", JSON.stringify(after));
    expect(after).toMatchObject({ total: 5, withVector: 5, missing: 0 });
    // 新模型行已落库（upsert 语义：同 site_id 一行，model 字段已换成新模型）。
    const rows = await ctx.repo.raw("SELECT DISTINCT model AS m FROM embeddings");
    expect(rows.map((r) => String(r.m))).toEqual([NEW_MODEL]);
  });
});

describe("embedding 关闭时不触发补齐", () => {
  it("ensure 返回 embedding-disabled，且无任何任务入队", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "navhub-u369-off-"));
    try {
      const config = loadConfig({
        mode: "lite",
        sqlitePath: join(dir2, "off.db"),
        embedding: { model: MODEL, endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir2, "models"), dim: DIM, enabled: false },
        llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
        fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
        corsOrigins: ["*"],
      });
      const offCtx = await createContext(config);
      try {
        await offCtx.repo.createCategory({ id: "u369off", title: "关闭类目" });
        await offCtx.repo.createSite({ url: "https://example.com/u369-off", title: "关闭站", categoryId: "u369off" });
        const result = await ensureSemanticVectorBackfill(offCtx);
        expect(result).toMatchObject({ enabled: false, enqueued: false, reason: "embedding-disabled", jobId: null });
        expect(result.total).toBe(1);
        expect(await offCtx.repo.listJobs(undefined, 10)).toHaveLength(0);
      } finally {
        await offCtx.close();
      }
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe("reindex payload schema", () => {
  it("接受 missingVectorsOnly，仍拒绝未知字段", () => {
    expect(validateJobPayload("reindex", { vectors: true, missingVectorsOnly: true }).ok).toBe(true);
    expect(validateJobPayload("reindex", { vectors: true, missingVectorsOnly: false }).ok).toBe(true);
    expect(validateJobPayload("reindex", { vectors: true, bogus: true }).ok).toBe(false);
  });
});
