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
import { createMailTransport, type MailTransport } from "@navhub/ai";
import { Repository, SearchEngine, SqliteFtsStore, SqliteVecStore, openDb, type Db, type FullTextStore, type PluginOps, type VectorStore } from "@navhub/store";
import type { AppConfig } from "./config.ts";
import { refreshLlmCapability } from "./llm-config.ts";
import { searchPluginsSemantic } from "./plugins-search.ts";
import { indexSitesBatch } from "./index-site.ts";
import { removePluginIndex } from "./index-plugin.ts";

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
  /** 邮件投递器：验证码/重置链接/通知外发的唯一出口 */
  mail: MailTransport;
  capabilities: Capabilities;
/**
   * 插件向量索引操作（MCP host-context 注入面）。
   *
   * 为什么必须在 ctx 上：MCP 的插件市场工具此前只声明了 `pluginOps?` 接口却
   **从未被任何启动器装配**——search_plugins 恒走 `unavailable` 降级，install
   * 后的向量索引也从不发生（D2 的 REST 通道能用是因为直接 import 实现）。
   * 这里是唯一装配点：MCP 与 REST 共用同一套实现（见 plugins-search.ts）。
   *
   * 类型 = `@navhub/store` 的 `PluginOps`（评审 P2-3 收敛）：此前本文件与
   * packages/mcp/src/host-context.ts 各写一份形状，靠结构检查兜底 —— 而 mcp 侧
   * 把 mode 放宽成 string，等于没有约束。现在两侧共享一份声明。
   */
  pluginOps: PluginOps;
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
    skipOrphanCleanup: config.skipOrphanCleanup,
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
      // 进程重启后重建 key -> siteId 映射，并在 vec0 表与持久层不一致时用向量重灌。
      // 只取当前模型/维度：换模型后旧向量不能混进 KNN，否则计数也会永久对不上。
const vectorFilter = { model: config.embedding.model, dim: config.embedding.dim };
      // 先只读 site_id 恢复映射；只有计数不一致（迁移 / 跨进程写 / 残留）时才拉全量
      // 向量重灌 —— 避免「计数一致」这一常态启动就把全部向量 BLOB 读进内存（O(N×dim)）。
      if (store.rehydrateIndex(await repo.savedEmbeddingIndex(vectorFilter))) {
        store.rebuildVectors(await repo.savedEmbeddings(vectorFilter));
      }
      vectors = store;
      // 插件向量：同一数据库、独立 vec0 表；持久层 plugin_embeddings 为唯一事实源
      const pluginStore = new SqliteVecStore({ db: db.sqlite as never, dim: config.embedding.dim, table: "plugins_vec" });
      pluginStore.init();
      if (pluginStore.rehydrateIndex(await repo.savedPluginEmbeddingIndex(vectorFilter))) {
        pluginStore.rebuildVectors(await repo.savedPluginEmbeddings(vectorFilter));
      }
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
        // external-content FTS5 的 `SELECT COUNT(*) FROM sites_fts` 读的是 content 表
        // (sites) 的行数：索引为空时它仍返回站点数，guard 会误判「已就绪」→ 全文通道
        // 永久静默失效而 health 仍报 fts=true（2026-11-06 数据层深扫实测复现）。
        // 与 fts.ts initSubstring 同口径，改查 _docsize 影子表：0 才说明索引真的没灌。
        // ⚠️ 2026-11-06 二次落地：并行会话曾把此处覆盖回 COUNT(*)，勿再回退。
        const ftsIndexed = (db.sqlite!.prepare("SELECT COUNT(*) AS n FROM sites_fts_docsize").get() as { n: number })?.n ?? 0;
        if (ftsIndexed === 0) store.rebuild();
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

  const search = new SearchEngine(
    {
      db,
      repo,
      fts,
      vectors,
      embed: embedding ? (text: string) => embedding!.encode(text) : null,
    },
    // semanticMinSimilarity 是 SearchEngineOptions（第二个参数），不是 SearchEngineDeps——
    // 放错对象会被 TS2353 挡下（2026-10-29 实测）。
    { semanticMinSimilarity: config.search.semanticMinSimilarity },
  );

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
    // 本地网关（Ollama 等）可以无密钥，管理员显式放行内网即视为可用
    llm: Boolean(config.llm.apiKey) || config.llm.allowPrivateNetwork === true,
    notes,
  };

  // 邮件投递器：未配 SMTP 时退化为日志投递（开发开箱即用），生产配好后自动切真实 SMTP。
  const mail = createMailTransport();

  const context: AppContext = {
    config, db, repo, search, vectors, pluginVectors, fts, embedding, mail, capabilities,
    pluginOps: {
      // 形状与 packages/mcp/src/host-context.ts 的声明逐字对应；
      // 语义检索的 keyword 回退 / degraded 标注在 plugins-search.ts 内实现。
      // 箭头函数在构造完成后才被调用，此处引用 context 是安全的（TDZ 不触发）。
      indexSitesBatch: (sites) => indexSitesBatch(context, sites),
      removePluginIndex: (pluginId) => removePluginIndex(context, pluginId),
      searchPluginsSemantic: (query, limit) => searchPluginsSemantic(context, { q: query, limit }),
    },
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

  // 系统级 LLM 配置（管理端写入）优先于环境变量；读取失败不阻断启动
  await refreshLlmCapability(context);
  return context;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
