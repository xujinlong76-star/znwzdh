import type { Repository } from "../repository.ts";
import { inPredicate } from "../sql-in.ts";

/**
 * 结构化档案字段（02-site-profiles §3，batch0-02）。
 *
 * 两张表：
 * - site_profiles：一站一行，自由文本与关系字段（best_for / not_for /
 *   license / alternatives）+ 行级来源与核查戳；
 * - site_profile_provenance：分面类字段的 {source_url, verified_at,
 *   verified_by} 四元组载体（pricing_model 的值住 site_facets.pricing，
 *   其溯源行同样写这里）。
 *
 * 写纪律（与 site_prices 同源）：
 * - verified_at 一律由调用方传服务端时间（路由层 Date.now()），仓储层
 *   不接受客户端传入——这里只按入参原样写库；
 * - alternatives 写时校验每个目标 id 在本站存在，否则整行写失败，
 *   不静默丢弃；
 * - upsert 只覆盖同站同字段，不碰他站。
 */

export type SiteProfileStatus = "draft" | "verified";

/** provenance 允许的 field_key：分面类字段 + pricing_model（值住 facets）。 */
export const PROFILE_PROVENANCE_FIELD_KEYS = [
  "requires_account",
  "free_trial",
  "data_export",
  "pricing_model",
] as const;

export type ProfileProvenanceFieldKey =
  (typeof PROFILE_PROVENANCE_FIELD_KEYS)[number];

export interface SiteProfileRecord {
  siteId: string;
  bestFor: string | null;
  notFor: string | null;
  license: string | null;
  /** 站内目标 id 数组（库内存 JSON 文本数组）。 */
  alternatives: string[];
  profileSourceUrl: string;
  profileVerifiedAt: number;
  verifiedBy: string;
  profileStatus: SiteProfileStatus;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertSiteProfileInput {
  siteId: string;
  bestFor: string | null;
  notFor: string | null;
  license: string | null;
  alternatives: string[];
  profileSourceUrl: string;
  profileStatus: SiteProfileStatus;
  verifiedBy: string;
  /** 服务端写入时间（毫秒戳，路由层 Date.now()）。 */
  profileVerifiedAt: number;
}

export interface ProfileProvenanceRecord {
  siteId: string;
  fieldKey: string;
  sourceUrl: string;
  verifiedAt: number;
  verifiedBy: string;
}

export interface SetProfileProvenanceInput {
  siteId: string;
  fieldKey: string;
  sourceUrl: string;
  /** 服务端写入时间（毫秒戳，路由层 Date.now()）。 */
  verifiedAt: number;
  verifiedBy: string;
}

type SiteProfileRow = {
  site_id: string;
  best_for: string | null;
  not_for: string | null;
  license: string | null;
  alternatives: string | null;
  profile_source_url: string;
  profile_verified_at: number;
  verified_by: string;
  profile_status: string;
  created_at: number;
  updated_at: number;
};

type ProfileProvenanceRow = {
  site_id: string;
  field_key: string;
  source_url: string;
  verified_at: number;
  verified_by: string;
};

function parseAlternatives(raw: string | null, siteId: string): string[] {
  if (raw == null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`站点档案 alternatives 不是合法 JSON 数组: ${siteId}`);
  }
  if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) {
    throw new Error(`站点档案 alternatives 不是字符串数组: ${siteId}`);
  }
  return parsed as string[];
}

function rowToProfile(row: SiteProfileRow): SiteProfileRecord {
  return {
    siteId: row.site_id,
    bestFor: row.best_for,
    notFor: row.not_for,
    license: row.license,
    alternatives: parseAlternatives(row.alternatives, row.site_id),
    profileSourceUrl: row.profile_source_url,
    profileVerifiedAt: Number(row.profile_verified_at),
    verifiedBy: row.verified_by,
    profileStatus: row.profile_status === "verified" ? "verified" : "draft",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToProvenance(row: ProfileProvenanceRow): ProfileProvenanceRecord {
  return {
    siteId: row.site_id,
    fieldKey: row.field_key,
    sourceUrl: row.source_url,
    verifiedAt: Number(row.verified_at),
    verifiedBy: row.verified_by,
  };
}

/**
 * 校验 alternatives 目标 id 全部存在于 sites 表；缺失即整行写失败。
 * 路由层已先做同一校验并回 400，这里是最后一道防线——直接写库的调用方
 * 绕过路由时也不能把站外 id 静默写进去（不丢弃、不截断，整行拒绝）。
 */
export async function assertAlternativeTargetsExist(
  repo: Repository,
  alternatives: string[],
): Promise<void> {
  const uniq = [...new Set(alternatives.filter(Boolean))];
  if (uniq.length === 0) return;
  const predicate = inPredicate("id", uniq);
  const rows = (await repo.raw(
    `SELECT id FROM sites WHERE ${predicate.sql}`,
    predicate.params,
  )) as Array<{ id: string }>;
  const found = new Set(rows.map((r) => String(r.id)));
  const missing = uniq.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`alternatives 目标站点不存在: ${missing.join(", ")}`);
  }
}

export async function getSiteProfile(
  repo: Repository,
  siteId: string,
): Promise<SiteProfileRecord | null> {
  const row = (await repo.raw(
    "SELECT * FROM site_profiles WHERE site_id = ? LIMIT 1",
    [siteId],
  ))[0] as SiteProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export async function upsertSiteProfile(
  repo: Repository,
  input: UpsertSiteProfileInput,
): Promise<SiteProfileRecord> {
  await assertAlternativeTargetsExist(repo, input.alternatives);
  const now = Date.now();
  await repo.run(
    `INSERT INTO site_profiles
       (site_id, best_for, not_for, license, alternatives, profile_source_url,
        profile_verified_at, verified_by, profile_status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (site_id) DO UPDATE SET
       best_for = excluded.best_for,
       not_for = excluded.not_for,
       license = excluded.license,
       alternatives = excluded.alternatives,
       profile_source_url = excluded.profile_source_url,
       profile_verified_at = excluded.profile_verified_at,
       verified_by = excluded.verified_by,
       profile_status = excluded.profile_status,
       updated_at = excluded.updated_at`,
    [
      input.siteId,
      input.bestFor,
      input.notFor,
      input.license,
      JSON.stringify(input.alternatives),
      input.profileSourceUrl,
      input.profileVerifiedAt,
      input.verifiedBy,
      input.profileStatus,
      now,
      now,
    ],
  );
  const saved = await getSiteProfile(repo, input.siteId);
  if (!saved) throw new Error("保存站点档案后无法读回: " + input.siteId);
  return saved;
}

export async function getProfileProvenance(
  repo: Repository,
  siteId: string,
): Promise<ProfileProvenanceRecord[]> {
  const rows = (await repo.raw(
    "SELECT * FROM site_profile_provenance WHERE site_id = ? ORDER BY field_key ASC",
    [siteId],
  )) as ProfileProvenanceRow[];
  return rows.map(rowToProvenance);
}

export async function setProfileProvenance(
  repo: Repository,
  input: SetProfileProvenanceInput,
): Promise<ProfileProvenanceRecord> {
  await repo.run(
    `INSERT INTO site_profile_provenance
       (site_id, field_key, source_url, verified_at, verified_by)
     VALUES (?,?,?,?,?)
     ON CONFLICT (site_id, field_key) DO UPDATE SET
       source_url = excluded.source_url,
       verified_at = excluded.verified_at,
       verified_by = excluded.verified_by`,
    [input.siteId, input.fieldKey, input.sourceUrl, input.verifiedAt, input.verifiedBy],
  );
  const rows = await getProfileProvenance(repo, input.siteId);
  const saved = rows.find((r) => r.fieldKey === input.fieldKey);
  if (!saved) throw new Error("保存档案溯源后无法读回: " + input.siteId + "/" + input.fieldKey);
  return saved;
}

/**
 * 档案分面定向写（只动给定的键，不动该站其他分面）。
 *
 * 与 setSiteFacets（全量替换）的分工：setSiteFacets 是管理员编辑语义，
 * 整站分面一把换掉；这里是 PUT /api/sites/:id/profile 随档案同事务写
 * requires_account / free_trial / data_export 三键的语义——只删这三键
 * 的旧行再插入新值，pricing / platform 等其他维原样保留。
 * 调用方须在 repo.withTransaction 内与 upsertSiteProfile /
 * setProfileProvenance 一起调，保证三者同事务。
 */
export async function upsertProfileFacets(
  repo: Repository,
  siteId: string,
  facets: Record<string, string[]>,
): Promise<void> {
  for (const [rawKey, rawValues] of Object.entries(facets)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    const values = [...new Set(rawValues.map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
    await repo.run("DELETE FROM site_facets WHERE site_id = ? AND facet_key = ?", [siteId, key]);
    for (const val of values) {
      await repo.run(
        "INSERT INTO site_facets (site_id, facet_key, facet_value) VALUES (?, ?, ?)",
        [siteId, key, val],
      );
    }
  }
}
