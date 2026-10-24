/**
 * 短链目标校验：`/s/<code>` 只允许跳站内 `/marketplace/` 路径。
 *
 * 这份逻辑在 `packages/core/src/mcp-schemas.ts` 里有同名的一份（入库/读回侧用），
 * apps/web 不依赖 @navhub/core 所以只能同构复制；两表的用例由
 * `test/shortlink-target.test.ts` 与 core 侧测试各自钉住，改一处必须改另一处。
 */

/** 短链目标的最大长度，与 POST /api/shortlinks 一致 */
export const MAX_SHORTLINK_TARGET_LENGTH = 500

/**
 * 三个字面校验之外的逃逸口：
 * - 控制字符：浏览器解析 URL 前会先删掉 Tab/LF/CR，`/\t/evil.com` 到我们手里是
 *   站内路径、到浏览器手里是协议相对地址。
 * - 反斜杠：`\` 被当成 `/`，`/\marketplace` 同样能变站外。
 * - 点段：`/marketplace/../../admin` 前缀过关，规范化后落在 `/admin`。
 */
export function isInternalShortLinkTarget(target: string): boolean {
  if (!target || target.length > MAX_SHORTLINK_TARGET_LENGTH) return false
  if (/[\u0000-\u001f\u007f]/.test(target)) return false
  if (!target.startsWith('/marketplace/') || target.startsWith('//')) return false
  if (target.includes('\\')) return false
  try {
    const resolved = new URL(target, 'http://navhub.internal')
    return resolved.origin === 'http://navhub.internal' && resolved.pathname.startsWith('/marketplace/')
  } catch {
    return false
  }
}
