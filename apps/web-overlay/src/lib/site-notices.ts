/**
 * 站点人工标注（临时）：巡检 health 派生之外的站内标注。
 *
 * 背景：Project Gutenberg 自 2026-11-26 约 00:30 起返回 503 维护页
 * （2026-11-27 02:26 本轮复测：仍 503，响应体 913 字节，
 * md5 fabac0991d526c65a9a4d71286601120，与 0022/0122 轮一致），
 * 但站内巡检因 DNS 误解析被 SSRF guard 拦在站外，拿不到状态码，
 * 卡片只能显示「近期检测异常」。本站无 per-site 人工覆盖字段，
 * 故用本静态 map 给状态机补一个「维护中」档。
 *
 * 约束：
 * - key 只许用 hubId（徽标映射键是 hubId，id 与 hubId 在本站相等）。
 * - label 写死 '维护中'，不接受自由文案（防错别字进徽标）。
 * - untilISO 过期后 getSiteNotice 返回 undefined，自动回落到原分级，
 *   无需二次上线摘除；但维护分支优先于可访问档，所以过期日必须设，
 *   否则人工标注会盖住恢复后的绿灯。
 */
export interface SiteNotice {
  label: '维护中'
  /** 标注失效时刻（含时区）；过期自动回落。 */
  untilISO: string
  note?: string
}

export const SITE_NOTICES: Record<string, SiteNotice> = {
  // Project Gutenberg：对方维护页 503，复测于 2026-11-27 02:26 CST，
  // 维护已持续约 26 小时；untilISO = 复测时刻 +48h。
  'nav-508848075e00': {
    label: '维护中',
    untilISO: '2026-11-29T02:26:00+08:00',
    note: '对方返回 503 维护页（retry-after 21600），本站巡检因 DNS 误解析拿不到状态码',
  },
}

/** 查不到或已过期返回 undefined（调用方按无标注处理）。 */
export function getSiteNotice(hubId?: string): SiteNotice | undefined {
  if (!hubId) return undefined
  const notice = SITE_NOTICES[hubId]
  if (!notice) return undefined
  if (Number.isNaN(Date.parse(notice.untilISO))) return undefined
  if (Date.parse(notice.untilISO) < Date.now()) return undefined
  return notice
}
