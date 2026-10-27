/**
 * 视频库的关系化存储（C6 基础设施）。
 *
 * 背景：视频库一直是 `videos.json` 一个整包文档（存在中枢的 KV 里），只能整体读写。
 * 后果：
 *   - 无法「按条查询 / 按分类分页 / 只取某几条的封面」—— 任何读取都要解析整包；
 *   - 单条编辑与采集轮换互相覆盖（后者已由 `ifVersion` 兜住，但本质仍是整包语义）；
 *   - 审计只能靠文档里的 `replacementHistory` 数组，无法按时间/分类查。
 *
 * 这里先把**表结构与读写原语**落地，**不切换事实源**：
 *   - JSON 仍是唯一事实源，页面与采集链路一行没改；
 *   - 表是影子副本，由 `replaceVideoCatalog()` 全量同步（幂等）；
 *   - 将来某轮灰度再把读路径切到这些函数上，切换前只需保证同步任务在跑。
 *
 * 为什么 `payload` 存整段 videoConfig：章节树 + 逐句字幕动辄几十 KB，
 * 拆成列既没有查询需求，也会让「查一个健康状态」变成 join 大表。
 * 列只放可过滤/可排序的字段。
 */
import type { Repository } from "../repository.ts";

export interface VideoCategoryInput {
  id: string;
  title: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
  sort?: number;
  /** 采集策略（keywords / maxItems / …），整段 JSON 存一列 */
  harvestPolicy?: unknown;
}

export interface VideoItemInput {
  id: string;
  categoryId: string;
  title: string;
  href: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
  sort?: number;
  platform?: string | null;
  externalId?: string | null;
  author?: string | null;
  durationSec?: number | null;
  publishedAt?: string | null;
  qualityScore?: number | null;
  freshnessScore?: number | null;
  healthStatus?: string | null;
  sourceType?: string | null;
  pinned?: boolean;
  /** 完整 videoConfig（含 chapters / transcript） */
  payload?: unknown;
}

export interface VideoItemRow {
  id: string;
  categoryId: string;
  title: string;
  href: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  sort: number;
  platform: string | null;
  externalId: string | null;
  author: string | null;
  durationSec: number | null;
  publishedAt: string | null;
  qualityScore: number | null;
  freshnessScore: number | null;
  healthStatus: string | null;
  sourceType: string | null;
  pinned: boolean;
  payload: unknown;
  updatedAt: number;
}

export interface VideoReplacementInput {
  id: string;
  categoryId: string;
  categoryTitle?: string | null;
  oldItem: unknown;
  newItem: unknown;
  reason?: string | null;
  scoreDiff?: number | null;
  trendKeyword?: string | null;
  rolledBack?: boolean;
  createdAt?: number;
}

/** sqlite 的布尔是 0/1，pg 是真 boolean */
function boolFor(repo: Repository, value: boolean | undefined, fallback = false): boolean | number {
  const v = value ?? fallback;
  return repo.db.dialect === "sqlite" ? (v ? 1 : 0) : v;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asStr(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

interface RawVideoItemRow {
  id: string;
  category_id: string;
  title: string;
  href: string;
  description?: string | null;
  icon?: string | null;
  enabled?: unknown;
  sort?: unknown;
  platform?: string | null;
  external_id?: string | null;
  author?: string | null;
  duration_sec?: unknown;
  published_at?: string | null;
  quality_score?: unknown;
  freshness_score?: unknown;
  health_status?: string | null;
  source_type?: string | null;
  pinned?: unknown;
  payload?: unknown;
  updated_at?: unknown;
}

function rowToVideoItem(row: RawVideoItemRow): VideoItemRow {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    href: row.href,
    description: row.description ?? null,
    icon: row.icon ?? null,
    enabled: asBool(row.enabled),
    sort: asNum(row.sort) ?? 0,
    platform: row.platform ?? null,
    externalId: row.external_id ?? null,
    author: row.author ?? null,
    durationSec: asNum(row.duration_sec),
    publishedAt: row.published_at ?? null,
    qualityScore: asNum(row.quality_score),
    freshnessScore: asNum(row.freshness_score),
    healthStatus: row.health_status ?? null,
    sourceType: row.source_type ?? null,
    pinned: asBool(row.pinned),
    payload: parseJson(row.payload),
    updatedAt: asNum(row.updated_at) ?? 0,
  }
}

/**
 * 全量替换视频库。
 *
 * 语义与 `videos.json` 一致：**传入的就是全部**，未出现的分类/条目会被删除。
 * 幂等：同样的输入反复调用结果不变。
 *
 * 放在一个事务里：中途失败不会留下「分类已删、条目没写」的半截状态。
 */
export async function replaceVideoCatalog(
  repo: Repository,
  categories: VideoCategoryInput[],
  items: VideoItemInput[],
): Promise<{ categories: number; items: number }> {
  const now = Date.now()
  await repo.withTransaction(async () => {
    if (repo.db.dialect === "sqlite") {
      const db = repo.db.sqlite!;
      db.prepare("DELETE FROM video_items").run()
      db.prepare("DELETE FROM video_categories").run()

      const insCat = db.prepare(
        "INSERT INTO video_categories (id,title,description,icon,enabled,sort,harvest_policy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      for (const [idx, c] of categories.entries()) {
        insCat.run(
          c.id,
          c.title,
          c.description ?? null,
          c.icon ?? null,
          boolFor(repo, c.enabled, true),
          c.sort ?? idx,
          JSON.stringify(c.harvestPolicy ?? {}),
          now,
          now,
        )
      }

      const insItem = db.prepare(
        "INSERT INTO video_items (id,category_id,title,href,description,icon,enabled,sort,platform,external_id,author,duration_sec,published_at,quality_score,freshness_score,health_status,source_type,pinned,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      for (const [idx, it] of items.entries()) {
        insItem.run(
          it.id,
          it.categoryId,
          it.title,
          it.href,
          it.description ?? null,
          it.icon ?? null,
          boolFor(repo, it.enabled, true),
          it.sort ?? idx,
          it.platform ?? null,
          it.externalId ?? null,
          it.author ?? null,
          it.durationSec ?? null,
          it.publishedAt ?? null,
          it.qualityScore ?? null,
          it.freshnessScore ?? null,
          it.healthStatus ?? null,
          it.sourceType ?? null,
          boolFor(repo, it.pinned, false),
          JSON.stringify(it.payload ?? {}),
          now,
          now,
        )
      }
      return
    }

    await repo.db.pg!.query("DELETE FROM video_items")
    await repo.db.pg!.query("DELETE FROM video_categories")

    for (const [idx, c] of categories.entries()) {
      await repo.db.pg!.query(
        "INSERT INTO video_categories (id,title,description,icon,enabled,sort,harvest_policy,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [c.id, c.title, c.description ?? null, c.icon ?? null, boolFor(repo, c.enabled, true), c.sort ?? idx, JSON.stringify(c.harvestPolicy ?? {}), now, now],
      )
    }
    for (const [idx, it] of items.entries()) {
      await repo.db.pg!.query(
        "INSERT INTO video_items (id,category_id,title,href,description,icon,enabled,sort,platform,external_id,author,duration_sec,published_at,quality_score,freshness_score,health_status,source_type,pinned,payload,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
        [
          it.id, it.categoryId, it.title, it.href, it.description ?? null, it.icon ?? null,
          boolFor(repo, it.enabled, true), it.sort ?? idx, it.platform ?? null, it.externalId ?? null,
          it.author ?? null, it.durationSec ?? null, it.publishedAt ?? null, it.qualityScore ?? null,
          it.freshnessScore ?? null, it.healthStatus ?? null, it.sourceType ?? null,
          boolFor(repo, it.pinned, false), JSON.stringify(it.payload ?? {}), now, now,
        ],
      )
    }
  })

  return { categories: categories.length, items: items.length }
}

/** 按分类分页列出条目（只返回列字段 + payload，不做 join） */
export async function listVideoItems(
  repo: Repository,
  opts: { categoryId?: string; limit?: number; offset?: number; healthStatus?: string } = {},
): Promise<VideoItemRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  const offset = Math.max(0, opts.offset ?? 0)

  if (repo.db.dialect === "sqlite") {
    const where: string[] = []
    const args: unknown[] = []
    if (opts.categoryId) { where.push("category_id = ?"); args.push(opts.categoryId) }
    if (opts.healthStatus) { where.push("health_status = ?"); args.push(opts.healthStatus) }
    const sql =
      "SELECT * FROM video_items" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY category_id, sort, id LIMIT ? OFFSET ?"
    const rows = repo.db.sqlite!.prepare(sql).all(...args, limit, offset) as RawVideoItemRow[]
    return rows.map(rowToVideoItem)
  }

  const where: string[] = []
  const args: unknown[] = []
  if (opts.categoryId) { args.push(opts.categoryId); where.push(`category_id = $${args.length}`) }
  if (opts.healthStatus) { args.push(opts.healthStatus); where.push(`health_status = $${args.length}`) }
  args.push(limit); const limitIdx = args.length
  args.push(offset); const offsetIdx = args.length
  const sql =
    "SELECT * FROM video_items" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    ` ORDER BY category_id, sort, id LIMIT $${limitIdx} OFFSET $${offsetIdx}`
  const res = await repo.db.pg!.query(sql, args)
  return (res.rows as RawVideoItemRow[]).map(rowToVideoItem)
}

export async function getVideoItem(repo: Repository, id: string): Promise<VideoItemRow | null> {
  if (repo.db.dialect === "sqlite") {
    const row = repo.db.sqlite!.prepare("SELECT * FROM video_items WHERE id = ?").get(id) as RawVideoItemRow | undefined
    return row ? rowToVideoItem(row) : null
  }
  const res = await repo.db.pg!.query("SELECT * FROM video_items WHERE id = $1", [id])
  const row = res.rows[0] as RawVideoItemRow | undefined
  return row ? rowToVideoItem(row) : null
}

export async function countVideoItems(repo: Repository, categoryId?: string): Promise<number> {
  if (repo.db.dialect === "sqlite") {
    const row = categoryId
      ? (repo.db.sqlite!.prepare("SELECT COUNT(*) AS n FROM video_items WHERE category_id = ?").get(categoryId) as { n: number })
      : (repo.db.sqlite!.prepare("SELECT COUNT(*) AS n FROM video_items").get() as { n: number })
    return Number(row?.n ?? 0)
  }
  const res = categoryId
    ? await repo.db.pg!.query("SELECT COUNT(*)::int AS n FROM video_items WHERE category_id = $1", [categoryId])
    : await repo.db.pg!.query("SELECT COUNT(*)::int AS n FROM video_items")
  return Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0)
}

/** 记录一条替换审计（供未来按时间/分类检索，替代文档里的 replacementHistory 数组） */
export async function logVideoReplacement(
  repo: Repository,
  record: VideoReplacementInput,
): Promise<void> {
  const createdAt = record.createdAt ?? Date.now()
  const oldItem = JSON.stringify(record.oldItem ?? {})
  const newItem = JSON.stringify(record.newItem ?? {})

  if (repo.db.dialect === "sqlite") {
    repo.db.sqlite!.prepare(
      "INSERT INTO video_replacements (id,category_id,category_title,old_item,new_item,reason,score_diff,trend_keyword,rolled_back,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET rolled_back = excluded.rolled_back",
    ).run(
      record.id, record.categoryId, record.categoryTitle ?? null, oldItem, newItem,
      record.reason ?? null, record.scoreDiff ?? null, record.trendKeyword ?? null,
      boolFor(repo, record.rolledBack, false), createdAt,
    )
    return
  }

  await repo.db.pg!.query(
    "INSERT INTO video_replacements (id,category_id,category_title,old_item,new_item,reason,score_diff,trend_keyword,rolled_back,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
    "ON CONFLICT (id) DO UPDATE SET rolled_back = EXCLUDED.rolled_back",
    [
      record.id, record.categoryId, record.categoryTitle ?? null, oldItem, newItem,
      record.reason ?? null, record.scoreDiff ?? null, record.trendKeyword ?? null,
      boolFor(repo, record.rolledBack, false), createdAt,
    ],
  )
}

export async function listVideoReplacements(
  repo: Repository,
  opts: { categoryId?: string; limit?: number } = {},
): Promise<Array<VideoReplacementInput & { createdAt: number; rolledBack: boolean }>> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))

  const map = (r: Record<string, unknown>) => ({
    id: String(r.id),
    categoryId: String(r.category_id),
    categoryTitle: asStr(r.category_title),
    oldItem: parseJson(r.old_item),
    newItem: parseJson(r.new_item),
    reason: asStr(r.reason),
    scoreDiff: asNum(r.score_diff),
    trendKeyword: asStr(r.trend_keyword),
    rolledBack: asBool(r.rolled_back),
    createdAt: asNum(r.created_at) ?? 0,
  })

  if (repo.db.dialect === "sqlite") {
    const rows = opts.categoryId
      ? (repo.db.sqlite!.prepare("SELECT * FROM video_replacements WHERE category_id = ? ORDER BY created_at DESC LIMIT ?").all(opts.categoryId, limit) as Array<Record<string, unknown>>)
      : (repo.db.sqlite!.prepare("SELECT * FROM video_replacements ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>)
    return rows.map(map)
  }

  const res = opts.categoryId
    ? await repo.db.pg!.query("SELECT * FROM video_replacements WHERE category_id = $1 ORDER BY created_at DESC LIMIT $2", [opts.categoryId, limit])
    : await repo.db.pg!.query("SELECT * FROM video_replacements ORDER BY created_at DESC LIMIT $1", [limit])
  return (res.rows as Array<Record<string, unknown>>).map(map)
}
