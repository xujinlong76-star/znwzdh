/**
 * 导航目录读路径（U-36，主方案 A + 配套 C 的 web 侧）。
 *
 * navigation.json 的 public 快照已达 2,087,826 字符（2026-11-18 电脑实库
 * 实测），离 Next Data Cache 单条目 2MB 上限只剩 9,326 字符；首页（ISR，
 * revalidate=60）每次 getFileContent 读整包，再增 14–15 站即写缓存失败、
 * 旧快照冻结（2026-11-05 真实事故）。中枢在每次写导航后同步派生「索引 +
 * 按一级分类分片」（见中枢侧 apps/api/src/navigation-shards.ts），本模块
 * 就是分片的读侧：
 *
 *   - loadNavigationCatalog()     拼装出与整包读在渲染字段上逐字等值的
 *                                 NavigationData（首页、考试页用）；
 *   - loadNavigationCategoryById() 单个分类按需读（只读该分类的片）。
 *
 * 瘦身投影 C：分片里的站点只带渲染字段（id/title/href/description/icon/
 * enabled/status/tags/health + videoConfig/useDefaultIcon 透传），重字段
 * （weight/trendScore/actions/relations/liveMetrics/workspaces）不在分片里。
 * 这是安全的：data-loader.ts 的 processNavigationSubItem 本就把重字段裁掉，
 * 拼装树经 getProcessedData 后的输出与整包读逐字等值；速览弹窗里读的重字段
 * 今天就是死的（同上原因），弹窗改走 /api/hub/sites/:id 按站懒取
 * （见 site-peek-dialog.tsx 的 useEffect 懒取）。
 *
 * 一致性纪律（任何一条不过 → 回落整包读并打点，永不比现状差）：
 *   - index 是派生的提交标记：各分片的 sourceVersion 必须与 index
 *     的 sourceVersion 逐一相等（防撕裂派生/缓存新旧混杂）；
 *   - 每片的 categoryId 与条数必须与 index 登记的对得上；
 *   - 分片缺失（中枢从未派生过、或被人为删除）→ 回落。
 *
 * 与视频分片读路径不同的一点：navigation.json 不在 Data Cache 豁免名单里，
 * 整包读是 revalidate=60 的缓存读，构建期发它不触发 Dynamic server usage，
 * 故回落不需要「构建期改内联基线」的特殊分支——getFileContentWithStatus
 * 本身在中枢不可达时就会用本地基线文件替代（与改造前首页行为一致）。
 *
 * 降级信号 degraded：分片校验不过回落时为 true；调用方只拿它记日志/打点，
 * 首页不据此做 404 定性（首页没有「条目不存在」的判定）。
 *
 * 灰度/回滚开关 NAVHUB_NAVIGATION_READ_MODE：
 *   - 未设置或 shard → 分片读（默认）；
 *   - doc → 整包读（= 本模块上线前的行为，秒级回滚位）；
 *   - 其它脏值 → 回 doc 并 warn（取数链路不因配置打错字而抛错，与
 *     revalidateFromEnv 的纪律一致）。
 */

import { getFileContent, getFileContentWithStatus } from "@/lib/github";
import {
  NAVIGATION_DOC_PATH,
  NAVIGATION_INDEX_PATH,
} from "@/lib/navigation-catalog-paths";
import type { NavigationCategory, NavigationData, NavigationItem } from "@/types/navigation";

export type NavigationReadMode = "shard" | "doc";

export function navigationReadMode(env: Record<string, string | undefined> = process.env): NavigationReadMode {
  const raw = (env.NAVHUB_NAVIGATION_READ_MODE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "shard") return "shard";
  if (raw === "doc") return "doc";
  console.warn("[navigation-read] NAVHUB_NAVIGATION_READ_MODE 取值无法识别（" + raw + "），回退整包读（doc）");
  return "doc";
}

/** 分片体积预警线（字符数）：与 video 同款，2MB 硬上限的 75% */
const NAVIGATION_SHARD_WARN_CHARS = 1_500_000;

/**
 * 分片读的体积护栏：某分类条数失控、分片逼近 Data Cache 上限时先在日志里
 * 报警——在撞限之前按子分类再拆一层，而不是撞限之后查「旧快照冻结」事故。
 * 只警告、不改行为。
 */
function warnIfShardNearCacheLimit(path: string, data: unknown): void {
  let size = 0;
  try {
    size = JSON.stringify(data)?.length ?? 0;
  } catch {
    return;
  }
  if (size >= NAVIGATION_SHARD_WARN_CHARS) {
    console.warn(
      "[navigation-read] 导航分片体积已达 " +
        size +
        " 字符，接近 Next Data Cache 单条目 2MB 上限（" +
        path +
        "）。请按子分类再拆一层分片，避免重演旧快照冻结事故。",
    );
  }
}

interface NavigationIndexCategory {
  id: string;
  title: string;
  shardPaths: string[];
  itemCount: number;
}

interface NavigationIndex {
  sourceVersion: number;
  totalItems: number;
  replacementHistory: unknown[];
  categories: NavigationIndexCategory[];
}

function parseIndex(raw: unknown): NavigationIndex | null {
  const idx = raw as {
    kind?: unknown;
    sourceVersion?: unknown;
    totalItems?: unknown;
    replacementHistory?: unknown;
    categories?: unknown;
  } | null;
  if (!idx || idx.kind !== "navhub-navigation-index") return null;
  if (typeof idx.sourceVersion !== "number" || typeof idx.totalItems !== "number") return null;
  if (!Array.isArray(idx.categories) || idx.categories.length === 0) return null;
  const categories: NavigationIndexCategory[] = [];
  for (const c of idx.categories as Array<Record<string, unknown>>) {
    if (typeof c?.id !== "string" || !Array.isArray(c?.shardPaths) || c.shardPaths.length === 0) {
      return null;
    }
    if (c.shardPaths.some((p) => typeof p !== "string" || !p)) return null;
    if (typeof c?.itemCount !== "number") return null;
    categories.push({
      id: c.id,
      title: typeof c.title === "string" ? c.title : "",
      shardPaths: [...(c.shardPaths as string[])],
      itemCount: c.itemCount,
    });
  }
  return {
    sourceVersion: idx.sourceVersion,
    totalItems: idx.totalItems,
    replacementHistory: Array.isArray(idx.replacementHistory) ? idx.replacementHistory : [],
    categories,
  };
}

function countCategoryItems(cat: NavigationItem): number {
  let n = Array.isArray(cat?.items) ? cat.items.length : 0;
  if (Array.isArray(cat?.subCategories)) {
    for (const sub of cat.subCategories) n += Array.isArray(sub?.items) ? sub.items.length : 0;
  }
  return n;
}

/** 读并校验单页：版本与 index 对齐、分类 id 与页号对得上才认 */
async function readShardPage(
  shardPath: string,
  categoryId: string,
  sourceVersion: number,
): Promise<NavigationItem | null> {
  const raw = (await getFileContent(shardPath)) as {
    kind?: unknown;
    sourceVersion?: unknown;
    categoryId?: unknown;
    page?: unknown;
    pageCount?: unknown;
    category?: NavigationItem;
  } | null;
  warnIfShardNearCacheLimit(shardPath, raw);
  if (!raw || raw.kind !== "navhub-navigation-cat") return null;
  if (raw.sourceVersion !== sourceVersion) return null;
  if (raw.categoryId !== categoryId || !raw.category) return null;
  if (typeof raw.page !== "number" || typeof raw.pageCount !== "number") return null;
  return raw.category;
}

/** 按 index 登记的 shardPaths 顺序拼回一个分类（多页时按页合并子分类） */
async function readCategory(
  entry: NavigationIndexCategory,
  sourceVersion: number,
): Promise<NavigationItem | null> {
  const pages: NavigationItem[] = [];
  for (const shardPath of entry.shardPaths) {
    const page = await readShardPage(shardPath, entry.id, sourceVersion);
    if (!page) return null;
    pages.push(page);
  }
  // 单页直接返回；多页按页顺序合并：顶级条目拼接，子分类按 id 归并
  if (pages.length === 1) {
    if (countCategoryItems(pages[0]) !== entry.itemCount) return null;
    return pages[0];
  }
  const merged: NavigationItem = { ...(pages[0] as NavigationItem) };
  const items: NavigationItem["items"] = [];
  const subById = new Map<string, NavigationCategory>();
  for (const page of pages) {
    for (const item of page.items ?? []) items.push(item);
    for (const sub of page.subCategories ?? []) {
      const existing = subById.get(sub.id);
      if (!existing) {
        subById.set(sub.id, { ...sub, items: [...(sub.items ?? [])] });
      } else {
        existing.items = [...(existing.items ?? []), ...(sub.items ?? [])];
      }
    }
  }
  merged.items = items;
  merged.subCategories = [...subById.values()];
  if (countCategoryItems(merged) !== entry.itemCount) return null;
  return merged;
}

export interface NavigationCatalogLoad {
  data: NavigationData;
  mode: NavigationReadMode;
  sourceVersion: number | null;
  /**
   * 数据是否处于降级态：分片不可用回落、或整包读拿到的是基线替代。
   * 首页只拿它记日志，不据此做 404 定性。
   */
  degraded: boolean;
}

async function loadWholeDoc(): Promise<NavigationCatalogLoad> {
  const { data, degraded } = await getFileContentWithStatus<NavigationData>(NAVIGATION_DOC_PATH);
  const usable = !!data && Array.isArray((data as NavigationData).navigationItems);
  return { data, mode: "doc", sourceVersion: null, degraded: degraded || !usable };
}

function fallback(reason: string): Promise<NavigationCatalogLoad> {
  console.warn("[navigation-read] 回落整包读：" + reason);
  return loadWholeDoc().then((load) => ({ ...load, degraded: true }));
}

/**
 * 读整份导航目录。shard 模式下拼装结果与整包读在渲染字段上逐字等值
 * （分片里存的是瘦身后的分类对象本体，replacementHistory 随 index 走）；
 * 任何校验不过回落整包并标记 degraded。
 */
export async function loadNavigationCatalog(): Promise<NavigationCatalogLoad> {
  if (navigationReadMode() === "doc") return loadWholeDoc();

  const index = parseIndex(await getFileContent(NAVIGATION_INDEX_PATH));
  if (!index) return fallback("分片索引缺失或形状不对（中枢尚未派生/已删除）");

  const categories = await Promise.all(
    index.categories.map((entry) => readCategory(entry, index.sourceVersion)),
  );
  const badAt = categories.findIndex((c) => c === null);
  if (badAt >= 0) {
    return fallback(
      "分片校验未过（分类 " +
        index.categories[badAt].id +
        "：缺失/版本或条数不一致；快照版本 " +
        index.sourceVersion +
        "）",
    );
  }
  const assembled = categories as NavigationItem[];
  const total = assembled.reduce((acc, c) => acc + countCategoryItems(c), 0);
  if (total !== index.totalItems) {
    return fallback(
      "分片总条数 " + total + " 与索引登记 " + index.totalItems + " 不一致（快照版本 " + index.sourceVersion + "）",
    );
  }
  return {
    data: {
      navigationItems: assembled,
      replacementHistory: index.replacementHistory as NavigationData["replacementHistory"],
    },
    mode: "shard",
    sourceVersion: index.sourceVersion,
    degraded: false,
  };
}

export interface NavigationCategoryHit {
  category: NavigationItem;
  sourceVersion: number;
}

/**
 * 按需定位单个分类：id → 该分类的完整条目（只读该分类的片，不碰整包）。
 *
 * 返回 null 的情形都由调用方回落全量读兜底：doc 模式、索引缺失、版本撕裂、
 * 分类不在索引里（可能是源数据刚更新而分片未跟上，或本来就是不存在的 id）。
 */
export async function loadNavigationCategoryById(
  categoryId: string,
): Promise<NavigationCategoryHit | null> {
  if (navigationReadMode() === "doc") return null;
  if (!categoryId) return null;

  const index = parseIndex(await getFileContent(NAVIGATION_INDEX_PATH));
  if (!index) return null;
  const entry = index.categories.find((c) => c.id === categoryId);
  if (!entry) return null;

  const category = await readCategory(entry, index.sourceVersion);
  if (!category) return null;
  return { category, sourceVersion: index.sourceVersion };
}
