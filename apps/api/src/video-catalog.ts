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
    const record = isRecord(raw) ? raw : {}
    const id = typeof record.id === "string" && record.id !== "" ? record.id : `replacement-${index}`
    replacements.push({
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
    })
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
 * 从关系表读取完整文档。
 *
 * 返回 `null` 表示「表里没有可用数据」，调用方应回落 KV 文档。
 * 这里的判据是**条目数为 0**：分类表可能有数据而条目表为空（迁移中途失败），
 * 那种状态读出来会得到「所有分类都是空的」，比回落更糟。
 */
export async function loadVideoCatalogFromDb(ctx: AppContext): Promise<Record<string, unknown> | null> {
  const itemCount = await countVideoItems(ctx.repo)
  if (itemCount === 0) return null

  const [categories, items, replacements] = await Promise.all([
    listVideoCategories(ctx.repo),
    listVideoItems(ctx.repo, { limit: 500 }),
    listVideoReplacements(ctx.repo, { limit: 500 }),
  ])

  // 条目超过单次上限（500）时不能静默截断：宁可回落文档，也不返回残缺的视频库
  if (items.length < itemCount) {
    console.warn(
      `[video-catalog] 关系表条目数 ${itemCount} 超过单次读取上限，已回落文档读取以避免截断`,
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
  const [categories, items] = await Promise.all([
    listVideoCategories(ctx.repo),
    listVideoItems(ctx.repo, { limit: 500 }),
  ])

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
