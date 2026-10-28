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
 * 退出码：0 = 没有失败 job，1 = 有失败 job，2 = 查询/鉴权失败。
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
  splitSuperseded,
  summarizeJob,
} from "./lib/ci-attribution.mjs";

const API = "https://api.github.com";
const MAX_LOG_BYTES = 8 * 1024 * 1024;
/** 只对传输层失败重试：DNS/TLS 瞬断是常态（本仓库一次会话里遇到三次），HTTP 4xx 不重试 */
const RETRYABLE_NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i;

async function fetchWithRetry(url, init, attempts = 3) {
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

  const run = await resolveRun(client, {
    repo,
    runId: argValue(argv, "--run"),
    sha: argValue(argv, "--sha"),
    branch: argValue(argv, "--branch", "main"),
  });

  const rows = await collectAttribution(client, repo, run);
  const baseline = await resolveBaseline(client, repo, argValue(argv, "--baseline"));
  const diff = baseline ? diffFailures(rows, baseline.rows) : null;
  const json = argv.includes("--json");

  if (json) {
    console.log(
      JSON.stringify(
        {
          repo,
          run: { id: run.id, sha: run.head_sha, url: run.html_url, conclusion: run.conclusion },
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
                  introduced: diff.introduced.map((row) => ({ name: row.name, firstError: row.firstError })),
                  persisted: diff.persisted.map((row) => ({ name: row.name, firstError: row.firstError })),
                  fixed: diff.fixed.map((row) => ({ name: row.name, firstError: row.firstError })),
                  superseded: splitSuperseded(rows).superseded.map((row) => ({ name: row.name, firstError: row.firstError })),
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
    return rows.length > 0 ? 1 : 0;
  }

  console.log("仓库 " + repo + " · run #" + run.id + " · " + run.head_sha.slice(0, 12) + (run.head_branch ? " · " + run.head_branch : ""));
  console.log(run.html_url);
  if (rows.length === 0) {
    console.log("\n没有失败的 job（run 结论：" + (run.conclusion ?? "进行中") + "）。");
    if (baseline) console.log("\n" + renderBaselineDiff(diff, { baselineLabel: "run #" + baseline.run.id + " · " + baseline.run.head_sha.slice(0, 12), inProgress: !run.conclusion }));
    return 0;
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
