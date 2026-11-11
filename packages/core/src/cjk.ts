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
 * A4「AI 泛词」假朋友治理：词元覆盖原语。
 *
 * 背景：`buildFtsQuery` 的二元组 OR 召回 + RRF 只看排名，只命中泛词
 * （如「ai」）的站点能靠字段权重挤进创作类查询的尾部（实测「AI 音乐」
 * 第 3–6 位全是生图/生视频工具）。引擎的召回契约不动（弱语义低权重
 * 补充是刻意设计），治理放在候选呈现层：调用方用这里的覆盖判定把
 * 「覆盖了判别词」的候选排前、只覆盖泛词的沉底。
 *
 * 拆词口径必须与 `buildFtsQuery`/`buildFtsTokens` 严格一致，否则
 * 覆盖判定与实际召回对不上：汉字二元组（单字串保留单字）、拉丁词
 * 小写、去重保序（汉字词元在前、拉丁词元在后）。
 */
export function extractQueryTerms(q: string): string[] {
  const terms: string[] = [];
  for (const run of hanRuns(q)) {
    const chars = [...run];
    if (chars.length === 1) {
      terms.push(chars[0]!);
      continue;
    }
    for (let i = 0; i < chars.length - 1; i++) terms.push(chars[i]! + chars[i + 1]!);
  }
  const latin = q.match(/[A-Za-z0-9_+#.-]{2,}/g) ?? [];
  for (const w of latin) terms.push(w.toLowerCase());
  return [...new Set(terms)];
}

/**
 * 站点的词元集合，与写入期 `buildFtsTokens` 同口径（`hanToTokens`
 * 展开后切分、拉丁词小写）。调用方应按写入期相同的字段传入
 * （title / description / url / tags），覆盖判定才与 fts 召回对齐。
 */
export function siteTokenSet(parts: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    const t = p.trim();
    if (!t) continue;
    for (const tok of hanToTokens(t).split(/\s+/)) {
      if (tok) tokens.add(tok.toLowerCase());
    }
  }
  return tokens;
}

/**
 * 查询词元是否被站点「覆盖」：
 *  - 站点文案词元集直接命中 → 覆盖；
 *  - 汉字词元额外允许分类回退：文案没写这个词、但分类标题链里能
 *    凑齐它的每个字（如 Leonardo 文案只有英文、分类是「AI 图像
 *    生成」，之于「生图」是真对口）→ 覆盖。回退只认「字都在」，
 *    分类八竿子打不着的假朋友凑不齐（Cursor 之于「生图」）；
 *  - 拉丁词元不吃回退：分类叫「PPT 模板」不等于站点文案与 PPT 有关。
 */
export function termCoveredBySite(
  term: string,
  tokens: ReadonlySet<string>,
  categoryText?: string | null,
): boolean {
  if (tokens.has(term)) return true;
  if (!categoryText) return false;
  const chars = [...term];
  if (chars.length === 0 || !chars.every((c) => isHan(c))) return false;
  return chars.every((c) => categoryText.includes(c));
}

/** 一组查询词元里被站点覆盖到的个数（供调用方做亲和判定/诊断）。 */
export function countCoveredTerms(
  terms: readonly string[],
  tokens: ReadonlySet<string>,
  categoryText?: string | null,
): number {
  let n = 0;
  for (const t of terms) if (termCoveredBySite(t, tokens, categoryText)) n++;
  return n;
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
