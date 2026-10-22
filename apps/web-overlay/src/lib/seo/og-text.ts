/**
 * 分享卡（OG 图）的文本口径——纯函数，无 React、无取数。
 *
 * 为什么单独一个文件：`next/og` 走 Satori，**默认字体不含 CJK**，中文进画面
 * 会变成空白方块。仓库既有决策（docs/PLUGIN-MARKET-ENHANCEMENTS-2026-10-19.md
 * · D3）是不引入字体资产、不发外网请求，所以每张卡片只能渲染 ASCII，
 * 「中文名 → 可渲染文本」的回退链是这套分享图的核心逻辑，值得单独测。
 * 构图本体在同目录 `og-card.tsx`（含 JSX，vitest 不覆盖）。
 */

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const
export const OG_IMAGE_CONTENT_TYPE = 'image/png'

/**
 * Satori 安全文本：过滤掉非 ASCII（中文会渲染成空白），压缩空白。
 * 返回空串表示「这段没有可渲染内容」，调用方负责回退。
 */
export function ogAscii(text: string | null | undefined, maxLen = 42): string {
  const s = (text ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.slice(0, maxLen)
}

/** 站点域名（去掉 www.）：中文站点名过滤后为空时，域名是最有信息量的 ASCII */
export function ogHost(url: string | null | undefined): string {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** slug 形态转标签：`ai-coding` → `AI CODING`（连字符在画面上读起来像 URL） */
export function ogSlugLabel(slug: string | null | undefined): string {
  return ogAscii((slug ?? '').replace(/[-_]+/g, ' '), 26).toUpperCase()
}

/**
 * 按优先级挑主标题：取第一个「够长」的 ASCII 候选，全部偏短再退回第一个非空。
 *
 * 为什么不是「谁长用谁」：`AI 编程工具链` 的标题只剩 `AI` 两个字符，
 * 而它的 slug `ai-coding` 信息量更大；但站名 `Google Fonts`（12 字符）又一定
 * 要比域名 `fonts.google.com`（16 字符）优先。所以是「达标即止」的顺序判定，
 * 候选次序由各路由按语义给出。
 */
export function ogBestLabel(
  candidates: Array<string | null | undefined>,
  minLen = 3,
): string {
  const ascii = candidates.map((c) => ogAscii(c))
  return ascii.find((s) => s.length >= minLen) ?? ascii.find(Boolean) ?? ''
}

/**
 * 逐页分享图的 URL：`{页面路径}/opengraph-image`，与 `opengraph-image.tsx`
 * 所在目录一一对应（Next 的文件约定路由）。
 *
 * 先剥掉查询串：`/sites?page=2` 这类形态直接拼会得到
 * `/sites?page=2/opengraph-image` 这种打不开的 URL。
 * 分页共用同一张卡片图，与 og:url 各自独立并不冲突。
 * 注意另一半：只有**存在** `opengraph-image.tsx` 的目录才能指过来 ——
 * `/category/{slug}/p/{n}` 没有自己的卡片路由，指过去是 404。
 */
export function ogImageUrl(pagePath: string): string {
  const path = pagePath.split('?')[0].replace(/\/+$/, '')
  return `${path}/opengraph-image`
}
