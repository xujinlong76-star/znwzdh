/**
 * 导航快照的版本号（升级改造方案 P1-1）。
 *
 * 解决的问题：快照缓存过去靠一条 `COUNT(*) / MAX(updated_at)` 指纹判断「库变过没有」，
 * 而指纹在**缓存命中**的路径上也要跑 —— PG 在大表上的 COUNT(*) 是顺序扫描，
 * 等于命中也付一次重查询的代价；更麻烦的是多实例只能靠 TTL 兜住滞后（最长 30s），
 * 而快照同时是后台「读-改-写」的写侧数据源，滞后不是慢而是丢数据。
 *
 * 这里换成 `data_version` 单行表的主键点查（两种方言都是微秒级），
 * 递增由触发器完成（建表语句见 `migrate.ts` 的 `migrateNavVersionTriggers`）。
 *
 * 为什么读侧还要探针：触发器**创建失败**（权限受限的 PG 部署、并发启动）不会让服务起不来，
 * 但会让版本号冻结 —— 冻结的版本号比没有版本号更危险，因为它看起来一切正常。
 * 探针把「该有触发器的地方有没有」变成可断言的读数：/api/health 报出来，测试也能钉住。
 */
import type { Repository } from "../repository.ts";
import { navVersionTriggerNames } from "../migrate.ts";

/** 版本号读数；null = 取不到（老库没这张表 / 单行没种下 / 查询失败） */
export async function readNavDataVersion(repo: Repository): Promise<number | null> {
  try {
    const rows = await repo.raw("SELECT version FROM data_version WHERE id = 1");
    const raw = rows[0]?.version;
    if (raw === undefined || raw === null) return null;
    // PG 把 BIGINT 返成字符串：不 Number() 会得到 NaN，再被当成「版本变了」无限重建
    const version = Number(raw);
    return Number.isFinite(version) ? version : null;
  } catch {
    return null;
  }
}

export interface NavVersionProbe {
  version: number | null;
  /** 实际存在的版本号触发器名 */
  present: string[];
  /** 应有但没有的触发器名（非空 = 版本号会冻结，缓存只能靠 TTL） */
  missing: string[];
}

/**
 * 核对「应有的触发器是否都在」。
 *
 * 取全量触发器名再在 JS 里按清单过滤：SQL 侧的 `LIKE 'nav_version_%'` 里下划线是
 * 单字符通配，两种方言的转义写法还不一样 —— 用清单比对反而更短，也更难写错。
 */
export async function navVersionProbe(repo: Repository): Promise<NavVersionProbe> {
  const version = await readNavDataVersion(repo);
  const expected = navVersionTriggerNames();
  let names: string[] = [];
  try {
    const rows =
      repo.db.dialect === "pg"
        ? await repo.raw(
            "SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal",
          )
        : await repo.raw("SELECT name FROM sqlite_master WHERE type = 'trigger'");
    names = rows.map((r) => String(r.name));
  } catch {
    // 目录查询失败（权限/只读副本）：全部记为缺失，让上层看见「不确定」而不是「没问题」
    return { version, present: [], missing: expected };
  }
  const present = expected.filter((name) => names.includes(name));
  return { version, present, missing: expected.filter((name) => !names.includes(name)) };
}
