/**
 * 公开导航页（Batch 3 第 6 项）。
 *
 * 用户把一个收藏文件夹发布成公开只读页（/pub/:slug），不用登录就能看。
 *
 * 与 /pack 的区分（见 lib/link-pack.ts）：pack 是发一次的快照文件（hash 编码、
 * 无服务端、无 SEO、无下线、20 条/4KB）；公开页是常驻页面——服务端存发布关系、
 * live 引用文件夹（发布后收藏增删自动跟随）、有独立链接与 SEO、可随时下线。
 * 与 /collections 的区分：合集是站方精选（admin 写），公开页是用户自己的发布，
 * 两者绝不混进同一张表、同一路由。
 *
 * 隐私红线：
 * - 默认不公开；只有 owner（canonical 身份 + 签名）能创建/改状态/删除；
 * - 公开读绝不返回 owner_identity；跨 owner 读写一律 404（不泄露存在性）；
 * - 收藏备注（note）是写给自己的私人内容：公开读绝不返回 note 字段，
 *   公开页绝不渲染备注——不要给这个加开关，默认就是不公开；
 * - 下线页在读端按不存在处理（404 纪律与 /collections 一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { badRequest, created, notFound, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed, identityTrusted } from "./shared.ts";
import { sendError } from "../error-envelope.ts";
import type { AppContext } from "../context.ts";
import type { PublicPage } from "@navhub/store";

/** 发布时文件夹内有效条目上限：公开页一页展示，不分页；超限请分文件夹发布。 */
export const PUBLIC_PAGE_MAX_ITEMS = 100;

const TITLE_MAX = 40;
const DESCRIPTION_MAX = 200;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

const createBody = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  description: z.string().trim().max(DESCRIPTION_MAX).nullable().optional(),
  folderId: z.string().trim().min(1).nullable().optional(),
  slug: z.string().trim().min(1).max(64).nullable().optional(),
});

const statusBody = z.object({
  status: z.enum(["published", "unpublished"]),
});

/** 公开面：绝不含 owner_identity。 */
function publicView(page: PublicPage) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    description: page.description,
    folderId: page.folderId,
    status: page.status,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

/**
 * 标题 slug 化：中文标题 slug 化后为空是常态，兜底 'nav' 再拼随机后缀，
 * 不把标题原文（可能含隐私信息）塞进 slug。
 */
export function slugifyPublicPageTitle(title: string): string {
  // 不用 /[^a-z0-9]+/g + /^-+|-+$/g：CodeQL #147 多项式回溯。单遍扫描等价实现
  //（连续非字母数字折成一个 '-'，首尾不留 '-'；单遍线性扫描本身无回溯，不截断输入）。
  const lower = title.toLowerCase();
  let out = "";
  let lastWasDash = true; // 开头不留 '-'
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!;
    const isAlnum = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
    if (isAlnum) {
      out += ch;
      lastWasDash = false;
    } else if (!lastWasDash) {
      out += "-";
      lastWasDash = true;
    }
  }
  if (out.endsWith("-")) out = out.slice(0, -1);
  return out.slice(0, 32) || "nav";
}

function randomSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 6);
}

/**
 * 分配公开 slug（Batch 4 Phase 2 P2-4 起导出复用：对照分享用同一份分配
 * 逻辑，不另复制一份——自定义 slug 已被占用返回 null（调用方 409），
 * 自动分配 5 次撞车返回 null。
 */
export async function allocatePublicSlug(ctx: AppContext, title: string, wanted?: string | null): Promise<string | null> {
  if (wanted) {
    // 格式错与已被占用是两回事：格式错 400（调用方传错了），占用 409（换一个就行）。
    // 这里只判断占用；格式由调用方先校验。
    if (await ctx.repo.getPublicPageBySlug(wanted)) return null;
    return wanted;
  }
  const base = slugifyPublicPageTitle(title);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? `${base}-${randomSuffix()}` : `${base}-${randomSuffix()}`;
    if (!(await ctx.repo.getPublicPageBySlug(slug))) return slug;
  }
  return null;
}

export interface PublicPageItem {
  siteId: string;
  title: string;
  url: string;
  description: string | null;
  categoryId: string;
}

/**
 * live 解析：按 owner + folder 现算收藏，只留仍存在且 active 的站。
 * broken/停用/已删的站不进公开页（与 /collections 详情同口径：公开推荐面
 * 不展示失效链接；收藏本身不动，站点恢复后自动回到公开页里）。
 */
export async function resolvePublicPageItems(ctx: AppContext, page: PublicPage): Promise<PublicPageItem[]> {
  const favorites = await ctx.repo.listFavorites(page.ownerIdentity);
  const inFolder = favorites.filter((f) => (page.folderId ? f.folderId === page.folderId : true));
  const siteMap = await ctx.repo.getSitesByIds(inFolder.map((f) => f.siteId));
  const items: PublicPageItem[] = [];
  for (const fav of inFolder) {
    const site = siteMap.get(fav.siteId);
    if (!site) continue;
    if (site.enabled === false || site.status !== "active") continue;
    items.push({
      siteId: site.id,
      title: site.title,
      url: site.url,
      description: site.description ?? null,
      categoryId: site.categoryId,
    });
  }
  return items;
}

export const publicPageRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  const requireOwner = async (req: Parameters<typeof requestIdentityOf>[0]) => {
    const identity = requestIdentityOf(req as never);
    if (!identity) return { error: "missing" as const };
    if (!identityTrusted(ctx, req as never)) return { error: "untrusted" as const };
    return { canonical: await resolveCanonicalIdentity(ctx, identity) };
  };

  /**
   * 公开读：免登。只返回已发布的页；下线/不存在一律 404。
   */
  app.get("/api/public-pages/:slug", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const page = await ctx.repo.getPublishedPublicPageBySlug(slug);
    if (!page) return notFound(reply, "公开页不存在或已下线");
    const items = await resolvePublicPageItems(ctx, page);
    return { page: publicView(page), items };
  });

  /** 我的公开页（owner 才看得到，含已下线）。 */
  app.get("/api/public-pages", { config: { scope: "public", rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    const owner = await requireOwner(req as never);
    if ("error" in owner) return sendError(reply, owner.error === "missing" ? 400 : 401, owner.error === "missing" ? "BAD_REQUEST" : "UNAUTHORIZED", owner.error === "missing" ? "缺少 userId 或 anonId" : "需要 Bearer <redacted>");
    const pages = await ctx.repo.listPublicPagesByOwner(owner.canonical);
    return { pages: pages.map(publicView) };
  });

  app.post("/api/public-pages", { config: { scope: "public", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const owner = await requireOwner(req as never);
    if ("error" in owner) return sendError(reply, owner.error === "missing" ? 400 : 401, owner.error === "missing" ? "BAD_REQUEST" : "UNAUTHORIZED", owner.error === "missing" ? "缺少 userId 或 anonId" : "需要 Bearer <redacted>");
    const parsed = createBody.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(reply, "参数无效", parsed.error.flatten());
    const { title, description, folderId, slug } = parsed.data;

    // 夹子归属：只能发布自己的夹子（BOLA；与 POST /api/favorites 同口径）。
    if (folderId) {
      const folders = await ctx.repo.listFavoriteFolders(owner.canonical);
      if (!folders.some((f) => f.id === folderId)) return badRequest(reply, "收藏夹不存在或不属于你");
    }

    // 自定义 slug 格式错是 400（调用方传错了）；已被占用是 409（换一个就行）。
    if (slug && !SLUG_PATTERN.test(slug)) {
      return badRequest(reply, "链接后缀只能用小写字母、数字和连字符，开头必须是字母或数字，2–64 个字符");
    }

    // 先算有效条目：空文件夹不发空页（诚实空态），超 100 条请分文件夹。
    const probe: PublicPage = {
      id: "",
      slug: "",
      ownerIdentity: owner.canonical,
      title,
      description: description ?? null,
      folderId: folderId ?? null,
      status: "published",
      createdAt: 0,
      updatedAt: 0,
    };
    const items = await resolvePublicPageItems(ctx, probe);
    if (items.length === 0) return badRequest(reply, "这个收藏夹里没有可公开的有效站点，先收藏几个再发布");
    if (items.length > PUBLIC_PAGE_MAX_ITEMS) {
      return badRequest(reply, `公开页最多 ${PUBLIC_PAGE_MAX_ITEMS} 条，当前 ${items.length} 条，请分文件夹发布`);
    }

    const allocated = await allocatePublicSlug(ctx, title, slug ?? null);
    if (!allocated) {
      return sendError(reply, 409, "CONFLICT", "这个链接后缀已被占用，换一个再试");
    }
    const page = await ctx.repo.createPublicPage({
      slug: allocated,
      ownerIdentity: owner.canonical,
      title,
      description: description ?? null,
      folderId: folderId ?? null,
    });
    return created(reply, { page: publicView(page), url: `/pub/${page.slug}` });
  });

  app.patch("/api/public-pages/:slug", { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const owner = await requireOwner(req as never);
    if ("error" in owner) return sendError(reply, owner.error === "missing" ? 400 : 401, owner.error === "missing" ? "BAD_REQUEST" : "UNAUTHORIZED", owner.error === "missing" ? "缺少 userId 或 anonId" : "需要 Bearer <redacted>");
    const parsed = statusBody.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(reply, "参数无效", parsed.error.flatten());
    const { slug } = req.params as { slug: string };
    const page = await ctx.repo.getPublicPageBySlug(slug);
    // 跨 owner 一律 404，不泄露存在性。
    if (!page || page.ownerIdentity !== owner.canonical) return notFound(reply, "公开页不存在");
    if (parsed.data.status === "published") {
      // 重新发布时重算：夹子被清空后不许把空页重新上线。
      const items = await resolvePublicPageItems(ctx, page);
      if (items.length === 0) return badRequest(reply, "这个收藏夹里没有可公开的有效站点，无法重新发布");
      if (items.length > PUBLIC_PAGE_MAX_ITEMS) {
        return badRequest(reply, `公开页最多 ${PUBLIC_PAGE_MAX_ITEMS} 条，当前 ${items.length} 条，请分文件夹发布`);
      }
    }
    const updated = await ctx.repo.setPublicPageStatus(page.id, parsed.data.status);
    if (!updated) return notFound(reply, "公开页不存在");
    return { page: publicView(updated) };
  });

  app.delete("/api/public-pages/:slug", { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const owner = await requireOwner(req as never);
    if ("error" in owner) return sendError(reply, owner.error === "missing" ? 400 : 401, owner.error === "missing" ? "BAD_REQUEST" : "UNAUTHORIZED", owner.error === "missing" ? "缺少 userId 或 anonId" : "需要 Bearer <redacted>");
    const { slug } = req.params as { slug: string };
    const page = await ctx.repo.getPublicPageBySlug(slug);
    if (!page || page.ownerIdentity !== owner.canonical) return notFound(reply, "公开页不存在");
    await ctx.repo.deletePublicPage(page.id);
    return { ok: true };
  });
};
