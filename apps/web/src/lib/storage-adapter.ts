/**
 * 存储适配器 —— 前端与持久化解耦的唯一接缝。
 *
 * 背景（决定了整个改造方案的成本）：
 *   NavSphere 全站的持久化只经过两个函数：
 *       getFileContent(path)             读
 *       commitFile(path, content, ...)   写
 *   共 69 处调用点，读写的都是 3 个 JSON 文件。
 *
 * 所以**不需要碰那 69 处**。只要把这两个函数的实现换成"按 adapter 选择后端"，
 * 整个后台就整体切换了存储层，前端业务代码零改动、也便于跟进上游更新。
 *
 * 三种后端：
 *   github — 原版行为（数据存你自己的 GitHub 仓库，零成本）
 *   http   — 指向 NavHub 中枢（SQLite/Postgres + AI 检索）
 *   sqlite — 服务端直连（Next.js 与数据库同机，无网络开销）
 *
 * 通过 STORAGE_ADAPTER 环境变量选择，默认 http。
 */

export type StorageAdapterKind = "github" | "http" | "sqlite";

export interface StorageAdapter {
  readonly kind: StorageAdapterKind;
  read(path: string): Promise<unknown>;
  write(path: string, content: string, message: string): Promise<{ ok: true; note?: string }>;
}

export class StorageError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "StorageError";
  }
}

export function resolveAdapterKind(env: Record<string, string | undefined> = process.env): StorageAdapterKind {
  const raw = (env.STORAGE_ADAPTER ?? "http").toLowerCase();
  if (raw === "github" || raw === "http" || raw === "sqlite") return raw;
  throw new StorageError("未知的 STORAGE_ADAPTER: " + raw + "（可选 github | http | sqlite）");
}

/* ------------------------------------------------------------------ *
 * HTTP 适配器：把 path 映射到 NavHub 的 /api/storage
 * ------------------------------------------------------------------ */

export interface HttpAdapterOptions {
  baseUrl: string;
  /** 可选 Bearer token（中枢开启鉴权时需要） */
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createHttpAdapter(opts: HttpAdapterOptions): StorageAdapter {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeout = opts.timeoutMs ?? 15_000;

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) h.Authorization = "Bearer " + opts.token;
    return h;
  };

  async function call(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await doFetch(url, { ...init, headers: headers(), signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new StorageError("中枢返回 " + res.status + "：" + text.slice(0, 300), res.status);
      }
      return text ? JSON.parse(text) : {};
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError("无法连接 NavHub 中枢（" + base + "）：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: "http",
    async read(path: string) {
      return call(base + "/api/storage?path=" + encodeURIComponent(path), { method: "GET" });
    },
    async write(path: string, content: string, message: string) {
      const body = JSON.stringify({ path, content, message });
      const res = await call(base + "/api/storage", { method: "PUT", body }) as { note?: string };
      return { ok: true, note: res?.note };
    },
  };
}

/* ------------------------------------------------------------------ *
 * GitHub 适配器：保留 NavSphere 原版行为
 * ------------------------------------------------------------------ */

export interface GithubAdapterOptions {
  owner: string;
  repo: string;
  branch?: string;
  /** 读用（可以是匿名，公开仓库不需要 token） */
  readToken?: string | null;
  /** 写必须带 token */
  getWriteToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createGithubAdapter(opts: GithubAdapterOptions): StorageAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const branch = opts.branch ?? "main";

  return {
    kind: "github",
    async read(path: string) {
      const url = "https://api.github.com/repos/" + opts.owner + "/" + opts.repo + "/contents/" + path + "?ref=" + branch;
      const res = await doFetch(url, {
        headers: {
          Accept: "application/vnd.github.v3.raw",
          Authorization: opts.readToken ? "token " + opts.readToken : "",
          "User-Agent": "NavHub",
        },
      });
      // 原版语义：文件不存在时返回空结构而不是抛错，避免首屏 500
      if (res.status === 404) {
        return path.includes("navigation.json") ? { navigationItems: [] } : {};
      }
      if (!res.ok) throw new StorageError("GitHub 读取失败 " + res.status + "：" + path, res.status);
      return res.json();
    },
    async write(path: string, content: string, message: string) {
      const token = await opts.getWriteToken();
      if (!token) throw new StorageError("未登录，无法写入 GitHub 仓库");

      // 取当前 sha（不存在则新建）
      const metaUrl = "https://api.github.com/repos/" + opts.owner + "/" + opts.repo + "/contents/" + path + "?ref=" + branch;
      let sha: string | undefined;
      const metaInit: RequestInit & { cache?: string } = {
        headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "User-Agent": "NavHub" },
        // 必须在最新 sha 上提交，否则会 409 冲突
        cache: "no-store",
      };
      const meta = await doFetch(metaUrl, metaInit);
      if (meta.ok) sha = ((await meta.json()) as { sha: string }).sha;

      const body = JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        sha,
        branch,
      });

      // GitHub 的 sha 冲突是常态（并发提交），这里做有限次重试
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await doFetch("https://api.github.com/repos/" + opts.owner + "/" + opts.repo + "/contents/" + path, {
          method: "PUT",
          headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json", "User-Agent": "NavHub" },
          body,
        });
        if (res.ok) return { ok: true, note: "已提交到 GitHub" };
        const err = await res.json().catch(() => ({})) as { message?: string };
        if (attempt < 3 && String(err.message ?? "").toLowerCase().includes("sha")) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw new StorageError("GitHub 写入失败：" + (err.message ?? res.status));
      }
      throw new StorageError("GitHub 写入失败：重试次数已用尽");
    },
  };
}

/* ------------------------------------------------------------------ *
 * SQLite 直连适配器：Next.js 与数据库同机时使用
 * ------------------------------------------------------------------ */

/**
 * 直连模式下，前端进程内直接装配 @navhub/api 的上下文。
 * 适合单机部署（省掉一次 HTTP 往返），但要求同一进程能访问数据库文件。
 */
export function createSqliteAdapter(load: () => Promise<{
  readStoragePath: (path: string) => Promise<unknown>;
  writeStoragePath: (path: string, content: string) => Promise<{ ok: true; note: string }>;
}>): StorageAdapter {
  return {
    kind: "sqlite",
    async read(path: string) {
      const mod = await load();
      return mod.readStoragePath(path);
    },
    async write(path: string, content: string) {
      const mod = await load();
      return mod.writeStoragePath(path, content);
    },
  };
}

/* ------------------------------------------------------------------ *
 * 工厂
 * ------------------------------------------------------------------ */

export function createStorageAdapter(config: {
  kind: StorageAdapterKind;
  http?: HttpAdapterOptions;
  github?: GithubAdapterOptions;
  sqlite?: () => Promise<{
    readStoragePath: (path: string) => Promise<unknown>;
    writeStoragePath: (path: string, content: string) => Promise<{ ok: true; note: string }>;
  }>;
}): StorageAdapter {
  switch (config.kind) {
    case "http":
      if (!config.http) throw new StorageError("http 适配器缺少配置");
      return createHttpAdapter(config.http);
    case "github":
      if (!config.github) throw new StorageError("github 适配器缺少配置");
      return createGithubAdapter(config.github);
    case "sqlite":
      if (!config.sqlite) throw new StorageError("sqlite 适配器缺少配置");
      return createSqliteAdapter(config.sqlite);
  }
}
