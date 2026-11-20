/**
 * 死链一键 Wayback 存档恢复（纯函数，0 DOM 依赖）。
 *
 * 背景（research #4「死链防御」）：链接会腐烂（20–30% 的链接几年内失效），
 * 「书签只是一个指针，不是副本」。站内已有巡检（health-sentinel 排期 +
 * 服务端可用性探测 + Wayback 自愈接口），但用户侧没有恢复入口：详情页的
 * Wayback 链接用的还是 `*`（最新快照，不是收录时的样子）。
 *
 * 本文件只剩详情页这一条活口径（与 site-health.ts「如实展示」同源）：
 * Wayback 时间戳取「收录/保存日期」：Wayback 会把
 * `web/YYYYMMDDHHMMSS/<url>` 重定向到离该时刻最近的一次抓取，
 * 用户看到的是收录时样子的页面，而不是最新快照（站可能已改版成
 * 停放页）。没有日期时回落到 `*`（最新快照）——仍是一键可达的恢复，
 * 只是不定向到收录时刻。
 *
 * 卡片上的「已失效 · 看存档」徽标已于 2026-11-12 移除（连同判定口径
 * isDeadLinkHealth）：卡片数据来自静态导航 JSON，从没有任何一条带巡检
 * health，首页也不取中枢数据，`nav-<hex>` 的导航 id 与中枢站点的 id
 * 之间又没有可验证的对应关系——徽标在生产里永远画不出来，留着只是死
 * UI。不要凭空猜一个 id 对应关系把它焊回来；若将来有了卡片可用的巡检
 * 生产者，再从 git 历史里恢复徽标与 isDeadLinkHealth（口径曾是：跑过
 * 巡检 + ok === false + 404/410/451/5xx；401/403/429 反爬与无状态码的
 * 探测失败都不算死链）。
 *
 * 2026-11-20（03-livelink-mapping §4.1/§4.3）：hubId 打通后卡片有了
 * 可用的巡检生产者，徽标与 isDeadLinkHealth 按本方案恢复——
 * 注意：本克隆的 git 历史经 rebase 压缩，2026-11-12 的移除提交已不可达
 * （`git log -S isDeadLinkHealth` 无命中），此处是按本文件头引用的旧口径
 * 原文 + 方案 §4.3 请回，不是凭空重写：旧口径（跑过巡检 + ok === false +
 * 404/410/451/5xx；401/403/429 与无状态码不算死链）保持不变，唯一改动
 * 是判定输入改为映射后的 health——函数只认 `siteHealthState()` 的输出
 * （`state === 'dead'`），内部不再直接读原始 ok/httpStatus 做判定。
 * SOFT_404 高置信度（>= 0.9）单次只返“疑似失效 · 看存档”，不返“已失效”：
 * 这一支由 siteHealthState() 落到 `suspect-soft404` 档保证，本函数对它
 * 返回 false。
 *
 * 渲染时不发任何网络请求：动作是用户点击后才打开新标签页（safeWindowOpen），
 * 不做快照有无的预先查询——查询会阻塞渲染、且 Wayback 的「有没有快照」
 * 本来就由它自己在打开后回答（无快照时它会明确告诉用户，而不是我们
 * 替它撒谎说「已恢复」）。
 */
import { buildWaybackSnapshotUrl } from "./wayback-resolver";
import type { SiteHealthState } from "./site-health";

/**
 * 死链判定（2026-11-12 旧口径请回，见文件头；唯一改动是判定输入改为
 * 映射后的 health）。
 *
 * 旧口径：跑过巡检 + ok === false + 404/410/451/5xx；401/403/429 反爬
 * 与无状态码的探测失败都不算死链。映射后等价为：`siteHealthState()` 的
 * 输出是 `dead` 档（连续失败 >= 2 且满足 §3.2 第 8 行硬条件）时为真，
 * 其余一切（未巡检 null、疑似档、检测异常）都为假。
 * SOFT_404 高置信度单次落 `suspect-soft404`（“疑似失效 · 看存档”），
 * 本函数对它返回 false，不算死链。
 */
export function isDeadLinkHealth(state: SiteHealthState | null | undefined): boolean {
  return state?.state === "dead";
}

/**
 * 把收录/保存时刻格式化成 Wayback 时间戳 `YYYYMMDDHHMMSS`（UTC）。
 *
 * 输入是毫秒 epoch（库里 createdAt 的单位）或 Date；无效、缺失、非正
 * 的输入返回 null，调用方据此回落到 `*`，不编一个假时间戳。
 */
export function formatWaybackTimestamp(savedAt: number | Date | null | undefined): string | null {
  let date: Date | null = null;
  if (typeof savedAt === "number") {
    // 0 / 负数 / NaN / Infinity 都不是真实的收录时刻：1970-01-01 的时间戳
    // 只会把用户带到 Wayback 建库前的真空地带，宁可回落到 `*`
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
    date = new Date(savedAt);
  } else if (savedAt instanceof Date) {
    date = savedAt;
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/**
 * 死链一键恢复的 Wayback 链接：`web/<收录时刻或 *>/<规范化后的目标 URL>`。
 *
 * URL 规范化（去 utm/hash）与空输入保护复用 buildWaybackSnapshotUrl：
 * 目标 URL 非法时返回空串，调用方不得打开空标签页。
 */
export function buildDeadLinkWaybackUrl(href: string, savedAt?: number | Date | null): string {
  return buildWaybackSnapshotUrl(href, formatWaybackTimestamp(savedAt) ?? undefined);
}
