/**
 * 应用上下文装配。
 *
 * 这是把「配置 + 数据库 + 检索 + AI」组装成一个可用系统的地方，
 * 也是双模式（lite / standard）差异被消化掉的唯一位置。
 *
 * 装配策略：**能力可选、失败不致命**。
 *   - sqlite-vec 加载失败 -> 退化为「无语义通道」，关键词/拼音/全文照常
 *   - embedding 模型缺失   -> 同上，并在 /api/health 里如实上报
 *   - LLM 无 Key          -> 富化走启发式，并在结果里标 provenance=heuristic
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createEmbeddingService, type EmbeddingService } from "@navhub/ai";
import { Repository, SearchEngine, SqliteFtsStore, SqliteVecStore, openDb, type Db, type FullTextStore, type VectorStore } from "@navhub/store";
import type { AppConfig } from "./config.ts";

export interface Capabilities {
  semantic: boolean;
  fts: boolean;
  llm: boolean;
  notes: string[];
}

export interface AppContext {
  config: AppConfig;
  db: Db;
  repo: Repository;
  search: SearchEngine;
  vectors: VectorStore;
  /** 插件向量独立表（plugins_vec）：与站点语义检索互不挤占 top-N */
  pluginVectors: VectorStore;
  fts: FullTextStore | null;
  embedding: EmbeddingService | null;
  capabilities: Capabilities;
  close(): Promise<void>;
}

export async function createContext(config: AppConfig): Promise<AppContext> {
  const notes: string[] = [];

  // ---- 数据库 ----
  if (config.mode === "lite") {
    const dir = dirname(config.sqlitePath);
    if (dir && dir !== "." && dir !== "/") mkdirSync(dir, { recursive: true });
  }
  const db = await openDb({
    dialect: config.mode === "lite" ? "sqlite" : "pg",
    sqlitePath: config.sqlitePath,
    databaseUrl: config.databaseUrl ?? undefined,
  });

  const repo = new Repository(db);

  // ---- 向量存储 ----
  let vectors: VectorStore;
  let pluginVectors: VectorStore;
  let fts: FullTextStore | null = null;

  if (config.mode === "lite") {
    try {
      const sqliteVec: any = await import("sqlite-vec");
      sqliteVec.load(db.sqlite as never);
      const store = new SqliteVecStore({ db: db.sqlite as never, dim: config.embedding.dim });
      store.init();
      // 进程重启后重建 key -> siteId 映射，并在 vec0 表为空（如刚迁移）时用向量重灌。
      // savedEmbeddings() 返回 { key, siteId, vector }，正好是 VectorRecord[]。
      const saved = await repo.savedEmbeddings();
      store.rehydrate(saved);
      vectors = store;
      // 插件向量：同一数据库、独立 vec0 表；持久层 plugin_embeddings 为唯一事实源
      const pluginStore = new SqliteVecStore({ db: db.sqlite as never, dim: config.embedding.dim, table: "plugins_vec" });
      pluginStore.init();
      pluginStore.rehydrate(await repo.savedPluginEmbeddings());
      pluginVectors = pluginStore;
      notes.push("sqlite-vec 已加载，向量维度 " + config.embedding.dim);
    } catch (err) {
      notes.push("sqlite-vec 不可用，语义检索降级：" + msg(err));
      const { MemoryVectorStore } = await import("@navhub/store");
      vectors = new MemoryVectorStore(config.embedding.dim);
      pluginVectors = new MemoryVectorStore(config.embedding.dim);
    }
    try {
      const store = new SqliteFtsStore(db.sqlite as never);
      // 首次初始化虚拟表结构，但**不**每次启动都强制全表 DELETE+INSERT 重建：
      // 增量写入已由 Repository.createSite/updateSite/deleteSite 维护，
      // 仅当 sites 表非空而 sites_fts 为空（例如首次升级）时才触发全量 rebuild。
      store.init(false);
      const siteCount = (db.sqlite!.prepare("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL").get() as { n: number })?.n ?? 0;
      if (siteCount > 0) {
        const ftsCount = (db.sqlite!.prepare("SELECT COUNT(*) AS n FROM sites_fts").get() as { n: number })?.n ?? 0;
        if (ftsCount === 0) store.rebuild();
      }
      fts = store;
      notes.push("FTS5 全文索引就绪（CJK 二元分词）");
    } catch (err) {
      notes.push("FTS5 不可用，全文通道降级：" + msg(err));
      fts = null;
    }
  } else {
    try {
      const { PgVectorStore } = await import("@navhub/store");
      const store = new PgVectorStore({ db: db.pg as never, dim: config.embedding.dim });
      await store.init();
      vectors = store;
      const pluginStore = new PgVectorStore({ db: db.pg as never, dim: config.embedding.dim, table: "plugins_vec" });
      await pluginStore.init();
      pluginVectors = pluginStore;
      notes.push("pgvector (HNSW) 就绪");
    } catch (err) {
      notes.push("pgvector 不可用，语义检索降级：" + msg(err));
      const { MemoryVectorStore } = await import("@navhub/store");
      vectors = new MemoryVectorStore(config.embedding.dim);
      pluginVectors = new MemoryVectorStore(config.embedding.dim);
    }
    // standard 模式的全文通道：PostgreSQL tsvector（语料仍用 navhub 的 CJK 二元分词）
    try {
      const { PgFtsStore } = await import("@navhub/store");
      const store = new PgFtsStore(db.pg as never);
      await store.init();
      fts = store;
      notes.push("PostgreSQL tsvector 全文索引就绪（CJK 二元分词 + GIN 表达式索引）");
    } catch (err) {
      notes.push("PostgreSQL 全文索引不可用：" + msg(err));
      fts = null;
    }
  }

  // ---- 本地 embedding（惰性加载，不阻塞启动） ----
  let embedding: EmbeddingService | null = null;
  if (config.embedding.enabled) {
    embedding = createEmbeddingService({
      model: config.embedding.model,
      endpoint: config.embedding.endpoint,
      dtype: config.embedding.dtype,
      cacheDir: config.embedding.cacheDir,
      dim: config.embedding.dim,
      useWorker: config.embedding.useWorker,
    });
    notes.push("embedding 服务已装配（惰性加载：" + config.embedding.model + " via " + config.embedding.endpoint + "，health 在 ready() 前如实报 semantic=false）");
  } else {
    notes.push("embedding 已被配置关闭，语义通道不可用");
  }

  const search = new SearchEngine({
    db,
    repo,
    fts,
    vectors,
    embed: embedding ? (text: string) => embedding!.encode(text) : null,
  });

  try {
    await search.initLinUCB();
  } catch (err) {
    notes.push("LinUCB 初始化异常（使用默认权重）：" + msg(err));
  }

  const capabilities: Capabilities = {
    // embedding 为惰性加载：装配时 ready() 必为 false，此处如实上报 false，
    // warmup/首次 encode 成功后由 /api/health 动态读取 ready()（见 server.ts 健康端点）。
    semantic: Boolean(embedding?.ready() && vectors),
    fts: Boolean(fts),
    llm: Boolean(config.llm.apiKey),
    notes,
  };

  return {
    config, db, repo, search, vectors, pluginVectors, fts, embedding, capabilities,
    async close() {
      try {
        await search.flushLinUCB();
      } catch {
        // ignore during shutdown
      }
      await db.close();
      if (embedding?.close) await embedding.close();
    },
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
