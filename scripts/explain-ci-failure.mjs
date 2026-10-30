#!/usr/bin/env node
/**
 * CI 红灯归因表：把一次 workflow run 的失败 job 逐条拆成
 * 「job / 失败步骤 / 归因层 / 归因头 / 信号」。
 *
 * 为什么不改 workflow：红灯的解释不该依赖某一步加了什么 echo——
 * 归因信息本来就在 Actions 的 API 里（job 元数据 + annotations + 日志）。
 * 本脚本只读这些接口，所以历史上任何一次失败都能事后复盘，不需要复跑。
 *
 * 凭据：优先 GITHUB_TOKEN / GH_TOKEN；否则用 git credential fill 取（只放入
 * 请求头，绝不打印、绝不写日志）。公开仓库没有凭据也能跑，只是受速率限制。
 *
 * 用法：
 *   node scripts/explain-ci-failure.mjs                     # 最近一次 main 的推送运行
 *   node scripts/explain-ci-failure.mjs --sha <sha>
 *   node scripts/explain-ci-failure.mjs --run 40489576417
 *   node scripts/explain-ci-failure.mjs --run 40489576417 --json
 *   node scripts/explain-ci-failure.mjs --sha <sha> --baseline <上一 tip 的 sha 或 run id>
 *     基线对比输出「新增红 / 同 job 换因 / 仍在红 / 已修复」——多会话并行时，能让「这条红是不是我造成的」
 *     不必靠人肉翻两次 run。
 *   node scripts/explain-ci-failure.mjs --sha <sha> --wait [--timeout 秒] [--interval 秒]
 *     推送后立刻调用时 run 往往还没跑完：等待终局再算四桶，而不是把「还没跑到」
 *     误报成「已修复」。默认每 20s 轮询、最多等 30 分钟；超时以退出码 3 收尾，
 *     并明确标注结果是超时快照。
 *   node scripts/explain-ci-failure.mjs --sha <sha> --save [路径]
 *     把与 --json 同形的快照落盘（默认 tmp/ci-explain-<run>-<sha12>-<时间戳>.json）。
 *     多会话并行时，事后复盘不依赖 Actions 保留期：日志会在 90 天后过期。
 *   node scripts/explain-ci-failure.mjs --defused [--run <id> | --sha <sha>] [--json]
 *     逐作业读日志里的「撤防账」：N 道门禁跑过 / M 道没跑成 + 是谁挡的。
 *     这条走的是**全部**作业而不是失败作业 —— 撤防账在绿色作业里同样有话要说
 *     （作业结论只说明「没新增红」，那行账才说明「门禁真的判过」），
 *     而跨机器只有日志读得到：`/jobs/{id}/summary` 要 actions:read，
 *     annotations 那一轮 13 个作业全返回 0 条（2026-10-30 run 41010267114 直证）。
 *     退出码：0 = 每个**本该有账**的作业都读到且没有撤防；1 = 有撤防，或本该有账的作业读不到
 *     （读不到 = 「没接线」与「跑过且全绿」又同形了，那正是要显式记账的东西）。
 *     「本该有账」由本地 .github/workflows/ci.yml 现推：作业块里有 `id: defused-gates`
 *     那一步才算。接线外的作业（整作业按 `if:` 跳过、汇总作业没有门禁步骤）单列一档、
 *     不参与判红——否则 run 41024897432 那种 13 作业里 2 个结构性无账的形状，
 *     会让 0 在任何 push 轮都不可达。ci.yml 读不到时全部按缺账保守记（宁可多报）。
 *   每条失败行都带 fixHint（按归因层给出的一条可执行修复命令）；文本模式另有
 *   「修复入口」段按层去重。JSON 里 failures[].fixHint 与 diff 四桶同形。
 *
 * 抗抖：本脚本跑在推送后的无人值守链路上，一次瞬断不该让整轮归因凭空消失。
 *   - 传输层瞬断（含 undici 的 terminated）重试 3 次；429/5xx/408 另按状态码重试，
 *     带 Retry-After（上限 20s）。
 *   - --wait 期间单次轮询失败只计数（wait.pollErrors），继续等到预算用尽。
 *   - 某个 job 的日志/注解取不到 → 该行标 partial + partialReason，其余 job 照常归因。
 *   - 连失败 job 清单都取不到 → 落「部分快照」：attribution.partial 记失败环节与原因，
 *     有 --save 就照常写盘，有 --json 就照常输出（绝不给空 stdout），跨轮对比整段省略
 *     ——本轮没证据时把「基线有、本轮没有」说成「已修复」是最坏的假绿灯。
 * 退出码：0 = 没有失败 job，1 = 有失败 job，2 = 查询/鉴权失败（含归因不完整），
 *         3 = 等待超时（run 仍未结束）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffFailures,
  isFailedJob,
  layerCounts,
  parseRepoSlug,
  renderAttributionTable,
  renderBaselineDiff,
  renderFixHints,
  splitSuperseded,
  summarizeJob,
  waitForRunConclusion,
} from "./lib/ci-attribution.mjs";
import {
  defusedWiring,
  matchDefusedWiring,
  parseDefusedTrace,
  renderDefusedTable,
} from "./lib/ci-defused.mjs";

const API = "https://api.github.com";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_FILE = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const MAX_LOG_BYTES = 8 * 1024 * 1024;

/**
 * 接线期望的来源就是这份工作流本身（不是另一份人手抄的名单）。
 * 读不到就返回空串 ⇒ 全部按「缺账」保守记账，不会因为拿不到期望就把作业说成结构性无账。
 */
function readWorkflowSource() {
  try {
    return existsSync(WORKFLOW_FILE) ? readFileSync(WORKFLOW_FILE, "utf8") : "";
  } catch {
    return "";
  }
}
/**
 * 只对传输层失败重试：DNS/TLS 瞬断是常态（本仓库一次会话里遇到三次），HTTP 4xx 不重试。
 * undici 的瞬断报错文案是 `terminated`（对端提前关连接）——真实 run #40609230621 里
 * 它让 --baseline 整段被跳过，而 HTTP 响应本身完全正常。
 */
const RETRYABLE_NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|terminated|UND_ERR_SOCKET/i;

/**
 * 传输层之外还要看状态码：429（中枢速率限制，按 IP 计）与 5xx / 408 是间歇性的，
 * 再试一次通常就有正文；403/404 这类 4xx 是语义结果，重试只会拖慢并掩盖真实原因。
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const STATUS_ATTEMPTS = 3;
/** 退避上限：无人值守脚本不该因为一个 429 的 Retry-After 写很大就卡住半小时 */
const MAX_BACKOFF_MS = 20_000;

const messageOf = (error) => (error instanceof Error ? error.message : String(error));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Retry-After 只认「秒数」写法；HTTP-date 与缺省一律回落到默认退避（不猜） */
function retryAfterMs(res) {
  const raw = res.headers?.get?.("retry-after");
  const sec = Number(raw);
  return Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, MAX_BACKOFF_MS) : null;
}

/** 丢弃响应体只为归还连接；读不动也不该影响重试本身 */
async function discardBody(res) {
  try {
    if (res.body?.cancel) await res.body.cancel();
    else await res.text();
  } catch {
    // 连接已经断了：下一次请求自己会重建
  }
}

export async function fetchWithRetry(url, init, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      const message = messageOf(error);
      // 非传输层错误（参数写错、代码里真正的 bug）原样抛出，不套重试文案
      if (!RETRYABLE_NETWORK.test(message)) throw error;
      if (attempt >= attempts) {
        // 把「试了几次」写进文案：只说 terminated 无法区分「一次都没连上」和
        // 「重试预算用光」，而后者才是要不要重跑这一轮的依据。
        throw new Error(message + "（传输层重试 " + attempt + " 次仍失败）", { cause: error });
      }
      await sleep(500 * attempt);
    }
  }
}

/**
 * 一次「会自己重试的读」：返回 Response 和真正发出的状态层尝试次数，
 * 交给调用方决定失败文案（不在这里抛，让 api 和日志接口各自保留自己的语义）。
 */
export async function fetchResilient(url, init, { attempts = STATUS_ATTEMPTS, sleepFn = sleep } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchWithRetry(url, init);
    if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt >= attempts) return { res, attempts: attempt };
    await discardBody(res);
    await sleepFn(retryAfterMs(res) ?? 500 * attempt);
  }
}

function argValue(argv, name, fallback = null) {
  const idx = argv.indexOf(name);
  if (idx === -1) return fallback;
  const value = argv[idx + 1];
  return typeof value === "string" && !value.startsWith("--") ? value : fallback;
}

/** 秒级参数：非法 / 非正数回退默认值——无人值守脚本不该因手滑参数直接崩 */
function secondsArg(argv, name, fallbackSec) {
  const n = Number(argValue(argv, name));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : fallbackSec * 1000;
}

/**
 * 推送后立刻解析 run 会撞上「workflow 还没创建」：只在等待模式下重试，
 * 且反复等到同一个总预算用完，不把「刚推完」当成查询失败。
 *
 * 等待模式下传输层瞬断也要接着等：一次 30 分钟的等待不该在第 25 分钟
 * 因为一条断掉的连接整轮作废——那等于让人重新推一次才拿到归因。
 */
async function resolveRunWhenWait(client, opts, { shouldWait, deadline, intervalMs, sleepFn = sleep }) {
  for (;;) {
    try {
      return await resolveRun(client, opts);
    } catch (error) {
      const message = messageOf(error);
      const transient = message.includes("找不到匹配的运行") || RETRYABLE_NETWORK.test(message);
      if (!shouldWait || !transient || Date.now() >= deadline) throw error;
      await sleepFn(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
  }
}

/** 从 git 凭据助手取 token；任何失败都返回 null（降级为匿名请求） */
function credentialToken() {
  try {
    const out = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 10_000,
    });
    const match = out.match(/^password=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function resolveRepo(explicit) {
  if (explicit) return explicit;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const slug = parseRepoSlug(remote);
    if (slug) return slug;
  } catch {
    // 不在 git 仓库里：交给调用方 --repo
  }
  return "";
}

function createClient(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "navhub-ci-attribution",
  };
  if (token) headers.Authorization = "Bearer " + token;

  async function api(path) {
    const { res, attempts } = await fetchResilient(API + path, { headers });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.message ?? "";
      } catch {
        detail = "";
      }
      // 状态码重试过就自报次数：429 打满 3 次和 404 一次命中，对调用方是两个不同的结论
      const retried = attempts > 1 ? "（状态层重试 " + attempts + " 次）" : "";
      throw new Error("GitHub API " + res.status + " " + path + retried + (detail ? "：" + detail : ""));
    }
    return res.json();
  }

  /**
   * 日志接口 302 到签名 URL：跳转后的 URL 不能再带 Authorization。
   * 读正文本身也可能被截断（undici 在流中途抛 terminated），这里不吞——
   * 由 collectAttribution 把这一条 job 标成证据不全，其余 job 照常归因。
   */
  async function fetchJobLog(repo, jobId) {
    const { res: first } = await fetchResilient(API + `/repos/${repo}/actions/jobs/${jobId}/logs`, {
      headers,
      redirect: "manual",
    });
    if (first.status === 200) return (await first.text()).slice(0, MAX_LOG_BYTES);
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get("location");
      if (!location) return "";
      const { res: signed } = await fetchResilient(location, { redirect: "follow" });
      if (!signed.ok) return "";
      return (await signed.text()).slice(0, MAX_LOG_BYTES);
    }
    return "";
  }

  return { api, fetchJobLog };
}

/** `head_sha` 只认完整提交号：短号先在本仓库解析，解析不了按原样传（让 API 去报错） */
function resolveCommitSha(sha) {
  if (!sha || /^[0-9a-f]{40}$/i.test(sha)) return sha;
  try {
    return execFileSync("git", ["rev-parse", "--verify", sha + "^{commit}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || sha;
  } catch {
    return sha;
  }
}

async function resolveRun(client, { repo, runId, sha, branch }) {
  if (runId) return client.api(`/repos/${repo}/actions/runs/${runId}`);
  const query = sha
    ? `head_sha=${encodeURIComponent(resolveCommitSha(sha))}`
    : `branch=${encodeURIComponent(branch)}&event=push`;
  const data = await client.api(`/repos/${repo}/actions/runs?${query}&per_page=1`);
  const run = data?.workflow_runs?.[0];
  if (!run) throw new Error("找不到匹配的运行（" + (sha || branch) + "）");
  return run;
}

/** job 的 check-run 注解（工具主动标注的错误，含文件/行号）；失败要把原因带回调用方 */
async function fetchAnnotations(client, repo, job) {
  const url = typeof job?.check_run_url === "string" ? job.check_run_url : "";
  const id = url.match(/\/check-runs\/(\d+)$/)?.[1];
  if (!id) return { annotations: [], error: "" };
  // 没有 check-run id 不是失败：按空注解继续，归因照样能从日志里算出来
  try {
    const list = await client.api(`/repos/${repo}/check-runs/${id}/annotations?per_page=50`);
    return { annotations: Array.isArray(list) ? list : [], error: "" };
  } catch (error) {
    return { annotations: [], error: messageOf(error) };
  }
}

/**
 * 逐 job 收集证据。两条铁律：
 *   1. 一个 job 的日志/注解取不到，不许拖垮整轮——其余 job 的归因同样有价值；
 *      取不到的那条标 partial，并带上原因，绝不用空正文冒充「这一步没报错」。
 *   2. jobs 清单本身取不到要往上抛：那是「整轮没有结论」，调用方必须落成部分快照，
 *      而不是打印「没有失败的 job」。
 */
export async function collectAttribution(client, repo, run) {
  const jobsData = await client.api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`);
  const jobs = (jobsData?.jobs ?? []).filter(isFailedJob);
  const rows = [];
  for (const job of jobs) {
    const [logResult, annoResult] = await Promise.all([
      client.fetchJobLog(repo, job.id).then(
        (logText) => ({ logText, error: "" }),
        (error) => ({ logText: "", error: messageOf(error) }),
      ),
      fetchAnnotations(client, repo, job),
    ]);
    const reasons = [];
    if (logResult.error) reasons.push("日志：" + logResult.error);
    if (annoResult.error) reasons.push("注解：" + annoResult.error);
    const row = summarizeJob(job, { logText: logResult.logText, annotations: annoResult.annotations });
    if (reasons.length > 0) {
      row.partial = true;
      row.partialReason = reasons.join("；");
    }
    rows.push(row);
  }
  return { rows, degraded: rows.filter((row) => row.partial).map((row) => row.name) };
}

/**
 * 撤防账视角：逐**全部**作业读日志里那一行账（判据与解读在 lib/ci-defused.mjs）。
 *
 * 与 collectAttribution 的差别只有两处，且都是刻意的：
 *   1. 不过滤 `isFailedJob` —— 绿色作业的账才是这里要看的东西；
 *   2. 不取注解 —— 那一轮 13 个作业的 annotations 返回 0 条，日志才有正文。
 * 单个作业日志取不到不拖垮整轮：该行标 error，其余照常出账。
 *
 * `wiring` 是「这个作业本该有账吗」的期望（由 ci.yml 现推，见 lib 的 defusedWiring）：
 * 读不到账的作业里，只有**期望有账**的那些算发现；`wired: false` 的那些是接线范围之外
 * （整作业按 `if:` 跳过、或汇总作业根本没有门禁步骤），把它们算进退出码就等于
 * 宣布 rc=0 永远达不到。`wiring` 为空（本地读不到 ci.yml）时全按缺账保守记，
 * 宁可多报也不把真被摘掉读数步骤的作业说成结构。
 */
export async function collectDefused(client, repo, run, wiring = []) {
  const jobsData = await client.api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`);
  const jobs = jobsData?.jobs ?? [];
  const rows = [];
  for (const job of jobs) {
    let error = "";
    let logText = "";
    try {
      logText = await client.fetchJobLog(repo, job.id);
    } catch (inner) {
      error = messageOf(inner);
    }
    const match = matchDefusedWiring(wiring, job.name ?? "");
    rows.push({
      id: job.id,
      name: job.name ?? String(job.id),
      conclusion: job.conclusion ?? "",
      ...parseDefusedTrace(logText),
      wired: match ? match.wired : null,
      wiredCond: match?.cond ?? "",
      error,
    });
  }
  return rows;
}

/**
 * 快照文件名：run id + 短 sha + 本地时间戳。
 * 放 tmp/ 而不是仓库根：快照是排障中间产物，不该污染工作树，也不该进提交。
 */
export function snapshotFileName({ runId, sha, now = new Date() }) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  return "ci-explain-" + runId + "-" + String(sha ?? "").slice(0, 12) + "-" + stamp + ".json";
}

/**
 * 快照载荷：--json 的 stdout 与 --save 落盘文件必须同形。
 * 各自拼一份对象迟早会漂移（加字段只改一处），所以只在这里构造。
 *
 * attribution 段只在「证据不全」时出现：degraded 是逐 job 的缺证据名单，
 * partial 是整轮级别的（jobs 清单没拿到）。读快照的人靠它区分
 * 「本轮确实没有红灯」和「本轮没能取到红灯」——少了这一段，部分快照会被当成绿灯。
 *
 * baseline.failures 把基线那一轮的失败集一起内嵌：日志 90 天后过期，
 * 事后要重算「谁新增、谁关掉」不该再依赖 Actions 还在不在。
 */
export function buildSnapshot({ repo, run, waitMeta, rows, baseline, diff, degraded = [], partial = null }) {
  const slim = (row) => ({ name: row.name, firstError: row.firstError, fixHint: row.fixHint });
  return {
    repo,
    run: { id: run.id, sha: run.head_sha, url: run.html_url, conclusion: run.conclusion },
    ...(waitMeta ? { wait: waitMeta } : {}),
    failures: rows,
    layers: Object.fromEntries(layerCounts(rows)),
    ...(degraded.length > 0 || partial
      ? { attribution: { ...(degraded.length > 0 ? { degraded } : {}), ...(partial ? { partial } : {}) } }
      : {}),
    ...(baseline
      ? {
          baseline: {
            id: baseline.run.id,
            sha: baseline.run.head_sha,
            url: baseline.run.html_url,
            conclusion: baseline.run.conclusion,
            failures: baseline.rows.map(slim),
            ...(baseline.degraded?.length > 0 ? { degraded: baseline.degraded } : {}),
          },
          diff: {
            inProgress: !run.conclusion,
            introduced: diff.introduced.map(slim),
            // 换因行要多带一个「基线里是什么」，否则 JSON 侧无法判断新因是不是本轮造成的
            changed: diff.changed.map((row) => ({ ...slim(row), previousErrors: row.previousErrors })),
            persisted: diff.persisted.map(slim),
            fixed: diff.fixed.map(slim),
            superseded: splitSuperseded(rows).superseded.map(slim),
          },
        }
      : {}),
  };
}

/**
 * 落盘：默认写到仓库 tmp/，同名冲突追加序号而不是覆盖上一轮。
 * 返回绝对路径，调用方负责告诉用户（走 stderr，保持 --json 的 stdout 纯净）。
 */
export function writeSnapshot({ target = null, snapshot, now = new Date() }) {
  const basePath = target ? resolve(target) : resolve(REPO_ROOT, "tmp", snapshotFileName({ runId: snapshot.run?.id ?? "run", sha: snapshot.run?.sha, now }));
  mkdirSync(dirname(basePath), { recursive: true });
  let file = basePath;
  for (let n = 2; existsSync(file); n++) {
    file = basePath.replace(/\.json$/i, "") + "-" + n + ".json";
  }
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return file;
}

/**
 * 基线 run 解析：基线是「上一轮的 tip」，给 sha 或 run id 都行。
 * 失败不致命：拿不到基线就退化成单轮归因，绝不让对比把一次正常查询变成报错。
 * 但基线里逐 job 的证据缺口要带回去（degraded），否则「这条已经关了」
 * 可能只是基线那轮的日志压根没取到。
 */
async function resolveBaseline(client, repo, value) {
  if (!value) return null;
  try {
    const run = await resolveRun(client, {
      repo,
      runId: /^\d+$/.test(value) ? value : null,
      sha: /^\d+$/.test(value) ? null : value,
      branch: "main",
    });
    const { rows, degraded } = await collectAttribution(client, repo, run);
    return { run, rows, degraded };
  } catch (error) {
    console.error("[explain-ci] 基线对比跳过：" + messageOf(error));
    return null;
  }
}

/**
 * 流程入口。clientFactory 只为了可测性注入：真实网络下没人能稳定复现
 * 「429 打满重试」或「jobs 清单整段取不到」，而这两条恰恰是假绿灯的最后一道闸，
 * 不该只能靠人肉断网验证。
 */
export async function main(argv, { clientFactory = createClient, workflowYaml = null } = {}) {
  const repo = resolveRepo(argValue(argv, "--repo"));
  if (!repo) {
    console.error("[explain-ci] 无法确定仓库：请在 git 仓库内运行，或用 --repo owner/repo 指定");
    return 2;
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || credentialToken();
  const client = clientFactory(token);

  const shouldWait = argv.includes("--wait");
  const waitTimeoutMs = secondsArg(argv, "--timeout", 1800);
  const waitIntervalMs = secondsArg(argv, "--interval", 20);
  const waitDeadline = Date.now() + waitTimeoutMs;

  let run = await resolveRunWhenWait(
    client,
    {
      repo,
      runId: argValue(argv, "--run"),
      sha: argValue(argv, "--sha"),
      branch: argValue(argv, "--branch", "main"),
    },
    { shouldWait, deadline: waitDeadline, intervalMs: waitIntervalMs },
  );

  let waitMeta = null;
  if (shouldWait && !run.conclusion) {
    const result = await waitForRunConclusion({
      run,
      fetchRun: (id) => client.api(`/repos/${repo}/actions/runs/${id}`),
      intervalMs: waitIntervalMs,
      timeoutMs: Math.max(0, waitDeadline - Date.now()),
      // 进度走 stderr：--json 的 stdout 必须保持纯 JSON，可直接管道给 jq
      onPoll: (latest, { waitedMs, error }) => {
        process.stderr.write(
          "[explain-ci] " +
            (error ? "轮询瞬断（继续等）：" + messageOf(error) : "run #" + latest.id + " " + (latest.status ?? "unknown")) +
            "（已等 " + Math.round(waitedMs / 1000) + "s）\n",
        );
      },
    });
    run = result.run;
    waitMeta = { timedOut: result.timedOut, waitedMs: result.waitedMs, polls: result.polls, pollErrors: result.pollErrors };
  }

  // ---- --defused：撤防账视角（全部作业，只读日志里的那一行账）----
  if (argv.includes("--defused")) {
    const runMeta = { id: run.id, head_sha: run.head_sha, conclusion: run.conclusion ?? null, html_url: run.html_url };
    // 「本该有账吗」由 ci.yml 现推（有 `id: defused-gates` 那一步才算），不是另一份手抄名单
    const wiring = defusedWiring(workflowYaml ?? readWorkflowSource());
    let jobs;
    try {
      jobs = await collectDefused(client, repo, run, wiring);
    } catch (error) {
      const why = messageOf(error);
      if (argv.includes("--json")) console.log(JSON.stringify({ mode: "defused", repo, run: runMeta, error: why }, null, 2));
      else console.error("[explain-ci] 撤防账读不了：jobs 清单没取到 —— " + why + "（这不是「没有撤防」）");
      return 2;
    }
    // 读不到账分两档：`wired === false` 是接线范围之外（整作业按 if 跳过 / 汇总作业没有门禁步骤），
    // 只有「本该有账却读不到」才算发现。混成一档 ⇒ rc=0 在任何 push 轮都不可达（run 41024897432 实测）。
    const unwired = jobs.filter((r) => !r.found && r.wired === false);
    const missing = jobs.filter((r) => !r.found && r.wired !== false);
    const defusedRows = jobs.filter((r) => r.found && r.defused > 0);
    const gatesRan = jobs.reduce((n, r) => n + (r.found ? r.ran : 0), 0);
    const gatesDefused = jobs.reduce((n, r) => n + (r.found && r.defused ? r.defused : 0), 0);
    if (argv.includes("--json")) {
      console.log(
        JSON.stringify(
          {
            mode: "defused",
            repo,
            run: runMeta,
            summary: {
              jobs: jobs.length,
              gatesRan,
              gatesDefused,
              unreadable: missing.map((r) => r.name),
              unwired: unwired.map((r) => r.name),
              unwiredBasis: wiring.length ? "ci.yml" : "本地 ci.yml 读不到：每个作业都按缺账保守记",
            },
            jobs,
          },
          null,
          2,
        ),
      );
    } else {
      console.log("仓库 " + repo + " · run #" + run.id + " · " + String(run.head_sha).slice(0, 12) + " · 撤防账");
      console.log(run.html_url);
      if (waitMeta) console.log("已等待 " + Math.round(waitMeta.waitedMs / 1000) + "s · run 结论：" + (run.conclusion ?? "仍未结束"));
      console.log("\n" + renderDefusedTable(jobs).join("\n"));
      console.log(
        "\n合计：" + jobs.length + " 个作业 · 跑过 " + gatesRan + " 道门禁 · 没跑成 " + gatesDefused + " 道" +
          (missing.length > 0 ? " · " + missing.length + " 个本该有账的作业读不到（" + missing.map((r) => r.name).join("、") + "）" : "") +
          (unwired.length > 0 ? " · " + unwired.length + " 个作业本就没有账（接线外：" + unwired.map((r) => r.name).join("、") + "）" : "") +
          "。读不到 ≠ 没撤防：作业结论只说明「没新增红」，那行账才说明门禁判过没有。" +
          // 接线期望取自**本地** ci.yml，而被读的那一轮可能是旧工作流：口径要说清来源，
          // 否则读 2ca11031 之前的历史轮会把「那时候还没接线」报成「现在该有账却读不到」。
          (missing.length > 0 ? "\n[口径] 接线期望取自本地 .github/workflows/ci.yml；读早于接线的历史轮会按本地口径多报（run 40973366906 实测：那轮账还没上线）。" : "") +
          (wiring.length ? "" : "\n[接线期望缺失] 本地 .github/workflows/ci.yml 没读到 ⇒ 每个读不到账的作业都按缺账保守记（可能多报，不漏报）。"),
      );
      for (const r of defusedRows) {
        if (r.blocker) console.log("\n" + r.name + " 的根因：" + (r.blockerLabel ?? "") + "（id: " + r.blocker + "）" + (r.blockerKind || ""));
      }
      // 合计只说「读到几道」，不说「本该有几道」——账自洽地变薄时这一档看不出（判据在厚度棘轮那一档）。
      console.log(
        "\n要看账的厚度（跑过 + 没跑成 是否等于登记表期望）：" +
          "node scripts/explain-ci-failure.mjs --defused --run " + run.id + " --json > snap.json" +
          " && node scripts/check-defused-thickness.mjs --from snap.json",
      );
    }
    // 0 = 每个「本该有账」的作业都读到且没撤防；接线外的作业不参与（否则 0 不可达）
    return defusedRows.length > 0 || missing.length > 0 ? 1 : 0;
  }

  let rows = [];
  let degraded = [];
  let partial = null;
  try {
    const collected = await collectAttribution(client, repo, run);
    rows = collected.rows;
    degraded = collected.degraded;
  } catch (error) {
    // 失败 job 清单本身没取到：这不是「没有红灯」。上一版让这个异常冒到进程外，
    // stdout 一片空白，调用方只看到一行 undici 的 terminated——现在先把已拿到的
    // run 身份落成部分快照，退出码仍按查询失败给 2，绝不伪装成 0。
    partial = { stage: "jobs", error: messageOf(error) };
  }

  // 跨轮对比只在「本轮证据完整」时才算：拿不到 jobs 就把基线一起丢掉，
  // 否则「基线有、本轮没有」会被算成已修复——那正是 --wait 当初要消灭的误报。
  let baseline = null;
  let diff = null;
  if (!partial && argValue(argv, "--baseline")) {
    baseline = await resolveBaseline(client, repo, argValue(argv, "--baseline"));
    diff = baseline ? diffFailures(rows, baseline.rows) : null;
  }
  const json = argv.includes("--json");
  const timedOut = Boolean(waitMeta?.timedOut);
  const snapshot = buildSnapshot({ repo, run, waitMeta, rows, baseline, diff, degraded, partial });

  if (argv.includes("--save")) {
    // 显式路径跟 --save 后面；没给就走 tmp/ 默认命名。写盘与 --json 同形。
    const target = argValue(argv, "--save");
    const path = writeSnapshot({ target, snapshot });
    process.stderr.write("[explain-ci] 快照已写入 " + path + "\n");
  }

  if (json) {
    console.log(JSON.stringify(snapshot, null, 2));
    if (partial) {
      process.stderr.write("[explain-ci] 归因不完整：" + partial.error + "（stdout 的 JSON 是部分快照，attribution.partial 有标注）\n");
      return 2;
    }
    if (timedOut) return 3;
    return rows.length > 0 ? 1 : 0;
  }

  console.log("仓库 " + repo + " · run #" + run.id + " · " + run.head_sha.slice(0, 12) + (run.head_branch ? " · " + run.head_branch : ""));
  console.log(run.html_url);
  if (waitMeta) {
    console.log(
      "已等待 " + Math.round(waitMeta.waitedMs / 1000) + "s（" + waitMeta.polls + " 次轮询" +
        (waitMeta.pollErrors > 0 ? "，" + waitMeta.pollErrors + " 次瞬断已重试" : "") +
        "）· run 结论：" + (run.conclusion ?? "仍未结束"),
    );
  }
  if (timedOut) {
    console.log("\n等待超时：run 仍未结束，以下只是超时时刻的快照；「已修复」桶不成立，结论以最终 run 为准。");
  }
  if (degraded.length > 0) {
    console.log("\n证据不全的 job " + degraded.length + " 个（日志或注解没取到，归因只按已取到的那半算）：" + degraded.join("、"));
  }
  if (partial) {
    console.log("\n归因不完整：" + partial.error);
    console.log("以下是部分快照（run 身份 + 已取到的证据）；退出码 2，不代表没有红灯。");
    return 2;
  }
  if (rows.length === 0) {
    if (!timedOut) console.log("\n没有失败的 job（run 结论：" + (run.conclusion ?? "进行中") + "）。");
    if (baseline) console.log("\n" + renderBaselineDiff(diff, { baselineLabel: "run #" + baseline.run.id + " · " + baseline.run.head_sha.slice(0, 12), inProgress: !run.conclusion }));
    return timedOut ? 3 : 0;
  }

  console.log("\n" + renderAttributionTable(rows));
  console.log(
    "\n按层统计：" +
      layerCounts(rows)
        .map(([layer, count]) => layer + " " + count)
        .join(" · "),
  );
  const { superseded } = splitSuperseded(rows);
  if (superseded.length > 0) {
    console.log("\n其中 " + superseded.length + " 个 job 是并发取消（新推送抢先，run 被取消），不计入代码失败：" + superseded.map((row) => row.name).join("、"));
  }
  console.log("\n" + renderFixHints(rows));
  if (baseline) {
    console.log("\n## 跨轮对比");
    console.log(renderBaselineDiff(diff, { baselineLabel: "run #" + baseline.run.id + " · " + baseline.run.head_sha.slice(0, 12), inProgress: !run.conclusion }));
  }

  for (const row of rows) {
    if (!row.stackLine && row.tail.length === 0 && !row.partialReason) continue;
    console.log("\n--- " + row.name + " ---");
    if (row.partialReason) console.log("证据不全：" + row.partialReason);
    if (row.stackLine) console.log("栈帧：" + row.stackLine);
    if (row.tail.length > 0) console.log(row.tail.join("\n"));
  }
  return 1;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error("[explain-ci] " + messageOf(error));
      process.exit(2);
    },
  );
}
