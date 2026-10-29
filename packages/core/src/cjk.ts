/**
 * CJK 检索分词。
 *
 * 背景（已实测）：SQLite 的 FTS5 `unicode61` 分词器把连续汉字当作**一个** token，
 * 因此 `match '启动'` 无法命中「启动脚本」；而 `LIKE '%启动%'` 能命中但无法走索引、
 * 也不支持相关性排序。
 *
 * 解法：写入期把中文转成「单字 + 相邻二元组」序列再喂给 unicode61。
 * 这样任意长度 ≥2 的中文子串都能被命中，且保留 BM25 排序能力。
 * 实测：'启动'、'启动脚本'、'天气'、'天气网'、'包管理' 全部命中。
 */

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const HAN_GLOBAL = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

export function isHan(ch: string): boolean {
  return HAN.test(ch);
}

/** 提取字符串中所有连续中文片段 */
export function hanRuns(input: string): string[] {
  return input.match(HAN_GLOBAL) ?? [];
}

const LATIN = /[A-Za-z0-9][A-Za-z0-9_+#.-]*/g;

/**
 * 把一个字符串展开为可被 unicode61 正确切分的 token 序列：
 *   - 中文：单字 + 相邻二元组（支持任意 ≥2 子串命中）
 *   - 拉丁/数字：原词保留（否则 "GitHub" 会被整段丢弃）
 * 以空格连接。
 */
export function hanToTokens(input: string): string {
  const out: string[] = [];
  for (const run of hanRuns(input)) {
    const chars = [...run];
    for (let i = 0; i < chars.length - 1; i++) out.push(chars[i]! + chars[i + 1]!);
    for (const c of chars) out.push(c);
  }
  for (const w of input.match(LATIN) ?? []) out.push(w);
  return out.join(" ");
}

/**
 * 构造 FTS 索引文本（写入期调用）。
 * 同时保留原文（供 LIKE / 展示）与分词后的检索线索。
 */
export function buildFtsTokens(parts: Array<string | null | undefined>): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const t = p.trim();
    if (!t) continue;
    chunks.push(hanToTokens(t));
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 把用户查询转成 FTS5 MATCH 表达式（查询期调用）。
 *
 * 策略：
 *  - 中文：每个二元组/单字精确 OR（配合 rank 排序，命中越多分越高）
 *  - 拉丁词：前缀匹配 `term*`，让 "curs" 命中 "cursor"
 *
 * 注意：FTS5 的 MATCH 表达式必须对每个 token 加引号，否则会被当成语法。
 */
export function buildFtsQuery(q: string): string | null {
  const terms: string[] = [];
  for (const run of hanRuns(q)) {
    const chars = [...run];
    if (chars.length === 1) {
      terms.push(quote(chars[0]!));
      continue;
    }
    const grams: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) grams.push(chars[i]! + chars[i + 1]!);
    for (const g of grams) terms.push(quote(g));
  }
  const latin = q.match(/[A-Za-z0-9_+#.-]{2,}/g) ?? [];
  for (const w of latin) terms.push(quote(w) + "*");

  const unique = [...new Set(terms)];
  if (unique.length === 0) return null;
  return unique.join(" OR ");
}

function quote(term: string): string {
  return '"' + term.replace(/"/g, '""') + '"';
}

/**
 * 把用户查询转成 PostgreSQL `to_tsquery` 表达式（查询期调用，standard 模式）。
 *
 * 为什么不能复用 `buildFtsQuery`：FTS5 与前缀语法不同——
 *   - FTS5：`"term"*`（双引号短语 + 尾星号）
 *   - tsquery：`'term':*`（单引号词元 + `:*`），连接符是 `|` 而不是 `OR`
 * 直接把 FTS5 串喂给 `to_tsquery` 会抛 `syntax error in tsquery`，
 * 而调用方（fts-pg）为了不让标点查询拖垮整次搜索，会把异常吞成「零命中」——
 * 结果就是 standard 模式的全文通道静默失效。
 *
 * 词元规则与 SQLite 侧保持一致（同一套 CJK 二元分词 + 拉丁词），只换组装语法：
 *   - 中文：`'启动'`（simple 配置不做词干化，二元组原样命中）
 *   - 拉丁：`'copilot':*`（前缀匹配）
 *   - 连接：`|`（任一命中即可，rank 由 ts_rank 负责）
 */
export function buildPgTsQuery(q: string): string | null {
  const terms: string[] = [];
  for (const run of hanRuns(q)) {
    const chars = [...run];
    if (chars.length === 1) {
      terms.push(quotePg(chars[0]!));
      continue;
    }
    for (let i = 0; i < chars.length - 1; i++) terms.push(quotePg(chars[i]! + chars[i + 1]!));
  }
  const latin = q.match(/[A-Za-z0-9_+#.-]{2,}/g) ?? [];
  for (const w of latin) terms.push(quotePg(w) + ":*");

  const unique = [...new Set(terms)];
  if (unique.length === 0) return null;
  return unique.join(" | ");
}

/**
 * tsquery 词元引号：单引号包裹，内部单引号按 PostgreSQL 规则双写。
 * 不用双引号——那不是 tsquery 的合法词元分隔符。
 */
function quotePg(term: string): string {
  return "'" + term.replace(/'/g, "''") + "'";
}
