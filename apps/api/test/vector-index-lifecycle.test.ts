/**
 * 向量索引生命周期（AI-5）：覆盖率按「当前模型 + 当前维度」判定，全量重建清理换代残留。
 *
 * 缺陷背景（改造前）：
 *   - 健康巡检的 `sitesMissingEmbedding` 只看 `NOT EXISTS (SELECT 1 FROM embeddings
 *     WHERE site_id = s.id)`。换模型（如 512 维 bge → 768 维别的模型）后旧向量还
 *     在表里，巡检会把「一条新向量都没有的站点」报成已覆盖。
 *   - 全量 reindex 只 upsert 当前模型向量，从不清理旧模型行：表永久膨胀，且哪天
 *     配置回滚到旧模型，旧向量会以「陈旧语义」悄悄复活。
 *
 * 口径：
 *   - 增量重建（siteId/siteIds）不碰全表——不能替并行写入的其他站点做决定；
 *   - vectors:false 的轻量重建也不碰（没有重建就不会补回，删了纯损失）；
 *   - 只在 embedding 真的可用时清（没有模型就写不回向量）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";

let dir: string;
let ctx: AppContext;
let siteA = "";
let siteB = "";

const MODEL = "gate-model";
const DIM = 4;

const fakeEmbedding = {
  dim: DIM,
  model: MODEL,
  async encode() {
    return new Float32Array([1, 0, 0, 0]);
  },
  async encodeBatch(texts: string[]) {
    return texts.map((_, i) => new Float32Array([1, i, 0, 0]));
  },
  ready: () => true,
  async warmup() {
    return true;
  },
};

async function insertEmbedding(siteId: string, model: string, dim: number): Promise<void> {
  await ctx.repo.run(
    "INSERT OR REPLACE INTO embeddings (site_id, model, dim, vector, updated_at) VALUES (?,?,?,?,?)",
    [siteId, model, dim, null, Date.now()],
  );
}

async function embeddingRows(): Promise<Array<{ siteId: string; model: string; dim: number }>> {
  const rows = await ctx.repo.raw("SELECT site_id AS siteId, model, dim FROM embeddings ORDER BY site_id");
  return rows.map((r) => ({ siteId: String(r.siteId), model: String(r.model), dim: Number(r.dim) }));
}

async function lastAuditDiff(): Promise<Record<string, unknown>> {
  const rows = await ctx.repo.raw(
    "SELECT diff FROM audit_logs WHERE action = 'user_data.audit' ORDER BY created_at DESC LIMIT 1",
  );
  return JSON.parse(String(rows[0]?.diff ?? "{}"));
}

async function lastReindexMeta(): Promise<Record<string, unknown>> {
  const rows = await ctx.repo.raw("SELECT meta FROM events WHERE kind = 'reindex' ORDER BY id DESC LIMIT 1");
  return JSON.parse(String(rows[0]?.meta ?? "{}"));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-vector-lifecycle-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "lifecycle.db"),
      embedding: {
        model: MODEL,
        endpoint: "https://hf-mirror.com",
        dtype: "q8",
        cacheDir: join(dir, "models"),
        dim: DIM,
        enabled: true,
      },
      corsOrigins: ["*"],
    }),
  );
  const cat = await ctx.repo.createCategory({ title: "生命周期测试" });
  siteA = (await ctx.repo.createSite({ url: "https://life-a.example.com", title: "生命周期 A", categoryId: cat.id })).id;
  siteB = (await ctx.repo.createSite({ url: "https://life-b.example.com", title: "生命周期 B", categoryId: cat.id })).id;
  // 巡检与重建都要真的编码向量：替换为确定性假实现，不加载真实模型
  ctx.embedding = fakeEmbedding as never;
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("向量生命周期", () => {
  it("健康巡检：覆盖率按当前模型/维度判定，并单独报出旧模型残留", async () => {
    await ctx.repo.run("DELETE FROM audit_logs");
    await ctx.repo.run("DELETE FROM embeddings");
    await insertEmbedding(siteA, MODEL, DIM); // 已覆盖
    await insertEmbedding(siteB, "old-model", DIM); // 有行，但模型不对 ⇒ 等于没覆盖
    const runner = new JobRunner(ctx, { enableCron: false });
    await ctx.repo.enqueueJob("user_data_audit", {});
    await runner.tick();

    const diff = await lastAuditDiff();
    // 只看 site_id 存在性的旧实现会报 0；正确实现必须报 1（siteB 没有当前模型向量）
    expect(Number(diff.sitesMissingEmbedding)).toBe(1);
    expect(Number(diff.staleEmbeddings)).toBe(1);
    expect(diff.embeddingModel).toBe(MODEL);
    expect(Number(diff.embeddingDim)).toBe(DIM);
  });

  it("全量 reindex：清掉旧模型残留，并用当前模型重灌所有站点", async () => {
    // 回收站站点：全量重建只覆盖 deleted_at IS NULL，行不会被重建覆盖——
    // 只有 purge 能清掉它。没有这条，「删除」可能被「重灌覆盖」伪装成通过。
    const cat = await ctx.repo.createCategory({ title: "生命周期回收站" });
    const trashed = (await ctx.repo.createSite({ url: "https://life-trashed.example.com", title: "生命周期 C", categoryId: cat.id })).id;
    await ctx.repo.deleteSite(trashed);
    await insertEmbedding(trashed, "old-model", DIM);

    const runner = new JobRunner(ctx, { enableCron: false });
    await ctx.repo.enqueueJob("reindex", { vectors: true });
    await runner.tick();

    const rows = await embeddingRows();
    expect(rows.map((r) => r.siteId).sort()).toEqual([siteA, siteB].sort());
    expect(rows.some((r) => r.siteId === trashed)).toBe(false);
    for (const r of rows) {
      expect(r.model).toBe(MODEL);
      expect(r.dim).toBe(DIM);
    }
    const meta = await lastReindexMeta();
    expect(Number(meta.staleEmbeddingsPurged)).toBe(2);
    // 向量内核也真的写入了（不是只落库）
    expect(await ctx.vectors.count()).toBe(2);
  });

  it("增量 reindex（siteIds）不动全表：其它站点的旧模型行原样保留", async () => {
    await insertEmbedding(siteA, "old-model", DIM);
    const runner = new JobRunner(ctx, { enableCron: false });
    await ctx.repo.enqueueJob("reindex", { siteIds: [siteB], vectors: true });
    await runner.tick();

    const rows = await embeddingRows();
    const rowA = rows.find((r) => r.siteId === siteA);
    expect(rowA?.model).toBe("old-model");
    const meta = await lastReindexMeta();
    expect(Number(meta.staleEmbeddingsPurged ?? 0)).toBe(0);
  });

  it("插件全量重建同样清掉旧模型残留", async () => {
    await ctx.repo.run(
      "INSERT OR REPLACE INTO plugin_embeddings (slug, model, dim, vector, updated_at) VALUES (?,?,?,?,?)",
      ["stale-plugin", "old-model", DIM, null, Date.now()],
    );
    const runner = new JobRunner(ctx, { enableCron: false });
    await ctx.repo.enqueueJob("reindex", { targets: ["plugins"] });
    await runner.tick();

    const rows = await ctx.repo.raw("SELECT slug FROM plugin_embeddings");
    expect(rows).toHaveLength(0);
    const meta = await lastReindexMeta();
    expect(Number(meta.stalePluginEmbeddingsPurged)).toBe(1);
  });

  it("vectors:false 的轻量重建不清残留（没有重建就不会补回，删了纯损失）", async () => {
    const runner = new JobRunner(ctx, { enableCron: false });
    await ctx.repo.enqueueJob("reindex", { vectors: false });
    await runner.tick();

    const rows = await embeddingRows();
    expect(rows.find((r) => r.siteId === siteA)?.model).toBe("old-model");
    const meta = await lastReindexMeta();
    expect(Number(meta.staleEmbeddingsPurged ?? 0)).toBe(0);
  });
});
