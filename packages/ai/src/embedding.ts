/**
 * Local embedding service with worker-thread isolation and in-process fallback.
 */
import { Worker } from "node:worker_threads";
import { withTimeout } from "./with-timeout.ts";

export interface EmbeddingConfig {
  model: string;
  endpoint: string;
  dtype: "q8" | "fp16" | "fp32" | "q4";
  cacheDir: string;
  dim: number;
  allowRemote: boolean;
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
  encode(text: string): Promise<Float32Array>;
  encodeBatch(texts: string[]): Promise<Float32Array[]>;
  ready(): boolean;
  warmup(): Promise<boolean>;
  stats?: () => { size: number; hits: number; misses: number };
  close?: () => Promise<void>;
}

type Extractor = (
  text: string,
  opts: { pooling: "cls" | "mean"; normalize: boolean }
) => Promise<{ data: ArrayLike<number> }>;

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
        cache.delete(normalized);
        cache.set(normalized, hit);
        return hit;
      }
      misses++;
      const pending = inflight.get(normalized);
      if (pending) return pending;
      const task = compute(normalized).finally(() => inflight.delete(normalized));
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

export function createEmbeddingService(
  config: Partial<EmbeddingConfig> = {}
): EmbeddingService {
  const cfg: EmbeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
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
          if (!new Set(["q8", "fp16", "fp32", "q4"]).has(cfg.dtype)) {
            throw new Error("非法 embedding dtype: " + cfg.dtype);
          }
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
      throw new Error("embedding 模型不可用: " + (inProcessLastError ?? "未知原因"));
    }
    const out = await withTimeout(
      ext(sliced, { pooling: "cls", normalize: true }),
      30_000,
      "embedding 编码超时"
    );
    const vec = Float32Array.from(out.data);
    if (vec.length !== cfg.dim) {
      throw new Error(`embedding 维度不符：期望 ${cfg.dim}，实际 ${vec.length}`);
    }
    return vec;
  }

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
      worker = new Worker(workerUrl, { execArgv: process.execArgv });
      worker.on("message", (msg: any) => {
        if (!msg || typeof msg !== "object") return;
        const entry = pendingRequests.get(msg.id);
        if (!entry) return;
        pendingRequests.delete(msg.id);
        if (msg.ok) entry.resolve(msg);
        else entry.reject(new Error(msg.error || "Worker embedding error"));
      });
      worker.on("error", (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        workerLastError = error.message;
        workerReady = false;
        for (const entry of pendingRequests.values()) entry.reject(error);
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
      fallbackInProcess = true;
      throw err;
    }
  }

  const vecCache = createEmbeddingCache(2048);

  async function encodeOne(text: string): Promise<Float32Array> {
    return vecCache.getOrCompute(text, async (normalized) => {
      const sliced = normalized.slice(0, 2000);
      if (!sliced.trim()) throw new Error("embedding 输入为空");
      if (!fallbackInProcess) {
        try {
          const w = getWorker();
          const id = reqId++;
          const task = new Promise<any>((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
          });
          w.postMessage({ id, type: "encode", text: sliced, config: cfg });
          const res = await withTimeout(task, 30_000, "embedding 编码超时", () =>
            pendingRequests.delete(id)
          );
          workerReady = true;
          const vec = new Float32Array(res.buffer);
          if (vec.length !== cfg.dim) {
            throw new Error(`embedding 维度不符：期望 ${cfg.dim}，实际 ${vec.length}`);
          }
          return vec;
        } catch (err) {
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
          let timer: NodeJS.Timeout | undefined;
          const task = new Promise<any>((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              pendingRequests.delete(id);
              reject(new Error("embedding 预热超时"));
            }, 30_000);
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
      const concurrency = 4;
      const out: Float32Array[] = new Array(texts.length);
      let cursor = 0;
      async function workerRunner() {
        while (cursor < texts.length) {
          const i = cursor++;
          out[i] = await encodeOne(texts[i] ?? "");
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, texts.length) }, () => workerRunner())
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

export function pluginEmbeddingText(plugin: {
  name: string;
  description?: string | null;
  kind?: string | null;
  tags?: string[] | null;
  sampleTitles?: string[] | null;
}): string {
  const kindLabels: Record<string, string> = {
    "site-pack": "网址包",
    "workspace-preset": "工作台预设",
    theme: "主题",
  };
  const parts = ["为这个插件生成表示：" + plugin.name];
  if (plugin.description) parts.push("描述：" + plugin.description);
  if (plugin.kind) parts.push("类型：" + (kindLabels[plugin.kind] ?? plugin.kind));
  if (plugin.tags?.length) parts.push("标签：" + plugin.tags.join(" / "));
  if (plugin.sampleTitles?.length) {
    parts.push("包含：" + plugin.sampleTitles.slice(0, 12).join("、"));
  }
  return parts.join("。");
}
