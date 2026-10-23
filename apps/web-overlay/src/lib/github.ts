/**
 * 存储层门面 —— 保持 NavSphere 原有的两个函数签名，内部改走 StorageAdapter。
 *
 * 为什么用「替换实现」而不是「改调用点」：
 *   NavSphere 全站有 16 个 route 文件、约 69 处调用，都只通过这两个函数读写数据。
 *   保持签名不变，就等于**一行调用点都不用改**，后台（增删改查、拖拽排序、
 *   投稿审核、数据导入导出）整体切换到了真实数据库 —— 这是本次改造能低成本落地的根本原因。
 *
 * 后端由 STORAGE_ADAPTER 选择（默认 http，指向 NavHub 中枢）：
 *   http   -> NavHub 中枢（SQLite / PostgreSQL + AI 检索）
 *   github -> 原版行为（数据存你自己的 GitHub 仓库）
 *   sqlite -> 同进程直连（单机部署，省一次网络往返）
 */
import { auth } from "@/lib/auth";
// 构建期即内联的基线数据（NavSphere 自带），用作中枢不可用时的兜底。
// 注意：这是「内容兜底」而不是「配置兜底」—— 正常情况下数据来自中枢。
import baselineNavigation from "@/navsphere/content/navigation.json";
import baselineSite from "@/navsphere/content/site.json";
import baselineVideos from "@/navsphere/content/videos.json";
// resource-metadata.json 也必须有基线：调用方会执行 `metadata.metadata.unshift(...)`，
// 一旦拿到空对象就会抛 "Cannot read properties of undefined (reading 'unshift')"。
import baselineResourceMetadata from "@/navsphere/content/resource-metadata.json";
import {
  createStorageAdapter,
  resolveAdapterKind,
  StorageError,
  type StorageAdapter,
} from "@/lib/storage-adapter";

/** 惰性单例：避免每个请求都重建适配器（会重复读环境变量与构造闭包） */
let cached: StorageAdapter | null = null;

/**
 * 连接冷静期（毫秒）：中枢不可达时，多久内不再向它发起新连接。
 * 默认 5 秒 —— 足够吸收一次 SSR 突发（十几个模块的并发读取），
 * 又能在中枢启动后迅速恢复。显式置 0 表示关闭熔断（每次请求都尝试连接）。
 */
function cooldownFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.NAVHUB_STORAGE_COOLDOWN_MS;
  if (raw === undefined || raw.trim() === "") return 5_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 5_000;
  return Math.floor(n);
}

/**
 * 读请求的 Data Cache 有效期（秒）：默认 60。
 *
 * 与 cooldownFromEnv 同一风格（脏环境值一律回退默认，绝不抛错——取数链路
 * 抛错会让首屏 500）。置 0 或 NAVHUB_STORAGE_REVALIDATE_S=0 表示禁用缓存，
 * 回到「每次实时读中枢」的旧行为（后台改完立即生效，但 TTFB 打穿中枢）。
 *
 * 默认 60s 的取舍：导航内容是人工策划的，变更频率以天计；后台改完后最多
 * 60s 全站可见，换取 Googlebot 命中缓存、首页 TTFB 从「等一次中枢往返」
 * 降到「本地渲染」。sitemap 用 3600（它更不怕旧），首页更保守。
 */
export function revalidateFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.NAVHUB_STORAGE_REVALIDATE_S;
  if (raw === undefined || raw.trim() === "") return 60;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 60;
  return Math.floor(n);
}

function getAdapter(): StorageAdapter {
  if (cached) return cached;
  const kind = resolveAdapterKind(process.env);

  if (kind === "http") {
    cached = createStorageAdapter({
      kind,
      http: {
        // 服务端渲染走容器内地址；可在部署时用 NAVHUB_STORAGE_BASE_URL 覆盖
        baseUrl:
          process.env.NAVHUB_STORAGE_BASE_URL ??
          process.env.NEXT_PUBLIC_API_URL ??
          "http://localhost:8787",
        token:
          process.env.NAVHUB_STORAGE_TOKEN ||
          process.env.NAVHUB_ADMIN_TOKEN ||
          process.env.NAVHUB_BOOTSTRAP_TOKEN ||
          null,
        cooldownMs: cooldownFromEnv(process.env),
        // 读请求进 Next Data Cache（配合路由级 revalidate 变 ISR）；
        // 详见 storage-adapter.ts 里 HttpAdapterOptions.revalidateS 的注释
        revalidateS: revalidateFromEnv(process.env),
      },
    });
    return cached;
  }

  if (kind === "sqlite") {
    throw new StorageError(
      "STORAGE_ADAPTER=sqlite 不适用于 Web 前端；请使用 http（推荐）或 github。" +
        "storage-adapter.ts 中的 createSqliteAdapter 可满足其他运行环境的直连需求。",
    );
  }

  // github：保留原版能力（数据仍在用户自己的仓库里）
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!owner || !repo) {
    throw new StorageError(
      "STORAGE_ADAPTER=github 时必须配置 GITHUB_OWNER 与 GITHUB_REPO；" +
        "若想使用 NavHub 中枢，请设置 STORAGE_ADAPTER=http",
    );
  }
  cached = createStorageAdapter({
    kind,
    github: {
      owner,
      repo,
      branch: process.env.GITHUB_BRANCH || "main",
      readToken: process.env.GITHUB_PAT ?? null,
      getWriteToken: async () => {
        const session = await auth();
        return session?.user?.accessToken ?? process.env.GITHUB_PAT ?? null;
      },
    },
  });
  return cached;
}

/** 内容文件的 basename */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** 判断导航类数据是否"有内容"（空数组等同没有数据） */
function hasNavigation(data: unknown): boolean {
  const items = (data as { navigationItems?: unknown } | null)?.navigationItems;
  return Array.isArray(items) && items.length > 0;
}

/** 判断是否为"空结构" */
function isEmptyObject(data: unknown): boolean {
  return data === null || data === undefined || typeof data !== "object" || Object.keys(data as object).length === 0;
}

/**
 * resource-metadata.json 的内容判定。
 *
 * 调用方（/api/resource）会执行 `metadata.metadata.unshift(...)`，
 * 因此 metadata 必须是**非空数组**；不能像普通配置那样只判"对象是否为空"，
 * 否则一个合法的空对象会一路传到 unshift 上直接抛错。
 */
function hasMetadataArray(data: unknown): boolean {
  const list = (data as { metadata?: unknown } | null)?.metadata;
  return Array.isArray(list) && list.length > 0;
}

/**
 * 按文件类型取构建期内联的基线。
 */
function baselineFor(name: string): unknown | undefined {
  if (name === "navigation.json" || name === "navigation-default.json") return baselineNavigation;
  if (name === "site.json") return baselineSite;
  if (name === "videos.json") return baselineVideos;
  if (name === "resource-metadata.json") return baselineResourceMetadata;
  return undefined;
}

const contentCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 2500; // 2.5 秒极速微缓存
const FAILURE_TTL_MS = 1_000;

export function invalidateContentCache(path?: string) {
  if (path) {
    contentCache.delete(path);
  } else {
    contentCache.clear();
  }
}

export async function getFileContent<T = any>(path: string): Promise<T> {
  const now = Date.now();
  const cachedItem = contentCache.get(path);
  if (cachedItem && cachedItem.expiresAt > now) {
    return cachedItem.data as T;
  }

  const name = basename(path);
  const baseline = baselineFor(name);

  try {
    const data = await getAdapter().read(path);

    if (data === null || data === undefined) {
      const res = (baseline ?? {}) as T;
      contentCache.set(path, { data: res, expiresAt: now + CACHE_TTL_MS });
      return res;
    }

    const looksEmpty =
      name === "navigation.json" || name === "navigation-default.json" || name === "videos.json"
        ? !hasNavigation(data)
        : name === "resource-metadata.json"
          ? !hasMetadataArray(data)
          : isEmptyObject(data);

    if (baseline !== undefined && looksEmpty) {
      console.warn("[storage] 中枢返回了数据但内容为空，回退到构建期基线:", path);
      contentCache.set(path, { data: baseline, expiresAt: now + CACHE_TTL_MS });
      return baseline as T;
    }
    contentCache.set(path, { data, expiresAt: now + CACHE_TTL_MS });
    return data as T;
  } catch (error) {
    const hubUnreachable = error instanceof StorageError && error.unreachable;
    if (!hubUnreachable) {
      console.error("[storage] 读取失败，回退到构建期基线:", path, error);
    }
    const res = (baseline ?? {}) as T;
    contentCache.set(path, { data: res, expiresAt: Date.now() + FAILURE_TTL_MS });
    return res;
  }
}

export async function commitFile(
  path: string,
  content: string,
  message: string,
  _token?: string,
  retryCount = 3,
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const result = await getAdapter().write(path, content, message);
      invalidateContentCache(path);
      return { ok: true, note: result.note, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new StorageError("写入失败: " + path);
}

/** 供健康检查/调试使用：当前实际生效的适配器类型 */
export function currentAdapterKind(): string {
  return getAdapter().kind;
}