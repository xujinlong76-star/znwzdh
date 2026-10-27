#!/usr/bin/env node
/**
 * 大文件入库守卫（零依赖，Node >= 20）
 *
 * 为什么需要它：2026-10-26 一个并行会话用 `git add -A` 把 `.playwright-mcp/` 下的
 * Playwright 安装包（141.42 MiB）提交进了本地历史。GitHub 的单文件硬限制是 100 MiB，
 * 推送被服务端连续拒绝三次，最后只能重写三个未推送提交才解除——而重写历史是不可逆操作，
 * 代价远高于在提交/推送前拦一次。
 *
 * 两种模式，对应两个不同的失败窗口：
 *   --staged    默认。只看本次提交集（`git diff --cached` 的 blob），供 pre-commit 调用。
 *               阈值刻意压在硬限制之下（默认 50 MiB = 100 MiB 的一半）：一旦提交进本地
 *               历史，即使还没推送，移除它就已经需要重写历史了，所以不能等到 100 MiB 才拦。
 *   --unpushed  供 pre-push 调用。扫描所有尚未被任何远程跟踪 ref 覆盖的 blob
 *               （`git rev-list --objects HEAD --not --remotes`）。
 *               为什么不能只靠 pre-commit：它可被 `--no-verify` 或直接 commit-tree 绕过，
 *               而真正撞上 GitHub 硬限制的时刻是 push。此模式也会看到「先提交、后删除」
 *               的大文件——它仍会被推上去，仍会触发服务端拒绝。
 *
 * 退出码：0 通过（允许有警告）；1 存在达到硬阈值的大文件；2 无法取证（不在 git 仓库、
 * git 不可用、参数错误）。取证失败绝不退化成「通过」。
 *
 * 只报告不自动修复：删除、移动还是转 LFS 属于用户的决定，脚本只给事实与恢复路径。
 */

import { execFileSync } from 'node:child_process';

const MIB = 1024 * 1024;
// GitHub 单文件硬限制 100 MiB；留一半余量，让「已经进历史」的文件还有机会在本地处理掉。
const DEFAULT_BLOCK_MIB = 50;
const DEFAULT_WARN_MIB = 10;

const USAGE = `用法：node scripts/check-large-files.mjs [--staged | --unpushed] [--block-mb=N] [--warn-mb=N]`;

function parseArgs(argv) {
  const opts = { mode: 'staged', blockMiB: DEFAULT_BLOCK_MIB, warnMiB: DEFAULT_WARN_MIB };
  for (const arg of argv) {
    if (arg === '--staged') opts.mode = 'staged';
    else if (arg === '--unpushed') opts.mode = 'unpushed';
    else if (arg.startsWith('--block-mb=')) opts.blockMiB = Number(arg.slice('--block-mb='.length));
    else if (arg.startsWith('--warn-mb=')) opts.warnMiB = Number(arg.slice('--warn-mb='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`[large-files] 未知参数：${arg}\n${USAGE}`);
      process.exit(2);
    }
  }
  for (const key of ['blockMiB', 'warnMiB']) {
    if (!Number.isFinite(opts[key]) || opts[key] <= 0) {
      console.error(`[large-files] ${key} 必须是正数，收到 ${opts[key]}`);
      process.exit(2);
    }
  }
  if (opts.warnMiB > opts.blockMiB) {
    console.error(`[large-files] --warn-mb(${opts.warnMiB}) 不能大于 --block-mb(${opts.blockMiB})`);
    process.exit(2);
  }
  return opts;
}

function git(args, input) {
  // maxBuffer 只用于对象清单文本；blob 内容不经过这里（--batch-check 只回元数据）。
  return execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 64 * MIB, stdio: ['pipe', 'pipe', 'pipe'] });
}

function splitZ(text) {
  return text.split('\0').map((s) => s.replace(/\r?\n$/, '')).filter(Boolean);
}

/** `<mode> <sha> <stage>\t<path>` -> { sha, path }；只保留 blob（子模块是 commit，跳过）。 */
function parseLsFiles(text) {
  const out = [];
  for (const record of splitZ(text)) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode, sha] = record.slice(0, tab).split(' ');
    if (mode !== '100644' && mode !== '100755') continue;
    out.push({ sha, path: record.slice(tab + 1) });
  }
  return out;
}

/** 一次批量取大小：stdin 每行一个 sha，stdout 每行 `<sha> <type> <size>`。 */
function sizesOf(shas) {
  const sizes = new Map();
  const unique = Array.from(new Set(shas));
  if (unique.length === 0) return sizes;
  const text = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], unique.join('\n') + '\n');
  for (const line of text.split(/\r?\n/)) {
    const [sha, type, size] = line.trim().split(' ');
    if (!sha || type !== 'blob') continue;
    const n = Number(size);
    if (Number.isFinite(n)) sizes.set(sha, n);
  }
  return sizes;
}

function stagedBlobs() {
  const names = splitZ(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
  if (names.length === 0) return { blobs: [], scope: '暂存区为空' };
  // 用 ls-files 取「索引里的 blob sha」，而不是读工作区文件大小：
  // 要判的是「将进入提交的那个对象」有多大，工作区文件可能被 .gitattributes
  // 做过行尾转换，两者大小并不相同。
  const entries = parseLsFiles(git(['ls-files', '-s', '-z', '--', ...names]));
  return { blobs: entries, scope: `${names.length} 个暂存文件` };
}

function unpushedBlobs() {
  // rev-list 输出 `<sha> [path]`；path 可能含空格，只按第一个空格切分。
  const text = git(['rev-list', '--objects', 'HEAD', '--not', '--remotes']);
  const paths = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    const sha = space < 0 ? trimmed : trimmed.slice(0, space);
    if (space >= 0) paths.set(sha, trimmed.slice(space + 1));
  }
  const blobs = Array.from(paths, ([sha, path]) => ({ sha, path }));
  return { blobs, scope: blobs.length === 0 ? '没有未推送对象' : `${blobs.length} 个未推送对象` };
}

function human(bytes) {
  if (bytes >= MIB) return (bytes / MIB).toFixed(1) + ' MiB';
  return (bytes / 1024).toFixed(1) + ' KiB';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const blockBytes = opts.blockMiB * MIB;
  const warnBytes = opts.warnMiB * MIB;

  let collected;
  try {
    git(['rev-parse', '--git-dir']);
    collected = opts.mode === 'staged' ? stagedBlobs() : unpushedBlobs();
  } catch (err) {
    console.error(`[large-files] 无法取证（${opts.mode}）：${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    console.error('[large-files] 取证失败不等同于通过，按失败处理');
    return 2;
  }

  const { blobs, scope } = collected;
  const sizes = sizesOf(blobs.map((b) => b.sha));

  const violations = [];
  const warnings = [];
  let largest = null;
  for (const blob of blobs) {
    const size = sizes.get(blob.sha);
    if (size === undefined) continue;
    if (!largest || size > largest.size) largest = { ...blob, size };
    if (size >= blockBytes) violations.push({ ...blob, size });
    else if (size >= warnBytes) warnings.push({ ...blob, size });
  }

  violations.sort((a, b) => b.size - a.size);
  warnings.sort((a, b) => b.size - a.size);

  const where = opts.mode === 'staged' ? '暂存区' : '未推送历史';
  for (const w of warnings) {
    console.warn(`[large-files] ⚠ ${where}大文件：${human(w.size)}  ${w.path}  (${w.sha.slice(0, 8)})`);
  }

  if (violations.length > 0) {
    console.error(`[large-files] ✖ ${where}有 ${violations.length} 个文件达到硬阈值 ${opts.blockMiB} MiB：`);
    for (const v of violations) {
      console.error(`  - ${human(v.size).padStart(9)}  ${v.path}  (${v.sha.slice(0, 8)})`);
    }
    console.error('[large-files] 为什么阈值不是 100 MiB：GitHub 的单文件硬限制是 100 MiB，');
    console.error('  但一旦对象进入本地历史，即使没推送也已经需要重写历史才能移除。50 MiB 留出处理余量。');
    console.error('[large-files] 处理方式（按文件性质选）：');
    console.error('  · 会话/构建产物：加进 .gitignore，然后 git rm --cached <path>');
    console.error('  · 确需版本化的二进制：改用 Git LFS 或外部制品库');
    console.error('  · 已经进入未推送历史：用 git rebase/filter-repo 在本地处理（不要先推送）');
    return 1;
  }

  const largestNote = largest ? `，最大 ${human(largest.size)}（${largest.path}）` : '';
  console.log(
    `[large-files] ✓ ${opts.mode} 模式：${scope}，${blobs.length} 个 blob 中无 >= ${opts.blockMiB} MiB 的文件${largestNote}` +
      (warnings.length > 0 ? `；${warnings.length} 个 >= ${opts.warnMiB} MiB 仅告警` : ''),
  );
  return 0;
}

process.exit(main());
