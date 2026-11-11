/**
 * 存储适配层：把 NavSphere 的「JSON 文件」语义翻译到 NavHub 的数据库语义。
 *
 * 背景（这是整个改造方案的关键）：
 *   NavSphere 全站的持久化只经过两个函数 ——
 *       getFileContent(path)             读文件
 *       commitFile(path, content, ...)   写文件
 *   数据落在 3 个 JSON：navigation.json / site.json / resource-metadata.json，
 *   共约 69 处调用点。
 *
 * 因此**不需要修改那 69 处**：只要在前端把这两个函数的实现换成"调用 NavHub API"，
 * 整个后台（增删改查、拖拽排序、投稿审核）就自动落到了真实数据库上。
 *
 * 本模块实现服务端一侧：以 path 为键，读写等价的 JSON 结构。
 */
import type { AppContext } from "./context.ts";
import { getEnhancedSiteData, resolveSiteIcon, type SiteAction, type SiteRelation, type SiteLiveMetrics, type SiteHealth } from "@navhub/core";
import { countVideoItems, slugify } from "@navhub/store";
import { backfillDerivedFacets, formatFacetBackfillReport } from "./facet-backfill.ts";
import { indexSitesBatch } from "./index-site.ts";
import { loadVideoCatalogFromDb, resolveVideoStoreMode, syncReplacementHistorySafely, syncVideoCatalogSafely, VIDEO_REPLACEMENTS_PATH } from "./video-catalog.ts";

/** 外置替换审计文档的 basename（路径事实源在 video-catalog.ts，避免两处硬编码漂移） */
const REPLACEMENTS_BASENAME = VIDEO_REPLACEMENTS_PATH.split("/").pop()!;

export const NAVIGATION_PATH = "src/navsphere/content/navigation.json";
export const SITE_PATH = "src/navsphere/content/site.json";
export const RESOURCE_PATH = "src/navsphere/content/resource-metadata.json";
export const DEFAULT_NAVIGATION_PATH = "src/navsphere/content/navigation-default.json";
export const VIDEOS_PATH = "src/navsphere/content/videos.json";

/** NavSphere 的站点项结构（= NavHub 的 site，扩展 4.0 动态特性） */
interface NsItem {
  id: string;
  title: string;
  href: string;
  description?: string;
  icon?: string;
  useDefaultIcon?: boolean;
  enabled: boolean;
  /** 站点状态（A10）：前台展示面靠它把 broken 站挡在精选/推荐位之外；分类列表仍保留展示并标失效。 */
  status?: string;
  weight?: number;
  trendScore?: number;
  tags?: string[];
  actions?: SiteAction[];
  relations?: SiteRelation[];
  liveMetrics?: SiteLiveMetrics;
  workspaces?: string[];
  health?: SiteHealth;
}

interface NsSubCategory {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  parentId?: string;
  enabled?: boolean;
  items?: NsItem[];
}

interface NsCategory {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  enabled?: boolean;
  items?: NsItem[];
  subCategories?: NsSubCategory[];
}

interface NsNavigationData { navigationItems: NsCategory[] }

/**
 * 单次导出 navigation.json 允许的最大站点数（防大库全表拉取 OOM，可通过 NAVHUB_NAVIGATION_MAX_SITES 调整）。
 *
 * 2026-11-06 深扫 C-3：旧写法 `Math.max(100, Number(env || 15000))`，当 env 是
 * `abc` 时 Number("abc")=NaN，Math.max(100,NaN)=NaN，于是 :266 的 `sites.length > NaN`
 * 恒 false —— 上限静默消失，大库下 /api/storage 全表读进内存组装，OOM 且无日志。
 * 与 SNAPSHOT_TTL_MS 同口径：非法值一律回退默认并显式警告（不静默）。
 */
const NAVIGATION_MAX_SITES = (() => {
  const raw = process.env.NAVHUB_NAVIGATION_MAX_SITES;
  if (raw === undefined || raw.trim() === "") return 15_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 100) {
    console.warn(`[navhub] NAVHUB_NAVIGATION_MAX_SITES 非法值 ${JSON.stringify(raw)}，回退默认 15000`);
    return 15_000;
  }
  return Math.max(100, Math.floor(n));
})();

/* ------------------------------------------------------------------ *
 * 快照读缓存
 *
 * 背景：`/api/storage?path=navigation.json` 每次都会把「全部类目 + 全部站点
 * + 每站增强数据」重新组装一遍。站点规模小时（50 站 ≈ 15ms）无所谓，
 * 但这是全站唯一没有缓存的全量操作，成本随站点数线性增长，而首页
 * `force-dynamic` 会让每次访问都触发它。
 *
 * 失效策略与一致性判据见下面 `snapshotCache` 的注释（P1-1 起以版本号为准）。
 * ------------------------------------------------------------------ */
const SNAPSHOT_TTL_MS = (() => {
  const raw = process.env.NAVHUB_SNAPSHOT_TTL_MS;
  if (raw === undefined || raw.trim() === "") return 30_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30_000;
})();

/**
 * 快照读缓存（升级改造方案 P1-1：版本号取代指纹）。
 *
 * 缓存的**正确性**判据从「COUNT/MAX 指纹」换成 `data_version` 单行表的主键读数：
 *   - 指纹是五条子查询的聚合，PG 上是顺序扫描 —— 而且**命中也要付**，因为它就是命中判据；
 *   - 版本号是 O(1) 点查，且写侧由数据库触发器递增（`migrate.ts` 的 nav_version 触发器），
 *     所以另一个实例/后台任务/运维脚本的写入在下一次读就可见，不再受 TTL 约束。
 *     这一点对标准模式（多副本）才是新能力：以前 A 实例写、B 实例最长滞后一个 TTL。
 *
 * 读顺序是这里唯一真正要紧的一条：**版本号必须在构建之前读**。
 * 反过来（先建、再取版本）会把「V 时刻的数据」标成 V+1：构建窗口里落下的那次写入
 * 被永久记为已包含，缓存于是把旧快照一直喂给「读-改-写」的写侧 —— 就是丢数据。
 * 现在这个方向最多让下一次读多重建一次。
 *
 * 失效仍然有三层，版本号只是把第 3 层从「TTL 兜底」升级成「立即一致」：
 *   1. 写请求成功后 server.ts 的 onResponse 统一 invalidateSnapshotCache()；
 *   2. writeStoragePath 内部再显式失效一次；
 *   3. 版本号（读不到时退回 TTL，见下面的 degradedReads）。
 */
/**
 * 导航快照的两种视图（P1-6）。
 *
 * `raw` 是写回数据源：必须包含停用/待审/归档记录，否则「快照里没有 = 用户删了」
 * 的全量对齐会把它们真删掉。`public` 是给匿名/只读调用方的展示投影：
 * 排除停用记录与未发布状态（pending/archived），避免只读凭据看到后台态。
 *
 * 两者由**同一次查询**构建（见 buildSnapshotPairWithMetrics）：投影差异只是内存里
 * 的过滤，重复查库会让「缓存命中」重新变成一次全量读。
 */
export type NavigationView = "raw" | "public";

interface SnapshotEntry {
  data: NsNavigationData;
  publicData: NsNavigationData;
  expiresAt: number;
  version: number | null;
}

let snapshotCache: SnapshotEntry | null = null;

/** 让下一次读取重建快照。写路径与 server 的 onResponse 都会调用。 */
export function invalidateSnapshotCache(): void {
  snapshotCache = null;
}

/* 观测读数：只给 /metrics 与测试用，不参与任何业务判断 */
let snapshotHits = 0;
let snapshotMisses = 0;
let snapshotBuilds = 0;
/** 版本号取不到（老库没这张表 / 单行没种下）的次数：此时一致性退回 TTL */
let snapshotDegradedReads = 0;
let snapshotLastBuildSeconds = 0;
let snapshotBuildSecondsTotal = 0;
let snapshotLastBytes = 0;

/** 构建一次快照并记录耗时/体积（体积用序列化字节，它就是网络上的那个数）。 */
let inFlightSnapshotPromise: Promise<{ raw: NsNavigationData; publicData: NsNavigationData }> | null = null;
async function buildSnapshotPairWithMetrics(ctx: AppContext): Promise<{ raw: NsNavigationData; publicData: NsNavigationData }> {
  const started = process.hrtime.bigint();
  const { sites, categories } = await loadNavigationRows(ctx);
  const raw = projectNavigation(sites, categories, "raw");
  const publicData = projectNavigation(sites, categories, "public");
  snapshotBuildSecondsTotal += Number(process.hrtime.bigint() - started) / 1e9;
  snapshotBuilds++;
  snapshotLastBuildSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  // 序列化一次只为取体积；重建本身是重路径，这里的个位数毫秒不影响结论
  snapshotLastBytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
  return { raw, publicData };
}

async function readNavigationSnapshot(
  ctx: AppContext,
  view: NavigationView = "raw",
  knownVersion?: number | null,
): Promise<NsNavigationData> {
  const pick = (entry: SnapshotEntry) => (view === "public" ? entry.publicData : entry.data);
  if (SNAPSHOT_TTL_MS <= 0) {
    const built = await buildSnapshotPairWithMetrics(ctx);
    return view === "public" ? built.publicData : built.raw;
  }
  // 路由层为 ETag 已经点查过版本号时直接复用：命中路径因此只付一次点查。
  // 注意 undefined 与 null 的区别 —— null 是「读不到」，仍按降级路径走。
  const version = knownVersion === undefined ? await ctx.repo.readNavDataVersion() : knownVersion;
  const now = Date.now();
  if (snapshotCache && snapshotCache.expiresAt > now) {
    if (version === null) {
      // 降级：没有版本号可用时信任 TTL（和改指纹之前的行为一致），
      // 而不是「读不到就每次重建」——那会让一个可选的观测件变成可用性故障。
      snapshotDegradedReads++;
      snapshotHits++;
      return pick(snapshotCache);
    }
    // 缓存里记的是 null（当时读不到）时不能算命中：那份数据的出处已经无法证明。
    if (snapshotCache.version === version) {
      snapshotHits++;
      return pick(snapshotCache);
    }
  }
  snapshotMisses++;
  // 并发防击穿 (SingleFlight)：多个并发请求只触发一次全量快照构建，
  // 其余请求共享同一个正在执行的 Promise，避免高并发下数据库连接暴涨与 GC 卡死
  if (!inFlightSnapshotPromise) {
    inFlightSnapshotPromise = buildSnapshotPairWithMetrics(ctx).finally(() => {
      inFlightSnapshotPromise = null;
    });
  }
  const built = await inFlightSnapshotPromise;
  snapshotCache = { data: built.raw, publicData: built.publicData, expiresAt: now + SNAPSHOT_TTL_MS, version };
  return pick(snapshotCache);
}

/** 供 /api/health、/api/metrics 与测试观察缓存状态（不参与业务）。 */
export function snapshotCacheInfo(): {
  cached: boolean;
  ttlMs: number;
  /** 当前缓存条目的数据版本号；null = 没缓存或版本号不可用 */
  version: number | null;
  hits: number;
  misses: number;
  builds: number;
  /** 版本号读不到、只能靠 TTL 保持一致的读取次数（非 0 = 触发器没建起来或老库） */
  degradedReads: number;
  lastBuildSeconds: number;
  /** 构建耗时合计（秒）：用于平均 rebuild 时间，避免再加一个带 label 的直方图 */
  buildSecondsTotal: number;
  /** 最近一次快照的序列化字节数 */
  bytes: number;
} {
  return {
    cached: snapshotCache !== null,
    ttlMs: SNAPSHOT_TTL_MS,
    version: snapshotCache?.version ?? null,
    hits: snapshotHits,
    misses: snapshotMisses,
    builds: snapshotBuilds,
    degradedReads: snapshotDegradedReads,
    lastBuildSeconds: snapshotLastBuildSeconds,
    buildSecondsTotal: snapshotBuildSecondsTotal,
    bytes: snapshotLastBytes,
  };
}

/** 测试用：把观测计数清零（不改缓存内容本身） */
export function resetSnapshotMetricsForTest(): void {
  snapshotHits = 0;
  snapshotMisses = 0;
  snapshotBuilds = 0;
  snapshotDegradedReads = 0;
  snapshotLastBuildSeconds = 0;
  snapshotBuildSecondsTotal = 0;
  snapshotLastBytes = 0;
}


/**
 * 把数据库读成 NavSphere 的 navigation.json 形状。
 * 组级顺序严格按 sort，保证前端拖拽排序结果可复现。
 *
 * 不做可见性过滤 —— 快照是写回数据源，见 buildNavigationData 上方注释。
 */
async function loadNavigationRows(ctx: AppContext): Promise<{
  sites: Awaited<ReturnType<AppContext["repo"]["listAllSites"]>>;
  categories: Awaited<ReturnType<AppContext["repo"]["listCategories"]>>;
}> {
  // 容量守卫：以前先跑一条 `stats()`（五个 COUNT/MAX 聚合）只为判断「会不会超上限」，
  // 而现在正要把这类重查询请出热路径 —— 改成「多取一行」：
  // 拉到 MAX+1 行就说明库里确实更多，直接 413；否则这批行本身就是要用数据，
  // 一次查询同时完成守卫与取数。代价是报错里不再给出精确总数（只说超过上限），
  // 而精确总数对处置建议没有影响。
  //
  // `facets: false`：快照形状（NsItem）里没有分面，写回也从不按快照里的分面删分面
  // （见 upsertSite），所以这里省掉一条聚合查询 —— 整个快照因此是 4 条语句。
  const sites = await ctx.repo.listAllSites(NAVIGATION_MAX_SITES + 1, { facets: false });
  if (sites.length > NAVIGATION_MAX_SITES) {
    const err = new Error(
      `站点数已超过单文件快照上限 (${NAVIGATION_MAX_SITES})，请改用分页接口 /api/sites 或调大 NAVHUB_NAVIGATION_MAX_SITES`,
    ) as Error & { statusCode?: number };
    err.statusCode = 413;
    throw err;
  }
  const categories = (await ctx.repo.listCategories()).sort((a, b) => a.sort - b.sort);
  return { sites, categories };
}

/**
 * 可见性判据（P1-6）。
 *
 * 与 `/api/sites` 的数据面最小化口径一致：pending / archived 是编辑工作面的
 * 中间态，只读调用方无权知道它们是否存在；broken 是「已上线但暂时不可用」，
 * 站点列表对匿名可见，这里也保留（否则一次探针失败就会让链接从导航消失）。
 * `enabled=false` 是管理员手动停用，任何公开投影都不应包含。
 */
export function isPubliclyVisibleSite(s: { enabled: boolean; status: string }): boolean {
  return s.enabled !== false && (s.status === "active" || s.status === "broken");
}

/**
 * 投影：把行集组装成导航树。
 *
 * `view="public"` 只做过滤，不改字段 —— 前台渲染消费 actions/relations/
 * liveMetrics/workspaces/health，裁剪字段会让公开快照与站内渲染出现两套数据。
 */
function projectNavigation(
  sites: Awaited<ReturnType<AppContext["repo"]["listAllSites"]>>,
  categories: Awaited<ReturnType<AppContext["repo"]["listCategories"]>>,
  view: NavigationView,
): NsNavigationData {
  const publicOnly = view === "public";
  const visibleSites = publicOnly ? sites.filter(isPubliclyVisibleSite) : sites;
  const visibleCategories = publicOnly ? categories.filter((c) => c.enabled !== false) : categories;
  // 类目与站点**都不做可见性预过滤**（raw 视图）：快照必须是数据的全量投影。
  // 隐藏语义（enabled=false）由渲染层负责 —— web 端 data-loader 的
  // filterNavigationData 已经过滤了类目/子类目/站点三级。
  //
  // 为什么 raw 不能在这里预过滤：快照写回把「快照里没有」当成「用户删了」。
  // 被停用的类目如果在读侧就被滤掉，NavSphere 原版后台（按快照读改写）
  // 既看不到它、也无法再启用它，下一次任意保存还会把它硬删、站点进回收站。
  //
  // 站点必须先于类目取到位：`listSites` 默认 limit 100，快照以前会静默截断到
  // 100 个站点，所以这里用的是全量版本（同上面容量守卫的那一次查询）。
  const byCategory = new Map<string, typeof visibleSites>();
  for (const s of visibleSites) {
    const list = byCategory.get(s.categoryId);
    if (list) list.push(s); else byCategory.set(s.categoryId, [s]);
  }

  const toItem = (s: (typeof visibleSites)[number], tags: string[]): NsItem => {
    const enhanced = getEnhancedSiteData(s.url, s.title);
    return {
      id: s.id,
      title: s.title,
      href: s.url,
      description: s.description ?? undefined,
      // 自定义图标走 resolveSiteIcon 的第 3 参（而非 `iconKey || ...` 短路）：
      // 指向第三方图标服务的脏值会在这里被视同没有自定义图标，避免进快照 / RSC payload。
      icon: resolveSiteIcon(s.url, s.title, s.iconKey),
      enabled: s.enabled,
      status: s.status,
      weight: s.weight,
      trendScore: s.trendScore,
      tags: s.tags ?? tags,
      actions: s.actions ?? enhanced.actions,
      relations: s.relations ?? enhanced.relations,
      liveMetrics: s.liveMetrics ?? enhanced.liveMetrics,
      workspaces: s.workspaces ?? enhanced.workspaces,
      health: s.health,
    };
  };

  const compareSitesByRank = (a: any, b: any): number => {
    // 优先：显式指定的有效排序序号（正整数）
    if (a.sort !== b.sort && a.sort > 0 && b.sort > 0) return a.sort - b.sort;
    // 次级：网站综合权威权重降序（高权重排在前面）
    const wA = typeof a.weight === "number" ? a.weight : 0;
    const wB = typeof b.weight === "number" ? b.weight : 0;
    if (wA !== wB) return wB - wA;
    // 三级：若权重相同，按 sort 升序兜底
    if (a.sort !== b.sort) return a.sort - b.sort;
    // 四级：按热度分 trend_score 降序
    const tA = typeof a.trendScore === "number" ? a.trendScore : 0;
    const tB = typeof b.trendScore === "number" ? b.trendScore : 0;
    if (tA !== tB) return tB - tA;
    // 末级：按点击量降序
    return (b.visitCount ?? 0) - (a.visitCount ?? 0);
  };

  const tops = visibleCategories.filter((c) => c.parentId === null);
  const navigationItems: NsCategory[] = tops.map((c) => {
    const own = (byCategory.get(c.id) ?? []).sort(compareSitesByRank);
    const children = visibleCategories.filter((x) => x.parentId === c.id).sort((a, b) => a.sort - b.sort);

    const node: NsCategory = {
      id: c.id,
      title: c.title,
      icon: c.icon ?? undefined,
      description: c.description ?? undefined,
      enabled: c.enabled,
    };
    if (own.length > 0) node.items = own.map((s) => toItem(s, s.tags));
    if (children.length > 0) {
      node.subCategories = children.map((sub) => {
        const subSites = (byCategory.get(sub.id) ?? []).sort(compareSitesByRank);
        return {
          id: sub.id,
          title: sub.title,
          icon: sub.icon ?? undefined,
          description: sub.description ?? undefined,
          parentId: c.id,
          enabled: sub.enabled,
          items: subSites.map((s) => toItem(s, s.tags)),
        };
      });
    }
    return node;
  });

  return { navigationItems };
}

export async function buildNavigationData(ctx: AppContext): Promise<NsNavigationData> {
  const { sites, categories } = await loadNavigationRows(ctx);
  return projectNavigation(sites, categories, "raw");
}

/**
 * 「前端快照托管」的 source 集合——只有这些来源的记录会被全量对齐删除。
 *   null / navsphere：NavSphere 前端自己创建/编辑的（默认托管）
 *   seed：一次性导入的初始内容（管理员在后台里照常管理，可删）
 * 其余来源（manual / api / mcp / mcp-batch / ai / submission / import）
 * 是经其它通道创建的，即使不在快照里也必须保留——否则用 MCP 加一个站点、
 * 前端后台再保存一次导航，那个站点就被静默删除了（D1：真实的数据丢失）。
 */
const SNAPSHOT_MANAGED_SOURCES = new Set<string | null>([null, "navsphere", "seed"]);

function isSnapshotManaged(source: string | null | undefined): boolean {
  return SNAPSHOT_MANAGED_SOURCES.has(source ?? null);
}

/**
 * 把 NavSphere 提交上来的 navigation.json 整体写回数据库。
 * 采用「全量对齐」而非逐条 diff：前台提交的就是完整快照，语义更明确、也更不容易漏。
 *
 * 全量对齐的删除语义有**来源过滤**（D1 缺陷的修复），见 isSnapshotManaged。
 *
 * 写放大的收口（P1-2）：存量行已经全量读出，diff 在内存里做；只有真正变化的
 * 站点才落 UPDATE，新增/复活/删除分别走多行 INSERT、批量 UPDATE、批量软删。
 * 此前是每站点 `updateSite`（先读、再写、再回读）——8k 站点保存 ≈ 1.6 万次重读
 * 全部压在同一条写事务里，SQLite 长时间持锁。
 */
export async function writeNavigationData(
  ctx: AppContext,
  data: NsNavigationData,
  guard: ShrinkGuardOptions = {},
): Promise<{ categories: number; sites: number }> {
  // 标签同步与向量回填在主事务提交后执行（setSiteTags 自带事务、向量索引在
  // 库外，都不能嵌套进主事务）：事务内只收集待办，提交后逐项落实。
  const pendingTagSync: Array<{ id: string; tags: string[] }> = [];
  const pendingReindexIds = new Set<string>();
  const result = await ctx.repo.withTransaction(async () => {
    const input = Array.isArray(data?.navigationItems) ? data.navigationItems : [];
    let categoryCount = 0;
    let siteCount = 0;

    const existingCats = await ctx.repo.listCategories();
    // 必须全量：只看到前 100 个存量站点时，超出部分会在下面被当作「不在快照里」
    // 或匹配不到存量行走 createSiteWithId 撞主键（见 listAllSites 注释）。
    // facets:false：写回只用 id / source / categoryId（索引字段的标签由
    // updateSitesFromSnapshot 对变化行补取），一条 8000 行的聚合查询换不来任何语义。
    // 写侧与读侧（buildNavigationData）同款 MAX+1 探测：超限直接 413，否则
    // 存量基线被静默截断——缩水判据失真，且截断行会被误判「新增」撞主键 500
    // （写侧容量守卫，P1-1）。
    const existingSites = await ctx.repo.listAllSites(NAVIGATION_MAX_SITES + 1, { facets: false });
    if (existingSites.length > NAVIGATION_MAX_SITES) {
      const err = new Error(
        `站点数已超过单文件快照上限 (${NAVIGATION_MAX_SITES})，保存被拒绝：请调大 NAVHUB_NAVIGATION_MAX_SITES`,
      ) as Error & { statusCode?: number };
      err.statusCode = 413;
      throw err;
    }
    // O(1) 索引代替线性 find：原来是"每个快照条目扫一遍全表"= O(n²)，
    // 数千站点的大库保存一次要做上百万次比较（实测是最主要的保存耗时来源）。
    const catIndex = new Map(existingCats.map((c) => [c.id, c]));
    const siteIndex = new Map(existingSites.map((s) => [s.id, s]));
    // 快照「可见集」：与 buildNavigationData 的投影规则严格一致（顶级类目 + 其直接子类目）。
    // 只有本该出现在快照里的记录，缺席才等于被删除；快照模型看不见的记录
    // （三级及更深类目、父类目不存在的孤儿类目）不能被写回顺手清掉。
    const emittedCatIds = new Set<string>();
    for (const c of existingCats) {
      if (c.parentId === null) emittedCatIds.add(c.id);
      else if (catIndex.get(c.parentId)?.parentId === null) emittedCatIds.add(c.id);
    }
    const seenCategoryIds = new Set<string>();
    const seenSiteIds = new Set<string>();
    // 快照里的站点先收集，循环结束后统一分类落库；重复 id 的顺序语义与逐条写回一致
    // （后出现的覆盖先出现的）。
    const snapshotSites: ReturnType<typeof snapshotSiteWrite>[] = [];

    let catSort = 0;
    for (const top of input) {
      seenCategoryIds.add(top.id);
      const existing = catIndex.get(top.id);
      if (existing) {
        await ctx.repo.updateCategory(top.id, {
          title: top.title,
          icon: top.icon ?? null,
          description: top.description ?? null,
          enabled: top.enabled !== false,
          sort: catSort,
        });
      } else {
        await ctx.repo.createCategory({
          id: top.id, title: top.title, icon: top.icon ?? null,
          description: top.description ?? null, sort: catSort, source: "navsphere",
        });
      }
      categoryCount++;
      catSort++;

      let itemSort = 0;
      for (const item of top.items ?? []) {
        seenSiteIds.add(item.id);
        snapshotSites.push(snapshotSiteWrite(item, top.id, itemSort++));
        siteCount++;
      }

      for (const sub of top.subCategories ?? []) {
        seenCategoryIds.add(sub.id);
        const subExisting = catIndex.get(sub.id);
        if (subExisting) {
          await ctx.repo.updateCategory(sub.id, {
            title: sub.title, icon: sub.icon ?? null,
            description: sub.description ?? null, enabled: sub.enabled !== false, sort: catSort,
          });
        } else {
          await ctx.repo.createCategory({
            id: sub.id, title: sub.title, icon: sub.icon ?? null,
            description: sub.description ?? null, parentId: top.id, sort: catSort, source: "navsphere",
          });
        }
        categoryCount++;
        catSort++;

        itemSort = 0;
        for (const item of sub.items ?? []) {
          seenSiteIds.add(item.id);
          snapshotSites.push(snapshotSiteWrite(item, sub.id, itemSort++));
          siteCount++;
        }
      }
    }

    // 缩水保护：快照是整包覆盖，前端一次客户端 bug 或误操作就能把库删空。
    // 基线只数「这份快照有权删除的托管站点」（来源受管 + 类目在可见集里），
    // 手工/MCP 创建的站点不参与比较——否则一个 5000 站点的库加了两条手工记录，
    // 就会让 80% 的判据悄悄变宽/变窄。
    // 类目更新已经在这个事务里执行过，这里抛错会整体回滚，不会留下「改了一半」。
    const managedExistingCount = existingSites.filter(
      (s) => isSnapshotManaged(s.source) && emittedCatIds.has(s.categoryId),
    ).length;
    const shrink = evaluateNavigationShrink(managedExistingCount, snapshotSites.length);

    // 类目维度守卫（P0-1）：站点守卫盯的是站点数，纯类目树不受它保护，
    // 而类目删除是物理删除（无回收站）。两道判据：
    //   1) 基线判据：托管可见类目 ≥ NAV_CATEGORY_SHRINK_MIN_BASELINE 时套用同款 80% 判据；
    //   2) 子树清空探测：挂 ≥ NAV_CATEGORY_SUBTREE_WIPE_MIN_CHILDREN 个托管子类目的
    //      可见类目被快照清零——真实运营极少整层清空，形状回归每次都长这样。
    // 只数托管子类目：MCP/API 创建的类目本就不在删除范围内（D1），不构成「丢失」。
    const managedVisibleCats = existingCats.filter(
      (c) => isSnapshotManaged(c.source) && emittedCatIds.has(c.id),
    );
    const categoryShrink = evaluateCategoryShrink(managedVisibleCats.length, categoryCount);
    const childrenByParent = new Map<string, number>();
    for (const c of existingCats) {
      if (c.parentId !== null && isSnapshotManaged(c.source) && emittedCatIds.has(c.parentId)) {
        childrenByParent.set(c.parentId, (childrenByParent.get(c.parentId) ?? 0) + 1);
      }
    }
    const wipedSubtrees: string[] = [];
    for (const top of input) {
      const existingChildren = childrenByParent.get(top.id) ?? 0;
      if (existingChildren >= NAV_CATEGORY_SUBTREE_WIPE_MIN_CHILDREN && (top.subCategories ?? []).length === 0) {
        wipedSubtrees.push(`「${top.title}」${existingChildren} -> 0`);
      }
    }
    const categoryViolation = categoryShrink
      ? `托管可见类目 ${managedVisibleCats.length} -> ${categoryCount}（低于 ${NAV_CATEGORY_SHRINK_MIN_BASELINE} 基线的 80%）`
      : wipedSubtrees.length > 0
        ? `子类目整层丢失：${wipedSubtrees.join("、")}`
        : null;

    // 站点与类目判据共用同一套二阶段确认协议：expectedCount 声明的都是
    // 本次真实写入的站点数（重试客户端只需要一个数字，两个判据同时校验）。
    if (shrink || categoryViolation) {
      const verdict = shrink ?? {
        existingCount: managedExistingCount,
        incomingCount: snapshotSites.length,
        minimumAllowed: Math.ceil(managedExistingCount * NAVIGATION_SHRINK_KEEP_RATIO),
      };
      const fullVerdict = categoryViolation ? { ...verdict, categoryViolation } : verdict;
      if (!guard.confirmLargeDeletion) throw new NavigationShrinkError("navigation_shrink_requires_confirmation", fullVerdict);
      if (guard.expectedCount === undefined) throw new NavigationShrinkError("navigation_shrink_expected_count_required", fullVerdict);
      if (guard.expectedCount !== snapshotSites.length) {
        throw new NavigationShrinkError("navigation_shrink_expected_count_mismatch", { ...fullVerdict, declaredExpectedCount: guard.expectedCount });
      }
    }

    // 内存 diff：存量行命中且字段一致 → 跳过（重复保存是后台最常见的回流路径）。
    // 不在存量集合里的 id 还要区分「真新增」与「回收站复活」：后者若走 INSERT
    // 会撞主键，语义也必须是复活（清空关联数据）而不是新建。
    const toUpdate: ReturnType<typeof snapshotSiteWrite>[] = [];
    const toCreate: ReturnType<typeof snapshotSiteWrite>[] = [];
    for (const row of snapshotSites) {
      const found = siteIndex.get(row.id);
      if (!found) toCreate.push(row);
      else if (snapshotSiteChanged(found, row)) toUpdate.push(row);
    }
    const deletedIds = await ctx.repo.listDeletedSiteIds(toCreate.map((row) => row.id));
    const toRevive = toCreate.filter((row) => deletedIds.has(row.id));
    const toInsert = toCreate.filter((row) => !deletedIds.has(row.id));

    if (toUpdate.length > 0) await ctx.repo.updateSitesFromSnapshot(toUpdate);
    if (toRevive.length > 0) await ctx.repo.reviveSitesFromSnapshot(toRevive);
    if (toInsert.length > 0) {
      await ctx.repo.insertSitesBulk(
        toInsert.map((row) => ({ ...row, source: "navsphere" })),
        { hydrate: false },
      );
    }

    // 标签同步的待办收集：SnapshotSiteWrite 刻意不带 tags（批量写行不碰标签表），
    // 于是在此之前，新导入的站点永远没有标签、文件里改了标签也永不生效——
    // 搜索的标签通道与「相似站点」对这批站点恒哑。这里把快照文件里的 tags
    // 与库内现有标签（slug 口径）逐站比对，有差异的记入 pendingTagSync，
    // 事务提交后由 setSiteTags 落实。（标签不进 embedding 文本——
    // siteEmbeddingText 只用标题/简介/网址——故标签变化本身不需要重建向量；
    // 需要重建的是标题/简介/网址真变了的站点，见下方 pendingReindexIds。）
    const tagsById = new Map<string, string[]>();
    for (const top of input) {
      for (const item of top.items ?? []) {
        if (Array.isArray(item.tags)) tagsById.set(item.id, item.tags);
      }
      for (const sub of top.subCategories ?? []) {
        for (const item of sub.items ?? []) {
          if (Array.isArray(item.tags)) tagsById.set(item.id, item.tags);
        }
      }
    }
    const insertedOrRevived = new Set([...toInsert, ...toRevive].map((r) => r.id));
    for (const row of snapshotSites) {
      const desired = tagsById.get(row.id);
      if (!desired) continue;
      const existingSlugs = new Set((siteIndex.get(row.id)?.tags ?? []).map((t) => slugify(t)));
      const desiredSlugs = new Set(desired.map((t) => slugify(t)));
      const differs =
        insertedOrRevived.has(row.id) ||
        existingSlugs.size !== desiredSlugs.size ||
        [...desiredSlugs].some((s) => !existingSlugs.has(s));
      if (differs) {
        pendingTagSync.push({ id: row.id, tags: desired });
      }
    }
    for (const row of [...toUpdate, ...toInsert, ...toRevive]) pendingReindexIds.add(row.id);

    // 快照语义：本次未出现的「前端托管」站点/类目视为被删除。
    // 这是"全量对齐"必须付的代价，也是它比 diff 更可靠的原因。
    // 但删除范围被 source 严格限界（D1 缺陷修复）：经 API/MCP/AI/投稿创建的
    // 记录即使不在快照里也保留——否则用 MCP 加一个站点、前端后台再保存一次
    // 导航，那个站点就被静默删除了（真实的数据丢失）。
    const removedSiteIds = existingSites
      .filter((s) => isSnapshotManaged(s.source) && !seenSiteIds.has(s.id))
      // 只有「可见集里的站点」缺席才算删除；所属类目不在快照可见集里
      // （孤儿 categoryId 等，接口未强校验）的站点本就不进快照，不能据此删除。
      .filter((s) => emittedCatIds.has(s.categoryId))
      .map((s) => s.id);
    if (removedSiteIds.length > 0) {
      await ctx.repo.softDeleteSites(removedSiteIds);
      await ctx.vectors.remove(removedSiteIds).catch(() => undefined);
    }
    for (const c of existingCats) {
      // 同上：不可见的类目缺席 ≠ 删除
      if (isSnapshotManaged(c.source) && emittedCatIds.has(c.id) && !seenCategoryIds.has(c.id)) await ctx.repo.deleteCategory(c.id);
    }

    // 确认放行与数据写在同一个事务里：审计要么和数据一起提交，要么一起回滚。
    // 类目守卫命中也属于「大规模删除」：放行审计要携带类目说明，事后才连得起来。
    if (shrink || categoryViolation) {
      await guard.onLargeDeletionConfirmed?.(
        categoryViolation ? { existingCount: managedExistingCount, incomingCount: snapshotSites.length, minimumAllowed: Math.ceil(managedExistingCount * NAVIGATION_SHRINK_KEEP_RATIO), categoryViolation } : (shrink as ShrinkVerdict),
      );
    }
    return { categories: categoryCount, sites: siteCount };
  });

  // 主事务已提交：落实标签同步与向量回填。单站失败不回滚已提交的导航数据
  // （与上方 vectors.remove 的处理一致），下一次整包导入会再次比对补齐。
  for (const t of pendingTagSync) {
    await ctx.repo.setSiteTags(t.id, t.tags).catch(() => undefined);
  }
  if (pendingReindexIds.size > 0) {
    const fresh = await ctx.repo.getSitesByIds([...pendingReindexIds]);
    const items = [...fresh.values()].map((s) => ({ id: s.id, title: s.title, description: s.description ?? null, url: s.url }));
    await indexSitesBatch(ctx, items).catch(() => undefined);
  }
  // A3 分面回填：快照不带 facets（见上方注释），新导入的站点 pricing 恒为空——
  // 在此对全库 heal 一遍：缺 pricing/platform 的按 core 推导补齐（人工核实
  // 覆盖表 > 强信号规则 > unknown 显式未标注），已有值永不覆盖（管理员手标
  // 优先）。必须排在标签同步之后：推导信号包含标签。失败只吞掉记日志，
  // 与标签/向量两项 post-commit 的容错口径一致，下次写回会再次 heal。
  try {
    const allSites = await ctx.repo.listAllSites(NAVIGATION_MAX_SITES, {});
    const facetReport = await backfillDerivedFacets(ctx, allSites);
    if (facetReport.filledPricing > 0 || facetReport.filledPlatform > 0) {
      console.info(`[storage] 分面回填：${formatFacetBackfillReport(facetReport)}`);
    }
  } catch (err) {
    console.warn("[storage] 分面回填失败（不影响本次写回）:", err);
  }
  return result;
}

type SiteRow = Awaited<ReturnType<AppContext["repo"]["listSites"]>>[number];

/** 快照条目 → 托管字段（与旧 upsertSite 的取值规则逐字一致） */
function snapshotSiteWrite(item: NsItem, categoryId: string, sort: number) {
  // 自定义图标作为第 3 参传给 resolveSiteIcon：指向第三方图标服务的脏值不会写回库里
  // （前端后台把快照读出来再保存一遍是常见的回流路径，这里必须同样净化）
  const resolvedIcon = resolveSiteIcon(item.href, item.title, item.icon);
  return {
    id: item.id,
    url: item.href,
    title: item.title ?? item.href,
    description: item.description ?? null,
    categoryId,
    iconKey: resolvedIcon || null,
    enabled: item.enabled !== false,
    sort,
  };
}

/** 快照托管的字段是否有变化；不变就不写（updated_at 也不动） */
function snapshotSiteChanged(existing: SiteRow, row: ReturnType<typeof snapshotSiteWrite>): boolean {
  return (
    existing.url !== row.url ||
    existing.title !== row.title ||
    (existing.description ?? null) !== row.description ||
    existing.categoryId !== row.categoryId ||
    (existing.iconKey ?? null) !== row.iconKey ||
    (existing.enabled !== false) !== row.enabled ||
    Number(existing.sort ?? 0) !== row.sort
  );
}

/**
 * site.json 的基线默认值。
 *
 * 为什么必须有基线：前端的 generateMetadata() 直接读 siteData.basic.title 等字段，
 * 若中枢在"用户从未保存过站点配置"时返回 {}，首页会在渲染期抛错。
 * 因此这里给出可用的默认品牌信息，用户后台保存后会覆盖它。
 */
export const DEFAULT_SITE_CONFIG = {
  basic: {
    // 留「导航」作类目描述词：seo-audit 的 <title> ≥4 字符底线与 e2e 标题断言都依赖它
    title: "山羊胡导航",
    description: "AI 原生的网址导航 —— 支持中文语义检索、拼音与关键词混合召回",
    keywords: "网址导航,导航站,AI 导航,语义检索,书签",
  },
  appearance: {
    logo: "/assets/images/alogo.webp",
    favicon: "/assets/images/favicon.webp",
    theme: "system",
  },
  navigation: { linkTarget: "_blank" },
} as const;

/**
 * site.json：站点全局配置。用 jobs 表里的键值存储，避免为此另加一张表。
 * 未保存过时返回 DEFAULT_SITE_CONFIG（而不是空对象），保证前端渲染不炸。
 */
export async function readSiteConfig(ctx: AppContext): Promise<Record<string, unknown>> {
  const row = await readKv(ctx, "site-config");
  if (!row || typeof row !== "object" || Object.keys(row as object).length === 0) {
    return structuredClone(DEFAULT_SITE_CONFIG) as unknown as Record<string, unknown>;
  }
  return row as Record<string, unknown>;
}

export async function writeSiteConfig(ctx: AppContext, config: Record<string, unknown>): Promise<void> {
  await ctx.repo.withTransaction(async () => {
    await lockBrandAssets(ctx);
    for (const [path, references] of assetReferences(config)) {
      if (await readKv(ctx, pathToKey(path)) === null) {
        throw Object.assign(new Error(`引用的上传资源不存在，请重新上传：${references.join("、")}`), { statusCode: 409 });
      }
    }
    await writeKv(ctx, "site-config", config);
  });
}

/** resource-metadata.json：资源（工具/文档）元数据 */
export async function readResourceMetadata(ctx: AppContext): Promise<unknown> {
  return (await readKv(ctx, "resource-metadata")) ?? {};
}

export async function writeResourceMetadata(ctx: AppContext, data: unknown): Promise<void> {
  await writeKv(ctx, "resource-metadata", data);
}

/**
 * 视频库条目计数：顶层 items + 子分类 items。
 *
 * 口径与关系表同步（video-catalog.ts 的 flatten）保持一致，否则缩水保护
 * 会比错两把尺子——文档里 300 条、表里 320 条时按比例判定毫无意义。
 */
export function countVideoDocItems(data: unknown): number {
  const items = (data as { navigationItems?: any[] })?.navigationItems || [];
  return items.reduce((acc: number, c: any) => {
    return acc + (c.items?.length || 0) + (c.subCategories || []).reduce((s: number, sub: any) => s + (sub.items?.length || 0), 0);
  }, 0);
}

/** 触发缩水保护所需的最小存量（少于它说明多半是首次导入，不是覆盖写） */
export const VIDEO_SHRINK_MIN_BASELINE = 100;
/** 允许的最低保留比例：写入量低于存量的 80% 即视为疑似数据损毁 */
export const VIDEO_SHRINK_KEEP_RATIO = 0.8;

/** 一次疑似缩水的覆盖写：三个数字是给操作者做判断用的，缺一不可 */
export interface ShrinkVerdict {
  existingCount: number;
  incomingCount: number;
  minimumAllowed: number;
  /** 调用方声明的条数；二阶段确认时必填 */
  declaredExpectedCount?: number;
  /** 类目维度守卫的命中说明（站点判据未触发时它就是主因）；进 409 响应体与审计 diff */
  categoryViolation?: string;
}

export type VideoShrinkVerdict = ShrinkVerdict;

/** 纯函数：方便把「判定」和「拦截后的处置」分开测 */
export function evaluateVideoShrink(existingCount: number, incomingCount: number): ShrinkVerdict | null {
  if (existingCount < VIDEO_SHRINK_MIN_BASELINE) return null;
  if (incomingCount >= existingCount * VIDEO_SHRINK_KEEP_RATIO) return null;
  return {
    existingCount,
    incomingCount,
    minimumAllowed: Math.ceil(existingCount * VIDEO_SHRINK_KEEP_RATIO),
  };
}

export type VideoShrinkBlockCode =
  | "video_shrink_requires_confirmation"
  | "video_shrink_expected_count_required"
  | "video_shrink_expected_count_mismatch";

/**
 * 缩水保护拦下了一次写入。
 *
 * 409 而不是 500：这是一次「按设计被拒」的请求，客户端要能据此弹出确认框，
 * 而不是把它当成中枢故障重试。`code` 是给机器的，`message` 是给操作者的。
 */
export class VideoShrinkError extends Error {
  readonly code: VideoShrinkBlockCode;
  readonly verdict: ShrinkVerdict;
  constructor(code: VideoShrinkBlockCode, verdict: ShrinkVerdict) {
    const { existingCount, incomingCount, minimumAllowed, declaredExpectedCount } = verdict;
    const base = `待写入 ${incomingCount} 条，少于库内 ${existingCount} 条的 80%（下限 ${minimumAllowed} 条）`;
    super(
      code === "video_shrink_requires_confirmation"
        ? `写入被视频库缩水保护拦下：${base}。若这确实是一次合法的大规模删除，请带 confirmLargeDeletion=true 且 expectedCount=${incomingCount} 重试`
        : code === "video_shrink_expected_count_required"
          ? `已确认大规模删除，但仍缺 expectedCount：${base}，expectedCount 必须填本次真实写入的 ${incomingCount} 条`
          : `expectedCount 与真实写入条数不一致：声明 ${declaredExpectedCount} 条，实际 ${incomingCount} 条（${base}），拒绝放行`,
    );
    this.name = "VideoShrinkError";
    this.code = code;
    this.verdict = verdict;
  }
  get statusCode(): number {
    return 409;
  }
}

/** 两阶段确认的参数：视频库与导航快照写回共用 */
export interface ShrinkGuardOptions {
  /** 二阶段确认的第一段：调用方明确知道这是一次大规模删除 */
  confirmLargeDeletion?: boolean;
  /**
   * 二阶段确认的第二段：调用方声明「我这次就是要写这么多条」。
   *
   * 必须与真实条数逐字相等，确认才有效——否则一个陈旧的确认框（或者一个
   * 无脑带 confirm=true 的脚本）可以把任意内容盖掉，保护就退化成了摆设。
   */
  expectedCount?: number;
  /** 确认放行后回调：身份与 IP 只有调用方知道，审计由它落笔 */
  onLargeDeletionConfirmed?: (verdict: ShrinkVerdict) => void | Promise<void>;
}

/* ------------------------- 导航快照写回的缩水保护 ------------------------- */

/**
 * 判据与视频库相同（100 基线 / 80% 保留率），但常量分开导出：
 * 两个域的「正常批量删除」频率不同，允许以后各自调参而不互相牵连。
 */
export const NAVIGATION_SHRINK_MIN_BASELINE = 100;
export const NAVIGATION_SHRINK_KEEP_RATIO = 0.8;

/**
 * 类目维度守卫（P0-1）的独立常量。
 *
 * 为什么需要：站点守卫盯的是站点数，纯类目树不受它保护——子类目整层被前端
 * 形状回归（丢 `subCategories` 字段）清掉时，站点若都挂在子类目下会跟着软删
 * （数量变化被站点守卫接住），但**挂在顶级类目下的类目树**（或站点都还在、
 * 只是挪了位置）完全绕过站点判据；而类目删除是物理删除，没有回收站。
 *
 *  - `NAV_CATEGORY_SHRINK_MIN_BASELINE`：类目基线判据的最小规模。类目总量远小
 *    于站点，照抄 100 基线等于永远不触发；20 是「值得为它保留整层结构」的量级。
 *  - `NAV_CATEGORY_SUBTREE_WIPE_MIN_CHILDREN`：子树清空探测的阈值。一个挂满
 *    ≥3 个托管子类目的可见类目被快照清零，真实运营极少这么干，形状回归却
 *    每次都长这样——与规模无关，任何库都受保护。
 */
export const NAV_CATEGORY_SHRINK_MIN_BASELINE = 20;
export const NAV_CATEGORY_SUBTREE_WIPE_MIN_CHILDREN = 3;

/**
 * 类目基线判据（纯函数）：与 evaluateNavigationShrink 同款 80% 保留率，
 * 但基线独立（20）——直接复用站点判据会把 100 基线带进来，类目总量
 * 通常不过十几二十个，那样等于永远不触发。
 */
export function evaluateCategoryShrink(existingCount: number, incomingCount: number): ShrinkVerdict | null {
  if (existingCount < NAV_CATEGORY_SHRINK_MIN_BASELINE) return null;
  if (incomingCount >= existingCount * NAVIGATION_SHRINK_KEEP_RATIO) return null;
  return {
    existingCount,
    incomingCount,
    minimumAllowed: Math.ceil(existingCount * NAVIGATION_SHRINK_KEEP_RATIO),
  };
}

/** 纯函数：基线是「当前可被这次快照删除的托管站点数」，不是全表站点数 */
export function evaluateNavigationShrink(existingCount: number, incomingCount: number): ShrinkVerdict | null {
  if (existingCount < NAVIGATION_SHRINK_MIN_BASELINE) return null;
  if (incomingCount >= existingCount * NAVIGATION_SHRINK_KEEP_RATIO) return null;
  return {
    existingCount,
    incomingCount,
    minimumAllowed: Math.ceil(existingCount * NAVIGATION_SHRINK_KEEP_RATIO),
  };
}

export type NavigationShrinkBlockCode =
  | "navigation_shrink_requires_confirmation"
  | "navigation_shrink_expected_count_required"
  | "navigation_shrink_expected_count_mismatch";

export class NavigationShrinkError extends Error {
  readonly code: NavigationShrinkBlockCode;
  readonly verdict: ShrinkVerdict;
  constructor(code: NavigationShrinkBlockCode, verdict: ShrinkVerdict) {
    const { existingCount, incomingCount, minimumAllowed, declaredExpectedCount } = verdict;
    const base = `待写入 ${incomingCount} 个站点，少于库内可托管站点 ${existingCount} 个的 80%（下限 ${minimumAllowed} 个）`;
    // 类目守卫命中时它才是主因（站点判据可能根本没触发），必须让人第一眼看到真实原因
    const catNote = verdict.categoryViolation ? `类目守卫命中：${verdict.categoryViolation}。` : "";
    super(
      code === "navigation_shrink_requires_confirmation"
        ? `${catNote}写入被导航快照缩水保护拦下：${base}。若这确实是一次合法的大规模删除，请带 confirmLargeDeletion=true 且 expectedCount=${incomingCount} 重试`
        : code === "navigation_shrink_expected_count_required"
          ? `${catNote}已确认大规模删除，但仍缺 expectedCount：${base}，expectedCount 必须填本次真实写入的 ${incomingCount} 个站点`
          : `${catNote}expectedCount 与真实写入条数不一致：声明 ${declaredExpectedCount} 个站点，实际 ${incomingCount} 个（${base}），拒绝放行`,
    );
    this.name = "NavigationShrinkError";
    this.code = code;
    this.verdict = verdict;
  }
  get statusCode(): number {
    return 409;
  }
}

/**
 * videos.json：视频导航数据。
 *
 * 从未写入过时返回 **null**（而不是 { navigationItems: [] }）。
 * 这是刻意的：null 让前端能区分「本来就没数据」（静默回退到构建期基线）
 * 与「中枢里确实存了空列表」—— 否则像 /videos 这种从没存过的页面
 * 会在**每个请求**上刷一条回退警告，把真正的问题淹没。
 */
/* ------------------ 视频库 KV 快照缓存（P1-4） ------------------ */

interface VideoSnapshotEntry {
  data: unknown;
  expiresAt: number;
  version: number | null;
}

let videoSnapshotCache: VideoSnapshotEntry | null = null;
let inFlightVideoSnapshot: Promise<unknown> | null = null;
/* 观测读数（与导航快照缓存同款口径；暂无 /metrics 出口，测试与排查用） */
let videoSnapshotHits = 0;
let videoSnapshotMisses = 0;
let videoSnapshotDegradedReads = 0;

/** 写路径成功后调用：下一次 readVideosData 立即重建（版本号兜底之外的立即一致层） */
export function invalidateVideoSnapshotCache(): void {
  videoSnapshotCache = null;
}

/** 供 /api/health、/metrics 与测试观察缓存状态（不参与业务判定） */
export function videoSnapshotCacheInfo(): {
  cached: boolean;
  version: number | null;
  hits: number;
  misses: number;
  degradedReads: number;
} {
  return {
    cached: videoSnapshotCache !== null,
    version: videoSnapshotCache?.version ?? null,
    hits: videoSnapshotHits,
    misses: videoSnapshotMisses,
    degradedReads: videoSnapshotDegradedReads,
  };
}

/**
 * KV 路径的缓存读：版本号 + SingleFlight，纪律与导航 snapshotCache 完全同款。
 *
 * 为什么值得：6.37MB 的 videos.json 是全站最大的单个 JSON 文档，json/dual 模式下
 * routes/videos 的每次列表/详情请求都要付一次 JSON.parse + flatten（导航侧早有
 * 版本号 + SingleFlight 快照缓存，视频侧一直没有）。
 *
 * 两条铁律（从导航侧的事故账里抄来的）：
 *   1. **版本号必须在构建之前读**——反过来会把「V 时刻的数据」标成 V+1，
 *      构建窗口里落下的写入被永久记为已包含；
 *   2. db 模式**不缓存**：readKvVersion 反映的是 KV 版本，与关系表写入无关，
 *      缓存会把表的更新喂成旧数据。
 */
async function readVideosDataCached(ctx: AppContext): Promise<unknown> {
  const version = await readKvVersion(ctx, "videos");
  const now = Date.now();
  if (videoSnapshotCache && videoSnapshotCache.expiresAt > now) {
    if (version === null) {
      // 降级：版本号读不到时信任 TTL（与导航同款），而不是「读不到就每次重建」
      videoSnapshotDegradedReads++;
      videoSnapshotHits++;
      return videoSnapshotCache.data;
    }
    if (videoSnapshotCache.version === version) {
      videoSnapshotHits++;
      return videoSnapshotCache.data;
    }
  }
  videoSnapshotMisses++;
  if (!inFlightVideoSnapshot) {
    inFlightVideoSnapshot = readKv(ctx, "videos").finally(() => {
      inFlightVideoSnapshot = null;
    });
  }
  const data = await inFlightVideoSnapshot;
  videoSnapshotCache = { data, expiresAt: now + SNAPSHOT_TTL_MS, version };
  return data;
}

export async function readVideosData(ctx: AppContext): Promise<unknown> {
  // `db` 模式：优先读关系表，表为空（首次切换 / 迁移未跑 / 被误清空）时回落 KV。
  // 回落而不是返回空库 —— 读路径绝不能因为影子表没准备好就让视频库消失。
  if (resolveVideoStoreMode() === "db") {
    const fromDb = await loadVideoCatalogFromDb(ctx);
    if (fromDb) return fromDb;
  }
  const fromKv = (await readVideosDataCached(ctx)) as { navigationItems?: any[] } | null;
  // 这里**不能**加「表里条数多于 KV 就用表」的启发式：`json` / `dual` 模式下关系表
  // 只是影子副本，可能早已和 KV 分叉（实测：KV 74 条、表 5,578 条）。按条数多的那侧供数
  // 会返回站点上根本不存在的幻影视频——这正是 routes/videos.ts 明令禁止的口径。
  // 判据只有 `resolveVideoStoreMode() === "db"` 一个；未切读就一律以 KV 为事实源。
  // 缓存共享同一个对象：调用方只读（routes/videos 的 filter/slice 均不改动文档）。
  return fromKv;
}

/**
 * 缩水判定的基线 = **即将被覆盖的那份文档**当前有多少条。
 *
 * 早先取关系表的 COUNT：`json` 模式下影子表可能根本没同步（基线 0，守卫形同虚设），
 * 也可能被手工导入过而与 KV 分叉（基线虚高，原样保存都被拦）。两种情况下判据都不对。
 * 关系表只在 KV 从未写入时回落：首次导入 / 切换期它至少是已知库容。
 */
async function currentVideoBaseline(ctx: AppContext): Promise<number> {
  try {
    const current = await readKv(ctx, "videos");
    if (current !== null) return countVideoDocItems(current);
  } catch {
    // 当前文档读不出来时继续走关系表：写入本来就会覆盖它，
    // 不能因为基线读取失败就把正常保存判死。
  }
  return await countVideoItems(ctx.repo).catch(() => 0);
}

export async function writeVideosData(
  ctx: AppContext,
  data: unknown,
  ifVersion?: number,
  guard: ShrinkGuardOptions = {},
): Promise<void> {
  const incomingItems = countVideoDocItems(data);
  const shrink = evaluateVideoShrink(await currentVideoBaseline(ctx), incomingItems);
  if (shrink) {
    if (!guard.confirmLargeDeletion) throw new VideoShrinkError("video_shrink_requires_confirmation", shrink);
    if (guard.expectedCount === undefined) throw new VideoShrinkError("video_shrink_expected_count_required", shrink);
    if (guard.expectedCount !== incomingItems) {
      throw new VideoShrinkError("video_shrink_expected_count_mismatch", { ...shrink, declaredExpectedCount: guard.expectedCount });
    }
  }
  await writeKv(ctx, "videos", data, ifVersion);
  // `dual` / `db` 模式下把文档同步进关系表。失败只记状态，不影响本次写入 ——
  // 影子表是副本，副本故障不该让正本写入报错（详见 video-catalog.ts 文件头）。
  await syncVideoCatalogSafely(ctx, data);
  // 写成功即失效视频快照缓存（P1-4）：版本号判据本会在下一次读时自然失效，
  // 显式失效把「降级读（版本号拿不到）」窗口内的一致性也补齐，与导航侧同款三层纪律。
  invalidateVideoSnapshotCache();
  // 确认放行只在写入真的落库之后记账：半途失败留一条「已放行」的审计，
  // 比不留更糟——它会让排查者以为数据已经按新内容覆盖了。
  if (shrink) await guard.onLargeDeletionConfirmed?.(shrink);
}

/* --------------------------- 键值读写（复用 jobs 表） --------------------------- */

/**
 * 读取键值。
 *
 * 注意：返回 null 表示「从未写入过」，与「写入过空对象」是不同语义 ——
 * 调用方需要据此决定是否返回默认值。
 */
export async function readKv(ctx: AppContext, key: string, strict = false): Promise<unknown> {
  const db = ctx.db;
  let payloadStr: string | undefined;
  if (db.dialect === "sqlite") {
    const row = db.sqlite!.prepare("SELECT payload FROM jobs WHERE id = ?").get("kv:" + key) as { payload: string } | undefined;
    payloadStr = row?.payload;
  } else {
    const res = await db.pg!.query("SELECT payload FROM jobs WHERE id = $1", ["kv:" + key]);
    const row = res.rows[0] as { payload: string } | undefined;
    payloadStr = row?.payload;
  }
  if (payloadStr === undefined) return null;
  try {
    return JSON.parse(payloadStr);
  } catch {
    if (strict) throw Object.assign(new Error("站点配置损坏，无法确认资源引用；已禁止清理"), { statusCode: 503 });
    return null;
  }
}

/**
 * 读取 KV 文档的版本号（= 最近一次写入的 `updated_at`）。
 *
 * 为什么需要它：`PUT /api/storage` 是「整包覆盖」语义，`writeKv` 用
 * `ON CONFLICT DO UPDATE` 直接替换 payload。A、B 两个写入方各自「读整包 → 改 → 写」
 * 时，后写的会把先写的整批内容抹掉，且**没有任何报错**（last-write-wins）。
 * 视频库有三个写入口（harvest / ai-autonomous-harvest / webhook-harvest）恰好是这种模式。
 *
 * 返回 `null` 表示从未写入过。
 */
export async function readKvVersion(ctx: AppContext, key: string): Promise<number | null> {
  const db = ctx.db;
  if (db.dialect === "sqlite") {
    const row = db.sqlite!
      .prepare("SELECT updated_at FROM jobs WHERE id = ?")
      .get("kv:" + key) as { updated_at?: number } | undefined;
    return typeof row?.updated_at === "number" ? row.updated_at : null;
  }
  const res = await db.pg!.query("SELECT updated_at FROM jobs WHERE id = $1", ["kv:" + key]);
  const row = res.rows[0] as { updated_at?: number } | undefined;
  return typeof row?.updated_at === "number" ? row.updated_at : null;
}

/** 版本冲突（HTTP 409）。调用方需重新读取后重放变更。 */
export class StorageVersionConflictError extends Error {
  readonly currentVersion: number | null;
  constructor(currentVersion: number | null) {
    super("写入冲突：数据已被其它写入方修改（currentVersion=" + String(currentVersion) + "）");
    this.name = "StorageVersionConflictError";
    this.currentVersion = currentVersion;
  }
  get statusCode(): number {
    return 409;
  }
}

/**
 * 写入 KV 文档；`ifVersion` 给出时做乐观并发控制。
 *
 * 判定与写入**必须在同一个同步块内**（sqlite 下）或同一事务语义下（pg），
 * 否则「检查完到写入前」仍有竞态窗口。这里采用「先读版本 → 比对 → 立刻写」，
 * 在单进程 sqlite（同步 API）下是原子的；pg 下依赖 `updated_at` 的单调性，
 * 最坏情况退化为原有的 last-write-wins，但不会比现状更差。
 */
async function writeKv(
  ctx: AppContext,
  key: string,
  value: unknown,
  ifVersion?: number,
): Promise<void> {
  const db = ctx.db;
  const payload = JSON.stringify(value);
  const now = Date.now();

  /**
   * 乐观并发为什么必须写成**数据库层的条件更新**，不能在应用层「先读再写」：
   *
   * 原来的实现是 `const current = await readKvVersion(...)` → 比对 → 写入。
   * 这三步之间有 await，窗口是敞开的。sqlite 驱动全是同步调用，
   * 微任务排队让窗口实际关着（实测 12 轮并发全部 A=200/B=409）；
   * 但 pg 驱动是真异步网络往返，两家写入方会同时通过比对，
   * 后写的那次把前一次悄悄覆盖 —— 正是 ifVersion 要防的丢失更新。
   *
   * 所以 sqlite / pg 都走「UPDATE ... WHERE updated_at = 期望值 + 判断受影响行数」：
   * 比对与写入在同一条语句里，由数据库保证原子性。
   *
   * 同时把 `updated_at` 改成 `max(旧值 + 1, now)`：
   * 版本号就是 updated_at，若两次写入落在同一毫秒，版本会相同，
   * 第三方拿着这个版本号仍能通过比对 —— 那是个 1ms 宽的同版本窗口。
   * 取 max 后版本**严格单调递增**，客户端可以真的依赖「版本一定变大」。
   */
  const id = "kv:" + key;

  if (ifVersion !== undefined) {
    if (db.dialect === "sqlite") {
      // node:sqlite 的 run() 返回类型是 unknown（不同版本签名不一致），只取 changes
      const info = db.sqlite!.prepare(
        "UPDATE jobs SET payload = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ? AND updated_at = ?",
      ).run(payload, now, id, ifVersion) as { changes?: number | bigint };
      if (Number(info.changes ?? 0) === 0) {
        throw new StorageVersionConflictError(await readKvVersion(ctx, key));
      }
      return;
    }
    const res = await db.pg!.query(
      "UPDATE jobs SET payload = $1, updated_at = GREATEST(updated_at + 1, $2) WHERE id = $3 AND updated_at = $4",
      [payload, now, id, ifVersion],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new StorageVersionConflictError(await readKvVersion(ctx, key));
    }
    return;
  }

  if (db.dialect === "sqlite") {
    db.sqlite!.prepare(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,0,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, " +
      "updated_at = MAX(jobs.updated_at + 1, excluded.updated_at)",
    ).run(id, "kv", payload, "done", now, now);
    return;
  }
  await db.pg!.query(
    "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES ($1,$2,$3,$4,0,$5,$6) " +
    "ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, " +
    "updated_at = GREATEST(jobs.updated_at + 1, EXCLUDED.updated_at)",
    [id, "kv", payload, "done", now, now],
  );
}

/** 内容文件的 basename（用于类型分发） */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/* ------------------------------------------------------------------ *
 * 品牌资产文档（上传的 logo / favicon / ogImage）
 *
 * 上传走 HTTP 表单 → web 侧 base64 编码 → `PUT /api/storage` 落成 KV 文档。
 * 这里只提供管理端清理所需的两个原语：列举与删除。
 *
 * 允许范围被收死在这一条目录 + 上传路由的命名形状里：
 *  - 不提供通用 KV 删除——`kv:site-config`、`doc:` 下的任意内容文件
 *    都可能是运营数据，误删一次就是整站导航消失；
 *  - `[name]` GET 路由用同一份命名正则，所以不会出现「列表里有、访问不到」的分叉。
 * ------------------------------------------------------------------ */
export const ASSET_DOC_DIR = "src/navsphere/content/assets";

/** 上传路由生成的资产文档名：`<kind>-<10 位内容哈希>.<位图扩展名>.json` */
const ASSET_DOC_NAME_RE = /^(?:logo|favicon|ogImage|appleTouchIcon|pwaIcon192|pwaIcon512|pwaMaskable512)-[0-9a-f]{10}\.(?:png|jpe?g|webp|ico)\.json$/;

/** 该路径是否是「允许管理的品牌资产文档」（删除/列举的唯一准入判定） */
export function isAssetDocPath(path: string): boolean {
  const norm = path.trim().replace(/^\/+/, "");
  const prefix = ASSET_DOC_DIR + "/";
  if (!norm.startsWith(prefix)) return false;
  return ASSET_DOC_NAME_RE.test(norm.slice(prefix.length));
}

async function lockBrandAssets(ctx: AppContext): Promise<void> {
  // PostgreSQL 的事务锁跨进程串行化配置保存与删除；SQLite 已持有 BEGIN IMMEDIATE 写锁。
  // 方言判定已收敛到 Repository 能力方法（见 packages/store/src/repository/io.ts）。
  await ctx.repo.acquireAdvisoryXactLock("navhub:brand-assets");
}

function assetReferences(config: unknown): Map<string, string[]> {
  const references = new Map<string, string[]>();
  const pending: Array<{ value: unknown; field: string }> = [{ value: config, field: "" }];
  while (pending.length) {
    const { value, field } = pending.pop()!;
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) pending.push({ value: child, field: field ? `${field}.${key}` : key });
    } else if (typeof value === "string") {
      let pathname: string;
      try { pathname = decodeURIComponent(new URL(value, "http://navhub.invalid").pathname); } catch { continue; }
      if (!pathname.startsWith("/api/site/asset/")) continue;
      const path = `${ASSET_DOC_DIR}/${pathname.slice("/api/site/asset/".length)}.json`;
      if (isAssetDocPath(path)) references.set(path, [...(references.get(path) ?? []), field]);
    }
  }
  return references;
}

async function persistedAssetReferences(ctx: AppContext): Promise<Map<string, string[]>> {
  const config = await readKv(ctx, "site-config", true);
  if (config !== null && (typeof config !== "object" || Array.isArray(config))) {
    throw Object.assign(new Error("站点配置格式异常，无法确认资源引用；已禁止清理"), { statusCode: 503 });
  }
  return assetReferences(config);
}

export interface AssetDocInfo {
  references: string[];
  kind: string;
  createdAt: number;
  mime: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  /** 资产文档路径（含 .json），与上传返回值 / 存储键一一对应 */
  path: string;
  /** 对外访问名（`/api/site/asset/<name>`） */
  name: string;
  /** 文档字节数（base64 后的 JSON，用于展示占用） */
  bytes: number;
  updatedAt: number;
}

/**
 * 列举已上传的资产文档（按最近更新倒序）。
 *
 * 直接查 jobs 表的 KV 行，不额外维护一份索引：索引与真实存储之间一旦分叉，
 * 「删了列表项但文档还在」「列表为空却占着空间」这类问题就只能靠人工核对。
 */
export async function listAssetDocs(ctx: AppContext, limit = 500): Promise<AssetDocInfo[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const prefix = "kv:" + pathToKey(ASSET_DOC_DIR + "/");
  type Row = {
    id: string; bytes: number | string | null; updated_at: number | string | null;
    created_at: number | string; mime: string | null; sha256: string | null;
    width: number | null; height: number | null;
  };
  let rows: Row[];
  if (ctx.db.dialect === "sqlite") {
    rows = ctx.db.sqlite!
      .prepare("SELECT id, length(payload) AS bytes, updated_at, created_at, " +
        "json_extract(payload, '$.mime') AS mime, json_extract(payload, '$.sha256') AS sha256, " +
        "json_extract(payload, '$.width') AS width, json_extract(payload, '$.height') AS height " +
        "FROM jobs WHERE id LIKE ? AND json_valid(payload) ORDER BY updated_at DESC LIMIT ?")
      .all(prefix + "%", cap) as Row[];
  } else {
    const res = await ctx.db.pg!.query(
      "SELECT id, LENGTH(payload) AS bytes, updated_at, created_at, " +
      "payload::jsonb->>'mime' AS mime, payload::jsonb->>'sha256' AS sha256, " +
      "payload::jsonb->>'width' AS width, payload::jsonb->>'height' AS height " +
      "FROM jobs WHERE id LIKE $1 ORDER BY updated_at DESC LIMIT $2",
      [prefix + "%", cap],
    );
    rows = res.rows as Row[];
  }
  const references = await persistedAssetReferences(ctx);
  const out: AssetDocInfo[] = [];
  for (const row of rows) {
    const path = String(row.id).replace(/^kv:doc:/, "");
    if (!isAssetDocPath(path)) continue;
    out.push({
      path,
      name: path.slice(ASSET_DOC_DIR.length + 1).replace(/\.json$/, ""),
      bytes: Number(row.bytes ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
      references: references.get(path) ?? [],
      kind: path.slice(ASSET_DOC_DIR.length + 1).split("-")[0]!,
      createdAt: Number(row.created_at),
      mime: row.mime,
      sha256: row.sha256,
      width: row.width === null ? null : Number(row.width),
      height: row.height === null ? null : Number(row.height),
    });
  }
  return out;
}

/**
 * 删除一份品牌资产文档。
 *
 * 只删 `doc:` 键；`kv:site-config` 这类结构化配置即使路径拼错也进不来。
 * 返回 deleted=false 表示文档本来就不存在（路由据此回 404，而不是伪报成功）。
 */
export async function deleteAssetDoc(ctx: AppContext, path: string): Promise<{ deleted: boolean }> {
  const norm = path.trim().replace(/^\/+/, "");
  if (!isAssetDocPath(norm)) {
    const err = new Error("只允许删除上传的品牌资产（src/navsphere/content/assets/<kind>-<hash>.<ext>.json）") as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  return ctx.repo.withTransaction(async () => {
    await lockBrandAssets(ctx);
    const references = (await persistedAssetReferences(ctx)).get(norm) ?? [];
    if (references.length) {
      throw Object.assign(new Error(`资源仍被已保存的配置引用：${references.join("、")}，请先替换并保存设置`), { statusCode: 409 });
    }
    const id = "kv:" + pathToKey(norm);
    if (ctx.db.dialect === "sqlite") {
      const info = ctx.db.sqlite!.prepare("DELETE FROM jobs WHERE id = ?").run(id) as { changes?: number };
      return { deleted: Number(info?.changes ?? 0) > 0 };
    }
    const res = await ctx.db.pg!.query("DELETE FROM jobs WHERE id = $1", [id]);
    return { deleted: Number(res.rowCount ?? 0) > 0 };
  });
}

/**
 * 把任意内容路径归一化成键值存储的 key。
 *
 * 存在的意义：NavSphere 的内容文件不止导航/站点/资源/视频这几个，
 * 而"哪些文件值得结构化建模"会随业务演进变化。与其每次新增文件都改一遍后端，
 * 不如给未知文件一个**通用 JSON 文档**通路 —— 后端因此不会被上游的文件清单卡住。
 */
export function pathToKey(path: string): string {
  return "doc:" + path.replace(/^\/+/, "");
}

/**
 * 分发：把 NavSphere 的 path 映射到上面的处理函数。
 *
 * `view` 只影响 navigation.json（及同源的 navigation-default.json）：
 * `public` 返回过滤后的展示投影，`raw`（默认）是全量快照。其它内容文件没有
 * 「后台态」概念，两种视图一致。
 */
export async function readStoragePath(
  ctx: AppContext,
  path: string,
  opts: { view?: NavigationView; navVersion?: number | null } = {},
): Promise<unknown> {
  const name = basename(path);
  // navigation-default.json 是"默认模板"，当前实现下与导航数据同源
  if (name === "navigation-default.json" || name === "navigation.json") {
    return readNavigationSnapshot(ctx, opts.view ?? "raw", opts.navVersion);
  }
  if (name === "site.json") return readSiteConfig(ctx);
  if (name === "resource-metadata.json") return readResourceMetadata(ctx);
  if (name === "videos.json") return readVideosData(ctx);
  // 其余内容文件走通用 JSON 文档。从未写入过时返回 null（与"保存了空对象"区分开），
  // 由调用方决定是静默回退还是告警。
  return readKv(ctx, pathToKey(path));
}

/**
 * 读取某个内容路径的当前版本（仅 KV 类路径有版本概念）。
 *
 * 供 `GET /api/storage/version` 与写入前的乐观并发校验使用。
 * 结构化路径（navigation.json / site.json / resource-metadata.json）走各自的
 * 关系表，不在此列 —— 返回 null。
 */
export async function readStorageVersion(ctx: AppContext, path: string): Promise<number | null> {
  const name = basename(path);
  if (name === "navigation.json" || name === "site.json" || name === "resource-metadata.json") {
    return null;
  }
  const key = name === "videos.json" ? "videos" : pathToKey(path);
  return readKvVersion(ctx, key);
}

export async function writeStoragePath(
  ctx: AppContext,
  path: string,
  content: string,
  opts?: { ifVersion?: number } & ShrinkGuardOptions,
): Promise<{ ok: true; note: string; version?: number }> {
  const parsed = content.trim() ? JSON.parse(content) : {};
  if (basename(path) === "navigation.json") {
    const r = await writeNavigationData(ctx, parsed as NsNavigationData, {
      // 与 videos.json 同一条通道：网关层漏传一个字段，二阶段确认就会永远 409
      confirmLargeDeletion: opts?.confirmLargeDeletion,
      expectedCount: opts?.expectedCount,
      onLargeDeletionConfirmed: opts?.onLargeDeletionConfirmed,
    });
    // 与 server.ts 的 onResponse 失效互为兜底：即便将来有调用方绕过 HTTP 层，
    // 也不会把旧快照继续喂给前端。
    invalidateSnapshotCache();
    return { ok: true, note: "已写入 " + r.categories + " 个类目 / " + r.sites + " 个站点" };
  }
  if (basename(path) === "site.json") {
    await writeSiteConfig(ctx, parsed as Record<string, unknown>);
    return { ok: true, note: "站点配置已更新" };
  }
  if (basename(path) === "resource-metadata.json") {
    await writeResourceMetadata(ctx, parsed);
    return { ok: true, note: "资源元数据已更新" };
  }
  if (basename(path) === "videos.json") {
    // 确认参数必须原样透传：写 videos.json 有两条入口（HTTP PUT /api/storage 与 CLI），
    // 这里漏掉一个字段，等于其中一条入口的二阶段确认永远失效（409 无限重试）。
    await writeVideosData(ctx, parsed, opts?.ifVersion, {
      confirmLargeDeletion: opts?.confirmLargeDeletion,
      expectedCount: opts?.expectedCount,
      onLargeDeletionConfirmed: opts?.onLargeDeletionConfirmed,
    });
    const version = await readKvVersion(ctx, "videos");
    return { ok: true, note: "视频导航数据已更新", version: version ?? undefined };
  }
  if (basename(path) === REPLACEMENTS_BASENAME) {
    await writeKv(ctx, pathToKey(path), parsed, opts?.ifVersion);
    // 这份文档是替换审计的**权威副本**（不截断）。同步进关系表后，
    // `video_replacements` 才持有全量而不仅是 videos.json 内联的那 100 条。
    // 同步失败不影响本次写入（副本语义，见 video-catalog.ts 文件头第 2 条）。
    await syncReplacementHistorySafely(ctx, parsed);
    const version = await readKvVersion(ctx, pathToKey(path));
    return { ok: true, note: "替换审计已更新", version: version ?? undefined };
  }
  await writeKv(ctx, pathToKey(path), parsed, opts?.ifVersion);
  const version = await readKvVersion(ctx, pathToKey(path));
  return { ok: true, note: "内容文件已更新: " + basename(path), version: version ?? undefined };
}