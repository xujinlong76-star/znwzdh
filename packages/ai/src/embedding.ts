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
}

type Extractor = (text: string, opts: { pooling: "cls" | "mean"; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;

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

  async function encodeOne(text: string): Promise<Float32Array> {
    const sliced = (text ?? "").slice(0, 2000);
    if (!sliced.trim()) throw new Error("embedding 输入为空");
    const ext = await load();
    if (!ext) throw new Error("embedding 模型不可用: " + (lastError ?? "未知原因"));
    // 超时保护：pipeline 卡死时不让请求挂死
    const timeoutMs = 30_000;
    const out = await Promise.race([
      ext(sliced, { pooling: "cls", normalize: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("embedding 编码超时")), timeoutMs)),
    ]);
    const vec = Float32Array.from(out.data);
    if (vec.length !== cfg.dim) throw new Error(`embedding 维度不符：期望 ${cfg.dim}，实际 ${vec.length}`);
    return vec;
  }

  return {
    dim: cfg.dim,
    model: cfg.model,
    ready: () => loaded,
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
