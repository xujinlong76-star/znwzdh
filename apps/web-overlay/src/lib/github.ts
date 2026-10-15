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
        token: process.env.NAVHUB_STORAGE_TOKEN ?? null,
      },
    });
    return cached;
  }

  if (kind === "sqlite") {
    // 前端不提供同进程直连模式。
    //
    // 原因：直连需要把 @navhub/api（也就是整个中枢）打进前端产物，会让构建期
    // 必须解析该包（实测报 Module not found），而它只在极少数场景下才有意义。
    // 需要"省掉一次 HTTP 往返"时，正确做法是让中枢与前端跑在同一台机器，
    // 用 http 适配器指向 127.0.0.1 —— 性能差异可忽略，架构却简单得多。
    //
    // sqlite 适配器的实现在 storage-adapter.ts 中保留，供服务端脚本或
    // 自定义部署使用。
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
 *
 * 为什么需要基线：中枢返回的空结构（库还没数据）与"读取失败"在渲染层的后果一样 ——
 * 页面会变空。用上游自带的内容兜底，可以让「中枢没起来」「库是空的」这两种情况
 * 依然呈现一个可用的导航页，而不是白屏。
 *
 * 返回 undefined 表示该文件没有基线（例如用户自定义的文档）。
 */
function baselineFor(name: string): unknown | undefined {
  if (name === "navigation.json" || name === "navigation-default.json") return baselineNavigation;
  if (name === "site.json") return baselineSite;
  if (name === "videos.json") return baselineVideos;
  if (name === "resource-metadata.json") return baselineResourceMetadata;
  return undefined;
}

/**
 * 读取一个"文件"。签名与原版完全一致，因此 69 处调用点无需修改。
 *
 * 兜底策略（三级，按"是否值得告警"区分）：
 *   1. 中枢返回 null（该文件从未写入过）-> **静默**回退到基线。
 *      这是正常状态而非故障；若也告警，像 videos.json 这种从没存过的文件
 *      会在每个请求上刷一条日志（实测确实如此），把真正的问题淹没。
 *   2. 中枢返回了数据但内容为空      -> 告警后回退（可能是数据异常）。
 *   3. 读取失败（中枢不可达/报错）    -> 告警后回退。
 * 没有基线的文件返回 {}（与原版一致的宽松语义）。
 */
export async function getFileContent<T = any>(path: string): Promise<T> {
  const name = basename(path);
  const baseline = baselineFor(name);

  try {
    const data = await getAdapter().read(path);

    // 情况 1：从未写入过 —— 静默回退，不告警
    if (data === null || data === undefined) {
      return (baseline ?? {}) as T;
    }

    // 情况 2：有数据但为空 —— 告警后回退
    // 空值判定按文件类型区分：
    //   - 导航类（navigation / videos）看 navigationItems 是否有元素
    //   - resource-metadata 看 metadata 数组（调用方会对它执行 .unshift）
    //   - 其余配置类看对象是否为空
    const looksEmpty =
      name === "navigation.json" || name === "navigation-default.json" || name === "videos.json"
        ? !hasNavigation(data)
        : name === "resource-metadata.json"
          ? !hasMetadataArray(data)
          : isEmptyObject(data);

    if (baseline !== undefined && looksEmpty) {
      console.warn("[storage] 中枢返回了数据但内容为空，回退到构建期基线:", path);
      return baseline as T;
    }
    return data as T;
  } catch (error) {
    // 情况 3：真正的故障
    console.error("[storage] 读取失败，回退到构建期基线:", path, error);
    if (baseline !== undefined) return baseline as T;
    return {} as T;
  }
}

/**
 * 写入一个"文件"。
 * message / _token 仅为兼容原签名而保留，HTTP 与 sqlite 适配器会忽略它们。
 */
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
      return { ok: true, note: result.note, attempts: attempt };
    } catch (error) {
      lastError = error;
      // 与原版一致的有限退避重试（网络抖动、上游并发冲突）
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