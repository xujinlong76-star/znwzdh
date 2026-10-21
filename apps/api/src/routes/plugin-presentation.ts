/**
 * 插件市场的表示层辅助（与路由注册解耦）。
 *
 * 从 routes/plugins.ts 抽出的纯函数：徽章 SVG 渲染、身份提取、公共序列化。
 * 它们不依赖 Fastify 实例，抽离后可单测、也让路由文件只保留「端点编排」。
 */
import { identityOf } from "./shared.ts";

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
