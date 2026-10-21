import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";

/**
 * 身份合并与用户中心聚合。
 *
 * 背景：匿名用户（anonId）与登录用户（userId）是两套身份，所有用户数据都按
 * 身份字符串归属。登录后必须把匿名数据并入 canonical userId，否则换设备/
 * 换浏览器就是一份空数据（见 docs 用户中心方案）。
 *
 * 设计约束：
 *  - 合并必须幂等：同一 source/target 只执行一次，重复调用返回首次统计；
 *  - 全部在一个事务里完成，失败不留半合并状态；
 *  - 合并后写 identity_aliases，旧 anonId 仍能解析到新身份（旧标签页不丢数据）；
 *  - E2EE 金库**不做服务端合并**（服务端没有明文），返回 vaultNeedsChoice 由前端引导。
 */

export interface IdentityMergeStats {
  favoritesMoved: number;
  favoritesSkipped: number;
  foldersMoved: number;
  searchesMoved: number;
  eventsMoved: number;
  pluginsMoved: number;
  starsMoved: number;
  reviewsMoved: number;
  llmConfigMoved: boolean;
  workspacesMoved: boolean;
  vaultNeedsChoice: boolean;
}

export interface IdentityMergeResult extends IdentityMergeStats {
  source: string;
  target: string;
  alreadyMerged: boolean;
}

export interface UserCenterOverview {
  identity: string;
  user: { id: string; username: string; email: string | null; avatar: string | null; source: string } | null;
  counts: {
    favorites: number;
    folders: number;
    searches: number;
    activePluginInstalls: number;
    pluginStars: number;
    authoredPlugins: number;
    recentEvents: number;
  };
  profile: { exists: boolean; updatedAt: number | null };
  vault: { exists: boolean; version: number | null; updatedAt: number | null };
  llmConfig: { exists: boolean };
  aliases: string[];
}

const MERGE_LOOKBACK = 5;

/** 解析身份别名（合并后的旧 anonId 会指向 canonical id）。最多跟随 5 跳，防环。 */
export async function resolveIdentity(repo: Repository, identity: string): Promise<string> {
  let current = identity;
  for (let i = 0; i < MERGE_LOOKBACK; i++) {
    const rows = await repo.raw("SELECT canonical FROM identity_aliases WHERE alias = ? LIMIT 1", [current]);
    const next = rows[0] ? String(rows[0].canonical) : "";
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

function parseStats(raw: unknown): IdentityMergeStats | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<IdentityMergeStats>;
    return {
      favoritesMoved: Number(parsed.favoritesMoved ?? 0),
      favoritesSkipped: Number(parsed.favoritesSkipped ?? 0),
      foldersMoved: Number(parsed.foldersMoved ?? 0),
      searchesMoved: Number(parsed.searchesMoved ?? 0),
      eventsMoved: Number(parsed.eventsMoved ?? 0),
      pluginsMoved: Number(parsed.pluginsMoved ?? 0),
      starsMoved: Number(parsed.starsMoved ?? 0),
      reviewsMoved: Number(parsed.reviewsMoved ?? 0),
      llmConfigMoved: Boolean(parsed.llmConfigMoved),
      workspacesMoved: Boolean(parsed.workspacesMoved),
      vaultNeedsChoice: Boolean(parsed.vaultNeedsChoice),
    };
  } catch {
    return null;
  }
}

async function findMerge(repo: Repository, source: string, target: string): Promise<IdentityMergeResult | null> {
  const rows = await repo.raw(
    "SELECT status, stats FROM identity_merges WHERE source = ? AND target = ? LIMIT 1",
    [source, target],
  );
  const row = rows[0];
  if (!row) return null;
  const stats = parseStats(row.stats);
  if (!stats) return null;
  return { ...stats, source, target, alreadyMerged: true };
}

/**
 * 合并匿名身份到登录身份。幂等；source === target 时抛错（调用方应先 resolve）。
 */
export async function mergeIdentity(
  repo: Repository,
  source: string,
  target: string,
): Promise<IdentityMergeResult> {
  if (!source || !target) throw new Error("合并身份缺少 source 或 target");
  if (source === target) throw new Error("source 与 target 相同，无需合并");

  const previous = await findMerge(repo, source, target);
  if (previous) return previous;

  return repo.withTransaction(async () => {
    // 事务内再查一次：并发双击时后到的事务直接返回已有结果
    const again = await findMerge(repo, source, target);
    if (again) return again;

    const stats: IdentityMergeStats = {
      favoritesMoved: 0,
      favoritesSkipped: 0,
      foldersMoved: 0,
      searchesMoved: 0,
      eventsMoved: 0,
      pluginsMoved: 0,
      starsMoved: 0,
      reviewsMoved: 0,
      llmConfigMoved: false,
      workspacesMoved: false,
      vaultNeedsChoice: false,
    };

    // 1) 收藏：按 (user_id, site_id) 去重；目标已有则跳过，源行最后统一删除
    const favorites = await repo.raw("SELECT * FROM favorites WHERE user_id = ?", [source]);
    for (const row of favorites) {
      const changes = await repo.runCount(
        `INSERT INTO favorites (id, user_id, site_id, folder_id, note, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (user_id, site_id) DO NOTHING`,
        [
          randomUUID(),
          target,
          String(row.site_id),
          row.folder_id ?? null,
          row.note ?? null,
          Number(row.created_at ?? Date.now()),
          Number(row.updated_at ?? row.created_at ?? Date.now()),
        ],
      );
      if (changes > 0) stats.favoritesMoved++;
      else stats.favoritesSkipped++;
    }
    await repo.run("DELETE FROM favorites WHERE user_id = ?", [source]);

    // 2) 文件夹：id 全局唯一，直接改归属；收藏里的 folder_id 引用仍然有效
    stats.foldersMoved = await repo.runCount(
      "UPDATE favorite_folders SET user_id = ? WHERE user_id = ?",
      [target, source],
    );

    // 3) 搜索历史 / 行为事件：直接改写归属，画像随后由聚合重建
    stats.searchesMoved = await repo.runCount(
      "UPDATE search_history SET user_id = ? WHERE user_id = ?",
      [target, source],
    );
    stats.eventsMoved = await repo.runCount(
      "UPDATE events SET identity = ? WHERE identity = ?",
      [target, source],
    );

    // 4) 画像：源画像删除；目标画像保留，后续用合并后的事件刷新
    await repo.run("DELETE FROM user_profiles WHERE user_id = ?", [source]);

    // 5) 个人 AI 配置：目标已有则保留目标的，否则接管源的
    const targetLlm = await repo.raw("SELECT 1 AS ok FROM user_llm_configs WHERE identity = ? LIMIT 1", [target]);
    if (targetLlm[0]) {
      await repo.run("DELETE FROM user_llm_configs WHERE identity = ?", [source]);
    } else {
      stats.llmConfigMoved = (await repo.runCount(
        "UPDATE user_llm_configs SET identity = ? WHERE identity = ?",
        [target, source],
      )) > 0;
    }

    // 6) 工作空间：目前仍存在 vault 的 workspaces:<identity> 键，目标没有才接管
    const sourceWorkspaces = await repo.raw(
      "SELECT payload FROM user_vault_sync WHERE user_id = ? LIMIT 1",
      ["workspaces:" + source],
    );
    if (sourceWorkspaces[0]) {
      const targetKey = "workspaces:" + target;
      const targetWorkspaces = await repo.raw(
        "SELECT 1 AS ok FROM user_vault_sync WHERE user_id = ? LIMIT 1",
        [targetKey],
      );
      if (!targetWorkspaces[0]) {
        await repo.run("UPDATE user_vault_sync SET user_id = ? WHERE user_id = ?", [
          targetKey,
          "workspaces:" + source,
        ]);
      } else {
        await repo.run("DELETE FROM user_vault_sync WHERE user_id = ?", ["workspaces:" + source]);
      }
      stats.workspacesMoved = true;
    }

    // 7) E2EE 金库：服务端无明文，无法合并；保留源密文并交由前端二选一
    const sourceVault = await repo.raw("SELECT 1 AS ok FROM user_vault_sync WHERE user_id = ? LIMIT 1", [source]);
    stats.vaultNeedsChoice = Boolean(sourceVault[0]);

    // 8) 插件安装/星标/评价：按复合主键去重，新增的活跃记录才调整计数
    const installs = await repo.raw("SELECT * FROM plugin_installs WHERE identity = ?", [source]);
    for (const row of installs) {
      const changes = await repo.runCount(
        `INSERT INTO plugin_installs (plugin_id, identity, version, meta, installed_at, removed_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (plugin_id, identity) DO NOTHING`,
        [row.plugin_id, target, row.version, row.meta ?? null, row.installed_at, row.removed_at ?? null],
      );
      if (changes > 0) {
        stats.pluginsMoved++;
        if (row.removed_at == null) {
          await repo.run("UPDATE plugins SET install_count = install_count + 1 WHERE id = ?", [row.plugin_id]);
        }
      }
    }
    await repo.run("DELETE FROM plugin_installs WHERE identity = ?", [source]);

    const stars = await repo.raw("SELECT * FROM plugin_stars WHERE identity = ?", [source]);
    for (const row of stars) {
      const changes = await repo.runCount(
        `INSERT INTO plugin_stars (plugin_id, identity, created_at)
         VALUES (?,?,?)
         ON CONFLICT (plugin_id, identity) DO NOTHING`,
        [row.plugin_id, target, row.created_at],
      );
      if (changes > 0) {
        stats.starsMoved++;
        await repo.run("UPDATE plugins SET star_count = star_count + 1 WHERE id = ?", [row.plugin_id]);
      }
    }
    await repo.run("DELETE FROM plugin_stars WHERE identity = ?", [source]);

    const reviews = await repo.raw("SELECT * FROM plugin_reviews WHERE identity = ?", [source]);
    for (const row of reviews) {
      const changes = await repo.runCount(
        `INSERT INTO plugin_reviews (
           id, plugin_id, identity, rating, title, content, installed_version, status,
           report_count, moderation_note, moderated_at, moderated_by, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (plugin_id, identity) DO NOTHING`,
        [
          randomUUID(),
          row.plugin_id,
          target,
          row.rating,
          row.title ?? null,
          row.content ?? null,
          row.installed_version,
          row.status ?? "visible",
          row.report_count ?? 0,
          row.moderation_note ?? null,
          row.moderated_at ?? null,
          row.moderated_by ?? null,
          row.created_at,
          row.updated_at ?? row.created_at,
        ],
      );
      if (changes > 0) stats.reviewsMoved++;
    }
    await repo.run("DELETE FROM plugin_reviews WHERE identity = ?", [source]);

    // 9) 写别名与合并记录（同一 source/target 只有一条）
    await repo.run(
      `INSERT INTO identity_aliases (alias, canonical, created_at) VALUES (?,?,?)
       ON CONFLICT (alias) DO UPDATE SET canonical = excluded.canonical`,
      [source, target, Date.now()],
    );
    await repo.run(
      `INSERT INTO identity_merges (id, source, target, status, stats, created_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (source, target) DO UPDATE SET status = 'completed', stats = excluded.stats`,
      [randomUUID(), source, target, "completed", JSON.stringify(stats), Date.now()],
    );

    return { ...stats, source, target, alreadyMerged: false };
  });
}

/** 用户中心概览：一次聚合身份、计数与各域存在性，供 /api/me 使用。 */
export async function getUserCenterOverview(repo: Repository, identity: string): Promise<UserCenterOverview> {
  const canonical = await resolveIdentity(repo, identity);
  const now = Date.now();

  const countRow = (await repo.raw(
    `SELECT
       (SELECT COUNT(*) FROM favorites WHERE user_id = ?) AS favorites,
       (SELECT COUNT(*) FROM favorite_folders WHERE user_id = ?) AS folders,
       (SELECT COUNT(*) FROM search_history WHERE user_id = ?) AS searches,
       (SELECT COUNT(*) FROM plugin_installs WHERE identity = ? AND removed_at IS NULL) AS active_installs,
       (SELECT COUNT(*) FROM plugin_stars WHERE identity = ?) AS stars,
       (SELECT COUNT(*) FROM plugins WHERE owner_identity = ?) AS authored,
       (SELECT COUNT(*) FROM events WHERE identity = ? AND created_at >= ?) AS recent_events`,
    [canonical, canonical, canonical, canonical, canonical, canonical, canonical, now - 30 * 86_400_000],
  ))[0] as Record<string, unknown> | undefined;

  const num = (v: unknown): number => Number(v ?? 0);

  const profileRow = (await repo.raw(
    "SELECT updated_at FROM user_profiles WHERE user_id = ? LIMIT 1",
    [canonical],
  ))[0];
  const vaultRow = (await repo.raw(
    "SELECT version, updated_at FROM user_vault_sync WHERE user_id = ? LIMIT 1",
    [canonical],
  ))[0];
  const llmRow = (await repo.raw(
    "SELECT 1 AS ok FROM user_llm_configs WHERE identity = ? LIMIT 1",
    [canonical],
  ))[0];
  const aliasRows = await repo.raw(
    "SELECT alias FROM identity_aliases WHERE canonical = ? ORDER BY created_at ASC",
    [canonical],
  );

  const user = await repo.getUser(canonical);

  return {
    identity: canonical,
    user: user
      ? {
          id: user.id,
          username: user.username,
          email: user.email ?? null,
          avatar: user.avatar ?? null,
          source: user.source ?? "local",
        }
      : null,
    counts: {
      favorites: num(countRow?.favorites),
      folders: num(countRow?.folders),
      searches: num(countRow?.searches),
      activePluginInstalls: num(countRow?.active_installs),
      pluginStars: num(countRow?.stars),
      authoredPlugins: num(countRow?.authored),
      recentEvents: num(countRow?.recent_events),
    },
    profile: {
      exists: Boolean(profileRow),
      updatedAt: profileRow ? Number(profileRow.updated_at) : null,
    },
    vault: {
      exists: Boolean(vaultRow),
      version: vaultRow ? Number(vaultRow.version) : null,
      updatedAt: vaultRow ? Number(vaultRow.updated_at) : null,
    },
    llmConfig: { exists: Boolean(llmRow) },
    aliases: aliasRows.map((r) => String(r.alias)),
  };
}
