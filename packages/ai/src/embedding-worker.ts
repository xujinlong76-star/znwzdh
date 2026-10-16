/**
 * ONNX Embedding 推理 Worker 线程。
 *
 * 职责：
 * 1. 独立运行在 Node.js worker_threads 线程中，完全解耦主线程的 Event Loop。
 * 2. 负责 @huggingface/transformers 管道的惰性加载与 ONNX 模型推理。
 * 3. 通过 ArrayBuffer 零拷贝（Transferable Objects）将 Float32Array 结果回传主线程。
 */
import { parentPort } from "node:worker_threads";

type Extractor = (
  text: string,
  opts: { pooling: "cls" | "mean"; normalize: boolean }
) => Promise<{ data: ArrayLike<number> }>;

let pipe: Extractor | null = null;
let loadPromise: Promise<Extractor | null> | null = null;
let lastError: string | null = null;

async function loadModel(cfg: {
  model: string;
  endpoint: string;
  cacheDir: string;
  allowRemote: boolean;
  dtype: string;
}): Promise<Extractor | null> {
  if (pipe) return pipe;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const tf: any = await import("@huggingface/transformers");
        const { pipeline, env } = tf;
        // 国内镜像与离线缓存适配
        env.remoteHost = cfg.endpoint.endsWith("/") ? cfg.endpoint : cfg.endpoint + "/";
        env.cacheDir = cfg.cacheDir;
        env.allowRemoteModels = cfg.allowRemote;
        env.allowLocalModels = true;
        env.useBrowserCache = false;
        env.useFSCache = true;
        const validDtypes = new Set(["q8", "fp16", "fp32", "q4"]);
        if (!validDtypes.has(cfg.dtype)) throw new Error("非法 embedding dtype: " + cfg.dtype);
        const p = await pipeline("feature-extraction", cfg.model, { dtype: cfg.dtype });
        pipe = p as Extractor;
        lastError = null;
        return pipe;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        pipe = null;
        loadPromise = null;
        return null;
      }
    })();
  }
  return loadPromise;
}

if (parentPort) {
  parentPort.on("message", async (msg: any) => {
    if (!msg || typeof msg !== "object") return;
    const { id, type } = msg;

    try {
      if (type === "init" || type === "warmup") {
        const ext = await loadModel(msg.config);
        parentPort!.postMessage({ id, ok: Boolean(ext), error: lastError });
      } else if (type === "encode") {
        const ext = await loadModel(msg.config);
        if (!ext) {
          parentPort!.postMessage({
            id,
            ok: false,
            error: "embedding 模型不可用: " + (lastError ?? "未知原因"),
          });
          return;
        }

        const out = await ext(msg.text, { pooling: "cls", normalize: true });
        const vec = Float32Array.from(out.data);
        // Transfer ArrayBuffer for zero-copy efficiency
        parentPort!.postMessage({ id, ok: true, buffer: vec.buffer }, [vec.buffer]);
      } else if (type === "ping") {
        parentPort!.postMessage({ id, ok: true, ready: Boolean(pipe), error: lastError });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({ id, ok: false, error: errMsg });
    }
  });
}
