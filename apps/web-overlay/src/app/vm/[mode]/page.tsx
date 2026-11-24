import { VIEW_MODE_IDS } from "@/lib/modular/card-display-modes";

/**
 * 展示模式预渲染变体（Zero-CLS 的 ISR 形态）。
 *
 * `src/proxy.ts` 在 `/` 读到 `nav_view_mode` Cookie 命中非 standard 合法模式时，
 * 把请求透明重写到这里对应 `/vm/[mode]` 变体——构建期已按 revalidate=60 预渲染，
 * 服务端直接吐该模式的完整 HTML，客户端水合零跳变（Zero-CLS）。
 *
 * 为什么不放 `app/page.tsx` 里读 Cookie：await cookies() 会把首页整条路由动态化，
 * `/` 落成 ƒ、revalidate=60 静默作废（check-isr-routes.mjs 的 ISR 门禁直接红），
 * 且 3.1MB navigation.json 快照超 Data Cache 2MB 上限未缓存时每次请求都要重取。
 * 变体形态让「按 Cookie 出模式 HTML」与「首页 ISR」两份契约同时成立：
 * - 页面实现只有 `app/page.tsx` 一份（default/generateMetadata 从这里重导出）；
 * - `initialCardDisplayMode` 取路由参数，standard 变体就是 `/` 本页。
 */
export { default, generateMetadata } from "../../page";

/** 与 `/` 同款 ISR 节拍；变体快照同样 60s 自愈。 */
export const revalidate = 60;

/** 只允许 6 个非 standard 规范模式；非法值直接 404（不兜底动态渲染）。 */
export const dynamicParams = false;

export function generateStaticParams() {
  return VIEW_MODE_IDS.filter((mode) => mode !== "standard").map((mode) => ({ mode }));
}
