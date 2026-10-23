import { timingSafeEqual } from "node:crypto";

/**
 * 「我方 Web 层的服务端取数」识别 —— 只用于限流豁免，不是鉴权。
 *
 * 为什么需要（docs/seo/ISR-ROUTES.md 5.9 实测）：中枢的全局按 IP 限流是 300 req/min，
 * 而 web 侧所有 SSR/RSC 取数在部署拓扑上是**同一个出口 IP**。抓取式扫 1126 个收录页
 * ≈ 每分钟 750+ 次取数 = 额度的 2.5 倍 → 429 → `hubGetProbe` 判 `failed` →
 * 渲染带 `noindex, follow` 的降级壳，而**这份壳正是会被 ISR 缓存的那一份**。
 * 也就是说：一次全站抓取能把近半数收录页刷成不可索引快照。
 *
 * 为什么不用「内网 IP 段」当判据：`trustProxy` 支持 `1`/`true`（采信整条 XFF 最左值，
 * 见 config.ts trustProxyMode 的说明），那时客户端自报 `X-Forwarded-For: 127.0.0.1`
 * 就能伪装成内网拿到无限额度。凭据不存在这个口子。
 *
 * **边界（务必守住）**：只有 `apps/web/src/lib/server/hub.ts` 这条服务端取数路径可以带这个头。
 * 浏览器侧的 `/api/hub/*` 代理**不得**附带 —— 附上了就等于把全站访客流量整体标成内部流量，
 * 按 IP 的限形同虚设。该边界由 `apps/web/test/hub-internal-token.test.ts` 钉住。
 *
 * 未配置 `NAVHUB_INTERNAL_TOKEN` 时本函数恒为 false：零豁免，与历史行为逐字一致。
 */
export const INTERNAL_TOKEN_HEADER = "x-navhub-internal-token";

export function isInternalTraffic(
  headerValue: string | string[] | undefined,
  configuredToken: string | null | undefined
): boolean {
  const expected = String(configuredToken ?? "").trim();
  if (!expected) return false;
  const sent = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!sent) return false;
  // 定长再比较：timingSafeEqual 对长度不等的 buffer 直接抛，长度本身就是公开信息，
  // 提前返回不泄露额外信号，却避免了抛错被上层吞成「放行」。
  const a = Buffer.from(sent, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
