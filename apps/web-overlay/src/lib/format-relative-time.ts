/**
 * 相对时间（第 15 项：数据安全可见补完）。
 *
 * 主显相对时间（“3 天前”），副显绝对时间由调用方用
 * `toLocaleString('zh-CN', { hour12: false })` 另行渲染（与通知页一致）。
 * 阈值：<1h 显示“刚刚/×分钟前”，<24h 显示“×小时前”，否则“×天前”；
 * 超 1 年以绝对时间为主；非法时间戳返回“—”。
 */
const relativeFormat = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

export function formatRelativeTime(ts: number | null | undefined, now = Date.now()): string {
  // 0 / 负数不是合法时间戳（Date.now() 恒 > 0）：脏数据不渲染成 1970 年日期。
  if (ts == null || typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
  const diffMs = now - ts;
  // 未来时间戳（时钟偏差）按“刚刚”处理，不显示负数
  if (diffMs < 0) return "刚刚";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const year = 365 * day;
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return relativeFormat.format(-Math.floor(diffMs / minute), "minute");
  if (diffMs < day) return relativeFormat.format(-Math.floor(diffMs / hour), "hour");
  if (diffMs < year) return relativeFormat.format(-Math.floor(diffMs / day), "day");
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

/** 绝对时间副显（与通知页一致的格式）。 */
export function formatAbsoluteTime(ts: number | null | undefined): string {
  if (ts == null || typeof ts !== "number" || !Number.isFinite(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}
