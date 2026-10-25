/**
 * 插件包与本地站点库的「重复预览」（P0-2 安装体感）。
 *
 * 解决的真实问题：用户装第二个网址包时，弹窗只说「将新增约 N 个站点」，
 * 但那 N 条里可能有一大半在之前安装的包里已经有了 —— 安装完成后才发现
 * 「实际只新增了 3 个」，体感落差很大。本路由让前端在**点击之前**就能说清
 * 「将新增 X 个，另有 Y 个已在您的库中（跨包重复，不会重复创建）」。
 *
 * 判定口径与真正安装时**必须完全一致**，否则预览会骗人：
 * 安装侧的去重实现在 `packages/store/src/repository/plugins.ts` 的 `siteUrlExists`，
 * 它把「原文 / canonicalizeUrl 规范化 / 尾斜杠增删」四种形态都当作同一条 URL。
 * 这里复刻同一套展开规则（见 `urlLookupForms`），并把 N 次单条查询压成
 * 少量批量 IN 查询（一个 200 站的包约 2 次 SQL，而不是 200 次）。
 *
 * 只读、不落库、不写审计：它只是把库里已存在的事实读出来。
 */
import type { FastifyPluginAsync } from "fastify";
import { canonicalizeUrl, type SitePackPayload } from "@navhub/core";
import type { AppContext } from "../context.ts";
import { safeDecodeParam, badRequest, notFound } from "./shared.ts";

/**
 * 单条 SQL 的最大占位符数。
 * SQLite 的默认上限是 999 个变量，PG 是 65535；取 400 让两边都安全，
 * 同时把 200 站 × 最多 4 种形态 = 800 个形态压到 2 条查询。
 */
const MAX_PLACEHOLDERS = 400;

/** 预览里最多回传几条「已存在」样例（足够让用户认出来，又不刷屏） */
const MAX_SAMPLES = 5;

/**
 * URL 的等价形态集合：原文 / 规范化 / 尾斜杠增删。
 *
 * 与安装侧 `siteUrlExists` 保持同一口径。抽成导出函数是为了让测试能直接锁住
 * 「https://a.com」与「https://a.com/」必须互相命中 —— 这两条一旦漂移，
 * 预览说「新增 200」而安装实际只新增 3，就会变成新的信任问题。
 */
export function urlLookupForms(url: string): string[] {
  const forms = new Set<string>();
  for (const form of [url.trim(), canonicalizeUrl(url)]) {
    if (!form) continue;
    forms.add(form);
    forms.add(form.endsWith("/") ? form.slice(0, -1) : form + "/");
  }
  return [...forms];
}

export interface OverlapPreview {
  slug: string;
  /** 清单声明条数（清单校验层已按等价 URL 归一去重） */
  declared: number;
  /** 包内按 URL 去重后的条数（再兜一层，防止校验层未来放宽） */
  unique: number;
  /** 已在本地站点库中（跨包重复或手工添加过） */
  existing: number;
  /** 安装后预计新建的条数 */
  fresh: number;
  /** 已存在的样例 URL，便于用户认出来 */
  existingSamples: string[];
}

/**
 * 计算一个网址包相对本地库的重复情况。
 *
 * 导出成纯函数（只依赖 repo.raw）便于单测，路由层只负责取插件与拼响应。
 */
export async function previewPluginOverlap(
  repo: { raw: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]> },
  urls: readonly string[],
): Promise<{ unique: string[]; existing: Set<string> }> {
  // 包内先去重：同一个包重复声明同一条 URL 时不能重复计入「将新增」
  const unique = [...new Set(urls)];
  const formToUrl = new Map<string, string>();
  for (const url of unique) {
    for (const form of urlLookupForms(url)) {
      if (!formToUrl.has(form)) formToUrl.set(form, url);
    }
  }
  const forms = [...formToUrl.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < forms.length; i += MAX_PLACEHOLDERS) {
    const chunk = forms.slice(i, i + MAX_PLACEHOLDERS);
    const rows = await repo.raw(
      `SELECT url FROM sites WHERE url IN (${chunk.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      chunk,
    );
    for (const row of rows) {
      const owner = formToUrl.get(String(row.url));
      if (owner) existing.add(owner);
    }
  }
  return { unique, existing };
}

export const pluginOverlapRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, { ctx }) => {
  /**
   * 网址包相对本地库的重复预览。
   *
   * 公开只读：任何访客都能在安装前看到「会新增多少」，
   * 因此不要求身份；限流按安装同档（60/min）防止被当作批量探测工具。
   */
  app.get(
    "/api/plugins/:slug/overlap",
    { config: { scope: "public", rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const slug = safeDecodeParam((req.params as { slug: string }).slug);
      const plugin = await ctx.repo.getPluginBySlug(slug);
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`);
      if (plugin.manifest.kind !== "site-pack") {
        return badRequest(reply, "只有网址包（site-pack）才有站点重复预览");
      }

      const declaredUrls = (plugin.manifest.payload as SitePackPayload).sites.map((s) => s.url);
      const { unique, existing } = await previewPluginOverlap(ctx.repo, declaredUrls);

      const result: OverlapPreview = {
        slug,
        declared: declaredUrls.length,
        unique: unique.length,
        existing: existing.size,
        fresh: unique.length - existing.size,
        existingSamples: unique.filter((u) => existing.has(u)).slice(0, MAX_SAMPLES),
      };
      return { ok: true, ...result };
    },
  );
};
