/**
 * 相对时间（第 15 项：数据安全可见补完）。
 *
 * 主显相对时间（“3 天前”），副显绝对时间由调用方用
 * `formatAbsoluteTime` 渲染（固定 Asia/Shanghai，不跟服务器时区）。
 * 阈值：<1h 显示“刚刚/×分钟前”，<24h 显示“×小时前”，否则“×天前”；
 * 超 1 年以绝对时间为主；非法时间戳返回“—”。
 *
 * 绝对时间一律固定 Asia/Shanghai 渲染：本站面向中国用户，且同一时刻
 * 在 UTC 与 CST 部署上曾渲染出不同的 /hot title（:3000 渲染 UTC、
 * :3100 渲染 CST），跨端口比对须先换算；固定时区后与“×分钟前”
 * 标签的年龄换算（以同一时刻为基准）始终自洽。
 */
const ABSOLUTE_TIME_ZONE = "Asia/Shanghai";

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
  return new Date(ts).toLocaleString("zh-CN", { hour12: false, timeZone: ABSOLUTE_TIME_ZONE });
}

/** 绝对时间副显（与通知页一致的格式；固定 Asia/Shanghai，不跟服务器时区）。 */
export function formatAbsoluteTime(ts: number | null | undefined): string {
  if (ts == null || typeof ts !== "number" || !Number.isFinite(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false, timeZone: ABSOLUTE_TIME_ZONE });
  } catch {
    return "—";
  }
}
