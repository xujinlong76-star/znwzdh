/**
 * 内置站点简称表（搜索容错纠错 · B 层）。
 *
 * 收录规则（协调人决定 2，2026-11-13）：
 * - 只收无歧义的简称；一两字母高碰撞的（x / gg / jd / tb / db …）一律不收，
 *   它们走拼音首字母通道（jd → 京东的 pinyin_initials 本来就能命中）。
 * - 每条 target 必须是库内真实收录站的标题，实施时对种子标题逐条核对过
 *   （apps/api/src/seed-data.json，84 站）：
 *   GitHub / 哔哩哔哩 / 知乎 / MDN Web Docs / 小红书 / Stack Overflow 均在列；
 *   tg → Telegram、yt → YouTube、wx → 微信、dy → 抖音、ks → 快手因种子库
 *   无此站而**不收**——不编造不存在的站。
 * - 新增走代码评审，不做管理后台（v1）。
 */

/** 简称（小写归一后的键）→ 库内真实标题 */
export const SITE_ALIASES: Readonly<Record<string, string>> = {
  gh: "GitHub",
  bili: "哔哩哔哩",
  bilibili: "哔哩哔哩",
  "b站": "哔哩哔哩",
  zhihu: "知乎",
  mdn: "MDN Web Docs",
  xhs: "小红书",
  stackoverflow: "Stack Overflow",
};

/**
 * 整串查简称表（大小写不敏感；别名 token 须 ≥2 字符，防 "a" 这类单字误触）。
 * 返回库内真实标题，未命中返回 null。
 */
export function resolveSiteAlias(query: string): string | null {
  const norm = (query ?? "").trim().toLowerCase();
  if (norm.length < 2) return null;
  return SITE_ALIASES[norm] ?? null;
}

/**
 * 多词查询逐 token 查表替换（如 "gh copilot" → "GitHub copilot"）。
 * 只替换命中的 token，其余原样保留；无任何命中返回 null（调用方据此判定
 * 是否走了别名路径）。
 */
export function resolveSiteAliasesPerToken(query: string): string | null {
  const tokens = (query ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  let replaced = false;
  const out = tokens.map((token) => {
    const target = token.length >= 2 ? SITE_ALIASES[token.toLowerCase()] : undefined;
    if (target) {
      replaced = true;
      return target;
    }
    return token;
  });
  return replaced ? out.join(" ") : null;
}
