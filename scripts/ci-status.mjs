#!/usr/bin/env node
/**
 * 查询 GitHub Actions 最近几次运行的状态。
 *
 * 为什么需要：本机没有 `gh` CLI，推送后「CI 到底绿没绿」只能开浏览器看。
 * 这个脚本走公开 REST API（公开仓库无需鉴权；配 `GITHUB_TOKEN` 可提高限额），
 * 把最近 N 次运行打在一屏里，便于推送后立刻确认。
 *
 * 用法：
 *   pnpm ci:status                # 最近 5 次
 *   pnpm ci:status --limit=10     # 最近 10 次
 *   pnpm ci:status --json         # 机器可读
 *
 * 退出码：
 *   0  最近一次 main 运行成功（或尚无运行）
 *   1  最近一次 main 运行失败/取消/超时
 *   2  用法错误、仓库地址解析失败或网络/API 错误
 *
 * 说明：API 未鉴权时限额 60 次/小时；脚本不缓存、不重试，避免把限额耗在后台。
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * 从 git remote 地址解析 `owner/repo`。
 * 支持 https / ssh / 带 .git 后缀三种写法；非 GitHub 地址返回 null。
 */
export function parseRepoSlug(remoteUrl) {
  if (typeof remoteUrl !== "string") return null;
  const trimmed = remoteUrl.trim();
  const match = trimmed.match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** 把 API 的 run 对象裁成打印需要的字段（同时便于 --json 的稳定结构） */
export function summarizeRun(run) {
  return {
    id: run.id,
    name: run.name ?? run.display_title ?? "(未命名)",
    branch: run.head_branch ?? "",
    sha: String(run.head_sha ?? "").slice(0, 7),
    event: run.event ?? "",
    status: run.status ?? "",
    conclusion: run.conclusion ?? "",
    createdAt: run.created_at ?? "",
    url: run.html_url ?? "",
  };
}

/** 单行状态标记：成功/失败一眼可分，且不依赖颜色（日志重定向后仍可读） */
export function statusMark(run) {
  if (run.status !== "completed") return "…";
  switch (run.conclusion) {
    case "success":
      return "✔";
    case "failure":
      return "✘";
    case "cancelled":
      return "⊘";
    case "skipped":
      return "–";
    default:
      return "?";
  }
}

function gitRemote() {
  if (process.env.NAVHUB_GIT_REMOTE) return process.env.NAVHUB_GIT_REMOTE;
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function usage(message) {
  if (message) console.error("❌ " + message);
  console.error("用法：node scripts/ci-status.mjs [--limit=N] [--json]");
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) usage("--limit 需为 1~50 的整数");

  const slug = parseRepoSlug(gitRemote());
  if (!slug) usage("无法从 git remote 解析 GitHub 仓库（可用 NAVHUB_GIT_REMOTE 覆盖）");

  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "navhub-ci-status",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${slug}/actions/runs?per_page=${limit}`, {
      headers,
    });
  } catch (error) {
    console.error(`❌ 请求 GitHub API 失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  if (!response.ok) {
    const hint = response.status === 403 ? "（可能是未鉴权限额 60 次/小时，试试 GITHUB_TOKEN）" : "";
    console.error(`❌ GitHub API ${response.status} ${response.statusText}${hint}`);
    process.exit(2);
  }

  const data = await response.json();
  const runs = (Array.isArray(data.workflow_runs) ? data.workflow_runs : []).map(summarizeRun);

  if (asJson) {
    console.log(JSON.stringify({ repo: slug, runs }, null, 2));
  } else if (runs.length === 0) {
    console.log(`${slug}：还没有 GitHub Actions 运行记录。`);
  } else {
    console.log(`${slug} · 最近 ${runs.length} 次运行`);
    for (const run of runs) {
      const when = run.createdAt ? run.createdAt.replace("T", " ").replace("Z", " UTC") : "";
      console.log(
        `${statusMark(run)} ${run.name}  [${run.branch || "-"}]  ${run.sha}  ${run.conclusion || run.status}  ${when}`,
      );
      console.log(`   ${run.url}`);
    }
  }

  const latestMain = runs.find((r) => r.branch === "main" || r.branch === "master");
  if (latestMain && latestMain.status === "completed" && latestMain.conclusion !== "success") {
    console.error(`\n❌ 最近一次 main 运行未成功：${latestMain.conclusion}（${latestMain.url}）`);
    process.exit(1);
  }
  if (latestMain) {
    console.log(`\n最近一次 main：${latestMain.conclusion || latestMain.status}`);
  }
}

// 仅在被直接执行时跑 main：被测试 import 时不应发网络请求
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
