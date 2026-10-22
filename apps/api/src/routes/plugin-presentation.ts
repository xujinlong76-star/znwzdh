/**
 * 插件市场的表示层辅助（与路由注册解耦）。
 *
 * 从 routes/plugins.ts 抽出的纯函数：徽章 SVG 渲染、身份提取、公共序列化。
 * 它们不依赖 Fastify 实例，抽离后可单测、也让路由文件只保留「端点编排」。
 */
import { identityOf, identityTrusted } from "./shared.ts";
import type { AppContext } from "../context.ts";

export function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

function calcTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      width += 12;
    } else if (/[ijlI1:.]/.test(ch)) {
      width += 4.5;
    } else if (/[A-Z%@#&]/.test(ch)) {
      width += 8;
    } else {
      width += 6.5;
    }
  }
  return Math.ceil(width);
}

export function renderBadgeSvg(leftText: string, rightText: string, rightColor: string): string {
  const leftPadding = 12;
  const rightPadding = 12;
  const leftContentWidth = calcTextWidth(leftText);
  const rightContentWidth = calcTextWidth(rightText);
  const leftWidth = leftContentWidth + leftPadding;
  const rightWidth = rightContentWidth + rightPadding;
  const totalWidth = leftWidth + rightWidth;

  const leftTextX = Math.round((leftWidth / 2) * 10);
  const rightTextX = Math.round((leftWidth + rightWidth / 2) * 10);
  const leftTextLength = Math.round(leftContentWidth * 10);
  const rightTextLength = Math.round(rightContentWidth * 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapeXml(leftText)}: ${escapeXml(rightText)}">
  <title>${escapeXml(leftText)}: ${escapeXml(rightText)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${rightColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${leftTextX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${leftTextLength}">${escapeXml(leftText)}</text>
    <text x="${leftTextX}" y="140" transform="scale(.1)" fill="#fff" textLength="${leftTextLength}">${escapeXml(leftText)}</text>
    <text aria-hidden="true" x="${rightTextX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${rightTextLength}">${escapeXml(rightText)}</text>
    <text x="${rightTextX}" y="140" transform="scale(.1)" fill="#fff" textLength="${rightTextLength}">${escapeXml(rightText)}</text>
  </g>
</svg>`;
}

/** 插件域从 body/query 的 identity 字段解析终端用户身份（Header/Query/Body userId 回退见 identityOf） */
export interface PluginIdentityRequest {
  body?: unknown;
  query?: unknown;
}

export function extractPluginIdentity(req: PluginIdentityRequest): string | null {
  // 必须与签名 hook 用**同一个**解析器。这里曾先取 body.identity、再取 query.identity，
  // 且截 120 字符，而 hook 校验的是 identityOf（Header → Query → Body，截 64）：
  // 「头里签攻击者自己的身份、body 里塞受害者身份」能通过签名校验，却以受害者身份
  // 执行安装/评价/`/api/plugins/mine`（他人私有草稿会整批读出）。
  return identityOf(req as never);
}

/**
 * 插件域身份的**唯一可信取用入口**：把「调用方配不配用这个身份」和「身份是什么」绑在一起。
 *
 * 为什么需要它：`NAVHUB_AUTH_REQUIRED=true` 只把门抬到「管理面必须持票」，而插件路由
 * 大多是 `scope:"public"`（访客可浏览/安装/评价），于是无票请求也能带
 * `?identity=<victim>` / body.identity 进来。第二道闸 `NAVHUB_IDENTITY_SECRET`
 * 只在 `NODE_ENV=production` 时才被 security-readiness 要求——也就是说
 * 「开了鉴权、没配签名密钥」这套部署（staging、内网、compose 默认）里，
 * 任何人都能读走他人的私有草稿（`/api/plugins/mine`）、以他人身份发评价/投稿/安装，
 * 靠猜到 `github:<id>` 这类归属串把未上架插件读出来，
 * 甚至用 `resolveLlm(identity)` 借他人存的密钥跑 AI（pre-audit / auto-fix / ai-audit）。
 *
 * 语义刻意不是「一律 403」：无票访客在本项目里是合法的一等公民（前端注释见
 * `navhub-api.ts` 「不带时回退匿名行为」，`/api/hub/*` 代理会给匿名身份签名）。
 * 所以闸门取 `identityTrusted`：开放模式与签名绑定的访客行为完全不变，只有
 * 「鉴权开着 + 签名没配 + 调用方没票」这一格被堵住。被堵时读私有视图的路由
 * 降级为 null（`isOwner`/`myReview` 自然变 false、未上架插件回到 404），
 * 而「以该身份写数据」的路由直接 401——写错人的数据没有可降级的形态。
 */
export function pluginIdentity(ctx: AppContext, req: PluginIdentityRequest): string | null {
  if (!identityTrusted(ctx, req as never)) return null;
  return extractPluginIdentity(req);
}

/**
 * 公共插件序列化：剔除内部归属身份与待审变更说明。
 * ownerKey 可以公开（不可逆哈希），用于作者页 URL。
 * 若 reviewNote 中包含有效的 AI 审核评分，则提取附带 aiAudit 认证标签。
 */
export function publicPlugin(
  plugin: Record<string, any>,
  opts: { ownerView?: boolean } = {},
): Record<string, any> {
  const { ownerIdentity: _ownerIdentity, pendingChangelog, ...rest } = plugin;
  let aiAudit: { score: number; level: string; auditedAt: number } | null = null;
  if (rest.reviewNote && typeof rest.reviewNote === "string") {
    try {
      const parsed = JSON.parse(rest.reviewNote);
      if (typeof parsed.score === "number") {
        aiAudit = {
          score: parsed.score,
          level: parsed.level || "safe",
          auditedAt: parsed.auditedAt || 0,
        };
      }
    } catch {}
  }
  const base = opts.ownerView ? { ...rest, pendingChangelog: pendingChangelog ?? null } : rest;
  return aiAudit ? { ...base, aiAudit } : base;
}
