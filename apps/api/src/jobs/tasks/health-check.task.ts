/**
 * 可用性巡检任务（health_check）。
 *
 * 职责：
 * 1. 批量安全探测站点连通性与 HTTP 状态；
 * 2. 识别软 404 与域名停靠；
 * 3. 统计连续失败判定 broken 状态，避免抖动误杀；
 * 4. 协作式限时退出（run.shouldStop()）与顺延。
 */

import { auditPageHealth, BOT_BLOCKED_ERROR_PREFIX, classifyProbeStatus } from "@navhub/core";
import type { AppContext } from "../../context.ts";
import {
  HEALTH_FAIL_THRESHOLD,
  shouldMarkBroken,
  type JobRunHandle,
  type PatrolSelection,
} from "../../jobs.ts";

type SiteRow = Awaited<ReturnType<AppContext["repo"]["listSites"]>>[number];

/**
 * 第二层重试用的桌面浏览器请求头（U-13 分层探活）。
 *
 * 第一层用 NavHubBot UA 被 WAF/风控拦截（403/429/503）时，再发一次桌面 Chrome
 * 口径的请求：很多站只拦机器人 UA、不拦浏览器。本层只换请求头、不伪装其它
 * 身份（不带 Cookie、不登录、不绕过认证），且只对 blocked/server-error 状态
 * 重试一次；两层都被拒时记 bot-blocked verdict、不判死链（见下）。
 */
export const DESKTOP_RETRY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const DESKTOP_RETRY_HEADERS: Record<string, string> = {
  "User-Agent": DESKTOP_RETRY_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * BOT_BLOCKED 前缀与识别函数由 @navhub/core 的 probe-policy 导出（探活判定的
 * 唯一事实源）；这里再导出一次，只为兼容既有测试的导入路径。
 */
export { BOT_BLOCKED_ERROR_PREFIX, isBotBlockedHealthRecord } from "@navhub/core";

/**
 * 第一层状态码是否值得发第二层（桌面 UA）重试。
 *
 * 判定复用 probe-policy 的唯一事实源，不自造第二套分类：只有 blocked
 * （401/403/405/412/418/429，WAF/风控）与 server-error（5xx，常是
 * Cloudflare 的 503 挑战页）才重试——这两类都是“服务端活着、但这一层
 * 不让过”。dead（404/410/451）与其它 4xx 不重试：页面确定不存在或请求
 * 本身被拒，换 UA 也不会变。
 */
export function needsDesktopRetry(status: number): boolean {
  const outcome = classifyProbeStatus(status);
  return outcome?.kind === "blocked" || outcome?.kind === "server-error";
}

/**
 * 本次失败是否足以把站点标为 broken。
 *
 * 读持久计数，不再现扫 health_checks：连续失败计数已持久化在
 * `sites.consecutive_failures`（与 updateSiteHealth 的 health 写回 +
 * lastCheckedAt 同一次写入、同一事务可见；03 §3.3，W1 §13 第 2 条 verdict ①）。
 * 本函数在 updateSiteHealth 写本次结果之前调（只在本次失败时调），所以读到
 * 的是上一次巡检结束后的计数，本次失败再 +1 后与阈值比较。
 *
 * bot-blocked 行在写入时已把计数清零（打断链，见 updateSiteHealth），
 * 这里无需再扫历史识别 BOT_BLOCKED 前缀；永久 WAF 站因此永远到不了阈值，
 * 与旧实现的行为一致（2026-10-18 事故：kubernetes.io / figma.com / npmjs.com）。
 *
 * 阈值取 HEALTH_FAIL_THRESHOLD，其默认值就是 core 的
 * CONSECUTIVE_FAILURES_THRESHOLD（= 2，03 §3.3 已裁决）；环境变量
 * NAVHUB_HEALTH_FAIL_THRESHOLD 仍可临时覆盖（§11 风险 5 的回退：阈值 2→3）。
 */
export async function shouldBreak(ctx: AppContext, siteId: string): Promise<boolean> {
  try {
    const previous = await ctx.repo.getConsecutiveFailures(siteId);
    return shouldMarkBroken(false, previous, HEALTH_FAIL_THRESHOLD);
  } catch {
    // 查不到计数（新库/表缺失/列未迁移）时保守处理：不标 broken，等下一轮
    return false;
  }
}

export async function handleHealthCheck(
  ctx: AppContext,
  payload: { siteId?: string; limit?: number },
  run: JobRunHandle,
  getTargets: (limit: number) => Promise<PatrolSelection>
): Promise<void> {
  const { guardedFetch } = await import("@navhub/ai");
  const limit = payload.limit ?? 50;
  let selection: PatrolSelection;
  if (payload.siteId) {
    // 单站点巡检：不走队列，配额与基数没有意义，显式置空而不是伪造。
    const one = await ctx.repo.getSite(payload.siteId);
    selection = {
      targets: one ? [one] : [],
      quota: { backfill: 0, refresh: 0 },
      picked: { backfill: 0, refresh: 0 },
      depth: { unchecked: 0, checked: 0 },
    };
  } else {
    selection = await getTargets(limit);
  }
  const targets = selection.targets.filter((s): s is SiteRow => Boolean(s));
  let ok = 0;
  let checked = 0;
  // U-13 可观测：两层都被拦截的站数 / 第二层救回来的站数（进 job 事件 meta）。
  let botBlocked = 0;
  let desktopRescued = 0;

  /**
   * 抓取并发度（窗口大小）。
   *
   * 原实现是**串行**抓取：50 个站点 × 每次最长 fetch 超时 = 最坏数百秒，而任务预算
   * 只有 240s、单实例锁心跳 TTL 120s（见 DEFAULT_SCHEDULES / LOCK_HEARTBEAT），
   * 于是"一轮巡检跑不完"本身就成了常态（剩余顺延）。
   * 现在按窗口**并发抓取**、**落库仍串行**：
   *   - 抓取是 IO 密集，并发能近似线性缩短总时长（默认 6；NAVHUB_HEALTH_POOL 可调，钳在 1..16）；
   *   - 写必须串行：存储层是单写者（见 DbAccessGate），且 shouldBreak 要按站点读历史。
   * 协作式取消语义不变：每个窗口前后都检查 run.shouldStop()，到点后不再开新窗口。
   */
  const pool = (() => {
    const raw = Number(process.env.NAVHUB_HEALTH_POOL ?? 6);
    return Number.isFinite(raw) ? Math.min(16, Math.max(1, Math.floor(raw))) : 6;
  })();

  for (let i = 0; i < targets.length; i += pool) {
    if (run.shouldStop()) break;
    const window = targets.slice(i, i + pool);
    const fetched = await Promise.all(
      window.map(async (site) => {
        const startedAt = Date.now();
        try {
          let res = await guardedFetch(site!.url, { ...ctx.config.fetch });
          let layer1Status: number | null = null;
          let retried = false;
          let layer2Error: unknown = null;
          if (needsDesktopRetry(res.status)) {
            // 分层探活第 2 层：第一层被 WAF/风控拦下时，换桌面浏览器口径再试一次。
            // 只重试一次；第二层发不出去（超时/断连）时保留第一层结果，不把
            // “第二层没发出去”写成站点的错。
            layer1Status = res.status;
            retried = true;
            try {
              res = await guardedFetch(
                site!.url,
                { ...ctx.config.fetch },
                { headers: DESKTOP_RETRY_HEADERS },
              );
            } catch (err2) {
              layer2Error = err2;
            }
          }
          return {
            site: site!,
            res,
            error: null as unknown,
            elapsedMs: Date.now() - startedAt,
            layer1Status,
            retried,
            layer2Error,
          };
        } catch (err) {
          return {
            site: site!,
            res: null,
            error: err,
            elapsedMs: Date.now() - startedAt,
            layer1Status: null as number | null,
            retried: false,
            layer2Error: null as unknown,
          };
        }
      }),
    );

    for (const item of fetched) {
      checked++;
      const site = item.site;
      if (item.res) {
        const res = item.res;
        let healthy = res.status >= 200 && res.status < 400;
        let reason: string | null = null;

        if (healthy && res.body) {
          const audit = auditPageHealth(site.url, res.body, undefined, undefined, { truncated: res.truncated });
          if (audit.status === "SUSPICIOUS_PARKED" || audit.status === "SOFT_404") {
            healthy = false;
            reason = `伪健康识别: ${audit.reason}`;
          }
        }

        if (healthy) {
          ok++;
          if (item.retried) desktopRescued++;
        }
        const nextStatus = healthy && site.status === "broken" ? "active" : site.status;
        const outcome = healthy ? null : classifyProbeStatus(res.status);
        if (!healthy && outcome?.kind === "blocked") {
          // 两层都被 WAF/风控拦截：站点在线但拒绝巡检抓取 —— 记 verdict，不判死链。
          // ok=false 照实记（本次确实没取到内容），但 markBroken 恒为 false，且该行
          // 不计入连续失败链（shouldBreak 见到 BOT_BLOCKED 前缀即打断），永久 WAF
          // 站因此永远到不了 broken 阈值；error 带层数+状态码+复核指向，供 U-10 复核。
          botBlocked++;
          const layer2Note =
            item.layer2Error != null
              ? `第 2 层桌面 UA 未能发出请求（${item.layer2Error instanceof Error ? item.layer2Error.message : String(item.layer2Error)}）`
              : `第 2 层桌面 UA 仍 HTTP ${res.status}`;
          await ctx.repo.updateSiteHealth(site.id, {
            httpStatus: res.status,
            ok: false,
            latencyMs: item.elapsedMs,
            redirectTo: res.redirects?.at(-1) ?? null,
            error: `${BOT_BLOCKED_ERROR_PREFIX} 第 1 层 HTTP ${item.layer1Status ?? res.status}，${layer2Note}；站点在线但拒绝巡检抓取，不等于已死，需浏览器层复核`,
            currentStatus: site.status,
            markBroken: false,
          });
          continue;
        }
        if (!healthy && outcome?.kind === "server-error" && item.retried) {
          // 第二层也 5xx：服务器对桌面 UA 也在报错，与“拒绝我们”有本质区别，
          // 仍按现有口径计入连续失败；但 error 写明两层都试过，避免复核时重走一遍。
          reason = `HTTP ${res.status}：服务端暂时不可用（第 1 层 ${item.layer1Status}，第 2 层桌面 UA 仍 ${res.status}），未能确认可用性（不等于站点已死）`;
        }
        await ctx.repo.updateSiteHealth(site.id, {
          httpStatus: res.status,
          ok: healthy,
          latencyMs: item.elapsedMs,
          redirectTo: res.redirects?.at(-1) ?? null,
          error: reason,
          currentStatus: nextStatus,
          markBroken: healthy ? undefined : await shouldBreak(ctx, site.id),
        });
      } else {
        await ctx.repo.updateSiteHealth(site.id, {
          httpStatus: null,
          ok: false,
          latencyMs: item.elapsedMs,
          redirectTo: null,
          error: item.error instanceof Error ? item.error.message : String(item.error),
          currentStatus: site.status,
          markBroken: await shouldBreak(ctx, site.id),
        });
      }
    }
  }

  const deferred = targets.length - checked;
  if (deferred > 0) {
    console.warn("[navhub-job] health_check 预算到点，剩余站点顺延下一轮", {
      planned: targets.length,
      checked,
      deferred,
    });
  }

  // 覆盖面指标：补探队列排在 targets 最前面（见 JobRunner#patrolTargets），
  // 所以「实际尝试过的补探数」= min(已巡检数, 补探选中数)，不会把被 shouldStop
  // 截断的部分算成已覆盖 —— 报一个偏乐观的覆盖率比不报更糟。
  const attemptedBackfill = Math.min(checked, selection.picked.backfill);
  const uncheckedAfter = Math.max(0, selection.depth.unchecked - attemptedBackfill);
  const total = selection.depth.unchecked + selection.depth.checked;
  const coveragePct = total > 0 ? Number((((total - uncheckedAfter) / total) * 100).toFixed(2)) : 100;
  await ctx.repo
    .recordEvent("health_check", {
      meta: {
        planned: targets.length,
        checked,
        ok,
        deferred,
        // U-13 分层探活计数：两层都被拦截的站数 / 第二层救回来的站数。
        botBlocked,
        desktopRescued,
        // 名额怎么分的：quota 是计划，picked 是实际选中（队列不足时两者不同）
        quota: selection.quota,
        picked: selection.picked,
        // 整库基数与投影：未知状态是在下降还是在原地打转，看这两个数
        depthBefore: selection.depth,
        uncheckedAfter,
        coveragePct,
        projectedDaysToFullCoverage:
          attemptedBackfill > 0 ? Math.ceil(uncheckedAfter / attemptedBackfill) : null,
      },
    })
    .catch(() => {
      // 审计/遥测类写库是尽力而为：失败不阻断主操作，写失败即丢弃。
    });
}
