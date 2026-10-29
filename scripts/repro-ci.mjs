#!/usr/bin/env node
/**
 * 把 CI 作业还原成本地可执行命令。
 *
 * 为什么需要：CI 红了以后，本地复现要手写「先 vendor、再按分片跑」——本轮每次
 * 都是凭记忆拼命令，拼错一次就多等五分钟。作业定义本来就在 ci.yml 里，
 * 应该由脚本读它，而不是靠人记。
 *
 * 用法：
 *   node scripts/repro-ci.mjs --list                      列出作业
 *   node scripts/repro-ci.mjs 测试                          按名字片段匹配并打印命令
 *   node scripts/repro-ci.mjs test-sqlite --run            真正执行
 *   node scripts/repro-ci.mjs test-sqlite --run --shard=2/3  指定分片
 *
 * 安全边界：默认只打印不执行；`--run` 是显式动作。矩阵变量用 `--shard` 注入，
 * 未提供时按矩阵第一项代入（并在输出里标注）。
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const WORKFLOW = ".github/workflows/ci.yml";

/**
 * 极简 YAML 扫描：只认「job → name → run 命令序列」这一层结构。
 * 不引入 yaml 依赖：仓库的门禁脚本要求零依赖，且这里只需要一个子集。
 */
export function parseWorkflow(text) {
  // 行尾归一：ci.yml 是混合行尾（部分行 CRLF），`(.+)$` 会被残留的 \r 卡住
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const jobs = [];
  let current = null;
  let inSteps = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) {
      inSteps = false;
      continue;
    }
    // 顶层 job：两个空格缩进 + 键名 + 冒号
    const jobMatch = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
    if (jobMatch) {
      current = { id: jobMatch[1], name: jobMatch[1], runs: [], matrix: [] };
      jobs.push(current);
      inSteps = false;
      continue;
    }
    if (!current) continue;

    // job 名称（第一个 name: 在 steps 之前）
    const nameMatch = line.match(/^ {4}name:\s*(.+)$/);
    if (nameMatch && !inSteps) {
      current.name = nameMatch[1].replace(/^["']|["']$/g, "");
      continue;
    }

    // 矩阵值：shard: [1, 2, 3]
    const matrixMatch = line.match(/^ {8}([a-zA-Z0-9_-]+):\s*\[(.+)\]\s*$/);
    if (matrixMatch) {
      current.matrix.push({ key: matrixMatch[1], values: matrixMatch[2].split(",").map((v) => v.trim()) });
      continue;
    }

    if (/^ {4}steps:\s*$/.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;

    // 步骤内的 run（含 `run: |` 多行块）
    const runInline = line.match(/^\s*(?:-\s*)?run:\s*(.+)$/);
    if (runInline && runInline[1].trim() !== "|") {
      current.runs.push(runInline[1].trim());
      continue;
    }
    if (runInline && runInline[1].trim() === "|") {
      const indent = (line.match(/^(\s*)/) ?? ["", ""])[1].length + (/-\s*run:/.test(line) ? 2 : 0);
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === "") {
          block.push("");
          continue;
        }
        const nextIndent = (next.match(/^(\s*)/) ?? ["", ""])[1].length;
        if (nextIndent <= indent) break;
        block.push(next.slice(indent + 2));
        i = j;
      }
      current.runs.push(block.join("\n").trim());
    }
  }

  return jobs.filter((j) => j.runs.length > 0);
}

/** 用 --shard 的值替换矩阵占位符（`${{ matrix.shard }}`） */
export function applyMatrix(run, matrix, shard) {
  if (!matrix.length) return run;
  const value = shard ?? matrix[0].values[0];
  return run.replace(/\$\{\{\s*matrix\.[a-zA-Z0-9_-]+\s*\}\}/g, value);
}

function usage(message) {
  if (message) console.error("❌ " + message);
  console.error("用法：node scripts/repro-ci.mjs [--list] [<作业名或片段>] [--run] [--shard=i/n]");
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes("--list");
  const shouldRun = argv.includes("--run");
  const shardArg = argv.find((a) => a.startsWith("--shard="));
  // 允许 --shard=2 或 --shard=2/3：矩阵变量本身只是分子（`${{ matrix.shard }}/3`），
  // 直接传 2/3 会拼成 `--shard=2/3/3`，所以这里取分子。
  const shard = shardArg ? shardArg.slice("--shard=".length).split("/")[0] : null;
  const keyword = argv.find((a) => !a.startsWith("--"));

  const jobs = parseWorkflow(readFileSync(WORKFLOW, "utf8"));
  if (jobs.length === 0) usage(`未能从 ${WORKFLOW} 解析出任何作业（格式变了？）`);

  if (listOnly || !keyword) {
    console.log(`可复现的作业（${jobs.length}）：`);
    for (const j of jobs) {
      const matrix = j.matrix.length ? `  矩阵: ${j.matrix.map((m) => `${m.key}=[${m.values.join(",")}]`).join(", ")}` : "";
      console.log(`  ${j.id.padEnd(22)} ${j.name}${matrix}`);
    }
    if (!keyword) console.log("\n用法：node scripts/repro-ci.mjs <作业 id 或名称片段> [--run]");
    return;
  }

  const matched = jobs.filter((j) => j.id.includes(keyword) || j.name.includes(keyword));
  if (matched.length === 0) usage(`没有匹配「${keyword}」的作业，用 --list 查看`);
  if (matched.length > 1) {
    console.error(`❌ 匹配到 ${matched.length} 个作业，请更精确：`);
    for (const j of matched) console.error(`   ${j.id}  ${j.name}`);
    process.exit(2);
  }

  const job = matched[0];
  const commands = job.runs.map((r) => applyMatrix(r, job.matrix, shard));

  console.log(`# 作业：${job.name}（${job.id}）`);
  if (job.matrix.length && !shard) {
    console.log(`# 矩阵未指定，按第一项代入：${job.matrix[0].key}=${job.matrix[0].values[0]}（可用 --shard=2/3 覆盖）`);
  }
  for (const cmd of commands) {
    console.log("\n" + cmd);
  }

  if (!shouldRun) {
    console.log("\n# 以上为待执行命令。加 --run 才会真正执行。");
    return;
  }

  for (const cmd of commands) {
    console.log(`\n▶ ${cmd.split("\n")[0]}${cmd.includes("\n") ? " …" : ""}`);
    const res = spawnSync(cmd, { shell: true, stdio: "inherit" });
    if ((res.status ?? 1) !== 0) {
      console.error(`\n❌ 该步骤失败（exit ${res.status}），后续步骤不再执行。`);
      process.exit(res.status ?? 1);
    }
  }
  console.log("\n✅ 该作业的全部步骤已在本机跑完。");
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) main();
