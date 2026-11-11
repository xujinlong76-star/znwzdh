/**
 * 视频快照分片派生（VIDEOS_ISR_PLAN 路线 b 的中枢侧）。
 *
 * 背景：videos.json 有 7MB+，超过 Next Data Cache 单条目 2MB 上限，只能留在
 * storage-adapter 的豁免名单里被 no-store 实时读——/videos（revalidate=60）与
 * /videos/v/[id]（revalidate=300）的 ISR 因此名存实亡（与首页 42f4a759 修过的
 * 「static to dynamic」同源）。但文档天然可切：12 个一级分类，每片 minified
 * 331–457KB，离上限有 4 倍余量。
 *
 * 本模块只做一件事：以 videos.json 为唯一事实源（本体一行不改），在写路径上
 * 同步派生四类小文档，读路径（web 侧 lib/video-catalog-read.ts）改读它们：
 *   - videos-index.json        分类清单 + 条数 + 源版本号（约 16KB，兼作派生
 *                              「提交标记」：写序上最后落库，读到它即代表同版本
 *                              分片与 idmap 已就位）；
 *   - videos-cat-<分类 id>.json × N  该分类的完整条目（全量，不做列表投影——
 *                              详情页要 chapters/transcript/stats 全字段）；
 *   - videos-idmap.json        条目全部可匹配标识（id / seoSlug / bvid 小写 /
 *                              videoId）→ categoryId，供详情页单分片定位。
 *
 * 一致性纪律：
 *   - 每份派生产物都带同一个 `sourceVersion`（= 源文档写入后的 KV 版本号）；
 *   - idmap 按文档顺序写入、同键先到先得，精确复现详情页原线性扫描的
 *     「先出现者赢」语义（同一字符串既是 A 的 bvid 又是 B 的 id 时不许变形）；
 *   - 派生失败不连带写失败：writeVideosData 里 try/catch 记 error 日志，
 *     读路径靠版本校验发现不一致后回落整包读，永不比现状差。
 *
 * 路径常量与 web 侧 lib/video-catalog-paths.ts 必须逐字一致（两侧各有钉死
 * 常量值的测试，改路径要两边一起改）。
 */

export const VIDEOS_INDEX_PATH = "src/navsphere/content/videos-index.json";
export const VIDEOS_IDMAP_PATH = "src/navsphere/content/videos-idmap.json";

export function videoShardPath(categoryId: string): string {
  return "src/navsphere/content/videos-cat-" + categoryId + ".json";
}

export const VIDEO_SHARD_KIND_INDEX = "navhub-videos-index";
export const VIDEO_SHARD_KIND_IDMAP = "navhub-videos-idmap";
export const VIDEO_SHARD_KIND_CAT = "navhub-videos-cat";

/**
 * 单分片体积红线（序列化字节）：测试用它钉住「分类失控前先报警」。
 * Data Cache 硬上限 2MB；750KB 是设计文档定的测试断言线（当前最大 457KB）。
 */
export const VIDEO_SHARD_SIZE_LIMIT_BYTES = 750_000;

interface VideoItemLike {
  id?: unknown;
  videoConfig?: {
    seoSlug?: unknown;
    bvid?: unknown;
    videoId?: unknown;
  } | null;
}

interface VideoCategoryLike {
  id?: unknown;
  title?: unknown;
  items?: VideoItemLike[] | null;
  subCategories?: Array<{ id?: unknown; title?: unknown; items?: VideoItemLike[] | null }> | null;
}

export interface DerivedVideoShard {
  path: string;
  data: unknown;
}

export interface DerivedVideoShardSet {
  sourceVersion: number;
  totalItems: number;
  /** 落库顺序即数组顺序：分片 → idmap → index（index 是提交标记，必须最后） */
  writes: DerivedVideoShard[];
}

function categoryItems(cat: VideoCategoryLike): VideoItemLike[] {
  const out: VideoItemLike[] = [];
  if (Array.isArray(cat.items)) out.push(...cat.items);
  if (Array.isArray(cat.subCategories)) {
    for (const sub of cat.subCategories) {
      if (Array.isArray(sub?.items)) out.push(...sub.items);
    }
  }
  return out;
}

/**
 * 纯函数：源文档 + 源版本号 → 待落库的派生文档集合。
 *
 * 源文档形状不对（navigationItems 不是数组）时抛错——调用方（写路径）的
 * 纪律是「派生失败只记日志、不连带写失败」，抛错正是给它 catch 的。
 */
export function deriveVideoShards(doc: unknown, sourceVersion: number): DerivedVideoShardSet {
  const root = doc as { navigationItems?: unknown; replacementHistory?: unknown } | null;
  if (!root || !Array.isArray(root.navigationItems)) {
    throw new Error("deriveVideoShards: 源文档 navigationItems 不是数组，无法派生分片");
  }
  const categories = root.navigationItems as VideoCategoryLike[];

  const writes: DerivedVideoShard[] = [];
  const indexCategories: Array<{
    id: string;
    title: string;
    shardPath: string;
    itemCount: number;
    subCategories: Array<{ id: string; title: string; itemCount: number }>;
  }> = [];
  // Map 保序 + 先到先得：与详情页线性扫描的文档顺序语义一致
  const idmap = new Map<string, string>();
  let totalItems = 0;

  const putKey = (key: string, categoryId: string) => {
    if (key && !idmap.has(key)) idmap.set(key, categoryId);
  };

  for (const cat of categories) {
    const categoryId = typeof cat?.id === "string" ? cat.id : "";
    if (!categoryId) {
      throw new Error("deriveVideoShards: 存在缺少 id 的一级分类，无法派生分片");
    }
    const items = categoryItems(cat);
    totalItems += items.length;

    for (const item of items) {
      if (!item) continue;
      if (typeof item.id === "string") putKey(item.id, categoryId);
      const vc = item.videoConfig ?? undefined;
      if (typeof vc?.seoSlug === "string") putKey(vc.seoSlug, categoryId);
      // 详情页的 bvid 匹配是大小写不敏感的（两侧都 toLowerCase），键统一存小写
      if (typeof vc?.bvid === "string") putKey(vc.bvid.toLowerCase(), categoryId);
      if (typeof vc?.videoId === "string") putKey(vc.videoId, categoryId);
    }

    writes.push({
      path: videoShardPath(categoryId),
      data: {
        kind: VIDEO_SHARD_KIND_CAT,
        sourceVersion,
        categoryId,
        category: cat,
      },
    });

    indexCategories.push({
      id: categoryId,
      title: typeof cat.title === "string" ? cat.title : "",
      shardPath: videoShardPath(categoryId),
      itemCount: items.length,
      subCategories: Array.isArray(cat.subCategories)
        ? cat.subCategories.map((sub) => ({
            id: typeof sub?.id === "string" ? sub.id : "",
            title: typeof sub?.title === "string" ? sub.title : "",
            itemCount: Array.isArray(sub?.items) ? sub.items.length : 0,
          }))
        : [],
    });
  }

  writes.push({
    path: VIDEOS_IDMAP_PATH,
    data: {
      kind: VIDEO_SHARD_KIND_IDMAP,
      sourceVersion,
      totalItems,
      // Object.fromEntries 走 CreateDataPropertyOnObject，__proto__ 等键也安全
      map: Object.fromEntries(idmap),
    },
  });

  writes.push({
    path: VIDEOS_INDEX_PATH,
    data: {
      kind: VIDEO_SHARD_KIND_INDEX,
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
