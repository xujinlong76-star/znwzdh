/**
 * Keyset（游标）分页共享工具（M12）。
 *
 * 为什么不用 OFFSET：`LIMIT ? OFFSET ?` 必须先扫过并丢弃 offset 行——页越深越贵，
 * 且两页之间有写入时同一行会跨页重复或被跳过。Keyset 用上一页末行的排序键做
 * `WHERE (sort, id) > (?, ?)` 形式的谓词，定位直接走排序索引，与页深无关，
 * 写并发下也不会重读/漏读同一行。
 *
 * 游标格式：排序键值数组的 base64url(JSON)。不透明——调用方只负责原样回传，
 * 不解析、不构造。值只能是 string | number（排序键列在库里都是这两类；
 * 含 null / 长度不符 / 非法 base64 一律视为无效游标，由调用方回 400）。
 *
 * 谓词生成：对 n 个排序键做字典序展开（混合升/降序也适用）：
 *   (k1 op1 v1)
 *   OR (k1 = v1 AND k2 op2 v2)
 *   OR (k1 = v1 AND k2 = v2 AND k3 op3 v3) ...
 * 其中 ASC 用 `>`、DESC 用 `<`。调用方必须保证谓词里的键与 ORDER BY 的键
 * **逐项一致**（含决胜键 id），否则游标页边界会丢行或重行——各 listing 函数
 * 的注释里标了自己的键表。
 */
export type KeysetDirection = "ASC" | "DESC";

export interface KeysetKey {
  /** 列或表达式（如 `LOWER(COALESCE(s.title, ''))`）；调用方保证它与 ORDER BY 同款。 */
  column: string;
  direction: KeysetDirection;
}

export type KeysetValue = string | number;

/** 游标无效时抛出的错误：路由层据此回 400（不要让它冒泡成 500）。 */
export class InvalidKeysetCursorError extends Error {
  constructor(message = "分页游标无效") {
    super(message);
    this.name = "InvalidKeysetCursorError";
  }
}

const CURSOR_MAX_BYTES = 4096;

/** 把一行的排序键值编成不透明游标。 */
export function encodeKeysetCursor(values: ReadonlyArray<KeysetValue | null>): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/**
 * 解游标；无效（非字符串、超长、非法 base64、非数组、元素非 string/number、
 * 元素为 null）返回 null，不抛错——调用方决定是 400 还是忽略。
 */
export function decodeKeysetCursor(cursor: unknown): KeysetValue[] | null {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > CURSOR_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (parsed.some((v) => typeof v !== "string" && typeof v !== "number")) return null;
  return parsed as KeysetValue[];
}

/**
 * 按游标值生成 keyset 谓词；键数与值数不符返回 null（调用方按无效游标处理）。
 * 返回的 sql 不带前导 AND，调用方拼进 WHERE；params 按出现顺序绑定。
 *
 * 占位符：默认 `?`（走 repo.raw 时由 toPgSql 统一翻成 $n）；直接调
 * `pg.query` 的调用方传 `placeholderStart`（已占用的参数个数），谓词里用
 * `$n` 连续编号，params 顺序与编号一致。
 */
export function buildKeysetPredicate(
  keys: ReadonlyArray<KeysetKey>,
  values: ReadonlyArray<KeysetValue>,
  opts: { placeholderStart?: number } = {},
): { sql: string; params: unknown[] } | null {
  if (keys.length === 0 || keys.length !== values.length) return null;
  let next = opts.placeholderStart ?? 0;
  const ph = (): string => (opts.placeholderStart === undefined ? "?" : `$${++next}`);
  const terms: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < keys.length; i++) {
    const parts: string[] = [];
    for (let j = 0; j < i; j++) {
      parts.push(`${keys[j]!.column} = ${ph()}`);
      params.push(values[j]);
    }
    const op = keys[i]!.direction === "ASC" ? ">" : "<";
    parts.push(`${keys[i]!.column} ${op} ${ph()}`);
    params.push(values[i]);
    terms.push(`(${parts.join(" AND ")})`);
  }
  return { sql: `(${terms.join(" OR ")})`, params };
}

/**
 * 解析调用方传进来的 cursor 参数：缺省返回 undefined（走 OFFSET 老路）；
 * 传了但解不出、或键数不对，抛 InvalidKeysetCursorError。
 */
export function parseKeysetCursor(cursor: unknown, expectedKeys: number): KeysetValue[] | undefined {
  if (cursor === undefined || cursor === null || cursor === "") return undefined;
  const values = decodeKeysetCursor(cursor);
  if (!values || values.length !== expectedKeys) {
    throw new InvalidKeysetCursorError();
  }
  return values;
}
