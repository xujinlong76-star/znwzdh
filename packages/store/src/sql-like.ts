/**
 * SQL LIKE 参数转义。
 *
 * 用户输入里的 `%` / `_` 是 LIKE 通配符：搜索 `%` 会命中全表，`_` 会命中任意
 * 单字符。所有把用户输入拼进 LIKE 模式的查询都必须先调用 `escapeLike`，
 * 并在 SQL 里显式写 `ESCAPE '!'`（SQLite 与 PostgreSQL 语法一致）。
 *
 * 选择 `!` 而不是反斜杠：反斜杠在 JS 字符串、SQL 字符串、各数据库方言里
 * 都要二次转义，最容易出现「测试环境正常、PG 上行为不同」的偏差。
 */
export function escapeLike(value: string): string {
  return String(value).replace(/[!%_]/g, (ch) => `!${ch}`)
}

/** 生成 `%value%` 包含匹配模式（已转义通配符）。 */
export function containsLike(value: string): string {
  return `%${escapeLike(value)}%`
}

/** 生成 `value%` 前缀匹配模式（已转义通配符）。 */
export function prefixLike(value: string): string {
  return `${escapeLike(value)}%`
}
