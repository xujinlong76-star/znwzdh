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
import { createLinUCBModel, deserializeLinUCB, type LinUCBModel } from "@navhub/core";
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
  fts: FullTextStore | null;
  embedding: EmbeddingService | null;
  bandit: LinUCBModel;
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
  let fts: FullTextStore | null = null;

  if (config.mode === "lite") {
    try {
      const sqliteVec: any = await import("sqlite-vec");
      sqliteVec.load(db.sqlite as never);
      const store = new SqliteVecStore({ db: db.sqlite as never, dim: config.embedding.dim });
      store.init();
      // 进程重启后重建 key -> siteId 映射（vec0 表里只有整数键）
      const saved = await repo.savedEmbeddings();
      store.rehydrate(saved.map((s) => ({ key: s.key, siteId: s.siteId })));
      vectors = store;
      notes.push("sqlite-vec 已加载，向量维度 " + config.embedding.dim);
    } catch (err) {
      notes.push("sqlite-vec 不可用，语义检索降级：" + msg(err));
      const { MemoryVectorStore } = await import("@navhub/store");
      vectors = new MemoryVectorStore(config.embedding.dim);
    }
    try {
      const store = new SqliteFtsStore(db.sqlite as never);
      store.init(true);
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
      notes.push("pgvector (HNSW) 就绪");
    } catch (err) {
      notes.push("pgvector 不可用，语义检索降级：" + msg(err));
      const { MemoryVectorStore } = await import("@navhub/store");
      vectors = new MemoryVectorStore(config.embedding.dim);
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
    });
    notes.push("embedding 服务已装配（惰性加载：" + config.embedding.model + " via " + config.embedding.endpoint + "）");
  } else {
    notes.push("embedding 已被配置关闭，语义通道不可用");
  }

  // ---- LinUCB 动态上下文多臂机 ----
  let bandit: LinUCBModel = createLinUCBModel();
  try {
    const saved = await repo.getSetting("linucb_bandit_model");
    if (saved) {
      bandit = deserializeLinUCB(saved);
      notes.push("LinUCB 多臂机权重已从持久化存储恢复");
    } else {
      notes.push("LinUCB 多臂机已就绪（先验权重自适应引导）");
    }
  } catch {
    notes.push("LinUCB 多臂机初始化为基准状态");
  }

  const search = new SearchEngine({
    db,
    fts,
    vectors,
    embed: embedding ? (text: string) => embedding!.encode(text) : null,
    bandit,
  });

  const capabilities: Capabilities = {
    semantic: Boolean(embedding && vectors),
    fts: Boolean(fts),
    llm: Boolean(config.llm.apiKey),
    notes,
  };

  return {
    config, db, repo, search, vectors, fts, embedding, bandit, capabilities,
    async close() { await db.close(); },
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
