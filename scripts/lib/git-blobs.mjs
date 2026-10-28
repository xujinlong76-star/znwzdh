/**
 * 从 git ref 批量读文件内容。
 *
 * 为什么抽成模块：pre-push 闸门要检查**正要推出去的提交**，不是工作区——多会话并行时
 * 别人未提交的半成品会挡住我的推送，而工作区绿、提交红恰恰是最常见的那种漏检
 * （2026-10-28 实测：`sync-core-mirrors --check` 在工作区绿，HEAD 的 core↔overlay 却漂移）。
 * 这类闸门动辄要读几百个文件，逐个 `git show` 实测 29 s，没人会留着这种闸门；
 * 一次 `git cat-file --batch` 的字节级解析又有一个非显然的坑：**blob 的 size 是字节数**，
 * 本仓库源码里全是中文，按 utf8 字符串的 length 切片会错位。两处闸门各写一遍
 * 就是两份会各自漂移的解析器，所以只留这一份。
 */
import { spawnSync } from "node:child_process";
import { normalizePath } from "./source-refs.mjs";

/** 跑 git 并拿二进制 stdout；失败时把 stderr 原文带进报错（不吞错） */
export function gitBuf(args, { cwd = process.cwd(), input } = {}) {
  const r = spawnSync("git", args, { cwd, input, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} 失败：${(r.stderr ? r.stderr.toString("utf8") : "").trim()}`);
  }
  return r.stdout;
}

/**
 * 一次进程读取 `ref` 里的多个文件；不存在的条目**从结果里缺席**（不抛错），
 * 由调用方按自己的语义把「缺席」解释成缺失或越界。
 * @param {string} ref git 引用（HEAD / sha / 分支）
 * @param {string[]} paths 仓库根相对路径（posix）
 * @param {object} [opts]
 * @param {string} [opts.cwd] 仓库工作目录
 * @returns {Map<string, string>} 路径 → 文本内容
 */
export function readBlobs(ref, paths, { cwd = process.cwd() } = {}) {
  const contents = new Map();
  const unique = [...new Set(paths)];
  if (unique.length === 0) return contents;
  const out = gitBuf(["cat-file", "--batch"], {
    cwd,
    input: Buffer.from(unique.map((p) => `${ref}:${p}`).join("\n") + "\n", "utf8"),
  });
  let i = 0;
  for (const path of unique) {
    const nl = out.indexOf(0x0a, i);
    if (nl < 0) break;
    const header = out.subarray(i, nl).toString("utf8");
    const m = /^([0-9a-f]{40}) (\w+) (\d+)$/.exec(header);
    if (m) {
      const size = Number(m[3]);
      if (m[2] === "blob") contents.set(path, out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
      i = nl + 1 + size + 1;
      continue;
    }
    // `<ref>:<path> missing`（或 `not found`）：这条腿在提交里不存在，交给调用方判
    if (/ (missing|not found)$/.test(header)) {
      i = nl + 1;
      continue;
    }
    throw new Error(`git cat-file --batch 输出解析不了（位置 ${i}）：${header.slice(0, 80)}`);
  }
  return contents;
}

/**
 * ref 是否指向本仓库里真实存在的对象。
 * 闸门必须先问这句：ref 拼错或还没 fetch 时，`cat-file` 会把每个路径都报成 `missing`，
 * 于是「读不到」被算成「全部漂移」——闸门说谎比没有闸门更糟。
 */
export function refExists(ref, { cwd = process.cwd() } = {}) {
  const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{object}`], { cwd });
  return r.status === 0;
}

/**
 * 列出 `ref` 下某个目录里匹配正则的文件（`git ls-tree -r`）。
 * @param {string} ref
 * @param {string} subDir 仓库根相对目录
 * @param {RegExp} fileRe 文件名过滤
 */
export function listFiles(ref, subDir, fileRe, { cwd = process.cwd() } = {}) {
  const listing = gitBuf(["ls-tree", "-r", "--name-only", "-z", ref, "--", subDir], { cwd }).toString("utf8");
  return listing
    .split("\0")
    .filter((p) => p && fileRe.test(p))
    .map(normalizePath);
}
