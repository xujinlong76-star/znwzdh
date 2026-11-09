#!/usr/bin/env node
/**
 * 显式 any 棘轮守卫（零依赖除 typescript，Node >= 20）
 *
 * 背景：apps/web-overlay/eslint.config.mjs 里 `@typescript-eslint/no-explicit-any` 当前是 off
 * （存量约 289 处，属独立类型工程）。一次性清零不现实，但也不能放任继续增长——本守卫采用
 * **按文件基线、只减不增**：
 *   - 每个当前含 any 的文件在 scripts/no-explicit-any-baseline.json 里记一个条数；
 *   - 已有文件条数 > 基线 → 失败（回增）；
 *   - 基线里没有的文件出现 any → 失败（新增债务）；
 *   - 条数比基线少 → 通过，并提示跑 --update-baseline 把基线收紧（棘轮才不会松）。
 *
 * 计数口径：用 TypeScript 语法树数 AnyKeyword 节点，与 eslint 的 no-explicit-any 命中集合一致
 * （`: any`、`as any`、`<any>`、`any[]`、`Record<string, any>` 都算；字符串里的 "any" 不算）。
 *
 * 范围：apps/web-overlay/src 下的 .ts/.tsx（apps/web 是生成物，不作为事实源）。
 *
 * 模式：
 *   默认（全量）  供 CI 使用：扫描整个 src，和基线逐文件对照。
 *   --staged      供 pre-commit 使用：只看本次暂存集，读索引里的内容（不读工作区，
 *                 避免「提交的是旧版、检查的是新版」）。别人的在途改动不会挡住你的提交。
 *
 * 退出码：0 通过；1 发现新增/回增；2 无法取证（基线缺失或坏、git 不可用、参数错误）。
 * 取证失败绝不退化成「通过」。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const P = '[no-explicit-any] ';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = 'apps/web-overlay/src';
const BASELINE_FILE = 'scripts/no-explicit-any-baseline.json';
const SOURCE_RE = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next']);

const USAGE = `用法：node scripts/check-no-explicit-any.mjs [--staged] [--update-baseline]
            [--root=<dir>] [--baseline=<file>]`;

export function parseArgs(argv) {
  const opts = { staged: false, update: false, root: REPO_ROOT, baseline: null };
  for (const arg of argv) {
    if (arg === '--staged') opts.staged = true;
    else if (arg === '--update-baseline') opts.update = true;
    else if (arg.startsWith('--root=')) opts.root = resolve(arg.slice('--root='.length));
    else if (arg.startsWith('--baseline=')) opts.baseline = resolve(arg.slice('--baseline='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`${P}未知参数：${arg}\n${USAGE}`);
      process.exit(2);
    }
  }
  opts.baseline ??= resolve(opts.root, BASELINE_FILE);
  return opts;
}

/** 数一棵语法树里的 AnyKeyword 节点（与 eslint no-explicit-any 的命中口径一致）。 */
export function countAny(source, filePath = 'x.tsx') {
  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind);
  let count = 0;
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && SOURCE_RE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function toRepoPath(root, abs) {
  return relative(root, abs).split('\\').join('/');
}

function fullScan(root) {
  const abs = walk(resolve(root, SCAN_DIR), []);
  const counts = new Map();
  for (const file of abs) {
    const n = countAny(readFileSync(file, 'utf8'), file);
    if (n > 0) counts.set(toRepoPath(root, file), n);
  }
  return { counts, scope: `${abs.length} 个源文件` };
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function stagedScan(root) {
  const names = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter((p) => p === SCAN_DIR || p.startsWith(`${SCAN_DIR}/`))
    .filter((p) => SOURCE_RE.test(p));
  const counts = new Map();
  for (const path of names) {
    // 读索引里的 blob，不读工作区：要判的是「即将进入提交的那份内容」。
    const source = git(root, ['show', `:${path}`]);
    const n = countAny(source, path);
    if (n > 0) counts.set(path, n);
  }
  return { counts, scope: names.length === 0 ? '暂存区无 overlay 源文件' : `${names.length} 个暂存源文件` };
}

export function readBaseline(path) {
  if (!existsSync(path)) return { error: `基线文件不存在：${path}（先跑 --update-baseline）` };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { error: `基线文件解析失败：${path} —— ${error.message}` };
  }
  if (!raw || typeof raw !== 'object' || typeof raw.files !== 'object' || raw.files === null) {
    return { error: `基线文件形状不合法（缺 files 对象）：${path}` };
  }
  const files = {};
  for (const [file, count] of Object.entries(raw.files)) {
    if (!Number.isInteger(count) || count < 0) {
      return { error: `基线文件条数不合法：${file} = ${JSON.stringify(count)}` };
    }
    files[file] = count;
  }
  return { files };
}

/**
 * 对照。返回 { violations, improvements, stale, additions }
 *   violations  = 回增（count > baseline）
 *   additions   = 基线里没有的文件出现 any
 *   improvements= 条数下降（通过，但要提示收紧基线）
 *   stale       = 基线里有、现在扫描集里已经没有 any 的文件
 */
export function evaluate(counts, baselineFiles, { partial = false } = {}) {
  const violations = [];
  const additions = [];
  const improvements = [];
  const seen = new Set();
  for (const [file, count] of counts) {
    seen.add(file);
    const base = baselineFiles[file];
    if (base === undefined) {
      additions.push({ file, count });
    } else if (count > base) {
      violations.push({ file, base, count });
    } else if (count < base) {
      improvements.push({ file, base, count });
    }
  }
  // staged 模式只看暂存集，「基线里有、本次没出现」是常态（不是清零）；只有全量模式才把缺席解读为清零。
  const stale = partial
    ? []
    : Object.entries(baselineFiles)
        .filter(([file]) => !seen.has(file))
        .map(([file, count]) => ({ file, base: count }));
  return { violations, additions, improvements, stale };
}

function writeBaseline(path, counts) {
  const files = {};
  for (const file of [...counts.keys()].sort()) files[file] = counts.get(file);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const body = {
    $comment: '按文件基线的显式 any 棘轮。只允许减少；新增文件/回增会被 node scripts/check-no-explicit-any.mjs 拦下。',
    scope: SCAN_DIR,
    total,
    files,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return { total, files: Object.keys(files).length };
}

function main(argv) {
  const opts = parseArgs(argv);

  let scanned;
  try {
    scanned = opts.staged ? stagedScan(opts.root) : fullScan(opts.root);
  } catch (error) {
    console.error(`${P}无法取证（${opts.staged ? 'staged' : 'full'}）：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    console.error(`${P}取证失败不等同于通过，按失败处理`);
    return 2;
  }

  if (opts.update) {
    const written = writeBaseline(opts.baseline, scanned.counts);
    const mode = opts.staged ? '仅本次暂存集' : '全量';
    console.log(`${P}✓ 基线已重写（${mode}）：${written.files} 个文件 / ${written.total} 处 any → ${opts.baseline}`);
    if (opts.staged) {
      console.warn(`${P}⚠ --staged 只会把暂存集写进基线，会丢掉其他文件；收紧基线请用全量模式。`);
    }
    return 0;
  }

  const baseline = readBaseline(opts.baseline);
  if (baseline.error) {
    console.error(`${P}${baseline.error}`);
    return 2;
  }

  const { violations, additions, improvements, stale } = evaluate(scanned.counts, baseline.files, { partial: opts.staged });

  for (const item of violations) {
    console.error(`${P}✖ 回增：${item.file}  ${item.base} → ${item.count}（+${item.count - item.base}）`);
  }
  for (const item of additions) {
    console.error(`${P}✖ 新增：${item.file}  出现 ${item.count} 处 any（基线里没有这个文件）`);
  }
  if (violations.length > 0 || additions.length > 0) {
    console.error(`${P}口径：显式 any 只减不增。请消掉新增的 any，或改用真实类型。`);
    console.error(`${P}确属合理新增时，必须由评审在提交说明里给出理由并把基线一起更新（不要静默 --update-baseline）。`);
    return 1;
  }

  for (const item of improvements) {
    console.log(`${P}↓ 已减少：${item.file}  ${item.base} → ${item.count}（建议跑 --update-baseline 收紧基线）`);
  }
  for (const item of stale) {
    console.log(`${P}↓ 已清零：${item.file}（基线 ${item.base}，可跑 --update-baseline 移除）`);
  }

  const total = [...scanned.counts.values()].reduce((a, b) => a + b, 0);
  console.log(
    `${P}✓ ${opts.staged ? 'staged' : '全量'}模式：${scanned.scope}，当前 ${scanned.counts.size} 个文件 / ${total} 处 any，` +
      `均未超过基线；${improvements.length + stale.length > 0 ? `有 ${improvements.length + stale.length} 项可收紧。` : '基线保持。'}`,
  );
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
