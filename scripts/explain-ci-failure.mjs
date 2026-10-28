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
 *     基线对比输出「新增红 / 仍在红 / 已修复」——多会话并行时，能让「这条红是不是我造成的」
 *     不必靠人肉翻两次 run。
 *   node scripts/explain-ci-failure.mjs --sha <sha> --wait [--timeout 秒] [--interval 秒]
 *     推送后立刻调用时 run 往往还没跑完：等待终局再算三桶，而不是把「还没跑到」
 *     误报成「已修复」。默认每 20s 轮询、最多等 30 分钟；超时以退出码 3 收尾，
 *     并明确标注结果是超时快照。
 *   每条失败行都带 fixHint（按归因层给出的一条可执行修复命令）；文本模式另有
 *   「修复入口」段按层去重。JSON 里 failures[].fixHint 与 diff 三桶同形。
 * 退出码：0 = 没有失败 job，1 = 有失败 job，2 = 查询/鉴权失败，3 = 等待超时（run 仍未结束）。
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
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

const API = "https://api.github.com";
const MAX_LOG_BYTES = 8 * 1024 * 1024;
/**
 * 只对传输层失败重试：DNS/TLS 瞬断是常态（本仓库一次会话里遇到三次），HTTP 4xx 不重试。
 * undici 的瞬断报错文案是 `terminated`（对端提前关连接）——真实 run #40609230621 里
 * 它让 --baseline 整段被跳过，而 HTTP 响应本身完全正常。
 */
const RETRYABLE_NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|terminated|UND_ERR_SOCKET/i;

export async function fetchWithRetry(url, init, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts || !RETRYABLE_NETWORK.test(message)) throw error;
      await new Promise((done) => setTimeout(done, 500 * attempt));
    }
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
 */
async function resolveRunWhenWait(client, opts, { shouldWait, deadline, intervalMs }) {
  for (;;) {
    try {
      return await resolveRun(client, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!shouldWait || !message.includes("找不到匹配的运行") || Date.now() >= deadline) throw error;
      await new Promise((done) => setTimeout(done, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
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
    const res = await fetchWithRetry(API + path, { headers });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.message ?? "";
      } catch {
        detail = "";
      }
      throw new Error("GitHub API " + res.status + " " + path + (detail ? "：" + detail : ""));
    }
    return res.json();
  }

  /** 日志接口 302 到签名 URL：跳转后的 URL 不能再带 Authorization */
  async function fetchJobLog(repo, jobId) {
    const first = await fetchWithRetry(API + `/repos/${repo}/actions/jobs/${jobId}/logs`, {
      headers,
      redirect: "manual",
    });
    if (first.status === 200) return (await first.text()).slice(0, MAX_LOG_BYTES);
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get("location");
      if (!location) return "";
      const signed = await fetchWithRetry(location, { redirect: "follow" });
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

/** job 的 check-run 注解（工具主动标注的错误，含文件/行号） */
async function fetchAnnotations(client, repo, job) {
  const url = typeof job?.check_run_url === "string" ? job.check_run_url : "";
  const id = url.match(/\/check-runs\/(\d+)$/)?.[1];
  if (!id) return [];
  try {
    const list = await client.api(`/repos/${repo}/check-runs/${id}/annotations?per_page=50`);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function collectAttribution(client, repo, run) {
  const jobsData = await client.api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`);
  const jobs = (jobsData?.jobs ?? []).filter(isFailedJob);
  const rows = [];
  for (const job of jobs) {
    const [logText, annotations] = await Promise.all([
      client.fetchJobLog(repo, job.id),
      fetchAnnotations(client, repo, job),
    ]);
    rows.push(summarizeJob(job, { logText, annotations }));
  }
  return rows;
}

/**
 * 基线 run 解析：基线是「上一轮的 tip」，给 sha 或 run id 都行。
 * 失败不致命：拿不到基线就退化成单轮归因，绝不让对比把一次正常查询变成报错。
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
    const rows = await collectAttribution(client, repo, run);
    return { run, rows };
  } catch (error) {
    console.error("[explain-ci] 基线对比跳过：" + (error instanceof Error ? error.message : String(error)));
    return null;
  }
}

async function main(argv) {
  const repo = resolveRepo(argValue(argv, "--repo"));
  if (!repo) {
    console.error("[explain-ci] 无法确定仓库：请在 git 仓库内运行，或用 --repo owner/repo 指定");
    return 2;
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || credentialToken();
  const client = createClient(token);

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
      onPoll: (latest, { waitedMs }) => {
        process.stderr.write(
          "[explain-ci] run #" + latest.id + " " + (latest.status ?? "unknown") + "（已等 " + Math.round(waitedMs / 1000) + "s）\n",
        );
      },
    });
    run = result.run;
    waitMeta = { timedOut: result.timedOut, waitedMs: result.waitedMs, polls: result.polls };
  }

  const rows = await collectAttribution(client, repo, run);
  const baseline = await resolveBaseline(client, repo, argValue(argv, "--baseline"));
  const diff = baseline ? diffFailures(rows, baseline.rows) : null;
  const json = argv.includes("--json");
  const timedOut = Boolean(waitMeta?.timedOut);

  if (json) {
    console.log(
      JSON.stringify(
        {
          repo,
          run: { id: run.id, sha: run.head_sha, url: run.html_url, conclusion: run.conclusion },
          ...(waitMeta ? { wait: waitMeta } : {}),
          failures: rows,
          layers: Object.fromEntries(layerCounts(rows)),
          ...(baseline
            ? {
                baseline: {
                  id: baseline.run.id,
                  sha: baseline.run.head_sha,
                  url: baseline.run.html_url,
                  conclusion: baseline.run.conclusion,
                },
                diff: {
                  inProgress: !run.conclusion,
                  introduced: diff.introduced.map((row) => ({ name: row.name, firstError: row.firstError, fixHint: row.fixHint })),
                  persisted: diff.persisted.map((row) => ({ name: row.name, firstError: row.firstError, fixHint: row.fixHint })),
                  fixed: diff.fixed.map((row) => ({ name: row.name, firstError: row.firstError, fixHint: row.fixHint })),
                  superseded: splitSuperseded(rows).superseded.map((row) => ({ name: row.name, firstError: row.firstError, fixHint: row.fixHint })),
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
    if (timedOut) return 3;
    return rows.length > 0 ? 1 : 0;
  }

  console.log("仓库 " + repo + " · run #" + run.id + " · " + run.head_sha.slice(0, 12) + (run.head_branch ? " · " + run.head_branch : ""));
  console.log(run.html_url);
  if (waitMeta) {
    console.log(
      "已等待 " + Math.round(waitMeta.waitedMs / 1000) + "s（" + waitMeta.polls + " 次轮询）· run 结论：" + (run.conclusion ?? "仍未结束"),
    );
  }
  if (timedOut) {
    console.log("\n等待超时：run 仍未结束，以下只是超时时刻的快照；「已修复」桶不成立，结论以最终 run 为准。");
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
    if (!row.stackLine && row.tail.length === 0) continue;
    console.log("\n--- " + row.name + " ---");
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
      console.error("[explain-ci] " + (error instanceof Error ? error.message : String(error)));
      process.exit(2);
    },
  );
}
