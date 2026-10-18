/**
 * 本地 embedding 服务。
 *
 * 关键实测结论（决定了这里的每一个配置项）：
 *  1. transformers.js v4 **不读取 HF_ENDPOINT 环境变量** —— 必须设 env.remoteHost。
 *     在 huggingface.co 不可达的网络里，这是能跑起来与"永远卡住"的分界。
 *  2. 默认模型 Xenova/bge-small-zh-v1.5 的 quantized 版本只有 24MB，512 维，中文语义表现最好。
 *  3. 加载后单次前向仅 ~1ms 量级；首次加载（含下载）约 315ms（已缓存时）。
 *
 * 架构升级（Phase 2: ONNX Worker 线程隔离）：
 *  - 默认将模型加载与推理隔离在独立的 Node.js Worker 线程（worker_threads）中运行；
 *  - 主线程保留 LRU + Singleflight 向量缓存，冷启动推理绝不占用主线程 Event Loop；
 *  - 具备透明优雅降级能力：若环境不支持或 NAVHUB_WORKER_EMBEDDING=false，自动回退到进程内推理；
 *  - 向量传输通过 ArrayBuffer 零拷贝（Transferable Objects），保证极致吞吐与最低 GC 抖动。
 *
 * 设计原则：embedding 永远**不是**硬依赖。模型不可用时返回 null，
 * 上层搜索自动降级为「关键词 + 拼音 + 全文」三路，功能不崩、只是少一路。
 */
import { Worker } from "node:worker_threads";
import { withTimeout } from "./with-timeout.ts";

export interface EmbeddingConfig {
  model: string;
  /** 镜像端点；默认 https://hf-mirror.com（huggingface.co 在部分网络不可达） */
  endpoint: string;
  /** 量化精度：q8 显著省内存且实测语义质量不变 */
  dtype: "q8" | "fp16" | "fp32" | "q4";
  cacheDir: string;
  /** 期望维度，用于校验（bge-small-zh-v1.5 = 512） */
  dim: number;
  /** 允许远程下载；离线部署时置 false，只读本地缓存 */
  allowRemote: boolean;
  /** 是否启用 Worker 线程隔离推理（默认由环境变量 NAVHUB_WORKER_EMBEDDING 决定，默认开启） */
  useWorker: boolean;
}

const defaultUseWorker =
  process.env.NAVHUB_WORKER_EMBEDDING === undefined
    ? true
    : process.env.NAVHUB_WORKER_EMBEDDING === "1" ||
      process.env.NAVHUB_WORKER_EMBEDDING.toLowerCase() === "true";

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "Xenova/bge-small-zh-v1.5",
  endpoint: "https://hf-mirror.com",
  dtype: "q8",
  cacheDir: "./data/models",
  dim: 512,
  allowRemote: true,
  useWorker: defaultUseWorker,
};

export interface EmbeddingService {
  readonly dim: number;
  readonly model: string;
  /** 单条编码；失败抛错（调用方决定是否降级） */
  encode(text: string): Promise<Float32Array>;
  encodeBatch(texts: string[]): Promise<Float32Array[]>;
  /** 模型是否已就绪；未就绪时上层应跳过语义通道 */
  ready(): boolean;
  /** 主动预热（可选），用于启动时不阻塞首个请求 */
  warmup(): Promise<boolean>;
  /** 缓存命中统计（可选实现：内存 LRU 的 size/hits/misses） */
  stats?: () => { size: number; hits: number; misses: number };
  /** 释放底层 Worker 线程资源（可选） */
  close?: () => Promise<void>;
}

type Extractor = (
  text: string,
  opts: { pooling: "cls" | "mean"; normalize: boolean }
) => Promise<{ data: ArrayLike<number> }>;

/**
 * 查询词归一化：NFKC + 去首尾空白 + 压缩连续空白 + 小写。
 *
 * 没有这一步，"iPhone " 和 "iphone" 会各占一个缓存条目、各触发一次
 * ONNX 推理 —— 缓存命中率白掉。注意归一化同时作用于**模型输入**而不只是
 * 缓存键：否则同一个键可能对应不同向量（先存入的赢），检索结果会随
 * 请求顺序漂移。
 */
export function normalizeEmbeddingKey(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export interface EmbeddingCache {
  getOrCompute(
    key: string,
    compute: (normalizedKey: string) => Promise<Float32Array>
  ): Promise<Float32Array>;
  readonly size: number;
  stats(): { size: number; hits: number; misses: number };
}

/**
 * LRU + Singleflight 向量缓存。
 *
 * - 值固定为 Float32Array（512 维 = 2048 字节连续内存，无装箱开销）；
 *   满载 2048 条 ≈ 4MB，且 GC 只需扫描少量外部对象。
 * - Singleflight：同一时刻对同一个冷词的并发请求只触发一次 ONNX 推理，
 *   其余调用共享同一个 Promise。批量富化（encodeBatch）与并发搜索打到
 *   同一个词时收益最直接 —— 没有它，一次突发就是 N 次重复前向。
 * - 推理失败不写缓存（下一次调用重新尝试），也不做负缓存。
 */
export function createEmbeddingCache(maxEntries = 2048): EmbeddingCache {
  const cache = new Map<string, Float32Array>();
  const inflight = new Map<string, Promise<Float32Array>>();
  let hits = 0;
  let misses = 0;

  return {
    get size() {
      return cache.size;
    },
    stats: () => ({ size: cache.size, hits, misses }),
    async getOrCompute(key, compute) {
      const normalized = normalizeEmbeddingKey(key);
      const hit = cache.get(normalized);
      if (hit) {
        hits++;
        // 刷新 LRU 位置
        cache.delete(normalized);
        cache.set(normalized, hit);
        return hit;
      }
      misses++;
      const pending = inflight.get(normalized);
      if (pending) return pending; // 合并并发推理，不等它完成就先让出来
      const task = compute(normalized).finally(() => {
        inflight.delete(normalized);
      });
      inflight.set(normalized, task);
      const vec = await task;
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(normalized, vec);
      return vec;
    },
  };
}

/**
 * 创建一个"惰性加载"的 embedding 服务。
 * 构造时不加载模型，首次 encode 时才加载 —— 避免拖慢服务启动。
 */
export function createEmbeddingService(
  config: Partial<EmbeddingConfig> = {}
): EmbeddingService {
  const cfg: EmbeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG, ...config };

  // ---- 模式 1：进程内回退实现 ----
  let inProcessExtractorPromise: Promise<Extractor | null> | null = null;
  let inProcessLoaded = false;
  let inProcessLastError: string | null = null;

  async function loadInProcess(): Promise<Extractor | null> {
    if (!inProcessExtractorPromise) {
      inProcessExtractorPromise = (async () => {
        try {
          const tf: any = await import("@huggingface/transformers");
          const { pipeline, env } = tf;
          env.remoteHost = cfg.endpoint.endsWith("/")
            ? cfg.endpoint
            : cfg.endpoint + "/";
          env.cacheDir = cfg.cacheDir;
          env.allowRemoteModels = cfg.allowRemote;
          env.allowLocalModels = true;
          env.useBrowserCache = false;
          env.useFSCache = true;
          const validDtypes = new Set(["q8", "fp16", "fp32", "q4"]);
          if (!validDtypes.has(cfg.dtype))
            throw new Error("非法 embedding dtype: " + cfg.dtype);
          const pipe = await pipeline("feature-extraction", cfg.model, {
            dtype: cfg.dtype,
          });
          inProcessLoaded = true;
          inProcessLastError = null;
          return pipe as Extractor;
        } catch (err) {
          inProcessLastError = err instanceof Error ? err.message : String(err);
          inProcessLoaded = false;
          inProcessExtractorPromise = null;
          return null;
        }
      })();
    }
    return inProcessExtractorPromise;
  }

  async function encodeInProcess(sliced: string): Promise<Float32Array> {
    const ext = await loadInProcess();
    if (!ext) {
      throw new Error(
        "embedding 模型不可用: " + (inProcessLastError ?? "未知原因")
      );
    }
    const timeoutMs = 30_000;
    // 用 withTimeout 而不是就地 Promise.race：成功路径也要清掉定时器
    const out = await withTimeout(
      ext(sliced, { pooling: "cls", normalize: true }),
      timeoutMs,
      "embedding 编码超时"
    );
    const vec = Float32Array.from(out.data);
    if (vec.length !== cfg.dim) {
      throw new Error(
        `embedding 维度不符：期望 ${cfg.dim}，实际 ${vec.length}`
      );
    }
    return vec;
  }

  // ---- 模式 2：Worker 线程隔离实现 ----
  let fallbackInProcess = !cfg.useWorker;
  let worker: Worker | null = null;
  let workerReady = false;
  let workerLastError: string | null = null;
  let isClosed = false;
  let reqId = 1;
  const pendingRequests = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();

  function getWorker(): Worker {
    if (worker) return worker;
    try {
      const workerUrl = new URL("./embedding-worker.ts", import.meta.url);
      worker = new Worker(workerUrl, {
        execArgv: process.execArgv,
      });

      worker.on("message", (msg: any) => {
        if (!msg || typeof msg !== "object") return;
        const entry = pendingRequests.get(msg.id);
        if (entry) {
          pendingRequests.delete(msg.id);
          if (msg.ok) {
            entry.resolve(msg);
          } else {
            entry.reject(new Error(msg.error || "Worker embedding error"));
          }
        }
      });

      worker.on("error", (err) => {
        workerLastError = err.message;
        workerReady = false;
        for (const entry of pendingRequests.values()) {
          entry.reject(err);
        }
        pendingRequests.clear();
      });

      worker.on("exit", (code) => {
        if (code !== 0 && !isClosed) {
          workerLastError = `Worker thread terminated with code ${code}`;
        }
        worker = null;
        workerReady = false;
      });

      return worker;
    } catch (err) {
      // Worker 构造异常直接无缝回退进程内
      fallbackInProcess = true;
      throw err;
    }
  }

  const cacheLimit = 2048;
  const vecCache = createEmbeddingCache(cacheLimit);

  async function encodeOne(text: string): Promise<Float32Array> {
    return vecCache.getOrCompute(text, async (normalized) => {
      const sliced = normalized.slice(0, 2000);
      if (!sliced.trim()) throw new Error("embedding 输入为空");

      if (!fallbackInProcess) {
        try {
          const w = getWorker();
          const id = reqId++;
          const timeoutMs = 30_000;
          const task = new Promise<any>((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
          });
          w.postMessage({ id, type: "encode", text: sliced, config: cfg });
          const res = await withTimeout(
            task,
            timeoutMs,
            "embedding 编码超时",
            () => pendingRequests.delete(id)
          );
          workerReady = true;
          const vec = new Float32Array(res.buffer);
          if (vec.length !== cfg.dim) {
            throw new Error(
              `embedding 维度不符：期望 ${cfg.dim}，实际 ${vec.length}`
            );
          }
          return vec;
        } catch (err) {
          // 如果是首次加载阶段 Worker 抛错，优雅回退到进程内重试一次
          if (!workerReady) {
            fallbackInProcess = true;
            return encodeInProcess(sliced);
          }
          throw err;
        }
      }

      return encodeInProcess(sliced);
    });
  }

  return {
    dim: cfg.dim,
    model: cfg.model,
    ready: () => (fallbackInProcess ? inProcessLoaded : workerReady),
    stats: () => vecCache.stats(),
    async warmup() {
      if (!fallbackInProcess) {
        try {
          const w = getWorker();
          const id = reqId++;
          const timeoutMs = 30_000;
          let timer: NodeJS.Timeout | undefined;
          const task = new Promise<any>((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              pendingRequests.delete(id);
              reject(new Error("embedding 预热超时"));
            }, timeoutMs);
          });
          w.postMessage({ id, type: "warmup", config: cfg });
          let res: any;
          try {
            res = await Promise.race([task, timeoutPromise]);
          } finally {
            if (timer) clearTimeout(timer);
          }
          workerReady = Boolean(res.ok);
          if (!workerReady && res.error) workerLastError = res.error;
          return workerReady;
        } catch {
          fallbackInProcess = true;
        }
      }
      try {
        await loadInProcess();
        return inProcessLoaded;
      } catch {
        return false;
      }
    },
    encode: encodeOne,
    async encodeBatch(texts: string[]) {
      const CONCURRENCY = 4;
      const out: Float32Array[] = new Array(texts.length);
      let cursor = 0;
      async function workerRunner() {
        while (cursor < texts.length) {
          const i = cursor++;
          out[i] = await encodeOne(texts[i] ?? "");
        }
      }
      await Promise.all(
        Array.from(
          { length: Math.min(CONCURRENCY, texts.length) },
          () => workerRunner()
        )
      );
      return out;
    },
    async close() {
      isClosed = true;
      if (worker) {
        await worker.terminate();
        worker = null;
        workerReady = false;
      }
    },
  };
}

/**
 * 站点 -> 用于 embedding 的文本。
 * 刻意加上"为这个网站生成表示"这类前缀：
 * 实测对 bge 系列的中文查询对齐更稳（查询侧不加前缀）。
 */
export function siteEmbeddingText(site: {
  title: string;
  description?: string | null;
  url?: string;
}): string {
  const parts = ["为这个网站生成表示：" + site.title];
  if (site.description) parts.push("描述：" + site.description);
  if (site.url) parts.push("网址：" + site.url);
  return parts.join("。");
}
