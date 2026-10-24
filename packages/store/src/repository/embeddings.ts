import type { Repository } from "../repository.ts";
import { hashSiteId, pluginVectorId, vectorToBlob } from "../vector/types.ts";

export async function saveEmbedding(repo: Repository, siteId: string, model: string, vector: Float32Array): Promise<void> {
  // 过 vectorToBlob：非有限值会在 BLOB 里静默存活，之后 rehydrate
  // 把它灌回 vec0，整个 KNN 索引的距离都变成 NaN 且不报错
  const buf = vectorToBlob(vector);
  await repo.run(
    `INSERT INTO embeddings (site_id, model, dim, vector, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT (site_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector, updated_at = excluded.updated_at`,
    [siteId, model, vector.length, buf, Date.now()],
  );
}

/**
 * 单条语句的向量批量写入分片。
 *
 * 每行 5 个绑定参数，100 行 = 500 参数——对 SQLite 老构建的 999 上限留出余量，
 * 也远低于 PostgreSQL 的 65535。再大就要靠多语句，单语句的原子性收益会被抵消。
 */
const EMBEDDING_UPSERT_CHUNK = 100;

/**
 * 批量写入站点向量（同一事务语义，一条多值 UPSERT）。
 *
 * 背景：`indexSitesBatch` 原先是「事务内逐条 saveEmbedding」——200 条导入就是
 * 200 次 INSERT + 一个长事务。改成多值 UPSERT 后往返次数降到 2 次（200 条）。
 *
 * 语义与 `saveEmbedding` 严格一致，包括 `vectorToBlob` 的非有限值拦截：
 * NaN/Infinity 一旦进了 BLOB，rehydrate 后会让整个 KNN 索引的距离变成 NaN
 * 且不报错，所以校验必须保留在写入前，而不是依赖调用方。
 */
export async function saveEmbeddingsBatch(
  repo: Repository,
  records: Array<{ siteId: string; model: string; vector: Float32Array }>,
): Promise<void> {
  if (records.length === 0) return;
  const now = Date.now();
  for (let i = 0; i < records.length; i += EMBEDDING_UPSERT_CHUNK) {
    const slice = records.slice(i, i + EMBEDDING_UPSERT_CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    for (const record of slice) {
      const buf = vectorToBlob(record.vector);
      values.push("(?,?,?,?,?)");
      params.push(record.siteId, record.model, record.vector.length, buf, now);
    }
    await repo.run(
      `INSERT INTO embeddings (site_id, model, dim, vector, updated_at) VALUES ${values.join(",")}
       ON CONFLICT (site_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector, updated_at = excluded.updated_at`,
      params,
    );
  }
}

/**
 * 读取持久层向量，可按模型/维度过滤。
 *
 * 过滤是必要的：换模型或换维度后旧向量仍在 embeddings 表里，若全量灌进
 * vec0，维度不符的记录会被 rehydrate 跳过，但计数已把它算进去 ——
 * 于是「表里条数」永远对不上「实际灌入条数」，每次启动都触发全量重建；
 * 若维度恰好相同，旧模型的向量则会混入 KNN，污染检索结果。
 */
export async function savedEmbeddings(
  repo: Repository,
  filter?: { model?: string; dim?: number },
): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.model) {
    conditions.push("model = ?");
    params.push(filter.model);
  }
  if (filter?.dim) {
    conditions.push("dim = ?");
    params.push(filter.dim);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = await repo.raw(`SELECT site_id AS siteId, vector FROM embeddings${where}`, params);
  const out: Array<{ key: number; siteId: string; vector: Float32Array }> = [];
  for (const r of rows) {
    const buf = r.vector as Buffer | Uint8Array | null;
    if (!buf) continue;
    const bytes = buf instanceof Uint8Array ? buf : Buffer.from(buf as ArrayBuffer);
    const copy = Buffer.from(bytes);
    out.push({
      key: hashSiteId(String(r.siteId)),
      siteId: String(r.siteId),
      vector: new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4)),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 插件向量：与站点同构，但落在独立的 plugin_embeddings 表 / plugins_vec 表
 * ------------------------------------------------------------------ */

export async function savePluginEmbedding(repo: Repository, slug: string, model: string, vector: Float32Array): Promise<void> {
  // 与 saveEmbedding 同口径：非有限值会在 BLOB 里静默存活，之后 rehydrate
  // 灌回 vec0，整个 KNN 索引的距离都变成 NaN 且不报错
  const buf = vectorToBlob(vector);
  await repo.run(
    `INSERT INTO plugin_embeddings (slug, model, dim, vector, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT (slug) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector, updated_at = excluded.updated_at`,
    [slug, model, vector.length, buf, Date.now()],
  );
}

export async function savedPluginEmbeddings(
  repo: Repository,
  filter?: { model?: string; dim?: number },
): Promise<Array<{ key: number; siteId: string; vector: Float32Array }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.model) {
    conditions.push("model = ?");
    params.push(filter.model);
  }
  if (filter?.dim) {
    conditions.push("dim = ?");
    params.push(filter.dim);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = await repo.raw(`SELECT slug, vector FROM plugin_embeddings${where}`, params);
  const out: Array<{ key: number; siteId: string; vector: Float32Array }> = [];
  for (const r of rows) {
    const buf = r.vector as Buffer | Uint8Array | null;
    if (!buf) continue;
    const bytes = buf instanceof Uint8Array ? buf : Buffer.from(buf as ArrayBuffer);
    const copy = Buffer.from(bytes);
    const siteId = pluginVectorId(String(r.slug));
    out.push({
      key: hashSiteId(siteId),
      siteId,
      vector: new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4)),
    });
  }
  return out;
}

export async function getPluginEmbedding(repo: Repository, slug: string): Promise<Float32Array | null> {
  const rows = await repo.raw("SELECT vector FROM plugin_embeddings WHERE slug = ? LIMIT 1", [slug]);
  const buf = rows[0]?.vector as Buffer | Uint8Array | null | undefined;
  if (!buf) return null;
  const bytes = buf instanceof Uint8Array ? buf : Buffer.from(buf as ArrayBuffer);
  const copy = Buffer.from(bytes);
  if (copy.byteLength < 4) return null;
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4));
}

export async function deletePluginEmbedding(repo: Repository, slug: string): Promise<void> {
  await repo.run("DELETE FROM plugin_embeddings WHERE slug = ?", [slug]);
}
