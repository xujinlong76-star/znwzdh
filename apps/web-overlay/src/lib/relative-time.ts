/**
 * 热榜新鲜度相对时间（/brief 全网热榜卡片顶标注）。
 *
 * 档位与站内 ageLabel（lib/modular/weather.ts:183-193）逐档一致：
 * `<1 分钟→刚刚 / 1–59 分钟→X 分钟前 / 1–23 小时→X 小时前 / ≥24 小时→M月D日`。
 * 两处有意的差别（本轮任务定死）：
 *  - ≥24 小时一档写 `M月D日`（不带空格），ageLabel 是 `M 月 D 日`；
 *  - 日期取 UTC 月/日：相对文案只算 epoch 毫秒差、时区无关，同一
 *    now/fetchedAt 在任何 TZ 下得同一文案（ageLabel 用本地月/日，跨
 *    午夜边界会随 TZ 变）。
 *
 * 纯函数，不读库、不发请求；`fetchedAt` 是本站成功抓取时刻（非平台
 * 更新时间），文案一律是「本站 X 分钟前更新」，不写成平台更新时间。
 */

/** stale 升级阈值：漏掉 ≥ 2 个刷新周期（每小时一轮）即视为旧缓存告警。边界 2 小时整按升级算（`>=`）。 */
export const STALE_ESCALATION_MS = 2 * 60 * 60_000

export function formatFreshness(
  fetchedAt: number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (fetchedAt == null || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null
  const diff = Math.max(0, now - fetchedAt)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const d = new Date(fetchedAt)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

export type HotlistSourceStatus = 'ok' | 'stale' | 'empty'

/**
 * /brief 全网热榜卡片副行文案（SSR 首帧与客户端小岛共用同一函数）。
 * 先判 status 再用时间：路由在 items 为空但 lastOkAt 非空时仍返回非空
 * fetchedAt、status 为 'empty'（routes/hotlist.ts:55-56 的边缘组合），
 * 此时一律不显示时间。无 fetchedAt 时不编造时间（不回退 Date.now()，
 * 不拿 last_attempt_at 冒充成功抓取时刻）。stale + 无 fetchedAt 时不说
 * 「暂无数据」（stale 态按路由定义 items.length > 0，下方有缓存条目），
 * 改说「时间未知的缓存」（研究报告 hotlist-freshness-2026-11-15-1422.md §4.2）。
 */
export function formatHotlistSubline(
  status: HotlistSourceStatus,
  fetchedAt: number | null | undefined,
  now: number = Date.now(),
): string {
  const fresh = formatFreshness(fetchedAt, now)
  if (status === 'empty') return '暂无数据（等待首次抓取）'
  if (status === 'stale') {
    if (fresh === null) return '抓取暂时失败，下面是时间未知的缓存'
    const ageMs = Math.max(0, now - (fetchedAt ?? 0))
    if (ageMs >= STALE_ESCALATION_MS) {
      const hours = Math.floor(ageMs / 3600_000)
      return `抓取已失败 ${hours} 小时，下面是旧缓存`
    }
    return `抓取暂时失败，下面是 ${fresh} 的缓存`
  }
  if (fresh === null) return '暂无数据（等待首次抓取）'
  return `${fresh}更新`
}
