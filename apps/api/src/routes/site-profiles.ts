/**
 * 结构化档案字段（02-site-profiles §3.3，batch0-02）。
 *
 * GET /api/sites/:id/profile：档案行 + 溯源段 + 价格行摘要。
 *   draft 行按缺失处理（profile 为 null、verified 为 false）。
 * PUT /api/sites/:id/profile：写权限（scope "write"）；Zod 校验 §2；
 *   best_for / not_for ≤140 字、禁最高级；alternatives ≤5 且目标存在；
 *   profile_source_url 必须是官网域名下的页面且 ≤2048 字符；
 *   verified_at 服务端生成、客户端传值忽略；每次 PUT 记审计日志
 *   action "site.profiles.update" + diff，旧值保留；provenance 写与
 *   facets / profile 写同事务。
 *
 * pricing_model 的值住 site_facets.pricing（已有），其溯源行写
 * site_profile_provenance；本路由不写 pricing 值，只接受其溯源行。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getFacetDefinition } from "@navhub/core";
import {
  PROFILE_PROVENANCE_FIELD_KEYS,
  type SitePriceRecord,
  type SiteProfileRecord,
} from "@navhub/store";
import type { AppContext } from "../context.ts";
import { badRequest, notFound } from "./shared.ts";

/** 禁最高级与营销词（§2.2）：任一出现即打回。 */
export const PROFILE_SUPERLATIVES = ["最好", "最强", "第一", "首选", "顶级"] as const;

/** provenance 允许的 field_key（与仓储层同一份常量）。 */
const PROVENANCE_KEYS = new Set<string>(PROFILE_PROVENANCE_FIELD_KEYS);

const ProfileFacetsSchema = z.object({
  requires_account: z.union([z.string(), z.array(z.string())]).optional(),
  free_trial: z.union([z.string(), z.array(z.string())]).optional(),
  data_export: z.union([z.string(), z.array(z.string())]).optional(),
});

const ProvenanceEntrySchema = z.object({
  sourceUrl: z.string().max(2048),
});

const ProfileBodySchema = z.object({
  bestFor: z.string().max(140).nullable().optional(),
  notFor: z.string().max(140).nullable().optional(),
  license: z.string().max(2048).nullable().optional(),
  alternatives: z.array(z.string().min(1)).max(5).optional(),
  profileSourceUrl: z.string().max(2048),
  profileStatus: z.enum(["draft", "verified"]).optional(),
  facets: ProfileFacetsSchema.optional(),
  provenance: z.record(z.string(), ProvenanceEntrySchema).optional(),
  // profileVerifiedAt / verifiedAt 故意不在 schema 里：客户端传来的值
  // 直接忽略（zod 默认剥离未知键），写库时间一律服务端 Date.now()。
});

type ProfileFacetsInput = z.infer<typeof ProfileFacetsSchema>;
type ProvenanceInput = Record<string, { sourceUrl: string }>;

function profileView(profile: SiteProfileRecord) {
  return {
    siteId: profile.siteId,
    bestFor: profile.bestFor,
    notFor: profile.notFor,
    license: profile.license,
    alternatives: profile.alternatives,
    profileSourceUrl: profile.profileSourceUrl,
    profileVerifiedAt: profile.profileVerifiedAt,
    verifiedBy: profile.verifiedBy,
    profileStatus: profile.profileStatus,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function priceSummaryView(price: SitePriceRecord | null) {
  if (!price) return null;
  return {
    amountMinor: price.amountMinor,
    currency: price.currency,
    period: price.period,
    freeTierLimit: price.freeTierLimit,
    sourceType: price.sourceType,
    sourceUrl: price.sourceUrl,
    verifiedAt: price.verifiedAt,
  };
}

/**
 * 同源判定（抄 site-prices.ts 的 SSRF 口径）：必须是合法 http(s) URL
 * 且与该站 site.url 同源，只许官网域名下的页面。
 */
function isSameOriginUrl(candidate: string, siteUrl: string): boolean {
  let parsed: URL;
  let origin: URL;
  try {
    parsed = new URL(candidate.trim());
    origin = new URL(siteUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.origin === origin.origin;
}

function allowedValues(key: string): string[] {
  return getFacetDefinition(key)?.options.map((o) => o.value) ?? [];
}

/** 单选归一：字符串或恰好一个元素的数组；多值即非法。 */
function singleValue(
  raw: string | string[] | undefined,
  field: string,
): { value?: string; error?: string } {
  if (raw === undefined) return {};
  const values = Array.isArray(raw) ? raw : [raw];
  const cleaned = values.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (cleaned.length !== 1) return { error: `${field} 是单选，只能传一个值` };
  return { value: cleaned[0] };
}

function multiValues(
  raw: string | string[] | undefined,
  field: string,
): { values?: string[]; error?: string } {
  if (raw === undefined) return {};
  const values = Array.isArray(raw) ? raw : [raw];
  const cleaned = [...new Set(values.map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) return { error: `${field} 没有有效取值` };
  return { values: cleaned };
}

/**
 * 校验 facets 三键的枚举与 data_export 互斥规则。
 * 返回归一化后的 facet 值（写 site_facets 用）或首个错误信息。
 */
function validateProfileFacets(input: ProfileFacetsInput): {
  facets?: Record<string, string[]>;
  error?: string;
} {
  const facets: Record<string, string[]> = {};
  for (const key of ["requires_account", "free_trial"] as const) {
    const single = singleValue(input[key], key);
    if (single.error) return { error: single.error };
    if (single.value === undefined) continue;
    if (!allowedValues(key).includes(single.value)) {
      return { error: `${key} 取值非法：${single.value}` };
    }
    facets[key] = [single.value];
  }
  const multi = multiValues(input.data_export, "data_export");
  if (multi.error) return { error: multi.error };
  if (multi.values) {
    const allowed = allowedValues("data_export");
    for (const v of multi.values) {
      if (!allowed.includes(v)) return { error: `data_export 取值非法：${v}` };
    }
    if (multi.values.includes("none") && multi.values.length > 1) {
      return { error: "data_export 的 none 不能与其他值并存" };
    }
    if (multi.values.includes("unknown") && multi.values.length > 1) {
      return { error: "data_export 的 unknown 不能与其他值并存" };
    }
    facets.data_export = multi.values;
  }
  return { facets };
}

export const siteProfileRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/sites/:id/profile", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) return notFound(reply, "站点不存在");

    const prices = await ctx.repo.listSitePricesBySite(id);
    const price = priceSummaryView(prices[0] ?? null);

    const profile = await ctx.repo.getSiteProfile(id);
    // 草稿态永不进入渲染与对照：draft 行按缺失处理。
    if (!profile || profile.profileStatus !== "verified") {
      return { ok: true, siteId: id, verified: false, profile: null, provenance: [], price };
    }
    const provenance = await ctx.repo.getProfileProvenance(id);
    return {
      ok: true,
      siteId: id,
      verified: true,
      profile: profileView(profile),
      provenance: provenance.map((p) => ({
        fieldKey: p.fieldKey,
        sourceUrl: p.sourceUrl,
        verifiedAt: p.verifiedAt,
        verifiedBy: p.verifiedBy,
      })),
      price,
    };
  });

  app.put("/api/sites/:id/profile", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) return notFound(reply, "站点不存在");

    const parsed = ProfileBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String((issue?.path ?? [])[0] ?? "");
      const message =
        field === "profileSourceUrl"
          ? "profile_source_url 必填且最多 2048 个字符。"
          : field === "bestFor" || field === "notFor"
            ? `${field} 最多 140 个字符。`
            : field === "alternatives"
              ? "alternatives 最多 5 个站点。"
              : field === "license"
                ? "license 最多 2048 个字符。"
                : "档案数据不合法，请检查后重试。";
      return badRequest(reply, message, parsed.error.issues);
    }
    const body = parsed.data;

    // 空串当未填：bestFor / notFor / license 的 "" 一律归一为 null 再校验。
    const textOrNull = (v: string | null | undefined): string | null => {
      if (typeof v !== "string") return null;
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    };
    const bestFor = textOrNull(body.bestFor);
    const notFor = textOrNull(body.notFor);
    const license = textOrNull(body.license);

    // 禁最高级：任一出现即打回。
    for (const [field, value] of [
      ["bestFor", bestFor],
      ["notFor", notFor],
    ] as const) {
      if (value) {
        const hit = PROFILE_SUPERLATIVES.find((w) => value.includes(w));
        if (hit) return badRequest(reply, `${field} 不得含有“${hit}”等最高级或营销词。`);
      }
    }

    // profile_source_url 必须是官网域名下的页面。
    const profileSourceUrl = body.profileSourceUrl.trim();
    if (!isSameOriginUrl(profileSourceUrl, site.url)) {
      return badRequest(reply, "profile_source_url 须为该站官网域名下的页面。");
    }

    // 分面枚举 + data_export 互斥。
    const facetCheck = validateProfileFacets(body.facets ?? {});
    if (facetCheck.error) return badRequest(reply, facetCheck.error);

    // provenance：field_key 白名单 + source_url 同源。
    const provenanceInput: ProvenanceInput = body.provenance ?? {};
    for (const [fieldKey, entry] of Object.entries(provenanceInput)) {
      if (!PROVENANCE_KEYS.has(fieldKey)) {
        return badRequest(reply, `provenance 字段非法：${fieldKey}`);
      }
      if (!isSameOriginUrl(entry.sourceUrl, site.url)) {
        return badRequest(reply, `provenance.${fieldKey} 的 source_url 须为该站官网域名下的页面。`);
      }
    }

    // alternatives：目标 id 必须存在于本站，否则整行写失败。
    const alternatives = [...new Set((body.alternatives ?? []).map((v) => v.trim()).filter(Boolean))];
    if (alternatives.length > 0) {
      const found = await ctx.repo.getSitesByIds(alternatives);
      const missing = alternatives.filter((altId) => !found.has(altId));
      if (missing.length > 0) {
        return badRequest(reply, `alternatives 目标站点不存在：${missing.join(", ")}`);
      }
    }

    const now = Date.now();
    const verifiedBy = req.auth.actor;
    const before = await ctx.repo.getSiteProfile(id);
    const profileStatus = body.profileStatus ?? before?.profileStatus ?? "draft";

    // provenance 写与 facets / profile 写同事务：任一失败整行回滚。
    const saved = await ctx.repo.withTransaction(async () => {
      const row = await ctx.repo.upsertSiteProfile({
        siteId: id,
        bestFor,
        notFor,
        license,
        alternatives,
        profileSourceUrl,
        profileStatus,
        verifiedBy,
        profileVerifiedAt: now,
      });
      if (facetCheck.facets && Object.keys(facetCheck.facets).length > 0) {
        await ctx.repo.upsertProfileFacets(id, facetCheck.facets);
      }
      for (const [fieldKey, entry] of Object.entries(provenanceInput)) {
        await ctx.repo.setProfileProvenance({
          siteId: id,
          fieldKey,
          sourceUrl: entry.sourceUrl.trim(),
          verifiedAt: now,
          verifiedBy,
        });
      }
      return row;
    });

    // 审计日志：diff 含旧值（before 为 null 即首写），旧值保留在日志里。
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.profiles.update",
      target: id,
      diff: {
        before: before ? profileView(before) : null,
        after: profileView(saved),
        facets: facetCheck.facets ?? {},
        provenance: provenanceInput,
      },
    });

    return {
      ok: true,
      siteId: id,
      verified: saved.profileStatus === "verified",
      profile: profileView(saved),
    };
  });
};
