/**
 * 服务端查询纠正（搜索容错纠错 · 核心算法）。
 *
 * 位置：只跑在 SearchEngine.search() 的零结果 / 纯语义路径上（已有两级放宽
 * 之后、返回之前）。原查询有词法命中时绝不改写；纠正只跑一次，不递归。
 *
 * 两层（见 packages/core/src/site-aliases.ts）：
 *   A. 确定性派生键（每站 title / 拉丁词元 / 域名 host / pinyin_full /
 *      pinyin_initials，写入期已有字段，查询期从 url 派生）；
 *   B. 内置简称表（SITE_ALIASES，小、人工审核、target 必为库内真实标题）。
 * v1 只有这两层：C 层（用户收藏现学纠错）不做（协调人决定 7：
 * v1 不做收藏本地纠错），列为跟进项，不在这里。
 *
 * 阈值与现有分档一致（search-suggestions.ts / findDidYouMeanSuggestion）：
 * 键长 ≤4 → 距离 ≤1；≥5 → ≤2。短词护栏：拉丁 <3、中文 <2 不纠（ai/qt 恒 null）。
 */
import { levenshteinDistance } from "./taxonomy-governance.ts";
import { resolveSiteAlias, resolveSiteAliasesPerToken } from "./site-aliases.ts";

export type CorrectionReason = "alias" | "pinyin-typo" | "spelling" | "chinese-typo";

export interface Correction {
  original: string;
  corrected: string;
  reason: CorrectionReason;
}

/** 一站的纠正候选键：display 用标题原文，比对键全部归一化后进 keys。 */
export interface CorrectionSiteKeys {
  siteId?: string;
  title: string;
  keys: string[];
}

/** 单站原始字段 → 候选键（A 层确定性派生，零维护、无新表）。 */
export function buildCorrectionKeys(site: {
  title: string;
  titleEn?: string | null;
  url?: string | null;
  pinyinFull?: string | null;
  pinyinInitials?: string | null;
}): string[] {
  const keys = new Set<string>();
  const add = (v: string | null | undefined) => {
    const norm = (v ?? "").trim().toLowerCase();
    if (norm) keys.add(norm);
  };
  add(site.title);
  // 标题拉丁词元： "GitHub Copilot" → github / copilot
  for (const token of (site.title ?? "").split(/[^A-Za-z0-9]+/)) {
    if (token.length >= 2) add(token);
  }
  if (site.titleEn) {
    add(site.titleEn);
    for (const token of site.titleEn.split(/[^A-Za-z0-9]+/)) {
      if (token.length >= 2) add(token);
    }
  }
  // 域名 host：github.com → github（无新表，查询期从 url 派生）
  if (site.url) {
    try {
      add(new URL(site.url).hostname.replace(/^www\./, "").split(".")[0]);
    } catch {
      // 非法 url 不参与派生
    }
  }
  // pinyin_full 是标题+描述整串连写（无分隔符）：做键时只能原样用，
  // 描述拼音串可能带来假匹配——长度剪枝 + 唯一最优决胜会挡掉大半，
  // 标题部分的拼音由 pinyin_initials（写入期只取标题）兜底。
  add(site.pinyinFull);
  add(site.pinyinInitials);
  return [...keys];
}

const CJK = /[\u4e00-\u9fa5]/;
/** 算子 token：剥离后不参与纠错、纠正后拼回（与 store 的 stripSearchOperators 同思路）。 */
const OPERATOR_TOKEN =
  /^(?:[#@][A-Za-z0-9_\u4e00-\u9fa5-]+|(?:tag|标签|cat|category|类目|分类|pricing|platform|form|language|lang|计费|平台|形态|语言):[A-Za-z0-9_\u4e00-\u9fa5-]+)$/i;

function splitOperators(raw: string): { operators: string[]; core: string } {
  const operators: string[] = [];
  const rest: string[] = [];
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    if (OPERATOR_TOKEN.test(token)) operators.push(token);
    else rest.push(token);
  }
  return { operators, core: rest.join(" ") };
}

function maxDistanceFor(keyLen: number): number {
  return keyLen <= 4 ? 1 : 2;
}

/**
 * 有界编辑距离（纠正路径专用，替代共享 levenshteinDistance 的逐格
 * toLowerCase() 热循环）。
 *
 * 与共享实现等价：调用方保证输入已小写（查询侧 normCore、键侧建桶时
 * 一次性小写），这里不再每格调 toLowerCase；两行 DP 用调用方传入的
 * scratch 复用（不再每次 new Int32Array——5000 站扫描约 1.5 万次 DP，
 * 逐次分配是冷启动 GC 大头），行最小值早退。dist ≤ max 时返回精确值
 * （决胜排序要真距离），dist > max 时返回 max + 1（调用方只关心
 * 「超阈」，不再展开算）。长度差 > max 时直接返回 max + 1，不跑 DP。
 * prev/curr 长度须 ≥ b.length + 1。
 */
function boundedLevenshtein(
  a: string,
  b: string,
  max: number,
  prev: Int32Array,
  curr: Int32Array,
): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > max) return max + 1;
  if (m === 0) return n;
  if (n === 0) return m;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      const v = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  const dist = prev[n] ?? 0;
  return dist <= max ? dist : max + 1;
}

/**
 * 中文键的「等长子串」比对：查询比标题多一两个字时，整串比对会被长度差剪枝
 * （如「简厉模板」vs「简历」）。取查询中与标题等长的每个子串逐一比对，
 * 命中则把该子串替换成标题、其余词保留，返回纠正后的整串与真实最优距离；
 * 无命中返回 null。距离必须记真实值：≥5 字标题的阈值是 2，硬编码 1 会
 * 错误压过真正距离 1 的候选（见 query-correction.test.ts 的回归用例）。
 */
function correctChineseSubstring(
  query: string,
  title: string,
  dp: (a: string, b: string, max: number) => number,
): { fixed: string; dist: number } | null {
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  if (q.length <= t.length) return null;
  const max = maxDistanceFor(t.length);
  let best: { dist: number; at: number } | null = null;
  for (let i = 0; i + t.length <= q.length; i += 1) {
    const sub = q.slice(i, i + t.length);
    const dist = dp(sub, t, max);
    if (dist <= max && (!best || dist < best.dist)) best = { dist, at: i };
  }
  if (!best) return null;
  return {
    fixed: query.slice(0, best.at) + title + query.slice(best.at + t.length),
    dist: best.dist,
  };
}

/** 测试用确定性计数器：一次扫描进入有界 DP 的键数。 */
export interface CorrectionStats {
  dpCalls: number;
}

export interface ResolveCorrectionOptions {
  maxDistance?: number;
  /**
   * 可选的测试用计数器：传入后在扫描结束时填入本次进入 DP 的键数。
   * 只在走到扫描分支时填写（别名直出、短词护栏等提前返回时不填）。
   * 供性能测试做确定性预算断言：长度分桶剪枝被删时该数膨胀到全量键数，
   * 不依赖墙钟即可被抓到——墙钟阈值在并行负载下会抖，这个数不会。
   */
  stats?: CorrectionStats;
}

/**
 * 对原始查询求一次自动纠正；不可自动纠正时返回 null（调用方退回 didYouMean
 * 建议-only）。决胜：最优距离 ≤阈值 且（唯一最优，或与次优差距 ≥1，
 * 或来自 B 表别名）才自动跑；歧义（两候选同距）一律 null。
 */
export function resolveQueryCorrection(
  rawQuery: string,
  sites: CorrectionSiteKeys[],
  opts: ResolveCorrectionOptions = {},
): Correction | null {
  const raw = (rawQuery ?? "").trim();
  if (!raw) return null;
  const { operators, core } = splitOperators(raw);
  const normCore = core.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normCore) return null;
  // LIKE 通配符按字面量处理：含 % / _ 的查询是字面模式串，不是拼错词——
  // 编辑距离会把 %/_ 当成「多了一个字符」删掉（penpot% → Penpot），让
  // LIKE 转义（sql-like.ts 的 escapeLike）刻意返回的零结果又被纠正复活。
  // 纠正与 LIKE 转义必须口径一致：这类查询不纠正、不改写。
  if (/[%_]/.test(normCore)) return null;
  const reattach = (correctedCore: string): string =>
    [...operators, correctedCore].join(" ").trim();
  // 恒等防护（B4）：纠正后与原查询完全相同不是纠正，返回 null。
  // 比较口径：空白折叠、区分大小写——仅大小写不同（如 chatgpt →
  // ChatGPT）不算恒等，不误杀合法纠正。
  const normalizedRaw = raw.replace(/\s+/g, " ");
  const finish = (correctedCore: string, reason: CorrectionReason): Correction | null => {
    const corrected = reattach(correctedCore);
    if (corrected === normalizedRaw) return null;
    return { original: raw, corrected, reason };
  };

  // B 层：整串别名（精确，不区分大小写）→ 高置信直接纠。
  const aliasWhole = resolveSiteAlias(normCore);
  if (aliasWhole) {
    return finish(aliasWhole, "alias");
  }
  // B 层：多词逐 token 别名（如 "gh copilot" → "GitHub copilot"）。
  const aliasTokens = resolveSiteAliasesPerToken(normCore);
  if (aliasTokens) {
    return finish(aliasTokens, "alias");
  }

  // 短词护栏（与 findDidYouMeanSuggestion 同档）：拉丁 <3、中文 <2 不纠。
  const minLen = CJK.test(normCore) ? 2 : 3;
  if (normCore.length < minLen) return null;

  const cap = opts.maxDistance ?? 2;
  // 候选 → 最优距离（同一纠正串去重：多键指向同一标题只算一次）。
  const bestByCorrected = new Map<string, { dist: number; reason: CorrectionReason; title: string }>();
  const consider = (corrected: string, dist: number, reason: CorrectionReason, title: string) => {
    if (dist > cap) return;
    const prev = bestByCorrected.get(corrected);
    if (!prev || dist < prev.dist) bestByCorrected.set(corrected, { dist, reason, title });
  };

  // 性能（B1）：候选键按长度分桶，整串比对只进长度差在阈值内的桶。
  // 逐键的长度判断与正则（isPinyinKey）只在命中后算，不再对每个键跑一次；
  // 距离用有界 DP（见 boundedLevenshtein），超阈早退。候选集合与原逐键
  // 长度剪枝完全一致，纠正语义（阈值、决胜）不变。
  // 桶是扁平数组 [key, title, key, title, …]：不给每个键建对象，
  // 键在建桶时一次性小写（DP 内不再 toLowerCase）。
  const byLength = new Map<number, string[]>();
  let maxKeyLen = 0;
  for (const site of sites) {
    for (const key of site.keys) {
      if (!key) continue;
      const lower = key.toLowerCase();
      if (lower.length > maxKeyLen) maxKeyLen = lower.length;
      const bucket = byLength.get(lower.length);
      if (bucket) bucket.push(lower, site.title);
      else byLength.set(lower.length, [lower, site.title]);
    }
  }
  // 两行 DP 的 scratch：整轮复用，不再每次 DP 都分配。
  const scratchSize = Math.max(normCore.length, maxKeyLen) + 1;
  const scratchPrev = new Int32Array(scratchSize);
  const scratchCurr = new Int32Array(scratchSize);
  // DP 调用计数（确定性预算）：全部 boundedLevenshtein 调用都走这里。
  // 长度分桶剪枝决定了哪些键能进 DP；剪枝被删时调用数膨胀到全量键数，
  // 即使有界 DP 靠内部长度检查把墙钟压住，计数也不会说谎。
  let dpCalls = 0;
  const dp = (a: string, b: string, max: number): number => {
    dpCalls += 1;
    return boundedLevenshtein(a, b, max, scratchPrev, scratchCurr);
  };

  const tokens = normCore.split(/\s+/).filter(Boolean);
  // 整串比对（只跑长度接近的桶）。
  for (let keyLen = Math.max(0, normCore.length - cap); keyLen <= normCore.length + cap; keyLen++) {
    const bucket = byLength.get(keyLen);
    if (!bucket) continue;
    const max = Math.min(maxDistanceFor(keyLen), cap);
    if (Math.abs(keyLen - normCore.length) > max) continue;
    for (let bi = 0; bi < bucket.length; bi += 2) {
      const key = bucket[bi]!;
      const title = bucket[bi + 1]!;
      const dist = dp(normCore, key, max);
      if (dist <= max) {
        const reason: CorrectionReason = CJK.test(normCore)
          ? "chinese-typo"
          : /^[a-z0-9]+$/.test(key) && CJK.test(title)
            ? "pinyin-typo"
            : "spelling";
        consider(title, dist, reason, title);
      }
    }
  }
  // 中文等长子串比对：查询比标题长时不被长度差剪掉（只跑 CJK 键）。
  if (CJK.test(normCore)) {
    for (const [keyLen, bucket] of byLength) {
      if (keyLen >= normCore.length) continue;
      for (let bi = 0; bi < bucket.length; bi += 2) {
        const key = bucket[bi]!;
        const title = bucket[bi + 1]!;
        if (!CJK.test(key)) continue;
        const sub = correctChineseSubstring(core, key, dp);
        if (sub && sub.fixed !== core) {
          consider(sub.fixed, sub.dist, "chinese-typo", title);
        }
      }
    }
  }

  // 多词查询逐 token 纠： "githb copilot" 只纠错 token，不动对的词。
  if (tokens.length > 1) {
    for (const site of sites) {
      const fixedTokens: string[] = [];
      let changed = false;
      let worst = 0;
      for (const token of tokens) {
        if (token.length < minLen) {
          fixedTokens.push(token);
          continue;
        }
        let tokenBest: { dist: number; corrected: string } | null = null;
        for (const key of site.keys) {
          if (Math.abs(key.length - token.length) > maxDistanceFor(key.length)) continue;
          const dist = dp(token, key.toLowerCase(), maxDistanceFor(key.length));
          if (dist <= maxDistanceFor(key.length) && (!tokenBest || dist < tokenBest.dist)) {
            tokenBest = { dist, corrected: site.title };
          }
        }
        if (tokenBest) {
          // token 纠成整标题只在 token 与标题拉丁词元/拼音相近时合理；
          // 标题本身含中文时 token 纠中文标题是错的（如 "githb" → "知乎"），
          // 所以 token 级只接受拉丁键的纠正，且纠正串取键本身（不取标题）。
          const latinKey = site.keys.find(
            (k) =>
              /^[a-z0-9]+$/.test(k) &&
              Math.abs(k.length - token.length) <= maxDistanceFor(k.length) &&
              dp(token, k.toLowerCase(), tokenBest.dist) === tokenBest.dist,
          );
          if (latinKey) {
            fixedTokens.push(latinKey);
            changed = true;
            worst = Math.max(worst, tokenBest.dist);
          } else {
            fixedTokens.push(token);
          }
        } else {
          fixedTokens.push(token);
        }
      }
      if (changed) {
        const joined = fixedTokens.join(" ");
        if (joined !== normCore) {
          // token 级纠正的显示串：把拉丁键还原成该站标题只在单 token 情形有意义；
          // 多词时保留纠正后的查询串本身（如 "github copilot"）。
          consider(joined, worst, "spelling", site.title);
        }
      }
    }
  }

  if (opts.stats) opts.stats.dpCalls = dpCalls;

  if (bestByCorrected.size === 0) return null;
  const ranked = [...bestByCorrected.entries()]
    .map(([corrected, v]) => ({ corrected, ...v }))
    .sort((a, b) => a.dist - b.dist);
  const best = ranked[0];
  const second = ranked[1];
  if (!best) return null;
  // 决胜：唯一最优，或与次优差距 ≥1；否则歧义 → null（只建议，不自动跑）。
  if (second && second.dist - best.dist < 1 && second.corrected !== best.corrected) return null;
  // 多词 token 级纠正的 corrected 是查询串本身（如 "github copilot"）；
  // 整串纠正的 corrected 是标题。两者都直接可用。
  return finish(best.corrected, best.reason);
}

/**
 * 待找匹配复用：wanted query 的每个 token 都要在新站的键上命中
 * （子串或编辑距离 ≤阈值），全命中才算匹配。AND 而非 OR：通知是强打扰，
 * 宁可漏报一次，不可错报一堆。
 */
export function matchSiteKeys(tokens: string[], siteKeys: string[]): boolean {
  const normTokens = tokens.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (normTokens.length === 0) return false;
  const normKeys = siteKeys.map((k) => k.trim().toLowerCase()).filter(Boolean);
  return normTokens.every((token) => {
    const max = maxDistanceFor(token.length);
    return normKeys.some((key) => {
      if (key.includes(token) || token.includes(key)) return true;
      if (Math.abs(key.length - token.length) > max) return false;
      return levenshteinDistance(token, key) <= max;
    });
  });
}
