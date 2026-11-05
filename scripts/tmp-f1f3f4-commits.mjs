/**
 * F1/F3/F4 + F2 四连提交执行器（hash-calc.ts 清障后运行一次）。
 *
 * 严格分家（主理人裁决）：globals.css 同时承载三个阶段的改动，提交前按阶段
 * 临时摘掉后续阶段的块，提交后复原，保证每份 commit 只含本阶段内容（原子性优先）。
 * F2（eng-route-finish 的路由骨架/错误边界，24 路径）不涉 globals，排最后原样提交。
 *
 * 用法：node scripts/tmp-f1f3f4-commits.mjs --dry   # 只演算三阶段 diff，不提交
 *       node scripts/tmp-f1f3f4-commits.mjs         # 确认 typecheck 清障后四连提交
 *
 * 阶段划分（globals.css）：
 *   F1 = token 块 + @theme 映射 + accent 组（文件主体）
 *   F3 = 末尾「F3 移动端触控可读性」@media 块
 *   F4 = .glass-surface 0.88 + 末尾「F4 自定义壁纸」两条未分层规则
 *   F2 = 不动 globals（路径里带 [slug]/[id] 方括号——execFileSync 数组传参
 *        不经 shell，天然免 glob 展开，勿改回 shell 拼接）
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(".");
const GLOBALS = resolve(ROOT, "apps/web-overlay/src/styles/globals.css");
const FULL_BAK = resolve(ROOT, ".tmp-globals-full.bak");
// 门禁 check-web-overlay 要求 overlay↔apps/web 镜像逐文件一致；手术只写 overlay 侧会被漂移检查拦下。
// 定点同步仅拷 globals.css 这一个我方文件（不跑全量 --fix，避免把他人 WIP 半成品镜像进 vendored 目录）。
const MIRROR = resolve(ROOT, "apps/web/src/styles/globals.css");
const syncMirror = () => copyFileSync(GLOBALS, MIRROR);
const DRY = process.argv.includes("--dry");

// ---- 阶段手术（纯字符串，块都有唯一注释标记；行尾兼容 CRLF/LF） ----
function stripF4(s) {
  // 1) .glass-surface 恢复 0.75 并摘掉 F4 注释
  s = s.replace(
    /  \.glass-surface \{\r?\n    \/\* F4 壁纸可读性兜底[\s\S]*?\*\/\r?\n    background-color: hsl\(var\(--card\) \/ 0\.88\);/,
    "  .glass-surface {\n    background-color: hsl(var(--card) / 0.75);",
  );
  // 2) 末尾 F4 两条未分层规则（含注释）
  s = s.replace(/\r?\n\/\* F4 自定义壁纸文字可读性兜底[\s\S]*$/, "\n");
  return s;
}
function stripF3(s) {
  // 末尾「F3 移动端触控可读性」注释 + @media 块（该块之后只会有 F4，已在前一步摘除）
  return s.replace(/\r?\n\/\* F3 移动端触控可读性[\s\S]*$/, "\n");
}
function phaseGlobals(full, phase) {
  let s = full;
  if (phase === "F1") {
    s = stripF3(stripF4(s));
  } else if (phase === "F3") {
    s = stripF4(s);
  }
  // F4 = 原样（full）
  return s;
}

// ---- 执行 ----
const full = readFileSync(GLOBALS, "utf8");
for (const phase of ["F1", "F3", "F4"]) {
  const staged = phaseGlobals(full, phase);
  console.log(`[phase ${phase}] globals bytes:`, staged.length, "（full:", full.length, "）");
  if (phase === "F1" && staged.includes("F3 移动端触控可读性")) throw new Error("F1 阶段仍含 F3 块");
  if (phase === "F1" && staged.includes("F4 自定义壁纸")) throw new Error("F1 阶段仍含 F4 块");
  if (phase === "F3" && staged.includes("F4 自定义壁纸")) throw new Error("F3 阶段仍含 F4 块");
}
if (DRY) {
  console.log("[dry-run] 三阶段手术校验通过，未写盘未提交");
  process.exit(0);
}

// typecheck 清障检查（hash-calc.ts 等他人 WIP 拦截时不逃逸）
const tsc = resolve(ROOT, "packages/core/node_modules/typescript/bin/tsc");
try {
  const out = execFileSync(process.execPath, [tsc, "--noEmit", "-p", "packages/core"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (/error TS/.test(out)) throw new Error("typecheck 仍有错误");
} catch (e) {
  const msg = String(e.stdout ?? e.message ?? e);
  const n = (msg.match(/error TS/g) || []).length;
  if (n > 0) {
    console.error(`[abort] typecheck 仍红（${n} 处），不提交不逃逸。拦截物多半是 packages/core/src/speculative-intent/hash-calc.ts`);
    process.exit(1);
  }
}

const commits = [
  ["F1", ".commit-msg-f1.txt", ".tmp-commit-paths.txt"],
  ["F3", ".commit-msg-f3.txt", ".tmp-commit-paths-f3.txt"],
  ["F4", ".commit-msg-f4.txt", ".tmp-commit-paths-f4.txt"],
  // F2（eng-route-finish 的 24 路径）不涉 globals 分家，排最后原样提交。
  // 清单由归属会话写入 .tmp-commit-paths-f2.txt（缺失则跳过并在结尾点名，防掉队）。
  ["F2", ".commit-msg-f2.txt", ".tmp-commit-paths-f2.txt"],
];
copyFileSync(GLOBALS, FULL_BAK);
const hashes = [];
try {
  for (const [phase, msg, list] of commits) {
    if (!existsSync(list)) {
      if (phase === "F2") {
        console.warn(`[skip ${phase}] 缺 ${list}——F2 未提交！请让 eng-route-finish 写入显式 24 路径清单后单独补跑：`);
        console.warn(`  node scripts/safe-commit.mjs --msg-file ${msg} -- $(cat ${list})`);
        continue;
      }
      throw new Error(`缺路径清单 ${list}`);
    }
    const phaseFull = phase === "F2";
    if (!phaseFull) writeFileSync(GLOBALS, phaseGlobals(full, phase), "utf8");
    syncMirror(); // 手术后定点同步镜像，防 check-web-overlay 漂移拦截
    const args = ["scripts/safe-commit.mjs", "--msg-file", msg, "--", ...readFileSync(list, "utf8").split(/\r?\n/).filter(Boolean)];
    console.log(`[commit ${phase}] node`, args.slice(0, 4).join(" "), "…", args.length - 4, "paths");
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
    const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const names = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    console.log(`[commit ${phase}] hash=${hash.slice(0, 12)} files=${names.length}`);
    hashes.push(`${phase}=${hash}`);
  }
} finally {
  // 复原完整 globals（即便中途失败），并同步镜像保持 0 漂移
  copyFileSync(FULL_BAK, GLOBALS);
  syncMirror();
}
console.log("[done] 哈希：", hashes.join(" "));
if (hashes.length < 4) console.warn("[warn] 不足 4 枚哈希——检查上方 [skip] 点名的掉队批次");
