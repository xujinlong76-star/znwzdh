/**
 * 对照价格数值（Batch 4 Phase 2 P2-2）：手工填写 + 官方定价页抓取确认。
 *
 * 只对调用者本人收藏里的站点生效：身份口径抄 /api/compare（requireAskIdentity +
 * askIdentityOf，匿名 401）；非本人收藏（不存在、他人收藏、pending/archived 指向）
 * → 通用 404，同码同 body，不点名 id。
 *
 * 写库口径：
 *   - POST /api/sites/:id/price：zod 校验金额/货币/周期/免费档上限/source_url；
 *     source_url 若传，必须是合法 http(s) URL 且与该站 site.url 同源（只许
 *     官方定价页，不许任意 URL；SSRF 口子不开）；verified_at 一律服务端
 *     Date.now()，客户端传来的直接忽略；upsert 覆盖写（每用户每站只留最新一条）。
 *   - sourceType 防伪造（NIT 2）：客户端传的 sourceType 只做形状校验，
 *     值永不被信任——无确认凭证的 POST 一律写 manual；只有凭抓取接口当场
 *     签发的一次性确认凭证（confirmToken，绑定本人 + 本站 + source_url +
 *     候选原文金额/货币/周期，15 分钟有效，用一次即焚）才能写
 *     official_scrape。直接 POST 标 official_scrape 会被强制改写为 manual。
 *   - 裸 ¥ 不推断货币（NIT 3）：抓取候选里裸 ¥（¥500）的 currency 留空
 *     （null），amountMinor 也留空（CNY 按 ×100、JPY 按 ×1，最小单位取决
 *     于货币）；候选另给原文金额 amount（本位，如 19.9），由用户选定货币
 *     后再算 minor。POST 本身要求 currency 必填（缺失 400），后端绝不猜。
 *   - DELETE /api/sites/:id/price：幂等，无记录也回 { ok: true, deleted: false }。
 *   - 无独立 GET：价格只随对照表出（GET /api/compare 与 compare_sites）。
 *
 * 官方页抓取（后行，手工填写先行）：
 *   - 抓取目标 = 该站已存 source_url，绝不猜路径（不拼 /pricing、/price、/plans）；
 *     无 source_url 的记录不可抓取（400）。
 *   - 复用共享探活模块（site-probe.ts）：checkRobotsAllowed + fetchCandidatePage
 *     （guardedFetch + candidate profile：2.5s、8KB、3 跳、不伪装 UA）
 *     + 自持 OutboundBudget 实例（与 verifyOutboundBudget 相同参数）
 *     + probe-cache（fetchCandidatePage 内按 P2-1 口径记结论）。
 *   - 只做保守正则候选抽取，候选列给用户确认后才写库；无候选 → “未验证”，
 *     不写任何值；POST /price/scrape 本身绝不自动写库一个数字。
 *   - 可确认的候选随附一次性确认凭证 confirmToken（见上）；确认时调
 *     POST /api/sites/:id/price 并带上该凭证 + 候选字段，服务端核对绑定
 *     无误才写 official_scrape。凭证只存本进程内存（单实例假设；若以后
 *     多实例部署，须改成共享存储或 HMAC 无状态凭证）。
 *   - 砍线：抓取连续失败（反爬/结构多变/候选命中率低）→ 砍掉抓取档，只保留
 *     手工填写 + 过期标记；砍抓取不影响已存手工记录。
 */
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SitePriceRecord } from "@navhub/store";
import type { AppContext } from "../context.ts";
import { sendError } from "../error-envelope.ts";
import { OutboundBudget } from "../outbound-budget.ts";
import { requireAskIdentity } from "./ask.ts";
import {
  checkRobotsAllowed,
  fetchCandidatePage,
  type SiteProbeOutcomeKind,
} from "../site-probe.ts";

/** 货币枚举（ISO 4217 三字母大写）：其它 400。 */
export const PRICE_CURRENCIES = [
  "CNY", "USD", "EUR", "GBP", "JPY", "HKD", "AUD", "CAD", "SGD", "KRW",
] as const;

/** 计费周期枚举：其它 400。 */
export const PRICE_PERIODS = ["month", "year", "once", "usage"] as const;

export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];
export type PricePeriod = (typeof PRICE_PERIODS)[number];

const PriceBodySchema = z.object({
  amountMinor: z.number().int().min(1).max(999_999_999),
  currency: z.enum(PRICE_CURRENCIES),
  period: z.enum(PRICE_PERIODS),
  freeTierLimit: z.string().max(120).nullable().optional(),
  // sourceType 只做形状校验（非法值仍 400），值永不被信任：写库来源只由
  // 服务端签发的确认凭证决定（见下），无凭证一律 manual。
  sourceType: z.enum(["manual", "official_scrape"]).optional(),
  sourceUrl: z.string().max(2048).nullable().optional(),
  // 抓取确认凭证：抓取接口当场签发的一次性 token（见 issueScrapeConfirmToken）。
  // 不带 → 本次写库按手工填写；带了但无效 → 直接 400，不写库（见 handler）。
  confirmToken: z.string().min(1).max(128).optional(),
  // verified_at 故意不在 schema 里：客户端传来的值直接忽略（zod 默认剥离未知键），
  // 写库时间一律服务端 Date.now()。
});

/** 出站预算：与 verifyOutboundBudget 相同参数（并发 2、每分钟 600 次）。 */
export const priceScrapeOutboundBudget = new OutboundBudget({
  maxConcurrent: 2,
  maxPerWindow: 600,
  windowMs: 60_000,
});

const NOT_FOUND_MESSAGE = "该站点不在你的收藏里，或已不在可验证状态。";

/** 对外回显的价格记录（不含 owner_identity；stale 是组装时现算的，不在这里给）。 */
function priceView(price: SitePriceRecord) {
  return {
    id: price.id,
    siteId: price.siteId,
    amountMinor: price.amountMinor,
    currency: price.currency,
    period: price.period,
    freeTierLimit: price.freeTierLimit,
    sourceType: price.sourceType,
    sourceUrl: price.sourceUrl,
    verifiedAt: price.verifiedAt,
    createdAt: price.createdAt,
    updatedAt: price.updatedAt,
  };
}

/* ------------------------------ 抓取候选抽取 ------------------------------ */

/** 抓取返回的一条价格候选：原文串 + 能解析出的结构化字段（解析不出为 null）。
 * amount 是原文金额（本位，如 19.9）：裸 ¥ 候选 currency 为空时 amountMinor
 * 算不出来（CNY ×100、JPY ×1），前端凭 amount + 用户选定的货币再算 minor；
 * confirmToken 是服务端签发的一次性确认凭证（抽取层本身不签发，恒为 null，
 * 由抓取 handler 填上；不可确认的候选为 null）。 */
export interface PriceScrapeCandidate {
  text: string;
  amount: number | null;
  amountMinor: number | null;
  currency: PriceCurrency | null;
  period: PricePeriod | null;
  confirmToken: string | null;
}

const CANDIDATE_CURRENCY_BY_SYMBOL: Record<string, PriceCurrency> = {
  // 注意：裸 ¥ 故意不进表——¥ 既是人民币符号也是日元符号，推断成 CNY 会把
  // 日元价写成 CNY（金额差 100 倍）。只有写明货币代码（JPY）或“元”才认。
  "HK$": "HKD",
  "A$": "AUD",
  "C$": "CAD",
  "S$": "SGD",
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "₩": "KRW",
  "元": "CNY",
};

const CANDIDATE_PERIOD_BY_SUFFIX: Record<string, PricePeriod> = {
  "月": "month",
  "mo": "month",
  "month": "month",
  "per month": "month",
  "年": "year",
  "yr": "year",
  "year": "year",
  "per year": "year",
  "次": "once",
};

/** 无小数位货币（最小单位即本位）：金额不除以 100。 */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW"]);

const MAX_CANDIDATES = 10;

// 保守正则：货币符号/代码 + 数字 + 可选周期后缀。只认这一种形状，
// 结构多变 / 反爬页面抽不出候选时如实回空，不猜、不编。
const PRICE_CANDIDATE_RE =
  /(HK\$|A\$|C\$|S\$|¥|\$|€|£|₩|CNY|USD|EUR|GBP|JPY|HKD|AUD|CAD|SGD|KRW)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*(月|年|次|mo|month|yr|year|per\s*month|per\s*year))?|([\d,]+(?:\.\d{1,2})?)\s*元\s*(?:\/\s*(月|年|次))?/gi;

/**
 * 从官方定价页正文里抽价格候选（纯函数，不碰网络与写库，也不签发确认凭证）。
 * 先去 HTML 标签再匹配；去重（同一串只留一条）；最多 10 条。
 * 金额解析不出或超出 1..999_999_999 的候选只保留原文串（amountMinor 为 null），
 * 由用户确认后在表单里改——抽取层绝不为了凑数而编数字。
 * 裸 ¥ 的候选 currency 为 null、amountMinor 为 null（货币未定，最小单位算不出），
 * 只给原文金额 amount 供用户选定货币后换算；写明货币代码的候选照旧解析。
 */
export function extractPriceCandidates(html: string): PriceScrapeCandidate[] {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
  const seen = new Set<string>();
  const out: PriceScrapeCandidate[] = [];
  for (const match of text.matchAll(PRICE_CANDIDATE_RE)) {
    const raw = match[0].trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    // 捕获组：第 1 分支——1=货币符号/代码、2=金额、3=周期后缀；
    // 第 2 分支（“19.9元/月”）——4=金额、5=周期后缀，货币恒为 CNY。
    const isYuanForm = match[4] !== undefined;
    const symbol = isYuanForm ? "元" : (match[1] ?? null);
    const amountText = (match[2] ?? match[4] ?? "").replace(/,/g, "");
    const periodText = (match[3] ?? match[5] ?? "").trim().toLowerCase();
    const currency =
      symbol && symbol in CANDIDATE_CURRENCY_BY_SYMBOL
        ? CANDIDATE_CURRENCY_BY_SYMBOL[symbol]!
        : symbol && (PRICE_CURRENCIES as readonly string[]).includes(symbol)
          ? (symbol as PriceCurrency)
          : null;
    let amountMinor: number | null = null;
    const amount = Number(amountText);
    // 原文金额（本位）：只要解析得出就带上，供用户选定货币后换算 minor；
    // amountMinor 只有货币已知时才算得出（零小数位货币不 ×100）。
    const amountValue = Number.isFinite(amount) && amount > 0 ? amount : null;
    if (amountValue !== null && currency) {
      const minor = ZERO_DECIMAL_CURRENCIES.has(currency)
        ? Math.round(amountValue)
        : Math.round(amountValue * 100);
      if (minor >= 1 && minor <= 999_999_999) amountMinor = minor;
    }
    const period = periodText ? (CANDIDATE_PERIOD_BY_SUFFIX[periodText] ?? null) : null;
    out.push({ text: raw, amount: amountValue, amountMinor, currency, period, confirmToken: null });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/* ------------------------------ 抓取注入点 ------------------------------ */

interface ScrapePage {
  kind: SiteProbeOutcomeKind;
  status: number | null;
  body: string;
  reason: string;
}

type ScrapePageFn = (url: string) => Promise<ScrapePage>;

let scrapePageOverride: ScrapePageFn | null = null;

/** 仅测试用：注入假定价页取回（绕过真实出站），传 null 恢复默认实现。 */
export function setPriceScrapePageForTests(fn: ScrapePageFn | null): void {
  scrapePageOverride = fn;
}

async function defaultScrapePage(url: string): Promise<ScrapePage> {
  const page = await fetchCandidatePage(url);
  return { kind: page.kind, status: page.status, body: page.body, reason: page.reason };
}

/* ------------------------------ 抓取确认凭证 ------------------------------ */

/**
 * 一次性抓取确认凭证（NIT 2 的服务端内部标志）。
 * 凭证 = 128 位随机串，只存本进程内存，绑定本人 + 本站 + source_url +
 * 候选原文金额/货币/周期；15 分钟有效，核对成功即焚（单次使用）。
 * 客户端传来的 sourceType 永远不参与来源判定——来源只由凭证决定。
 */
export const SCRAPE_CONFIRM_TOKEN_TTL_MS = 15 * 60 * 1000;

interface ScrapeConfirmToken {
  identity: string;
  siteId: string;
  sourceUrl: string;
  text: string;
  amount: number | null;
  currency: PriceCurrency | null;
  period: PricePeriod | null;
  expiresAt: number;
}

const scrapeConfirmTokens = new Map<string, ScrapeConfirmToken>();

function minorForAmount(amount: number, currency: PriceCurrency): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency)
    ? Math.round(amount)
    : Math.round(amount * 100);
}

function pruneExpiredScrapeConfirmTokens(now: number): void {
  for (const [token, rec] of scrapeConfirmTokens) {
    if (now > rec.expiresAt) scrapeConfirmTokens.delete(token);
  }
}

/**
 * 为一条抓取候选签发确认凭证；不可确认的候选返回 null（只留手工填写）。
 * 可确认条件：原文金额解析得出；货币已知时 minor 须在合法区间内；
 * 裸 ¥（货币未定）时原文金额本身须 ≤ 999_999_999——至少零小数位货币能确认，
 * 两位小数货币的越界由 POST 的 zod 上限再拦，凭证本身不猜货币。
 */
export function issueScrapeConfirmToken(input: {
  identity: string;
  siteId: string;
  sourceUrl: string;
  text: string;
  amount: number | null;
  currency: PriceCurrency | null;
  period: PricePeriod | null;
}): string | null {
  const { amount, currency } = input;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  if (currency) {
    const minor = minorForAmount(amount, currency);
    if (minor < 1 || minor > 999_999_999) return null;
  } else if (amount > 999_999_999) {
    return null;
  }
  const now = Date.now();
  pruneExpiredScrapeConfirmTokens(now);
  const token = randomUUID();
  scrapeConfirmTokens.set(token, { ...input, expiresAt: now + SCRAPE_CONFIRM_TOKEN_TTL_MS });
  return token;
}

/**
 * 核对并核销确认凭证：任一绑定不符、过期、不存在 → "invalid"，不写库。
 * 绑定：本人 + 本站 + source_url 须一致；候选货币已知时提交货币须一致
 * （裸 ¥ 候选货币未定，任何合法货币都可，但金额须按该货币换算一致）；
 * 提交金额须等于原文金额按提交货币换算的 minor；候选周期已知时须一致
 * （周期未定则确认时由用户选）。核对失败不焚凭证（用户改对了可重试）；
 * 核对成功当场删除，凭证只能用一次。
 */
function consumeScrapeConfirmToken(
  token: string,
  check: {
    identity: string;
    siteId: string;
    sourceUrl: string | null;
    amountMinor: number;
    currency: PriceCurrency;
    period: PricePeriod;
  },
): boolean {
  const rec = scrapeConfirmTokens.get(token);
  if (!rec) return false;
  if (Date.now() > rec.expiresAt) {
    scrapeConfirmTokens.delete(token);
    return false;
  }
  if (rec.identity !== check.identity || rec.siteId !== check.siteId) return false;
  if (rec.sourceUrl !== check.sourceUrl) return false;
  if (rec.currency && rec.currency !== check.currency) return false;
  if (rec.amount !== null && minorForAmount(rec.amount, check.currency) !== check.amountMinor) {
    return false;
  }
  if (rec.period && rec.period !== check.period) return false;
  scrapeConfirmTokens.delete(token);
  return true;
}

/** 仅测试用：把确认凭证强制置过期（锁 TTL 语义）；不存在的 token 直接忽略。 */
export function expireScrapeConfirmTokenForTests(token: string): void {
  const rec = scrapeConfirmTokens.get(token);
  if (rec) rec.expiresAt = 0;
}

/* ------------------------------ 路由 ------------------------------ */

export const sitePriceRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 本人收藏判定（抄 verify.ts 的 loadOwnSite）。
   * 只返回判定结果，不直接发响应——错误包络必须由 handler `return sendError(...)`
   * 发出；helper 里先 send 再让 handler 返回 undefined 会被 Fastify 以空体覆盖。
   */
  async function loadOwnSite(
    req: FastifyRequest,
    reply: FastifyReply,
    siteId: string,
  ): Promise<
    | {
        ok: true;
        identity: string;
        site: { id: string; url: string; status: string };
      }
    | { ok: false; status: number; code: string; message: string }
  > {
    const identity = await requireAskIdentity(ctx, req, reply);
    if (!identity) {
      return { ok: false, status: 401, code: "UNAUTHORIZED", message: "价格填写只对登录用户开放，请先登录后再试。" };
    }
    const favorites = await ctx.repo.listFavorites(identity);
    const favBySite = new Map(favorites.map((f) => [f.siteId, f]));
    const sites = await ctx.repo.getSitesByIds([siteId]);
    const site = sites.get(siteId);
    if (!favBySite.get(siteId) || !site || site.status === "pending" || site.status === "archived") {
      return { ok: false, status: 404, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }
    return { ok: true, identity, site };
  }

  app.post(
    "/api/sites/:id/price",
    {
      config: {
        scope: "public",
        rateLimit: { max: 60, timeWindow: "1 minute" },
        cache: { maxAge: 0 },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const siteId = typeof id === "string" ? id.trim() : "";
      if (!siteId) {
        return sendError(reply, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      const loaded = await loadOwnSite(req, reply, siteId);
      if (!loaded.ok) {
        return sendError(reply, loaded.status, loaded.code, loaded.message);
      }
      const { identity, site } = loaded;

      const raw = (req.body ?? {}) as Record<string, unknown>;
      // 空串当未填：freeTierLimit / sourceUrl 的 "" 一律归一为 null 再校验。
      const normalized = {
        ...raw,
        freeTierLimit:
          typeof raw.freeTierLimit === "string" && !raw.freeTierLimit.trim()
            ? null
            : raw.freeTierLimit,
        sourceUrl:
          typeof raw.sourceUrl === "string" && !raw.sourceUrl.trim() ? null : raw.sourceUrl,
      };
      const parsed = PriceBodySchema.safeParse(normalized);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = String((issue?.path ?? [])[0] ?? "");
        const message =
          field === "amountMinor"
            ? "金额须为 1..999999999 之间的整数（最小货币单位，如 1990 表示 ¥19.9）。"
            : field === "currency"
              ? "货币须为 CNY / USD / EUR / GBP / JPY / HKD / AUD / CAD / SGD / KRW 之一。"
              : field === "period"
                ? "计费周期须为 month / year / once / usage 之一。"
                : field === "freeTierLimit"
                  ? "免费档上限最多 120 个字符。"
                  : "价格数据不合法，请检查后重试。";
        return sendError(reply, 400, "BAD_REQUEST", message);
      }
      const body = parsed.data;

      // source_url 若传，必须是合法 http(s) URL 且与该站 site.url 同源。
      let sourceUrl: string | null = null;
      if (typeof body.sourceUrl === "string") {
        const trimmed = body.sourceUrl.trim();
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(trimmed);
        } catch {
          return sendError(reply, 400, "BAD_REQUEST", "官方定价页 URL 须为合法的 http(s) 地址。");
        }
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          return sendError(reply, 400, "BAD_REQUEST", "官方定价页 URL 须为合法的 http(s) 地址。");
        }
        let siteUrl: URL;
        try {
          siteUrl = new URL(site.url);
        } catch {
          return sendError(reply, 400, "BAD_REQUEST", "官方定价页 URL 须与该站同源，只许官方定价页。");
        }
        if (parsedUrl.origin !== siteUrl.origin) {
          return sendError(reply, 400, "BAD_REQUEST", "官方定价页 URL 须与该站同源，只许官方定价页。");
        }
        sourceUrl = trimmed;
      }

      // 来源判定（NIT 2）：客户端传的 sourceType 直接丢弃，永不信任。
      // 无凭证 → 一律 manual；带凭证 → 逐项核对绑定，通过才 official_scrape，
      // 凭证无效/过期/被改过 → 400，不写库（伪造来源连手工记录都写不进去）。
      let sourceType: "manual" | "official_scrape" = "manual";
      if (typeof body.confirmToken === "string") {
        const confirmed = consumeScrapeConfirmToken(body.confirmToken, {
          identity,
          siteId,
          sourceUrl,
          amountMinor: body.amountMinor,
          currency: body.currency,
          period: body.period,
        });
        if (!confirmed) {
          return sendError(
            reply,
            400,
            "BAD_REQUEST",
            "抓取确认凭证无效或已过期，请重新从官方定价页抓取后再确认。",
          );
        }
        sourceType = "official_scrape";
      }

      // verified_at 一律服务端 Date.now()：客户端传来的值上面已被 zod 剥离，
      // 这里不读 req.body.verified_at、不写库、不回显。
      const price = await ctx.repo.upsertSitePrice({
        ownerIdentity: identity,
        siteId,
        amountMinor: body.amountMinor,
        currency: body.currency,
        period: body.period,
        freeTierLimit:
          typeof body.freeTierLimit === "string" ? body.freeTierLimit.trim() : null,
        sourceType,
        sourceUrl,
        verifiedAt: Date.now(),
      });
      return { ok: true, price: priceView(price) };
    },
  );

  app.delete(
    "/api/sites/:id/price",
    {
      config: {
        scope: "public",
        rateLimit: { max: 60, timeWindow: "1 minute" },
        cache: { maxAge: 0 },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const siteId = typeof id === "string" ? id.trim() : "";
      if (!siteId) {
        return sendError(reply, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      const loaded = await loadOwnSite(req, reply, siteId);
      if (!loaded.ok) {
        return sendError(reply, loaded.status, loaded.code, loaded.message);
      }
      // 幂等：无记录也回 200 { deleted: false }，不 404。
      const deleted = await ctx.repo.deleteSitePrice(loaded.identity, siteId);
      return { ok: true, deleted };
    },
  );

  /**
   * 从已存 source_url 抓一次官方定价页，只回候选列表，不写库。
   * 用户点选候选后，再调 POST /api/sites/:id/price 写库，带上该候选的
   * confirmToken（服务端签发的一次性凭证，verified_at = 写库此刻）；
   * 无凭证的 POST 一律按手工填写写库，客户端自称 official_scrape 无效。
   * 裸 ¥ 候选 currency/amountMinor 为空，点选时须由用户选货币才能提交
   * （POST 的 currency 必填，后端不猜不补）。
   */
  app.post(
    "/api/sites/:id/price/scrape",
    {
      config: {
        scope: "public",
        rateLimit: { max: 20, timeWindow: "1 minute" },
        cache: { maxAge: 0 },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const siteId = typeof id === "string" ? id.trim() : "";
      if (!siteId) {
        return sendError(reply, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      const loaded = await loadOwnSite(req, reply, siteId);
      if (!loaded.ok) {
        return sendError(reply, loaded.status, loaded.code, loaded.message);
      }
      const { identity } = loaded;

      // 抓取目标 = 该站已存 source_url，绝不猜路径；无 source_url 不可抓取。
      const stored = await ctx.repo.getSitePrice(identity, siteId);
      const sourceUrl = stored?.sourceUrl?.trim() || null;
      if (!sourceUrl) {
        return sendError(
          reply,
          400,
          "BAD_REQUEST",
          "请先在价格表单里填写官方定价页 URL，再从官方定价页抓取。",
        );
      }

      // robots.txt 禁抓 → 不发站点请求、不占预算，候选为空，前端据此置灰按钮。
      if (await checkRobotsAllowed(sourceUrl)) {
        return {
          ok: true,
          siteId,
          sourceUrl,
          robots_disallowed: true,
          candidates: [],
          message: "该站点的 robots.txt 禁止抓取，抓取已置灰。",
        };
      }

      // 出站预算：拿不到额度直接 429，不排队。
      if (!priceScrapeOutboundBudget.tryAcquire(1)) {
        return sendError(reply, 429, "RATE_LIMITED", "出站抓取预算已耗尽，请稍后再试。");
      }
      try {
        const fetchPage = scrapePageOverride ?? defaultScrapePage;
        const page = await fetchPage(sourceUrl);
        if (page.kind !== "ok" || !page.body) {
          // 超时/被拒/死链一律“未验证”，不写任何值。
          return {
            ok: true,
            siteId,
            sourceUrl,
            robots_disallowed: false,
            candidates: [],
            message: `本次抓取未能确认价格（${page.reason}），未写入任何值。`,
          };
        }
        const candidates: PriceScrapeCandidate[] = extractPriceCandidates(page.body).map(
          (candidate) => ({
            ...candidate,
            confirmToken: issueScrapeConfirmToken({
              identity,
              siteId,
              sourceUrl,
              text: candidate.text,
              amount: candidate.amount,
              currency: candidate.currency,
              period: candidate.period,
            }),
          }),
        );
        return {
          ok: true,
          siteId,
          sourceUrl,
          robots_disallowed: false,
          candidates,
          message:
            candidates.length === 0
              ? "官方定价页上没有识别出价格候选，未写入任何值。"
              : "请点选一条候选确认后写入，抓取本身不写库。",
        };
      } finally {
        priceScrapeOutboundBudget.release();
      }
    },
  );
};
