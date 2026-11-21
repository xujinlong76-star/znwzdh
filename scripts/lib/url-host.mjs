/**
 * URL 主机归属判定（CodeQL `js/incomplete-url-substring-sanitization` 根治）。
 *
 * 与 `packages/core/src/url-host.ts` 及 `apps/web-overlay/src/lib/safe-url.ts`
 * 同语义实现（`.mjs` 无法 import `.ts`，故就地一份）；三份共用同一套测试
 * 用例，行为必须一致。改动任一份时须同步另外两份 + 三份测试。
 *
 * 规则（与 TS 版逐行一致）：
 *   - `new URL(rawUrl)` 解析，非法 URL 返回 `false`；
 *   - 协议必须为 `http:` / `https:`；
 *   - 主机名严格比对：`hostname === host || hostname.endsWith('.' + host)`。
 */

function normalizeAllowedHost(host) {
  return String(host).trim().toLowerCase().replace(/\.$/, "");
}

/**
 * 判定 `rawUrl` 是否属于 `allowedHosts` 任一主机（含其子域）。
 * 只判定“主机归属”，不管 userinfo；无方案裸串 `new URL` 抛错 -> `false`。
 */
export function isAllowedHost(rawUrl, allowedHosts) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
  let hostname;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // WHATWG 保留主机名末尾的点（https://github.com./x -> "github.com."），去点再比对。
    hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (!hostname) return false;
  for (const host of allowedHosts) {
    const h = normalizeAllowedHost(host);
    if (!h) continue;
    if (hostname === h || hostname.endsWith(`.${h}`)) return true;
  }
  return false;
}

/** 是否为可解析的 http(s) 绝对 URL（替代 `value.startsWith('http')` 嗅探）。 */
export function isAbsoluteHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 站点 URL 归一化解析（替代 `raw.startsWith('http') ? raw : `https://${raw}``）。
 * http(s) 绝对 URL 原样返回；裸串补 `https://` 再解析；非法返回 `null`。
 */
export function parseSiteUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return u;
    // 非 http(s) 方案：若串里已有 `://`，它就是带方案的绝对 URL（如 httpx://），
    // 不补方案（`https://httpx://evil.com` 会被 WHATWG 解析成主机名 httpx，
    // 属于误解析）；只有无 `://` 的裸串才补 `https://` 再试。
    if (trimmed.includes("://")) return null;
  } catch {
    // 无方案裸串，补 https:// 再试。
  }
  try {
    return new URL(`https://${trimmed}`);
  } catch {
    return null;
  }
}
