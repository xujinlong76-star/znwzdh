/**
 * 视频目录读路径（VIDEOS_ISR_PLAN 路线 b 的 web 侧）。
 *
 * videos.json 有 7MB+，超 Next Data Cache 单条目 2MB 上限，只能留在豁免名单
 * 里 no-store 实时读，/videos、/videos/v/[id] 的 ISR 因此名存实亡。中枢在每次
 * 写 videos.json 后同步派生「索引 + 按一级分类分片 + id 映射」（见中枢侧
 * apps/api/src/video-shards.ts），本模块就是分片的读侧：
 *
 *   - loadVideoCatalog()          拼装出与整包读逐字等值的 NavigationData
 *                                 （/videos、sitemap、feed 用）；
 *   - loadVideoCategoryByIdentifier()  详情页先经 idmap 定位到单个分片，
 *                                 命中就只读那一片；未命中返回 null，
 *                                 由调用方回落到全量扫描（语义与原实现一致）。
 *
 * 一致性纪律（任何一条不过 → 回落整包读并打点，永不比现状差）：
 *   - index 是派生的提交标记：分片与 idmap 的 sourceVersion 必须与 index
 *     的 sourceVersion 逐一相等（防撕裂派生/缓存新旧混杂）；
 *   - 每片的条数必须与 index 登记的 itemCount 相等、分类 id 对得上；
 *   - 分片缺失（中枢从未派生过、或被人为删除）→ 回落。
 *
 * 灰度/回滚开关 NAVHUB_VIDEOS_READ_MODE：
 *   - 未设置或 shard → 分片读（默认）；
 *   - doc → 整包读（= 本模块上线前的行为，秒级回滚位）；
 *   - 其它脏值 → 回 doc 并 warn（取数链路不因配置打错字而抛错，与
 *     revalidateFromEnv 的纪律一致）。
 */

import { getFileContent } from "@/lib/github";
import baselineVideos from "@/navsphere/content/videos.json";
import {
  VIDEOS_DOC_PATH,
  VIDEOS_IDMAP_PATH,
  VIDEOS_INDEX_PATH,
} from "@/lib/video-catalog-paths";
import type { NavigationData, NavigationItem } from "@/types/navigation";

export type VideoReadMode = "shard" | "doc";

export function videoReadMode(env: Record<string, string | undefined> = process.env): VideoReadMode {
  const raw = (env.NAVHUB_VIDEOS_READ_MODE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "shard") return "shard";
  if (raw === "doc") return "doc";
  console.warn("[videos-read] NAVHUB_VIDEOS_READ_MODE 取值无法识别（" + raw + "），回退整包读（doc）");
  return "doc";
}

/** 分片体积预警线（字节）：与 navigation 同款，2MB 硬上限的 75% */
const VIDEO_SHARD_WARN_BYTES = 1_500_000;

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
  if (size >= VIDEO_SHARD_WARN_BYTES) {
    console.warn(
      "[videos-read] 视频分片体积已达 " +
        size +
        " 字节，接近 Next Data Cache 单条目 2MB 上限（" +
        path +
        "）。请按子分类再拆一层分片（videos-sub-*），避免重演旧快照冻结事故。",
    );
  }
}

interface VideoIndexCategory {
  id: string;
  shardPath: string;
  itemCount: number;
}

interface VideoIndex {
  sourceVersion: number;
  totalItems: number;
  replacementHistory: unknown[];
  categories: VideoIndexCategory[];
}

function parseIndex(raw: unknown): VideoIndex | null {
  const idx = raw as {
    kind?: unknown;
    sourceVersion?: unknown;
    totalItems?: unknown;
    replacementHistory?: unknown;
    categories?: unknown;
  } | null;
  if (!idx || idx.kind !== "navhub-videos-index") return null;
  if (typeof idx.sourceVersion !== "number" || typeof idx.totalItems !== "number") return null;
  if (!Array.isArray(idx.categories) || idx.categories.length === 0) return null;
  const categories: VideoIndexCategory[] = [];
  for (const c of idx.categories as Array<Record<string, unknown>>) {
    if (typeof c?.id !== "string" || typeof c?.shardPath !== "string" || typeof c?.itemCount !== "number") {
      return null;
    }
    categories.push({ id: c.id, shardPath: c.shardPath, itemCount: c.itemCount });
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

/** 读并校验单片：版本与 index 对齐、分类 id 与条数对得上才认 */
async function readShard(entry: VideoIndexCategory, sourceVersion: number): Promise<NavigationItem | null> {
  const raw = (await getFileContent(entry.shardPath)) as {
    kind?: unknown;
    sourceVersion?: unknown;
    categoryId?: unknown;
    category?: NavigationItem;
  } | null;
  warnIfShardNearCacheLimit(entry.shardPath, raw);
  if (!raw || raw.kind !== "navhub-videos-cat") return null;
  if (raw.sourceVersion !== sourceVersion) return null;
  if (raw.categoryId !== entry.id || !raw.category) return null;
  if (countCategoryItems(raw.category) !== entry.itemCount) return null;
  return raw.category;
}

export interface VideoCatalogLoad {
  data: NavigationData;
  mode: VideoReadMode;
  sourceVersion: number | null;
}

async function loadWholeDoc(): Promise<VideoCatalogLoad> {
  const data = (await getFileContent(VIDEOS_DOC_PATH)) as NavigationData;
  return { data, mode: "doc", sourceVersion: null };
}

function fallback(reason: string): Promise<VideoCatalogLoad> {
  // 构建期（next build 预渲染）绝不执行整包读：videos.json 是 no-store 豁免
  // 路径，构建期跑它的 fetch 会触发 Dynamic server usage、把路由污染回动态
  // —— 而生产 Docker 构建时中枢不在场是常态，分片读偶发失败（或中枢未启动）
  // 不能因此让整轮部署丢掉 ISR。构建期改用内联基线出静态页（与改造前各页
  // 构建期用基线一致），运行期首次再生成即换上分片数据。
  if (process.env.NEXT_PHASE === "phase-production-build") {
    console.info("[videos-read] 构建期回落基线：" + reason);
    return Promise.resolve({
      data: baselineVideos as unknown as NavigationData,
      mode: "doc",
      sourceVersion: null,
    });
  }
  console.info("[videos-read] 回落整包读：" + reason);
  return loadWholeDoc();
}

/**
 * 读整份视频目录。shard 模式下拼装结果与整包读逐字等值（分片里存的是
 * 分类对象本体，replacementHistory 随 index 走）；任何校验不过回落整包。
 */
export async function loadVideoCatalog(): Promise<VideoCatalogLoad> {
  if (videoReadMode() === "doc") return loadWholeDoc();

  const index = parseIndex(await getFileContent(VIDEOS_INDEX_PATH));
  if (!index) return fallback("分片索引缺失或形状不对（中枢尚未派生/已删除）");

  const shards = await Promise.all(
    index.categories.map((entry) => readShard(entry, index.sourceVersion)),
  );
  const badAt = shards.findIndex((s) => s === null);
  if (badAt >= 0) {
    return fallback("分片校验未过（分类 " + index.categories[badAt].id + "：缺失/版本或条数不一致）");
  }
  const categories = shards as NavigationItem[];
  const total = categories.reduce((acc, c) => acc + countCategoryItems(c), 0);
  if (total !== index.totalItems) {
    return fallback("分片总条数 " + total + " 与索引登记 " + index.totalItems + " 不一致");
  }
  return {
    data: {
      navigationItems: categories,
      replacementHistory: index.replacementHistory as NavigationData["replacementHistory"],
    },
    mode: "shard",
    sourceVersion: index.sourceVersion,
  };
}

export interface VideoCategoryHit {
  category: NavigationItem;
  sourceVersion: number;
}

/**
 * 详情页定位：identifier（id / seoSlug / bvid / videoId）→ 单个分类分片。
 *
 * 返回 null 的情形都由调用方回落全量扫描兜底：doc 模式、idmap/索引缺失、
 * 版本撕裂、标识不在映射里（可能是源数据刚更新而分片未跟上，或本来就是
 * 不存在的 id——404 与否由全量扫描按原语义裁定）。
 */
export async function loadVideoCategoryByIdentifier(
  identifier: string,
): Promise<VideoCategoryHit | null> {
  if (videoReadMode() === "doc") return null;
  if (!identifier) return null;

  const idmapRaw = (await getFileContent(VIDEOS_IDMAP_PATH)) as {
    kind?: unknown;
    sourceVersion?: unknown;
    map?: Record<string, string>;
  } | null;
  if (!idmapRaw || idmapRaw.kind !== "navhub-videos-idmap" || !idmapRaw.map) return null;

  // bvid 的匹配大小写不敏感：派生侧键统一存小写，查时先精确、后小写
  const map = idmapRaw.map;
  const categoryId = Object.prototype.hasOwnProperty.call(map, identifier)
    ? map[identifier]
    : map[identifier.toLowerCase()];
  if (typeof categoryId !== "string" || !categoryId) return null;

  const index = parseIndex(await getFileContent(VIDEOS_INDEX_PATH));
  if (!index) return null;
  if (idmapRaw.sourceVersion !== index.sourceVersion) return null;

  const entry = index.categories.find((c) => c.id === categoryId);
  if (!entry) return null;

  const category = await readShard(entry, index.sourceVersion);
  if (!category) return null;
  return { category, sourceVersion: index.sourceVersion };
}
