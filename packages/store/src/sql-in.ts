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

/** 与 driver.ts 的 Dialect 保持同形：新方言在两侧同步增加，类型上不会静默漏配 */
export type SqlDialect = "sqlite" | "pg" | "libsql";

/**
 * 把整个列表绑成**一个**参数的集合谓词（`IN` 的无分片形态）。
 *
 * 为什么必须存在：`inPredicate` 把每个值绑成一个参数，语句级绑参上限（SQLite 999）
 * 意味着 >500 个 id 就得拆成多条语句，调用方被迫做「分片查 + JS 归并」
 * （见 repository/sites.ts 的 listSites）。两种方言各有一个原生的单参数写法：
 *   - SQLite / libsql：`col IN (SELECT value FROM json_each(?))`，
 *     参数是 JSON 数组字符串，长度只受文本长度限制，与绑参上限无关；
 *   - PostgreSQL：`col = ANY(?::text[])`，node-postgres 把 JS 数组序列化成
 *     数组字面量，同样只占一个参数位。
 *
 * 空列表返回 null：空集合的业务语义是「无匹配」，不是「恒假条件」，
 * 必须由调用方短路（返回空页），否则会把语义交给 SQL 引擎的空 IN 行为。
 *
 * JSON1 是否可用由 Repository 首次调用时探测（老 SQLite 构建没有 JSON1），
 * 探测失败时调用方回退到分片路径——本函数不做运行时能力假设。
 */
export function collectionInPredicate(
  dialect: SqlDialect,
  column: string,
  values: Array<string | number>,
): { sql: string; params: unknown[] } | null {
  if (values.length === 0) return null;
  if (dialect === "pg") {
    return { sql: `${column} = ANY(?::text[])`, params: [values] };
  }
  if (dialect === "sqlite" || dialect === "libsql") {
    return { sql: `${column} IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(values)] };
  }
  return null;
}
