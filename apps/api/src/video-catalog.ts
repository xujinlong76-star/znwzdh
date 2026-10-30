/**
 * 视频库的「文档 ↔ 关系表」映射与同步（C6 第二步）。
 *
 * 事实源策略由环境变量 `NAVHUB_VIDEO_STORE` 决定：
 *
 * | 取值 | 写 | 读 | 用途 |
 * |---|---|---|---|
 * | `json`（默认） | 只写 KV 文档 | KV 文档 | 与改造前完全一致 |
 * | `dual` | KV 文档 + 关系表 | KV 文档 | 灰度：让影子表被真实数据填满并受校验 |
 * | `db` | KV 文档 + 关系表 | 关系表（空表回落 KV） | 切换读路径 |
 *
 * 三个刻意的设计决定：
 *
 * 1. **任何模式下都继续写 KV 文档**。它是回滚快照：把 `NAVHUB_VIDEO_STORE`
 *    改回 `json` 就能立刻回到旧行为，不需要「反向导入」。代价是一次额外写入，
 *    在 16 条视频的规模上可以忽略。
 * 2. **影子表写失败绝不影响用户写入**。JSON 已经是事实源，表只是副本；
 *    如果因为表写失败就让 `PUT /api/storage` 返回 500，等于让副本拖垮正本。
 *    失败只记 `lastSyncError` 并打日志，由 `--check` 与运维发现。
 * 3. **`db` 模式下空表回落 KV**。首次切换、迁移没跑、或表被误清空时，
 *    读路径不能返回「视频库空了」——那是最坏的一种故障。
 */
import type { AppContext } from "./context.ts";
import {
  countVideoItems,
  listVideoCategories,
  listVideoItems,
  listVideoReplacements,
  logVideoReplacement,
  replaceVideoCatalog,
  replaceVideoReplacements,
  type VideoCategoryInput,
  type VideoCategoryRow,
  type VideoItemInput,
  type VideoItemRow,
  type VideoReplacementInput,
} from "@navhub/store";

export type VideoStoreMode = "json" | "dual" | "db";

const MODES: readonly VideoStoreMode[] = ["json", "dual", "db"];

let warnedInvalidMode = false;

/**
 * 解析存储模式。
 *
 * 非法值**不退化成 `db`**（那会让一个拼写错误直接改变读路径），而是退化成
 * `json` 并告警一次 —— 与「不认识这个配置」相比，「保持现有行为」才是安全的。
 */
export function resolveVideoStoreMode(raw: string | undefined = process.env.NAVHUB_VIDEO_STORE): VideoStoreMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "json";
  if ((MODES as readonly string[]).includes(value)) return value as VideoStoreMode;
  if (!warnedInvalidMode) {
    warnedInvalidMode = true;
    console.warn(
      `[video-catalog] NAVHUB_VIDEO_STORE=${JSON.stringify(raw)} 不是合法取值（json / dual / db），已按 json 处理`,
    );
  }
  return "json";
}

/** 测试用：重置「只告警一次」的标记 */
export function resetVideoStoreModeWarning(): void {
  warnedInvalidMode = false;
}

/* ------------------------------------------------------------------ *
 * 最近一次同步结果（进程内，供 /api/health 或运维排查读取）
 * ------------------------------------------------------------------ */
export interface VideoCatalogSyncState {
  /** 最近一次尝试同步的时间戳（0 = 从未同步） */
  lastAttemptAt: number;
  /** 最近一次成功同步的时间戳（0 = 从未成功） */
  lastSuccessAt: number;
  /** 最近一次失败原因（成功后清空） */
  lastSyncError: string | null;
  /** 连续失败次数（成功后归零） */
  consecutiveFailures: number;
  /** 最近一次同步写入的分类 / 条目数 */
  lastCounts: { categories: number; items: number } | null;
}

const syncState: VideoCatalogSyncState = {
  lastAttemptAt: 0,
  lastSuccessAt: 0,
  lastSyncError: null,
  consecutiveFailures: 0,
  lastCounts: null,
};

export function videoCatalogSyncState(): VideoCatalogSyncState {
  return { ...syncState, lastCounts: syncState.lastCounts ? { ...syncState.lastCounts } : null };
}

/** 测试用：清空同步状态 */
export function resetVideoCatalogSyncState(): void {
  syncState.lastAttemptAt = 0;
  syncState.lastSuccessAt = 0;
  syncState.lastSyncError = null;
  syncState.consecutiveFailures = 0;
  syncState.lastCounts = null;
}

/* ------------------------------------------------------------------ *
 * 文档 → 行
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 条目在 `video_items.id` 上是主键，而文档里同一 id 出现在两个分类下是可能的
 * （历史上复制粘贴类目就会造成这种数据）。这里给重复 id 加后缀，避免整批 INSERT
 * 因为一条重复而全部失败。
 */
function uniqueId(candidate: string, seen: Set<string>): string {
  if (!seen.has(candidate)) {
    seen.add(candidate);
    return candidate;
  }
  for (let n = 2; n < 1000; n++) {
    const next = `${candidate}#${n}`;
    if (!seen.has(next)) {
      seen.add(next);
      return next;
    }
  }
  const fallback = `${candidate}#${Date.now()}`;
  seen.add(fallback);
  return fallback;
}

/**
 * 替换审计的权威副本（独立于 `videos.json`，**不截断**）。
 *
 * 与 overlay 侧 `lib/video-library-store.ts` 的 `REPLACEMENTS_FILE_PATH` 必须是同一个
 * 路径字符串 —— 两边各自硬编码是既有设计（api 不能 import overlay 的模块），
 * 改路径要同时改两处。
 */
export const VIDEO_REPLACEMENTS_PATH = "src/navsphere/content/video-replacements.json";

/**
 * 文档里内联的替换历史保留多少条。
 *
 * 与 overlay 侧 `capReplacementHistory()` 的上限一致：内联数组随整包文档读写，
 * 不能无限长。**关系表不吃这个限制**（它由外置文档全量同步）；
 * `db` 模式重建文档时按这个上限截断，保证与 `json` 模式的文档形状一致。
 */
const INLINE_REPLACEMENT_LIMIT = 100;

/** 一条替换记录 → 表行（文档里字段名是 `timestamp`，表里叫 `created_at`） */
function toReplacementInput(raw: unknown, index: number): VideoReplacementInput {
  const record = isRecord(raw) ? raw : {}
  const id = typeof record.id === "string" && record.id !== "" ? record.id : `replacement-${index}`
  return {
    id,
    categoryId: asString(record.categoryId) ?? "unknown",
    categoryTitle: asString(record.categoryTitle),
    oldItem: record.oldItem ?? {},
    newItem: record.newItem ?? {},
    reason: asString(record.reason),
    scoreDiff: asNumber(record.scoreDiff),
    trendKeyword: asString(record.trendKeyword),
    rolledBack: asBoolean(record.rolledBack, false),
    createdAt: asNumber(record.timestamp) ?? Date.now(),
  }
}

/**
 * 压平外置的替换审计文档。
 *
 * 兼容两种形状：`{ version, records: [...] }`（当前写入口的格式）与裸数组
 * （内联历史搬过来时的样子）。形状不认识就返回 `null`，由调用方决定记日志 ——
 * 「静默把表清空」是这一层最不能犯的错。
 */
export function flattenReplacementDoc(data: unknown): VideoReplacementInput[] | null {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.records)
      ? (data.records as unknown[])
      : null
  if (!list) return null
  return list.map((raw, index) => toReplacementInput(raw, index))
}

export interface FlattenedVideoCatalog {
  categories: VideoCategoryInput[];
  items: VideoItemInput[];
  replacements: VideoReplacementInput[];
}

/**
 * 把 `videos.json` 的文档结构压平成关系表行。
 *
 * `payload` 存的是**完整原始条目**（`{ item, sub }`），而不是 videoConfig：
 * 列只承担「可过滤 / 可排序」的投影职责，重建时一律以 payload 为准。
 * 这样即使将来列增删，round-trip 也不会因为少一列而丢字段。
 */
export function flattenVideoCatalog(data: unknown): FlattenedVideoCatalog {
  const doc = isRecord(data) ? data : {};
  const categories: VideoCategoryInput[] = [];
  const items: VideoItemInput[] = [];
  const replacements: VideoReplacementInput[] = [];
  const seenItemIds = new Set<string>();

  const pushItems = (categoryId: string, sub: Record<string, unknown> | null, list: unknown): void => {
    const subCategoryId = sub ? (typeof sub.id === "string" ? sub.id : null) : null
    asArray(list).forEach((raw, index) => {
      const item = isRecord(raw) ? raw : {}
      const config = isRecord(item.videoConfig) ? item.videoConfig : null
      const fallbackId = `${categoryId}${subCategoryId ? `_${subCategoryId}` : ""}_${index}`
      const rawId = typeof item.id === "string" && item.id !== "" ? item.id : fallbackId

      items.push({
        id: uniqueId(rawId, seenItemIds),
        categoryId,
        title: asString(item.title) ?? rawId,
        href: asString(item.href) ?? "",
        description: asString(item.description),
        icon: asString(item.icon),
        enabled: asBoolean(item.enabled, true),
        sort: index,
        platform: config ? asString(config.type) : null,
        // 外部 ID 只在**同平台内**唯一：B 站的 BV 与 YouTube 的 11 位 ID 是两套空间
        externalId: config ? (asString(config.bvid) ?? asString(config.videoId)) : null,
        author: config ? asString(config.author) : null,
        durationSec: config ? asNumber(config.durationSec) : null,
        publishedAt: config ? asString(config.publishedAt) : null,
        qualityScore: config ? asNumber(config.qualityScore) : null,
        freshnessScore: config ? asNumber(config.freshnessScore) : null,
        healthStatus: config ? asString(config.healthStatus) : null,
        sourceType: config ? asString(config.sourceType) : null,
        pinned: config ? asBoolean(config.pinned, false) : false,
        payload: {
          item,
          // 子分类元数据跟着条目走：表里没有 sub_category 表，
          // 而重建时必须还原子分类的 id / title / icon
          sub: sub ? { ...sub, items: undefined } : null,
        },
      })
    })
  }

  asArray(doc.navigationItems).forEach((rawCategory, index) => {
    const category = isRecord(rawCategory) ? rawCategory : {}
    const rawId = typeof category.id === "string" && category.id !== "" ? category.id : `category-${index}`

    categories.push({
      id: rawId,
      title: asString(category.title) ?? rawId,
      description: asString(category.description),
      icon: asString(category.icon),
      enabled: asBoolean(category.enabled, true),
      sort: index,
      harvestPolicy: isRecord(category.harvestPolicy) ? category.harvestPolicy : {},
    })

    pushItems(rawId, null, category.items)
    asArray(category.subCategories).forEach((rawSub) => {
      pushItems(rawId, isRecord(rawSub) ? rawSub : null, isRecord(rawSub) ? rawSub.items : undefined)
    })
  })

  asArray(doc.replacementHistory).forEach((raw, index) => {
    replacements.push(toReplacementInput(raw, index))
  })

  return { categories, items, replacements }
}

/* ------------------------------------------------------------------ *
 * 行 → 文档
 * ------------------------------------------------------------------ */

/**
 * 由关系表还原 `videos.json` 的文档结构。
 *
 * 未在表中体现的两处，如实说明而不是假装无损：
 *   - `replacementHistory` 的 `subCategoryId` / `subCategoryTitle` 没有对应列
 *     （表设计时把子分类归属留在了条目 payload 里，审计记录没跟）；
 *   - 条目在文档中的原始顺序以 `sort` 列为准。
 */
export function rebuildVideoCatalog(
  categories: VideoCategoryRow[],
  items: VideoItemRow[],
): { navigationItems: Array<Record<string, unknown>>; replacementHistory: Array<Record<string, unknown>> } {
  const byCategory = new Map<string, VideoItemRow[]>()
  for (const item of items) {
    const list = byCategory.get(item.categoryId)
    if (list) list.push(item)
    else byCategory.set(item.categoryId, [item])
  }

  const navigationItems = categories.map((category) => {
    const categoryItems = (byCategory.get(category.id) ?? []).slice().sort((a, b) => a.sort - b.sort)
    const topLevel: Record<string, unknown>[] = []
    const subMap = new Map<string, { meta: Record<string, unknown>; items: Record<string, unknown>[] }>()

    for (const row of categoryItems) {
      const payload = isRecord(row.payload) ? row.payload : {}
      const originalItem = isRecord(payload.item) ? payload.item : null
      const sub = isRecord(payload.sub) ? payload.sub : null

      const rebuilt: Record<string, unknown> = originalItem
        ? { ...originalItem }
        : {
            // payload 缺失时的兜底：至少不丢标题与链接
            id: row.id,
            title: row.title,
            href: row.href,
            description: row.description ?? undefined,
            icon: row.icon ?? undefined,
            enabled: row.enabled,
          }

      if (!sub) {
        topLevel.push(rebuilt)
        continue
      }

      const subId = typeof sub.id === "string" && sub.id !== "" ? sub.id : "sub-unknown"
      const bucket = subMap.get(subId)
      if (bucket) bucket.items.push(rebuilt)
      else subMap.set(subId, { meta: { ...sub }, items: [rebuilt] })
    }

    const rebuilt: Record<string, unknown> = {
      id: category.id,
      title: category.title,
      ...(category.description ? { description: category.description } : {}),
      ...(category.icon ? { icon: category.icon } : {}),
      enabled: category.enabled,
      ...(isRecord(category.harvestPolicy) && Object.keys(category.harvestPolicy).length > 0
        ? { harvestPolicy: category.harvestPolicy }
        : {}),
      items: topLevel,
    }

    if (subMap.size > 0) {
      rebuilt.subCategories = Array.from(subMap.values()).map(({ meta, items: subItems }) => ({
        ...meta,
        items: subItems,
      }))
    }

    return rebuilt
  })

  return { navigationItems, replacementHistory: [] }
}

/** 由 `listVideoReplacements()` 的行还原审计记录（供 `db` 模式使用） */
export function rebuildReplacementHistory(
  rows: Array<VideoReplacementInput & { createdAt: number; rolledBack: boolean }>,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.createdAt,
    categoryId: row.categoryId,
    categoryTitle: row.categoryTitle ?? "",
    oldItem: row.oldItem,
    newItem: row.newItem,
    reason: row.reason ?? "manual_replace",
    scoreDiff: row.scoreDiff ?? 0,
    ...(row.trendKeyword ? { trendKeyword: row.trendKeyword } : {}),
    ...(row.rolledBack ? { rolledBack: true } : {}),
  }))
}

/* ------------------------------------------------------------------ *
 * 同步 / 读取
 * ------------------------------------------------------------------ */

/**
 * 把文档同步进关系表（全量替换语义）。
 *
 * 返回 `null` 表示当前模式不需要同步（`json`）。
 * 抛错只在「调用方明确要求必须成功」时由调用方自己决定 —— 本函数不吞异常，
 * 由 `syncVideoCatalogSafely()` 负责把异常降级成状态记录。
 */
export async function syncVideoCatalog(
  ctx: AppContext,
  data: unknown,
): Promise<{ categories: number; items: number; replacements: number } | null> {
  const mode = resolveVideoStoreMode()
  if (mode === "json") return null

  const flattened = flattenVideoCatalog(data)
  const counts = await replaceVideoCatalog(ctx.repo, flattened.categories, flattened.items)
  for (const record of flattened.replacements) {
    await logVideoReplacement(ctx.repo, record)
  }

  return { ...counts, replacements: flattened.replacements.length }
}

/**
 * 同步并记录状态；**永不抛出**。
 *
 * 影子表是副本，副本失败不该让正本的写入失败（见文件头第 2 条）。
 */
export async function syncVideoCatalogSafely(
  ctx: AppContext,
  data: unknown,
): Promise<{ categories: number; items: number; replacements: number } | null> {
  syncState.lastAttemptAt = Date.now()
  try {
    const result = await syncVideoCatalog(ctx, data)
    if (result) {
      syncState.lastSuccessAt = Date.now()
      syncState.lastSyncError = null
      syncState.consecutiveFailures = 0
      syncState.lastCounts = { categories: result.categories, items: result.items }
    }
    return result
  } catch (err) {
    syncState.lastSyncError = err instanceof Error ? err.message : String(err)
    syncState.consecutiveFailures += 1
    console.warn(`[video-catalog] 影子表同步失败（不影响文档写入）：${syncState.lastSyncError}`)
    return null
  }
}

/**
 * 把**外置**的替换审计文档同步进 `video_replacements` 表（全量替换语义）。
 *
 * 为什么单独一个同步入口：`videos.json` 里的内联历史有 100 条上限（整包文档不能膨胀），
 * 而 `video-replacements.json` 是**不截断**的权威副本。表的定位是「可 SQL 查询的全量镜像」，
 * 所以它必须吃外置文档 —— 否则表里永远只有最近 100 条，回滚审计等于残废。
 *
 * 返回 `null` 表示当前模式不同步（`json`）或文档形状不认识。
 */
export async function syncReplacementHistory(
  ctx: AppContext,
  data: unknown,
): Promise<{ replacements: number } | null> {
  if (resolveVideoStoreMode() === "json") return null

  const records = flattenReplacementDoc(data)
  if (!records) {
    // 形状不认识时**不清表**，只记一条告警。用一个空数组去全量替换是最危险的默认行为。
    console.warn("[video-catalog] 外置替换历史文档形状无法识别，已跳过同步（表未被清空）")
    return null
  }

  return { replacements: await replaceVideoReplacements(ctx.repo, records) }
}

/** 同步外置替换历史并记录状态；**永不抛出**（理由同 syncVideoCatalogSafely） */
export async function syncReplacementHistorySafely(
  ctx: AppContext,
  data: unknown,
): Promise<{ replacements: number } | null> {
  syncState.lastAttemptAt = Date.now()
  try {
    const result = await syncReplacementHistory(ctx, data)
    if (result) {
      syncState.lastSuccessAt = Date.now()
      syncState.lastSyncError = null
      syncState.consecutiveFailures = 0
    }
    return result
  } catch (err) {
    syncState.lastSyncError = err instanceof Error ? err.message : String(err)
    syncState.consecutiveFailures += 1
    console.warn(`[video-catalog] 替换历史同步失败（不影响文档写入）：${syncState.lastSyncError}`)
    return null
  }
}

/** 分页大小：与 repository 内部的单次上限保持一致（传更大值也会被夹到 500） */
const VIDEO_ITEM_PAGE_SIZE = 500

/** 全量重建的条目硬上限：防止误配或数据异常把进程内存打满 */
const VIDEO_REBUILD_MAX_ITEMS = (() => {
  const raw = Number(process.env.NAVHUB_VIDEO_REBUILD_MAX || 50000)
  return Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 50000
})()

/**
 * 分页读全表条目。
 *
 * 历史实现是单次 `listVideoItems({ limit: 500 })`，条目数一旦超过 500 就整条
 * 读路径回落 KV —— 当前库有 5,578 条，于是 `NAVHUB_VIDEO_STORE=db` 永远读不到
 * 关系表，灰度开关形同虚设（还照样付着双写的成本）。
 *
 * 这里按 500 一页翻到底；上限用 `NAVHUB_VIDEO_REBUILD_MAX` 控制，超限时抛错，
 * 由调用方决定回落（而不是静默截断成半份视频库）。
 */
async function listAllVideoItems(ctx: AppContext, total: number): Promise<VideoItemRow[]> {
  if (total > VIDEO_REBUILD_MAX_ITEMS) {
    throw Object.assign(
      new Error(
        `关系表条目数 ${total} 超过全量重建上限 ${VIDEO_REBUILD_MAX_ITEMS}；` +
          `请调大 NAVHUB_VIDEO_REBUILD_MAX，或改用分页接口读取`,
      ),
      { statusCode: 413 },
    )
  }

  const out: VideoItemRow[] = []
  for (let offset = 0; offset < total; offset += VIDEO_ITEM_PAGE_SIZE) {
    const page = await listVideoItems(ctx.repo, { limit: VIDEO_ITEM_PAGE_SIZE, offset })
    if (page.length === 0) break
    out.push(...page)
  }
  return out
}

/**
 * 从关系表读取完整文档。
 *
 * 返回 `null` 表示「表里没有可用数据」，调用方应回落 KV 文档。
 * 这里的判据是**条目数为 0**：分类表可能有数据而条目表为空（迁移中途失败），
 * 那种状态读出来会得到「所有分类都是空的」，比回落更糟。
 */
export async function loadVideoCatalogFromDb(ctx: AppContext): Promise<Record<string, unknown> | null> {
  const itemCount = await countVideoItems(ctx.repo)
  if (itemCount === 0) return null

  let categories: Awaited<ReturnType<typeof listVideoCategories>>
  let items: VideoItemRow[]
  let replacements: Awaited<ReturnType<typeof listVideoReplacements>>

  try {
    ;[categories, items, replacements] = await Promise.all([
      listVideoCategories(ctx.repo),
      listAllVideoItems(ctx, itemCount),
      // 只取内联语义允许的条数：表里可能是**全量**（由 video-replacements.json 同步），
      // 而重建出来的 videos.json 是整包文档，不能把几千条审计塞回去。
      // 全量历史请走 /api/videos/history（读外置文档）或直接查 video_replacements 表。
      listVideoReplacements(ctx.repo, { limit: INLINE_REPLACEMENT_LIMIT }),
    ])
  } catch (err) {
    // 读路径不能因为影子表异常就让视频库消失：回落 KV 并留下可排查的日志
    console.warn(
      `[video-catalog] 关系表读取失败，已回落文档读取：${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }

  // 分页读到的条目数与 COUNT(*) 不一致：宁可回落文档，也不返回残缺的视频库
  // source-truth-ok: 同源完整性检查（分页读到的条数 vs COUNT(*)），防截断不是选源
  if (items.length < itemCount) {
    console.warn(
      `[video-catalog] 关系表条目数 ${itemCount}，实际读到 ${items.length}，已回落文档读取以避免截断`,
    )
    return null
  }

  const rebuilt = rebuildVideoCatalog(categories, items)
  rebuilt.replacementHistory = rebuildReplacementHistory(replacements)
  return rebuilt as unknown as Record<string, unknown>
}

/**
 * 一致性检查：对比「文档压平后的行」与「表中的行」。
 *
 * 只比对**会影响页面展示与查询**的字段，不做全字段深比较 ——
 * 目的是发现「同步没跑 / 跑了一半 / 条目丢失」，而不是做序列化等价性证明。
 */
export interface VideoCatalogCheckResult {
  ok: boolean
  docCategories: number
  dbCategories: number
  docItems: number
  dbItems: number
  /** 在文档里但不在表里 */
  missingInDb: string[]
  /** 在表里但不在文档里 */
  extraInDb: string[]
  /** 两边都有但标题/链接/健康状态不一致 */
  mismatched: Array<{ id: string; field: string; doc: unknown; db: unknown }>
}

export async function checkVideoCatalogConsistency(
  ctx: AppContext,
  data: unknown,
): Promise<VideoCatalogCheckResult> {
  const flattened = flattenVideoCatalog(data)
  // 一致性检查必须读全表：只读前 500 行会把「表里多出来的条目」全判成缺失
  const [categories, dbItemCount] = await Promise.all([
    listVideoCategories(ctx.repo),
    countVideoItems(ctx.repo),
  ])
  const items = await listAllVideoItems(ctx, dbItemCount)

  const docIds = new Set(flattened.items.map(i => i.id))
  const dbIds = new Set(items.map(i => i.id))
  const missingInDb = [...docIds].filter(id => !dbIds.has(id))
  const extraInDb = [...dbIds].filter(id => !docIds.has(id))

  const dbById = new Map(items.map(i => [i.id, i]))
  const mismatched: VideoCatalogCheckResult["mismatched"] = []
  for (const doc of flattened.items) {
    const db = dbById.get(doc.id)
    if (!db) continue
    if (db.title !== doc.title) mismatched.push({ id: doc.id, field: "title", doc: doc.title, db: db.title })
    if (db.href !== doc.href) mismatched.push({ id: doc.id, field: "href", doc: doc.href, db: db.href })
    if ((db.healthStatus ?? null) !== (doc.healthStatus ?? null)) {
      mismatched.push({ id: doc.id, field: "healthStatus", doc: doc.healthStatus ?? null, db: db.healthStatus })
    }
    if ((db.externalId ?? null) !== (doc.externalId ?? null)) {
      mismatched.push({ id: doc.id, field: "externalId", doc: doc.externalId ?? null, db: db.externalId })
    }
    if ((db.platform ?? null) !== (doc.platform ?? null)) {
      mismatched.push({ id: doc.id, field: "platform", doc: doc.platform ?? null, db: db.platform })
    }
  }

  return {
    ok:
      missingInDb.length === 0 &&
      extraInDb.length === 0 &&
      mismatched.length === 0 &&
      flattened.categories.length === categories.length &&
      flattened.items.length === items.length,
    docCategories: flattened.categories.length,
    dbCategories: categories.length,
    docItems: flattened.items.length,
    dbItems: items.length,
    missingInDb,
    extraInDb,
    mismatched,
  }
}
