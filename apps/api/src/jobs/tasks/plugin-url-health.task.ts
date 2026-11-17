/**
 * 搜索包 URL 健康探活任务（plugin_url_health，P1-4 前缀引擎登录墙化）。
 *
 * 职责：每天跑一轮（DEFAULT_CRON_SCHEDULES intervalMs 86_400_000，声明
 * `DAILY`，见 apps/api/src/jobs.ts），对 5 个 search-pack 种子里的全部外部
 * 检索 URL 逐个探活一次，把结果记进事件流；有坏链时再写一条审计。
 *
 * 为什么是独立 kind、而不是并进 plugin_governance：
 *  - 探活对象不同：plugin_governance 只看库内待审/被举报（repo.getPluginGovernanceAlerts），
 *    不出网；本任务只探种子 searchUrl，出网是主业；
 *  - 节奏不同：治理每 4 小时扫一次库内状态就够了，探活每天一次即可（191 条 URL、
 *    每批 5 并发 × 单条 3.5s 上限，最坏约 2 分钟，预算 300s 绰绰有余）；
 *  - 各自的入队/手动触发/重试/超时预算互不干扰。
 *
 * 探活口径与 POST /api/plugins/check-urls 路由同一份（apps/api/src/routes/plugins/
 * p2-detail-and-tools.ts）：guardedFetch、单条超时 3500ms、只读 1KB、正文重定向
 * 最多 3 次、HTTP 200–399 判健康；`{q}` 占位符按 web-overlay 的 extractManifestUrls
 * 同款规则替换成固定测试词 `navhub`。路由是「单次最多 30 条」的人工预检入口，
 * 本任务在进程内直接探全部种子 URL，不走 HTTP、不受路由限流约束。
 *
 * P1-4b（2026-11-17）：只判 status 会漏登录墙 —— 复审员当天 curl 实测
 * libraries.io/search?q=react 200 落 /login、you.com/search?q=react 200 落
 * /signin。探活在 status 之外再看 guardedFetch 返回的终态 URL：落登录页
 * （见 PLUGIN_URL_HEALTH_LOGIN_WALL_MARKERS）即判失败。路由的单次预检
 * 仍是旧口径（不在本任务改动范围），不要把两处口径混为一谈。
 *
 * 只标记、不下架：
 *  - 坏链只进事件 meta 的 failed 清单（封顶 30 条）与审计 diff，不改任何插件
 *    状态、不删任何种子条目 —— 下架/换链是人工裁决（见 P1-4 任务规格）；
 *  - 单条失败（超时、限流、对方登录墙）不抛错、不中断整轮：失败本身就是要
 *    记录的状态，本任务只在基础设施异常（库不可写等）时抛错走任务重试。
 *
 * 间隔与配置方式：
 *  - 间隔只改一处：jobs.ts 的 DEFAULT_CRON_SCHEDULES 里本 kind 的 intervalMs，
 *    同时把 DEFAULT_SCHEDULES 里同名 cron 别名改成对应值（DAILY / X4H / HOURLY /
 *    WEEKLY 四档，upgrade-batch1「排期声明与实际间隔一致」会钉住两者一致）；
 *  - 不需要任何密钥或外部 cron：中枢自己的 JobRunner.startCronTimer 每分钟
 *    检查一次排期，到点入队；部署形态是 Docker 自托管，Vercel Cron 不适用。
 *
 * 手动触发：POST /api/jobs { "kind": "plugin_url_health", "payload": {} }
 * （scope write；开放模式下匿名身份同样可调，与其它巡检 kind 一致）。
 * 跑完后查事件流：events 表 kind='plugin_url_health' 的最新一行 meta 即本轮报告。
 */

import type { AppContext } from "../../context.ts";
import type { JobRunHandle } from "../../jobs.ts";
import { allSeedPluginDefs } from "../../seed-data/index.ts";
import type { SeedPluginDef } from "../../seed-data/types.ts";

/** 事件流里的 kind：与任务 kind 同名，方便按 kind 查最近一轮报告。 */
export const PLUGIN_URL_HEALTH_EVENT_KIND = "plugin_url_health";

/** `{q}` 占位符的固定测试词：与 web-overlay `extractManifestUrls` 一致。 */
export const PLUGIN_URL_HEALTH_PROBE_WORD = "navhub";

/** 探活并发度：与 check-urls 路由的分批并发一致。 */
export const PLUGIN_URL_HEALTH_CONCURRENCY = 5;

/** 单条探活上限：与 check-urls 路由一致（guardedFetch 超时、只读 1KB、最多 3 跳）。 */
export const PLUGIN_URL_HEALTH_TIMEOUT_MS = 3500;
export const PLUGIN_URL_HEALTH_MAX_BYTES = 1024;
export const PLUGIN_URL_HEALTH_MAX_REDIRECTS = 3;

/** 事件 meta / 审计 diff 里坏链清单的封顶条数（191 条全坏时也不把事件写爆）。 */
export const PLUGIN_URL_HEALTH_FAILED_ITEMS_CAP = 30;

/**
 * 登录墙终态 URL 标记表（P1-4b）：与 P1-4a 测试
 * `apps/api/test/search-pack-login-wall.test.ts` 里的 LOGIN_MARKERS 同一份
 * （2026-11-17 curl 实测证实的登录墙地址特征）。
 */
export const PLUGIN_URL_HEALTH_LOGIN_WALL_MARKERS = ["login", "signin", "sign-in", "pclogin", "mlogin"] as const;

/**
 * 终态 URL 是否落登录页：小写后含任一登录墙标记即判登录墙。
 * 只看终态 URL（guardedFetch 跟随重定向后的 finalUrl），不看起始 URL：
 * 起始 URL 是种子收录的检索地址，本身已由 P1-4a 静态测试钉住不含标记。
 */
export function isLoginWallFinalUrl(finalUrl: string): boolean {
  const lower = finalUrl.toLowerCase();
  return PLUGIN_URL_HEALTH_LOGIN_WALL_MARKERS.some((marker) => lower.includes(marker));
}

export interface SearchPackProbeTarget {
  packSlug: string;
  engineName: string;
  prefix?: string;
  url: string;
}

export interface PluginUrlProbeResult {
  url: string;
  ok: boolean;
  status: number;
  error?: string;
}

export type PluginUrlProbeFn = (url: string) => Promise<PluginUrlProbeResult>;

export interface PluginUrlHealthFailedItem extends PluginUrlProbeResult {
  packSlug: string;
  engineName: string;
  prefix?: string;
}

export interface PluginUrlHealthSummary {
  total: number;
  okCount: number;
  failedCount: number;
  /** 覆盖的 search-pack 种子数。 */
  packs: number;
  checkedAt: number;
  failed: PluginUrlHealthFailedItem[];
}

export interface PluginUrlHealthDeps {
  /** 探活实现：默认走 guardedFetch（与 check-urls 路由同款）；单测可注入桩。 */
  probeUrl?: PluginUrlProbeFn;
  /** 种子来源：默认全部种子插件定义；单测可注入精简清单。 */
  defs?: SeedPluginDef[];
  now?: () => number;
}

/**
 * 从种子插件定义里提取全部 search-pack 的待探活 URL。
 *
 * 只认 kind === 'search-pack' 的清单，engines[].searchUrl 逐条提取；
 * `{q}` 换成固定测试词后按最终 URL 去重（同一服务跨包共用同一 !前缀、
 * 同前缀只许指向同一检索 URL，跨包重复是常态，去重后第一个归属为准）。
 * 结构不合规的条目直接跳过（种子是另一个 worker 的活，这里不校验种子、
 * 不抛错）；空字符串不进清单，格式非法的 URL 留给探活层按路由同款口径报错。
 */
export function collectSearchPackUrls(
  defs: SeedPluginDef[] = allSeedPluginDefs,
): SearchPackProbeTarget[] {
  const seen = new Set<string>();
  const targets: SearchPackProbeTarget[] = [];
  for (const def of defs) {
    const manifest = def.manifest as {
      kind?: unknown;
      payload?: { engines?: unknown };
    } | null;
    if (!manifest || manifest.kind !== "search-pack") continue;
    const engines = manifest.payload?.engines;
    if (!Array.isArray(engines)) continue;
    for (const engine of engines) {
      const entry = (engine ?? {}) as { name?: unknown; prefix?: unknown; searchUrl?: unknown };
      if (typeof entry.searchUrl !== "string" || entry.searchUrl.trim() === "") continue;
      const url = entry.searchUrl.replace(/\{q\}/g, PLUGIN_URL_HEALTH_PROBE_WORD);
      if (seen.has(url)) continue;
      seen.add(url);
      targets.push({
        packSlug: def.slug,
        engineName: typeof entry.name === "string" ? entry.name : "",
        ...(typeof entry.prefix === "string" && entry.prefix !== "" ? { prefix: entry.prefix } : {}),
        url,
      });
    }
  }
  return targets;
}

/**
 * 默认探活：与 POST /api/plugins/check-urls 路由逐字同款的单条判定，
 * 再加 P1-4b 登录墙检测：status 200–399 但终态 URL 落登录页仍判失败
 * （登录墙恰恰回 200，不看 finalUrl 就会把坏链记成健康）。
 *
 * 动态 import @navhub/ai（与 health-check.task.ts 同款写法）：任务模块只在
 * Node 侧跑，避免把这条链拉进 Edge 编译。
 */
export async function defaultProbeUrl(url: string): Promise<PluginUrlProbeResult> {
  const { guardedFetch } = await import("@navhub/ai");
  const urlStr = url.trim();
  if (!urlStr) {
    return { url: urlStr, ok: false, status: 0, error: "URL 为空" };
  }
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { url: urlStr, ok: false, status: 0, error: "仅支持 HTTP(S) 协议" };
    }
  } catch {
    return { url: urlStr, ok: false, status: 0, error: "URL 格式不合法" };
  }
  try {
    const res = await guardedFetch(urlStr, {
      timeoutMs: PLUGIN_URL_HEALTH_TIMEOUT_MS,
      maxBytes: PLUGIN_URL_HEALTH_MAX_BYTES,
      maxRedirects: PLUGIN_URL_HEALTH_MAX_REDIRECTS,
    });
    const loginWall = isLoginWallFinalUrl(res.finalUrl);
    const ok = res.status >= 200 && res.status < 400 && !loginWall;
    return {
      url: urlStr,
      ok,
      status: res.status,
      error: ok ? undefined : loginWall ? `落登录页：${res.finalUrl}` : `HTTP ${res.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url: urlStr, ok: false, status: 0, error: message };
  }
}

export async function handlePluginUrlHealth(
  ctx: AppContext,
  run: JobRunHandle,
  deps: PluginUrlHealthDeps = {},
): Promise<PluginUrlHealthSummary> {
  const checkedAt = (deps.now ?? Date.now)();
  const probeUrl = deps.probeUrl ?? defaultProbeUrl;
  const targets = collectSearchPackUrls(deps.defs);
  const packSlugs = new Set(targets.map((t) => t.packSlug));

  const results: PluginUrlProbeResult[] = [];
  for (let i = 0; i < targets.length; i += PLUGIN_URL_HEALTH_CONCURRENCY) {
    // 协作式取消：预算到点后不再开新窗口（与 health_check 同款语义）。
    if (run.shouldStop()) break;
    const window = targets.slice(i, i + PLUGIN_URL_HEALTH_CONCURRENCY);
    // 单条探活抛错也只记该条失败，不掀翻整批（与 check-urls 路由逐条 try/catch 同款）。
    results.push(
      ...(await Promise.all(
        window.map(async (t) => {
          try {
            return await probeUrl(t.url);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { url: t.url, ok: false, status: 0, error: message } as PluginUrlProbeResult;
          }
        }),
      )),
    );
  }

  const byUrl = new Map(results.map((r) => [r.url, r]));
  const failed: PluginUrlHealthFailedItem[] = [];
  for (const target of targets) {
    const result = byUrl.get(target.url);
    // 被 shouldStop 截断、没探到的条目不算失败：下一轮会重新排期覆盖。
    if (!result || result.ok) continue;
    failed.push({ ...result, packSlug: target.packSlug, engineName: target.engineName, ...(target.prefix ? { prefix: target.prefix } : {}) });
  }
  const summary: PluginUrlHealthSummary = {
    total: targets.length,
    // ok = 实际探到且健康的条数；被 shouldStop 截断未探的既不计 ok 也不计 failed，下一轮重排。
    okCount: results.filter((r) => r.ok).length,
    failedCount: failed.length,
    packs: packSlugs.size,
    checkedAt,
    failed: failed.slice(0, PLUGIN_URL_HEALTH_FAILED_ITEMS_CAP),
  };

  // 留痕（尽力而为：写失败不阻断主流程，与 health_check 的 recordEvent 口径一致）。
  await ctx.repo
    .recordEvent(PLUGIN_URL_HEALTH_EVENT_KIND, {
      meta: {
        total: summary.total,
        okCount: summary.okCount,
        failedCount: summary.failedCount,
        packs: summary.packs,
        checkedAt: summary.checkedAt,
        failed: summary.failed,
      },
    })
    .catch(() => {
      // 审计/遥测类写库失败即丢弃。
    });

  if (failed.length > 0) {
    // 只标记、不下架：坏链进审计由人工裁决换链或下架（与 plugin_governance
    // 「只写审计与日志，不自动下架/隐藏」同一口径）。
    await ctx.repo
      .audit({
        actor: "system",
        actorKind: "system",
        action: "plugin.url_health.failed",
        target: PLUGIN_URL_HEALTH_EVENT_KIND,
        diff: {
          total: summary.total,
          okCount: summary.okCount,
          failedCount: summary.failedCount,
          failed: summary.failed,
        },
      })
      .catch(() => {
        // 尽力而为。
      });
    console.warn(
      `[navhub-job] plugin_url_health: ${failed.length}/${summary.total} 条搜索包 URL 探活失败（只标记，未下架）`,
      failed.slice(0, PLUGIN_URL_HEALTH_FAILED_ITEMS_CAP).map((f) => `${f.packSlug}/${f.engineName}: ${f.url} -> ${f.error ?? `HTTP ${f.status}`}`),
    );
  }

  return summary;
}
