/**
 * 导航快照分片派生（U-36，主方案 A + 配套 C）。
 *
 * 背景：navigation.json 的 public 快照已达 2,087,826 字符（2026-11-18 电脑实库
 * 实测），离 Next Data Cache 单条目 2MB 上限只剩 9,326 字符；再增 14–15 站即
 * 写缓存失败，旧快照冻结（2026-11-05 真实事故）。根因是数据层仍有 4,850 站，
 * 而代码层已缩到 346 站。
 *
 * 本模块只做一件事：以 public 快照为唯一事实源（本体一行不改），在写路径上
 * 同步派生两类小文档，读路径（web 侧 lib/navigation-catalog-read.ts）改读它们：
 *   - navigation-index.json      分类清单 + 条数 + 源版本号（兼作派生「提交标记」：
 *                                写序上最后落库，读到它即代表同版本分片已就位）；
 *   - navigation-cat-<分类 id>.json × N   该分类的完整条目（瘦身投影 C：只带渲染
 *                                字段，见 slimNavigationItem）；单分类超 750KB
 *                                时按站数切子片 navigation-cat-<id>-p<页>.json。
 *
 * 一致性纪律（照抄 video-shards.ts）：
 *   - 每份派生产物都带同一个 `sourceVersion`（= 写导航后读到的 data_version）；
 *   - 派生失败不连带写失败：writeNavigationData 里 try/catch 记 error 日志，
 *     读路径靠版本校验发现不一致后回落整包读，永不比现状差；
 *   - 落库顺序即 writes 数组顺序：分片 → index（index 是提交标记，必须最后）。
 *
 * 瘦身投影 C 的字段白名单（与 data-loader.ts 的 processNavigationSubItem 逐字
 * 一致，另加 status——设计笔记 §2-C 的保留清单）：渲染只消费这些字段；重字段
 * （weight/trendScore/actions/relations/liveMetrics/workspaces）只在速览弹窗
 * 里读，而弹窗的读数今天就是死的（processNavigationSubItem 早已把它们裁掉，
 * 弹窗改走 /api/sites/:id 按站懒取，见 navigation-catalog-read.ts 文件头）。
 * 因此拼装树在渲染字段上与整包逐字等值，getProcessedData 输出不变。
 *
 * Batch0-02：白名单另加档案三字段 pricing / requires_account / best_for
 * （卡片直接画的字段，细化方案 §6.1）。它们不进 navigation.json 本体，
 * 只在 deriveNavigationShards 里由调用方传入的 verified 档案行 join 进来
 * （profilesBySiteId 入参）；草稿态（draft）行调用方根本不传，进不了分片。
 *
 * 路径常量与 web 侧 lib/navigation-catalog-paths.ts 必须逐字一致（两侧各有钉死
 * 常量值的测试，改路径要两边一起改）。
 */

export const NAVIGATION_DOC_PATH = "src/navsphere/content/navigation.json";
export const NAVIGATION_INDEX_PATH = "src/navsphere/content/navigation-index.json";

export function navigationShardPath(categoryId: string): string {
  return "src/navsphere/content/navigation-cat-" + categoryId + ".json";
}

export function navigationShardPagePath(categoryId: string, page: number): string {
  return "src/navsphere/content/navigation-cat-" + categoryId + "-p" + page + ".json";
}

export const NAVIGATION_SHARD_KIND_INDEX = "navhub-navigation-index";
export const NAVIGATION_SHARD_KIND_CAT = "navhub-navigation-cat";

/**
 * 单分片体积红线（序列化字符数与字节双口径，取其大者为限）。
 * Data Cache 硬上限 2MB；750KB 是设计文档定的测试断言线（与视频分片同款）。
 * 实库最大分类 340 站、单片约 150–230KB，离红线有 3 倍余量。
 */
export const NAVIGATION_SHARD_SIZE_LIMIT_BYTES = 750_000;

/** 渲染字段白名单：processNavigationSubItem 消费的全部字段 + 设计保留的 status */
const RENDER_ITEM_FIELDS = [
  "id",
  "title",
  "href",
  "description",
  "icon",
  "useDefaultIcon",
  "enabled",
  "status",
  "tags",
  "health",
  "videoConfig",
  // Batch0-02：卡片直接画的档案三字段（细化方案 §6.1）
  "pricing",
  "requires_account",
  "best_for",
] as const;

/**
 * 分片 join 用的档案行子集（Batch0-02）。
 *
 * 调用方（写路径）从库里加载已 verified 的 site_profiles 行后传入；
 * 只传这三个卡片字段，其余档案字段走 GET /api/sites/:id/profile 懒取。
 * 各字段均为可选：map 里没有某站、或某站缺某个字段时，该字段不进分片
 * （不编造、不回落、不猜）。
 */
export interface SiteProfileShardFields {
  pricing?: string;
  requires_account?: string;
  best_for?: string;
}

const HEAVY_ITEM_FIELDS = [
  "weight",
  "trendScore",
  "actions",
  "relations",
  "liveMetrics",
  "workspaces",
] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 瘦身单站：只留渲染字段。重字段（actions/relations/liveMetrics/workspaces
 * 等）不在分片里——渲染层今天就不消费它们（见文件头），速览弹窗改走单站接口。
 *
 * Batch0-02：可选入参 profilesBySiteId 命中本站时，把 verified 档案行的
 * 三个卡片字段叠加上去（只叠加 map 里已给的字段；map 里没有本站时不动）。
 */
export function slimNavigationItem(item: unknown, profilesBySiteId?: Map<string, SiteProfileShardFields>): UnknownRecord {
  const out: UnknownRecord = {};
  if (!isRecord(item)) return out;
  for (const f of RENDER_ITEM_FIELDS) {
    if (item[f] !== undefined) out[f] = item[f];
  }
  if (profilesBySiteId && typeof item.id === "string") {
    const profile = profilesBySiteId.get(item.id);
    if (profile) {
      if (profile.pricing !== undefined) out.pricing = profile.pricing;
      if (profile.requires_account !== undefined) out.requires_account = profile.requires_account;
      if (profile.best_for !== undefined) out.best_for = profile.best_for;
    }
  }
  return out;
}

function slimSubCategory(sub: unknown, profilesBySiteId?: Map<string, SiteProfileShardFields>): UnknownRecord {
  if (!isRecord(sub)) return {};
  const out: UnknownRecord = { ...sub };
  out.items = Array.isArray(sub.items) ? sub.items.map((item) => slimNavigationItem(item, profilesBySiteId)) : [];
  return out;
}

function slimCategory(cat: UnknownRecord, profilesBySiteId?: Map<string, SiteProfileShardFields>): UnknownRecord {
  const out: UnknownRecord = { ...cat };
  out.items = Array.isArray(cat.items) ? cat.items.map((item) => slimNavigationItem(item, profilesBySiteId)) : [];
  out.subCategories = Array.isArray(cat.subCategories)
    ? cat.subCategories.map((sub) => slimSubCategory(sub, profilesBySiteId))
    : [];
  return out;
}

function measureSize(data: unknown): { chars: number; bytes: number } {
  const text = JSON.stringify(data);
  return { chars: text.length, bytes: Buffer.byteLength(text, "utf8") };
}

function exceedsLimit(data: unknown): boolean {
  const { chars, bytes } = measureSize(data);
  return chars >= NAVIGATION_SHARD_SIZE_LIMIT_BYTES || bytes >= NAVIGATION_SHARD_SIZE_LIMIT_BYTES;
}

interface ShardPage {
  category: UnknownRecord;
  itemCount: number;
}

export interface DerivedNavigationShard {
  path: string;
  data: unknown;
}

export interface DerivedNavigationShardSet {
  sourceVersion: number;
  totalItems: number;
  /** 落库顺序即数组顺序：分片 → index（index 是提交标记，必须最后） */
  writes: DerivedNavigationShard[];
}

/**
 * 纯函数：public 快照 + 源版本号 → 待落库的派生文档集合。
 *
 * 源文档形状不对（navigationItems 不是数组、分类缺 id）时抛错——调用方
 * （写路径）的纪律是「派生失败只记日志、不连带写失败」，抛错正是给它 catch 的。
 *
 * 切子片规则：按条目顺序贪心打包，每页序列化后字符数与字节双口径都 <750KB；
 * 单条目自身超限（理论上不可能）时独占一页，不丢数据。
 *
 * Batch0-02：可选入参 profilesBySiteId（Map<siteId, {pricing,
 * requires_account, best_for}>，调用方只放 verified 行）。入参缺省时
 * 三个字段全部缺省——分片里不出现它们，不编造、不回落、不猜。
 */
export function deriveNavigationShards(
  doc: unknown,
  sourceVersion: number,
  profilesBySiteId?: Map<string, SiteProfileShardFields>,
): DerivedNavigationShardSet {
  const root = doc as { navigationItems?: unknown; replacementHistory?: unknown } | null;
  if (!root || !Array.isArray(root.navigationItems)) {
    throw new Error("deriveNavigationShards: 源文档 navigationItems 不是数组，无法派生分片");
  }
  const categories = root.navigationItems as UnknownRecord[];

  const writes: DerivedNavigationShard[] = [];
  const indexCategories: Array<{
    id: string;
    title: string;
    shardPaths: string[];
    itemCount: number;
    subCategories: Array<{ id: string; title: string; itemCount: number }>;
  }> = [];
  let totalItems = 0;

  for (const cat of categories) {
    if (!isRecord(cat) || typeof cat.id !== "string" || !cat.id) {
      throw new Error("deriveNavigationShards: 存在缺少 id 的一级分类，无法派生分片");
    }
    const categoryId = cat.id as string;
    const slimmed = slimCategory(cat, profilesBySiteId);

    // 子分类元数据（index 登记用）与条数
    const subMeta: Array<{ id: string; title: string; itemCount: number }> = [];
    let categoryItemCount = 0;
    const subs = Array.isArray(slimmed.subCategories) ? (slimmed.subCategories as UnknownRecord[]) : [];
    for (const sub of subs) {
      if (!isRecord(sub) || typeof sub.id !== "string" || !sub.id) {
        throw new Error(`deriveNavigationShards: 分类 ${categoryId} 存在缺少 id 的子分类，无法派生分片`);
      }
      const n = Array.isArray(sub.items) ? sub.items.length : 0;
      subMeta.push({ id: sub.id as string, title: typeof sub.title === "string" ? sub.title : "", itemCount: n });
      categoryItemCount += n;
    }
    const topItems = Array.isArray(slimmed.items) ? (slimmed.items as UnknownRecord[]) : [];
    categoryItemCount += topItems.length;
    totalItems += categoryItemCount;

    // 打包：槽位 = 顶级条目（各 1 个）+ 每个子分类的条目（按子分类顺序）；
    // 同一子分类的条目尽量落在同一页，跨页时子分类元数据随页重复出现。
    // 性能：逐条试加（每加一条序列化整页）是 O(n²)，4,850 站要 7.7 秒、
    // 2,000 站单分类要 14.8 秒——写回保存不能背这个。改用二分切分：
    // 整分类先一次实测能装则单页；超限时二分找最大可装前缀（单调：条目只增
    // 不减，装得下 k 条则装得下更少条），每页 O(log n) 次实测。4,850 站
    // 实测 <100ms。单槽位自身超限（理论上不可能）时独占一页，不丢数据。
    type Slot =
      | { kind: "top"; item: UnknownRecord }
      | { kind: "sub"; sub: UnknownRecord; item: UnknownRecord };
    const slots: Slot[] = [];
    for (const item of topItems) slots.push({ kind: "top", item });
    for (const sub of subs) {
      const subItems = Array.isArray(sub.items) ? (sub.items as UnknownRecord[]) : [];
      for (const item of subItems) slots.push({ kind: "sub", sub, item });
    }
    const buildCategory = (list: Slot[]): UnknownRecord => {
      const cat: UnknownRecord = { ...slimmed, items: [], subCategories: [] };
      for (const s of list) {
        if (s.kind === "top") {
          (cat.items as UnknownRecord[]).push(s.item);
        } else {
          const subsOnPage = cat.subCategories as UnknownRecord[];
          let found = subsOnPage.find((x) => x.id === s.sub.id);
          if (!found) {
            found = { ...s.sub, items: [] };
            subsOnPage.push(found);
          }
          (found.items as UnknownRecord[]).push(s.item);
        }
      }
      return cat;
    };
    const fitsOnPage = (list: Slot[]): boolean =>
      !exceedsLimit({ kind: NAVIGATION_SHARD_KIND_CAT, sourceVersion, categoryId, category: buildCategory(list) });
    const pages: ShardPage[] = [];
    let rest = slots;
    while (rest.length > 0) {
      if (fitsOnPage(rest)) {
        pages.push({ category: buildCategory(rest), itemCount: rest.length });
        break;
      }
      let lo = 1;
      let hi = rest.length;
      let best = 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (fitsOnPage(rest.slice(0, mid))) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      pages.push({ category: buildCategory(rest.slice(0, best)), itemCount: best });
      rest = rest.slice(best);
    }
    // 空分类（0 条目）也要落一片，否则读路径会因缺片回落整包
    if (pages.length === 0) {
      pages.push({ category: buildCategory([]), itemCount: 0 });
    }

    const shardPaths: string[] = [];
    if (pages.length === 1) {
      const only = pages[0];
      if (!only) throw new Error("deriveNavigationShards: 内部错误，分片页为空");
      const path = navigationShardPath(categoryId);
      shardPaths.push(path);
      writes.push({
        path,
        data: { kind: NAVIGATION_SHARD_KIND_CAT, sourceVersion, categoryId, page: 1, pageCount: 1, category: only.category },
      });
    } else {
      pages.forEach((p, i) => {
        const path = navigationShardPagePath(categoryId, i + 1);
        shardPaths.push(path);
        writes.push({
          path,
          data: { kind: NAVIGATION_SHARD_KIND_CAT, sourceVersion, categoryId, page: i + 1, pageCount: pages.length, category: p.category },
        });
      });
    }

    indexCategories.push({
      id: categoryId,
      title: typeof cat.title === "string" ? cat.title : "",
      shardPaths,
      itemCount: categoryItemCount,
      subCategories: subMeta,
    });
  }

  writes.push({
    path: NAVIGATION_INDEX_PATH,
    data: {
      kind: NAVIGATION_SHARD_KIND_INDEX,
      sourceVersion,
      totalItems,
      // replacementHistory 原样随 index 走：拼装出的文档必须与源文档逐字等值，
      // 它现在是空数组，但将来非空时不能在分片路径上丢掉
      replacementHistory: Array.isArray(root.replacementHistory) ? root.replacementHistory : [],
      categories: indexCategories,
    },
  });

  return { sourceVersion, totalItems, writes };
}

/** 供测试与读路径复用：分片文档是否含重字段（瘦身断言用） */
export function shardContainsHeavyFields(data: unknown): boolean {
  const text = JSON.stringify(data);
  return HEAVY_ITEM_FIELDS.some((f) => text.includes(`"${f}":`));
}
