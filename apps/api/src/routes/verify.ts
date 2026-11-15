/**
 * 刷新验证（POST /api/sites/:id/verify + GET /api/sites/:id/verify，Batch 4 Phase 2 P2-1）。
 *
 * 只对调用者本人收藏里的站点生效：身份口径抄 /api/compare（requireAskIdentity +
 * askIdentityOf，匿名 401）；非本人收藏（不存在、他人收藏、pending/archived 指向）
 * → 通用 404，同码同 body，不点名 id。
 *
 * 点一次只发一次站点探活请求，不扇出：
 *   - robots.txt 合规检查是同源的一次轻量读取（结果按 origin 内存缓存 1 小时，
 *     重复点击不再重读），它不是站点探活；站点本身每次刷新只发一个 guardedFetch。
 *   - robots.txt 明确禁抓 → 不发站点请求，直接回 robots_disallowed，前端据此置灰按钮
 *     并把该站记进本机记忆（localStorage），下次打开对照表直接就是灰的。
 *
 * 走后台任务，不阻塞请求：POST 只做身份/归属/robots/预算检查，通过后返回 202
 * `{ status: "pending" }`，探活在后台跑；前端轮询 GET /api/sites/:id/verify
 * 等状态翻成 done 后再重拉 /api/compare 回填格子。
 *
 * 探活复用现有管线，不自造判定：
 *   - guardedFetch（@navhub/ai，逐跳 SSRF 校验）+ candidate profile（单条 2.5 秒、
 *     8KB、最多 3 跳，不伪装浏览器 UA）；
 *   - 整批预算 6 秒：AbortSignal 到点即断，超时按「没测准」处理；
 *   - OutboundBudget（进程级并发 + 窗口用量）：拿不到额度直接 429，不排队；
 *   - probe-cache（@navhub/core）：结论 TTL 按种类分档（健康 7 天、死链 12 小时、
 *     未验证 1 小时），新鲜缓存直接复用结论、不发请求，过期缓存带条件头重测。
 *
 * 探活与 robots 判定已抽成共享模块 `../site-probe.ts`（Batch 4 Phase 2
 * P2-2 第 0 步）：本文件只保留路由、后台任务与写库口径，P2-2 的官方
 * 定价页抓取复用同一管线（同一抓取口径、同一 robots 合规、同一 probe-cache）。
 *
 * 写库口径（绝不写假值）：
 *   - ok（2xx/3xx）与 dead（404/410/451，页面确定不存在）才调 updateSiteHealth，
 *     更新 last_checked_at 与 http_status / latency_ms / redirect_to；
 *     markBroken 恒为 false——单次手动验证绝不把站点标 broken，不写“已停更”。
 *   - blocked（403 等 WAF 拦截）/ unverified（超时、连接失败、其余 4xx）/
 *     server-error（5xx）一律不写 sites 健康字段，只进 probe-cache；
 *     对照表 maintenance 格因此仍显示旧值或“未验证”，绝不凭一次失败写“不可达”。
 *   - robots 禁抓不写任何健康字段。
 *   - 缓存命中（fromCache）不写：本次根本没发请求，latencyMs 0 不是实测值、
 *     此刻也不是真实核实时间；跳过 updateSiteHealth，sites 健康字段与
 *     health_checks 历史都保留上次真实探活的值（评审 NIT 1）。
 *
 * 在途去重（评审 NIT 11）：同身份+同站已有 pending 任务时，第二次 POST 直接
 * 202 复用——不重新查 robots、不占出站预算、不新起后台任务、不新发探活请求。
 * 前端守卫只覆盖单标签页；两标签页/直接 API 连点靠这里兜底。
 *
 * MCP 不新增工具：刷新是写操作，对照层保持只读。
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { sendError } from "../error-envelope.ts";
import { OutboundBudget } from "../outbound-budget.ts";
import { requireAskIdentity } from "./ask.ts";
import {
  checkRobotsAllowed,
  probeWithCandidateProfile,
  resetSiteProbeRobotsCacheForTests,
  setSiteProbeRobotsCheckForTests,
  SITE_PROBE_ROBOTS_CACHE_TTL_MS,
  SITE_PROBE_TIMEOUT_MS,
  type SiteProbeResult,
} from "../site-probe.ts";

/** 单条探活硬超时（毫秒）：candidate profile 的 2.5 秒（见 site-probe.ts）。 */
export const VERIFY_SINGLE_TIMEOUT_MS = SITE_PROBE_TIMEOUT_MS;
/** 整批预算（毫秒）：一次刷新只探一个站，6 秒是本次探活的绝对截止点。 */
export const VERIFY_BATCH_BUDGET_MS = 6000;
/** robots.txt 判定按 origin 的内存缓存时长（毫秒，见 site-probe.ts）。 */
export const VERIFY_ROBOTS_CACHE_TTL_MS = SITE_PROBE_ROBOTS_CACHE_TTL_MS;

// 共享模块的类型与纯函数经由本文件再导出：verify-api.test.ts 沿用原导入路径。
export { isRobotsDisallowed, robotsUrlFor } from "../site-probe.ts";
export type { SiteProbeResult as VerifyProbeResult } from "../site-probe.ts";

/** 出站预算：与插件体检同口径（并发 2、每分钟 600 次），拿不到额度直接 429。 */
export const verifyOutboundBudget = new OutboundBudget({
  maxConcurrent: 2,
  maxPerWindow: 600,
  windowMs: 60_000,
});

const VERIFY_VARY = ["x-navhub-anon-id", "x-user-id", "x-navhub-user-id", "authorization", "cookie"];

export type VerifyOutcomeKind = SiteProbeResult["kind"];
export type VerifyStatus = "idle" | "pending" | "done" | "robots_disallowed";

export interface VerifyJobState {
  siteId: string;
  status: VerifyStatus;
  /** 本次探活结论（pending 时为 null）。 */
  outcome: SiteProbeResult | null;
  /** 本次探活结束时间（毫秒戳；pending/idle 时为 null）。 */
  finishedAt: number | null;
  /** 本次探活开始前站点的 last_checked_at（供前端判断格子是否已回填）。 */
  previousLastCheckedAt: number | null;
}

type VerifyProbeFn = (
  url: string,
  signal: AbortSignal,
) => Promise<SiteProbeResult>;
type RobotsCheckFn = (url: string) => Promise<boolean>;

let probeOverride: VerifyProbeFn | null = null;

/** 仅测试用：注入假探活（绕过真实出站），传 null 恢复默认实现。 */
export function setVerifyProbeForTests(fn: VerifyProbeFn | null): void {
  probeOverride = fn;
}

/**
 * 仅测试用：注入假 robots 判定（true = 禁抓），传 null 恢复默认实现。
 * 直接委托给共享模块的注入点——P2-2 抓取与本路由共用同一判定。
 */
export function setVerifyRobotsCheckForTests(fn: RobotsCheckFn | null): void {
  setSiteProbeRobotsCheckForTests(fn);
}

/** 仅测试用：清空 robots 内存缓存（委托给共享模块）。 */
export function resetVerifyRobotsCacheForTests(): void {
  resetSiteProbeRobotsCacheForTests();
}

const pendingJobs = new Set<Promise<void>>();
const jobStates = new Map<string, VerifyJobState>();

/** 仅测试用：等全部后台验证任务跑完（POST 只返回 202，测试靠它定序）。 */
export async function awaitPendingVerifyJobs(): Promise<void> {
  while (pendingJobs.size > 0) {
    await Promise.all([...pendingJobs]);
  }
}

function jobKey(identity: string, siteId: string): string {
  return identity + "\n" + siteId;
}

/* ------------------------------ 路由 ------------------------------ */

const NOT_FOUND_MESSAGE = "该站点不在你的收藏里，或已不在可验证状态。";

export const verifyRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 本人收藏判定（抄 /api/compare 的取数与统一判定）。
   * 只返回判定结果，不直接发响应——错误包络必须由 handler `return sendError(...)`
   * 发出；helper 里先 send 再让 handler 返回 undefined 会被 Fastify 以空体覆盖。
   */
  async function loadOwnSite(
    req: FastifyRequest,
    reply: FastifyReply,
    siteId: string,
  ): Promise<
    | {
        ok: true;
        identity: string;
        site: { id: string; url: string; status: string; health?: { lastCheckedAt?: number | null } };
      }
    | { ok: false; status: number; code: string; message: string }
  > {
    const identity = await requireAskIdentity(ctx, req, reply);
    if (!identity) {
      return { ok: false, status: 401, code: "UNAUTHORIZED", message: "刷新验证只对登录用户开放，请先登录后再试。" };
    }
    // 一次 listFavorites + 一次 getSitesByIds，内存求交后统一判定（抄 /api/compare），
    // 不逐 id 查库、不点名是哪个 id，避免存在性泄漏。
    const favorites = await ctx.repo.listFavorites(identity);
    const favBySite = new Map(favorites.map((f) => [f.siteId, f]));
    const sites = await ctx.repo.getSitesByIds([siteId]);
    const site = sites.get(siteId);
    if (!favBySite.get(siteId) || !site || site.status === "pending" || site.status === "archived") {
      return { ok: false, status: 404, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    }
    return { ok: true, identity, site };
  }

  app.post(
    "/api/sites/:id/verify",
    {
      config: {
        scope: "public",
        rateLimit: { max: 20, timeWindow: "1 minute" },
        cache: { maxAge: 0 },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const siteId = typeof id === "string" ? id.trim() : "";
      if (!siteId) {
        return sendError(reply, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      const loaded = await loadOwnSite(req, reply, siteId);
      if (!loaded.ok) {
        return sendError(reply, loaded.status, loaded.code, loaded.message);
      }
      const { identity, site } = loaded;

      const key = jobKey(identity, siteId);
      // 在途去重（评审 NIT 11）：同身份+同站已有 pending 任务时直接 202 复用——
      // 不重新查 robots、不占出站预算、不新起后台任务、不新发探活请求。
      // 放在 robots/预算检查之前：复用本身是零成本的，不该再为它花任何资源。
      const existing = jobStates.get(key);
      if (existing?.status === "pending") {
        reply.code(202);
        return {
          ok: true,
          siteId,
          status: "pending",
          robots_disallowed: false,
          message: "正在后台验证，稍后会回填最新结果。",
          lastCheckedAt: existing.previousLastCheckedAt ?? null,
        };
      }

      // robots.txt 合规检查在请求内同步做：禁抓就不发站点请求、不占预算、
      // 不启动后台任务，直接把置灰原因带回给前端。
      // robots.txt 合规检查走共享模块（注入点与 P2-2 抓取共用）。
      const robotsDisallowed = await checkRobotsAllowed(site.url);
      if (robotsDisallowed) {
        const key = jobKey(identity, siteId);
        jobStates.set(key, {
          siteId,
          status: "robots_disallowed",
          outcome: {
            kind: "unverified",
            latencyMs: 0,
            redirectTo: null,
            reason: "该站点的 robots.txt 禁止抓取，本站不做探活。",
            robotsDisallowed: true,
          },
          finishedAt: Date.now(),
          previousLastCheckedAt: site.health?.lastCheckedAt ?? null,
        });
        return {
          ok: true,
          siteId,
          status: "robots_disallowed",
          robots_disallowed: true,
          message: "该站点的 robots.txt 禁止抓取，刷新验证已置灰。",
          lastCheckedAt: site.health?.lastCheckedAt ?? null,
        };
      }

      // 出站预算：拿不到额度直接 429，不排队（排队会把压力转成进程内存）。
      if (!verifyOutboundBudget.tryAcquire(1)) {
        return sendError(reply, 429, "RATE_LIMITED", "出站验证预算已耗尽，请稍后再试。");
      }

      const previousLastCheckedAt = site.health?.lastCheckedAt ?? null;
      jobStates.set(key, {
        siteId,
        status: "pending",
        outcome: null,
        finishedAt: null,
        previousLastCheckedAt,
      });

      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), VERIFY_BATCH_BUDGET_MS);
      deadline.unref?.();

      const job = (async () => {
        try {
          const probe = probeOverride ?? probeWithCandidateProfile;
          const result = await probe(site.url, controller.signal);
          if (result.robotsDisallowed) {
            jobStates.set(key, {
              siteId,
              status: "robots_disallowed",
              outcome: result,
              finishedAt: Date.now(),
              previousLastCheckedAt,
            });
            return;
          }
          // 只有 ok 与 dead 才写 sites 健康字段；blocked / unverified /
          // server-error 只进 probe-cache（探活函数内已记），不写脏数据。
          // 缓存命中（fromCache）也不写：本次没发请求，latencyMs 0 与此刻
          // 时间戳都是假值，写了会把维护格的核实日期推成今天、并往
          // health_checks 里插一条未真实发生的成功行（评审 NIT 1）。
          if ((result.kind === "ok" || result.kind === "dead") && !result.fromCache) {
            await ctx.repo.updateSiteHealth(siteId, {
              httpStatus: result.status ?? null,
              ok: result.kind === "ok",
              latencyMs: result.latencyMs,
              redirectTo: result.redirectTo ?? null,
              error: result.kind === "dead" ? result.reason : null,
              currentStatus: site.status,
              markBroken: false,
            });
          }
          jobStates.set(key, {
            siteId,
            status: "done",
            outcome: result,
            finishedAt: Date.now(),
            previousLastCheckedAt,
          });
        } catch (err) {
          // 后台任务绝不把异常抛回请求：记一条日志状态，前端轮询到 done
          // 的 unverified 结论，而不是挂起。
          jobStates.set(key, {
            siteId,
            status: "done",
            outcome: {
              kind: "unverified",
              latencyMs: 0,
              redirectTo: null,
              reason: err instanceof Error ? "验证任务异常，未能确认可用性。" : "验证任务异常，未能确认可用性。",
            },
            finishedAt: Date.now(),
            previousLastCheckedAt,
          });
        } finally {
          clearTimeout(deadline);
          verifyOutboundBudget.release();
        }
      })();
      pendingJobs.add(job);
      void job.finally(() => {
        pendingJobs.delete(job);
      });

      reply.code(202);
      return {
        ok: true,
        siteId,
        status: "pending",
        robots_disallowed: false,
        message: "正在后台验证，稍后会回填最新结果。",
        lastCheckedAt: previousLastCheckedAt,
      };
    },
  );

  app.get(
    "/api/sites/:id/verify",
    {
      config: {
        scope: "public",
        rateLimit: { max: 120, timeWindow: "1 minute" },
        cache: { maxAge: 0, vary: VERIFY_VARY },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const siteId = typeof id === "string" ? id.trim() : "";
      if (!siteId) {
        return sendError(reply, 404, "NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      const loaded = await loadOwnSite(req, reply, siteId);
      if (!loaded.ok) {
        return sendError(reply, loaded.status, loaded.code, loaded.message);
      }
      const { identity, site } = loaded;
      const state = jobStates.get(jobKey(identity, siteId));
      return {
        ok: true,
        siteId,
        status: state?.status ?? "idle",
        outcome: state?.outcome ?? null,
        robots_disallowed: state?.outcome?.robotsDisallowed === true || state?.status === "robots_disallowed",
        finishedAt: state?.finishedAt ?? null,
        lastCheckedAt: site.health?.lastCheckedAt ?? null,
        previousLastCheckedAt: state?.previousLastCheckedAt ?? null,
      };
    },
  );
};
