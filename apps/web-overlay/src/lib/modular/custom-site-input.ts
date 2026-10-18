/**
 * 自定义站点录入：URL 规范化 + 伪协议拦截 + id 生成（纯函数，可单测）。
 *
 * 从 `navigation-content.tsx` 抽出三条录入路径共用的两段逻辑
 * （手工添加 / 拖拽收录 / 批量收录，此前各自内联）：
 *
 *  1. `normalizeCustomSiteHref`：trim → 伪协议黑名单拦截（javascript:/data:/
 *     vbscript:/file:/blob:，防存储型 XSS 的纵深防御）→ 无协议自动补
 *     https://（站内相对路径除外）→ 复用 `isSafeSiteHref` 做最终白名单；
 *     判定顺序与拆分前逐字对齐，行为不变。
 *  2. `createCustomSiteId`：`custom_site_<时间戳>_<≤4 位 base36 随机后缀>`，
 *     此前同一表达式在组件里内联了 4 处。
 */
import { isSafeSiteHref } from '@/lib/modular/diy-presets'

export type CustomSiteHrefResult =
  | { ok: true; href: string }
  | { ok: false; reason: 'unsafe-protocol' | 'invalid' | 'empty' }

/** 伪协议黑名单：即使 `isSafeSiteHref` 将来放宽，这里也先拦一道 */
const UNSAFE_PROTOCOL_RE = /^(javascript|data|vbscript|file|blob):/i

/**
 * 规范化用户录入的站点地址。
 *
 * 返回 `ok/href` 或失败原因（组件按原因给不同文案；`empty` 会被组件层的
 * 必填校验提前静默忽略）。
 */
export function normalizeCustomSiteHref(raw: string): CustomSiteHrefResult {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  if (UNSAFE_PROTOCOL_RE.test(trimmed)) return { ok: false, reason: 'unsafe-protocol' }

  let href = trimmed
  if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) {
    href = `https://${href}`
  }
  if (!isSafeSiteHref(href)) return { ok: false, reason: 'invalid' }
  return { ok: true, href }
}

/** 生成自定义站点 id；时间戳与随机源可注入，便于测试与排查 */
export function createCustomSiteId(
  now: number = Date.now(),
  random: () => number = Math.random,
): string {
  return `custom_site_${now}_${random().toString(36).slice(2, 6)}`
}
