/**
 * `IN (...)` 参数预算。
 *
 * 绑定参数个数上限是**语句级**的：SQLite 的老构建是 999（`SQLITE_LIMIT_VARIABLE_NUMBER`，
 * 较新版本 32766，实测本机 better-sqlite3 到 5000 仍可用），PostgreSQL 是 65535。
 * 超限不是「变慢」而是直接抛错 → 500；而本站里多处 IN 列表的长度由数据量决定
 * （一个热门分面值能覆盖上千站点）。所以这类列表必须**按片拆成多条语句**，
 * 而不是等运营侧攒出第 1000 / 第 32767 条记录时才发现列表接口集体 500。
 *
 * ⚠️ 拆片必须是「多条语句」级的：把 `(col IN (…500…) OR col IN (…500…))` 拼进
 * 同一条语句看着像分片，参数总数一点没减，等于没分片。因此 `inPredicate` 只生成
 * **一片**的谓词，分片与多次执行由调用方负责（见 repository/sites.ts 的 listSites）。
 */

/** 单条语句里一个 IN 列表最多绑多少个参数（对 999 与 65535 两侧都留出余量） */
export const SQL_IN_CHUNK = 500;

/** 按 SQL_IN_CHUNK 切分（分片顺序即参数顺序） */
export function chunkList<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += SQL_IN_CHUNK) out.push(items.slice(i, i + SQL_IN_CHUNK));
  return out;
}

/**
 * 生成**一片**的 IN 谓词与其参数（长度必须 ≤ SQL_IN_CHUNK）。
 *
 * 调用方必须保证 `values` 非空且不超过一片：空集合的业务语义是「无匹配」，
 * 不是「不加这个条件」，那一支要由调用方自己短路返回。
 */
export function inPredicate(column: string, values: Iterable<string | number>): { sql: string; params: unknown[] } {
  const list: unknown[] = [...values];
  return { sql: `${column} IN (${list.map(() => "?").join(",")})`, params: list };
}
