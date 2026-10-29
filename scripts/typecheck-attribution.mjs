#!/usr/bin/env node
/**
 * 类型错误归因：把 `tsc` 的「文件:行」映射回**是谁的提交**引入的。
 *
 * 为什么需要：CI 只给一行「tsc 失败」，58 个错误横跨 8 个文件时，没人知道该找谁。
 * 多会话并行时尤其致命——本轮就出现过「A 的提交让 B 的 CI 红」，双方都在猜。
 *
 * 做法：解析 tsc 输出 → 对每个错误行 `git blame` → 按提交聚合。
 * 注意 blame 的语义是「这一行最后被谁改过」，不等于「谁引入了错误」：
 * 类型错误的根因常在上游（改了接口没改调用方），所以输出里同时给
 * 「错误行所在提交」与「该文件最近一次提交」，供人工判断。
 *
 * 用法：
 *   node scripts/typecheck-attribution.mjs
 *   node scripts/typecheck-attribution.mjs --cmd="pnpm -w exec tsc --noEmit"
 *   node scripts/typecheck-attribution.mjs --json
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** 解析 tsc 输出：`path(l,c): error TSxxxx: msg` */
export function parseTscOutput(text) {
  const errors = [];
  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    errors.push({ file: m[1].replace(/\\/g, "/"), line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5] });
  }
  return errors;
}

/** 从 `git blame --line-porcelain` 输出解析 行号 → { sha, author, summary } */
export function parseBlame(text) {
  const map = new Map();
  let sha = null;
  let author = "";
  let summary = "";
  let currentLine = 0;
  for (const raw of text.split("\n")) {
    // 接受 7~40 位：真实 git 输出 40 位，但测试/短 sha 场景也要能解析
    const header = raw.match(/^([0-9a-f]{7,40}) \d+ (\d+)/);
    if (header) {
      sha = header[1];
      currentLine = Number(header[2]);
      continue;
    }
    if (raw.startsWith("author ")) author = raw.slice(7);
    else if (raw.startsWith("summary ")) summary = raw.slice(8);
    else if (raw.startsWith("\t")) {
      if (sha) map.set(currentLine, { sha, author, summary });
    }
  }
  return map;
}


/**
 * 把 tsc 的相对路径映射到**真实源文件**。
 *
 * tsc 在 apps/web 下运行，输出 `src/components/x.tsx`；但 apps/web 是 vendor 出来的
 * 镜像（gitignore），对它 blame 只会得到 vendor 提交。真正的作者信息在
 * apps/web-overlay/ 里，所以优先映射到 overlay。
 */
export function resolveTrackedPath(file, exists = existsSync) {
  const candidates = [];
  if (file.startsWith("apps/")) candidates.push(file);
  candidates.push(`apps/web-overlay/${file}`, `apps/web/${file}`, file);
  return candidates.find((c) => exists(c)) ?? file;
}

function blameFile(file) {
  // 未入库文件直接跳过：对它们 blame 只会得到 "no such path in HEAD" 的噪声
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", file], { stdio: "ignore" });
  } catch {
    return new Map();
  }
  try {
    const out = execFileSync("git", ["blame", "--line-porcelain", "--", file], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseBlame(out);
  } catch {
    return new Map();
  }
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : "(未跟踪)";
}

function runTsc(cmd) {
  try {
    // 命令可能带空格参数，用 shell 执行
    return execFileSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // tsc 有错误时退出码非 0，但 stdout/stderr 仍含完整输出
    return `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const cmdArg = argv.find((a) => a.startsWith("--cmd="));
  const cmd = cmdArg ? cmdArg.slice("--cmd=".length) : "pnpm --filter navsphere exec tsc --noEmit";

  const output = runTsc(cmd);
  const errors = parseTscOutput(output).filter((e) => !e.file.includes(".next-"));

  if (errors.length === 0) {
    console.log("✅ 类型检查：无错误，无需归因");
    return;
  }

  const blameCache = new Map();
  const groups = new Map();
  for (const err of errors) {
    // 归因到真实源（overlay），而不是 gitignore 的镜像
    err.file = resolveTrackedPath(err.file);
    if (!blameCache.has(err.file)) blameCache.set(err.file, blameFile(err.file));
    const info = blameCache.get(err.file)?.get(err.line) ?? null;
    const key = info?.sha ?? "(未跟踪)";
    if (!groups.has(key)) {
      groups.set(key, { sha: key, author: info?.author ?? "-", summary: info?.summary ?? "-", files: new Map(), count: 0 });
    }
    const g = groups.get(key);
    g.count++;
    g.files.set(err.file, (g.files.get(err.file) ?? 0) + 1);
  }

  const rows = [...groups.values()].sort((a, b) => b.count - a.count);

  if (json) {
    console.log(JSON.stringify({ total: errors.length, groups: rows.map((r) => ({ ...r, files: [...r.files.entries()] })) }, null, 2));
    return;
  }

  console.log(`类型错误 ${errors.length} 个，按「错误行所在提交」归因：\n`);
  for (const r of rows) {
    console.log(`${shortSha(r.sha)}  ${String(r.count).padStart(3)} 个  ${r.author}`);
    console.log(`         ${r.summary}`);
    for (const [file, n] of [...r.files.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`         · ${file}  (${n})`);
    }
    console.log();
  }
  console.log("提示：blame 指向「该行最后被谁改过」，根因可能在上游接口变更——");
  console.log("      若某组作者与你的改动无关，优先检查该组里是否改了被广泛引用的类型。");
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) main();
