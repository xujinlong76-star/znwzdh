import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";
import {
  buildFtsTokens,
  canonicalizeUrl,
  pinyinTraits,
  type Category,
  type Collection,
  type Site,
  type SiteStatus,
} from "@navhub/core";
import type {
  ApiTokenRecord,
  AuditLogRecord,
  FavoriteFolderRecord,
  FavoriteRecord,
  JobRecord,
  SiteInput,
  TagWithCount,
  UserProfileRecord,
  UserRecord,
  UserVaultRecord,
} from "./records.ts";
import {
  bindSqlite,
  buildIndexFields,
  rowToApiToken,
  rowToAuditLog,
  rowToCategory,
  rowToCollection,
  rowToFavorite,
  rowToFolder,
  rowToJob,
  rowToProfile,
  rowToSite,
  rowToUser,
  slugify,
  toPgSql,
} from "./dialect.ts";
import type { Db } from "../driver.ts";

export function getEnabledLiteral(repo: Repository): string {
  return repo.db.dialect === "sqlite" ? "1" : "TRUE";
}

export async function runCount(repo: Repository, sqlText: string, params: unknown[]): Promise<number> {
  if (repo.db.dialect === "sqlite") {
    const info = repo.db.sqlite!.prepare(sqlText).run(...bindSqlite(params)) as { changes?: number };
    return Number(info?.changes ?? 0);
  }
  const res = await repo.db.pg!.query(toPgSql(sqlText), params);
  return Number(res.rowCount ?? 0);
}

export async function raw(repo: Repository, sqlText: string, params: unknown[]): Promise<Record<string, any>[]> {
  if (repo.db.dialect === "sqlite") {
    return repo.db.sqlite!.prepare(sqlText).all(...bindSqlite(params)) as Record<string, any>[];
  }
  const res = await repo.db.pg!.query(toPgSql(sqlText), params);
  // PostgreSQL 折叠未加引号的别名为小写，这里统一归一化，读取侧用小写键
  return (res.rows as Record<string, unknown>[]).map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) out[k.toLowerCase()] = r[k];
    return out as Record<string, any>;
  });
}

export async function run(repo: Repository, sqlText: string, params: unknown[]): Promise<void> {
  if (repo.db.dialect === "sqlite") {
    repo.db.sqlite!.prepare(sqlText).run(...bindSqlite(params));
    return;
  }
  await repo.db.pg!.query(toPgSql(sqlText), params);
}
