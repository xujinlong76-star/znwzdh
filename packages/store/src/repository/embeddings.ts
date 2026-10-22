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
