/**
 * 本地 embedding 服务。
 *
 * 关键实测结论（决定了这里的每一个配置项）：
 *  1. transformers.js v4 **不读取 HF_ENDPOINT 环境变量** —— 必须设 env.remoteHost。
 *     在 huggingface.co 不可达的网络里，这是能跑起来与"永远卡住"的分界。
 *  2. 默认模型 Xenova/bge-small-zh-v1.5 的 quantized 版本只有 24MB，512 维，中文语义表现最好。
 *  3. 加载后单次前向仅 ~1ms 量级；首次加载（含下载）约 315ms（已缓存时）。
 *
 * 设计原则：embedding 永远**不是**硬依赖。模型不可用时返回 null，
 * 上层搜索自动降级为「关键词 + 拼音 + 全文」三路，功能不崩、只是少一路。
 */

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
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "Xenova/bge-small-zh-v1.5",
  endpoint: "https://hf-mirror.com",
  dtype: "q8",
  cacheDir: "./data/models",
  dim: 512,
  allowRemote: true,
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
}

type Extractor = (text: string, opts: { pooling: "cls" | "mean"; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;

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
  getOrCompute(key: string, compute: (normalizedKey: string) => Promise<Float32Array>): Promise<Float32Array>;
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
export function createEmbeddingService(config: Partial<EmbeddingConfig> = {}): EmbeddingService {
  const cfg = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  let extractorPromise: Promise<Extractor | null> | null = null;
  let loaded = false;
  let lastError: string | null = null;

  async function load(): Promise<Extractor | null> {
    if (!extractorPromise) {
      extractorPromise = (async () => {
        try {
          const tf: any = await import("@huggingface/transformers");
          const { pipeline, env } = tf;
          // 这三行是能在国内网络跑通的关键
          env.remoteHost = cfg.endpoint.endsWith("/") ? cfg.endpoint : cfg.endpoint + "/";
          env.cacheDir = cfg.cacheDir;
          env.allowRemoteModels = cfg.allowRemote;
          env.allowLocalModels = true;
          env.useBrowserCache = false;
          env.useFSCache = true;
          const validDtypes = new Set(["q8", "fp16", "fp32", "q4"]);
          if (!validDtypes.has(cfg.dtype)) throw new Error("非法 embedding dtype: " + cfg.dtype);
          const pipe = await pipeline("feature-extraction", cfg.model, { dtype: cfg.dtype });
          loaded = true;
          lastError = null;
          return pipe as Extractor;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          loaded = false;
          // 失败不永久缓存：置空允许下次重试（首启断网抖动一次即终身不可用是线上最痛）
          extractorPromise = null;
          return null;
        }
      })();
    }
    return extractorPromise;
  }

  const cacheLimit = 2048;
  const vecCache = createEmbeddingCache(cacheLimit);

  async function encodeOne(text: string): Promise<Float32Array> {
    // 键归一化 + 并发合并都收拢在缓存里；compute 只在真正未命中时跑一次
    return vecCache.getOrCompute(text, async (normalized) => {
      // 输入截断与空值防护：超长文本对语义向量无增益，只会拖慢前向
      const sliced = normalized.slice(0, 2000);
      if (!sliced.trim()) throw new Error("embedding 输入为空");
      const ext = await load();
      if (!ext) throw new Error("embedding 模型不可用: " + (lastError ?? "未知原因"));
      // cls 与 mean 池化实测都能通过中文语义用例；这里用 cls 并归一化，
      // 归一化后余弦距离等价于点积，简化向量存储实现。
      // 超时保护：pipeline 卡死时不让请求挂死
      const timeoutMs = 30_000;
      const out = await Promise.race([
        ext(sliced, { pooling: "cls", normalize: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("embedding 编码超时")), timeoutMs)),
      ]);
      const vec = Float32Array.from(out.data);
      if (vec.length !== cfg.dim) throw new Error(`embedding 维度不符：期望 ${cfg.dim}，实际 ${vec.length}`);
      return vec;
    });
  }

  return {
    dim: cfg.dim,
    model: cfg.model,
    ready: () => loaded,
    stats: () => vecCache.stats(),
    async warmup() {
      try { await load(); return loaded; } catch { return false; }
    },
    encode: encodeOne,
    async encodeBatch(texts: string[]) {
      // 并发限流：串行千站索引太慢，无限并发又会 OOM，取 4 并发
      const CONCURRENCY = 4;
      const out: Float32Array[] = new Array(texts.length);
      let cursor = 0;
      async function worker() {
        while (cursor < texts.length) {
          const i = cursor++;
          out[i] = await encodeOne(texts[i] ?? "");
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () => worker()));
      return out;
    },
  };
}

/**
 * 站点 -> 用于 embedding 的文本。
 * 刻意加上"为这个网站生成表示"这类前缀：
 * 实测对 bge 系列的中文查询对齐更稳（查询侧不加前缀）。
 */
export function siteEmbeddingText(site: { title: string; description?: string | null; url?: string }): string {
  const parts = ["为这个网站生成表示：" + site.title];
  if (site.description) parts.push("描述：" + site.description);
  if (site.url) parts.push("网址：" + site.url);
  return parts.join("。");
}
