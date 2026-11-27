#!/usr/bin/env node
/**
 * raw palette 棘轮守卫（零依赖除 typescript，Node >= 20）
 *
 * 背景：globals.css 建了完整的语义 Token（success/pinned/category/info/destructive
 * 系，含高对比模式归一），但组件层长期直接写 bg-emerald-500 / text-blue-700 之类的
 * Tailwind 调色板类——这些颜色：① 未经 AA 对比度实测；② 高对比模式的归一规则
 * （[class*="bg-card/"] 等）覆盖不到；③ 与 Token 体系并行成两套色彩事实源
 * （2026-11-25 UI 评审 P2-6）。存量约 5500 处，一次性清零不现实，也不能放任增长——
 * 本守卫采用与 check-no-explicit-any.mjs 同款的 **按文件基线、只减不增**：
 *   - 每个当前含 raw palette 类的文件在 scripts/no-raw-palette-baseline.json 记一个条数；
 *   - 已有文件条数 > 基线 → 失败（回增）；
 *   - 基线里没有的文件出现 → 失败（新增债务）；
 *   - 条数比基线少 → 通过，并提示跑 --update-baseline 把基线收紧。
 *
 * 计数口径：TypeScript 语法树里只数**字符串字面量**（StringLiteral、无替换模板、
 * 模板的静态 chunk）中的类名——注释与标识符里的 "bg-blue-500" 不算（写迁移说明
 * 时可以自由引用旧类名）。命中的类名模式：
 *   {text|bg|border|ring|fill|stroke|from|to|via|decoration|outline|divide|accent|
 *    caret|shadow|placeholder|underline|selection}-{16 个彩色 hue}-{档位}[/透明度]
 * 灰阶（gray/zinc/slate/neutral/stone）与语义 Token 类（bg-success 等）不在范围内；
 * hue 前带 hover:/dark: 等变体前缀照样命中。动态拼接（`bg-${x}-500`）抓不到，
 * 属已知盲区——评审把关。
 *
 * 范围：apps/web-overlay/src 下的 .ts/.tsx（apps/web 是生成物，不作为事实源）。
 * registry/ 是上游 shadcn 副本（不是我们的色彩纪律），跳过。
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

const P = '[no-raw-palette] ';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = 'apps/web-overlay/src';
const BASELINE_FILE = 'scripts/no-raw-palette-baseline.json';
const SOURCE_RE = /\.(ts|tsx)$/;
// registry/ = 上游 shadcn 副本，不纳入本仓的色彩纪律（与 any 棘轮同口径跳过生成物）。
const SKIP_DIRS = new Set(['node_modules', '.next', 'registry']);

const USAGE = `用法：node scripts/check-no-raw-palette.mjs [--staged] [--update-baseline]
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

/** 彩色 hue 白名单（灰阶不进本守卫：它们的治理是另一条线）。 */
const HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
].join('|');

const PREFIXES = [
  'text', 'bg', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'via',
  'decoration', 'outline', 'divide', 'accent', 'caret', 'shadow',
  'placeholder', 'underline', 'selection',
].join('|');

/** 前面不能是类名字符（拦住 my-bg-blue-500 这类词内误报）；变体前缀 hover:bg-… 照样命中。 */
export const PALETTE_CLASS_RE = new RegExp(
  `(?<![a-zA-Z0-9-])(?:${PREFIXES})-(?:${HUES})-\\d+(?:\\/\\d+)?`,
  'g',
);

/** 数一段字符串字面量文本里的 raw palette 类名（可多次命中）。 */
export function countPaletteInText(text) {
  const re = new RegExp(PALETTE_CLASS_RE.source, 'g');
  let count = 0;
  while (re.exec(text) !== null) count += 1;
  return count;
}

/**
 * 数一份源码里的 raw palette 类名。只看字符串字面量（含模板静态 chunk）——
 * 注释与标识符里写「原 bg-emerald-500 已迁移」不会被计数，迁移说明可自由引用旧类名。
 */
export function countPalette(source, filePath = 'x.tsx') {
  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind);
  let count = 0;
  const visit = (node) => {
    if (
      node.kind === ts.SyntaxKind.StringLiteral ||
      node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      count += countPaletteInText(node.text);
    } else if (
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      count += countPaletteInText(node.text);
    }
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
    const n = countPalette(readFileSync(file, 'utf8'), file);
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
    .filter((p) => SOURCE_RE.test(p))
    .filter((p) => !p.split('/').includes('registry'));
  const counts = new Map();
  for (const path of names) {
    // 读索引里的 blob，不读工作区：要判的是「即将进入提交的那份内容」。
    const source = git(root, ['show', `:${path}`]);
    const n = countPalette(source, path);
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
 *   additions   = 基线里没有的文件出现
 *   improvements= 条数下降（通过，但要提示收紧基线）
 *   stale       = 基线里有、现在扫描集里已经没有的文件
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
    $comment:
      '按文件基线的 raw palette 棘轮（bg-emerald-500 等彩色调色板类）。只允许减少；新增文件/回增会被 node scripts/check-no-raw-palette.mjs 拦下。色彩一律走 globals.css 的语义 Token。',
    scope: `${SCAN_DIR}（跳过 registry/ 上游副本）`,
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
    console.log(`${P}✓ 基线已重写（${mode}）：${written.files} 个文件 / ${written.total} 处 → ${opts.baseline}`);
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
    console.error(`${P}✖ 新增：${item.file}  出现 ${item.count} 处 raw palette 类（基线里没有这个文件）`);
  }
  if (violations.length > 0 || additions.length > 0) {
    console.error(`${P}口径：raw palette 类只减不增。请改用语义 Token（bg-success / text-info-foreground / bg-pinned/10 …，见 globals.css）。`);
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
    `${P}✓ ${opts.staged ? 'staged' : '全量'}模式：${scanned.scope}，当前 ${scanned.counts.size} 个文件 / ${total} 处 raw palette 类，` +
      `均未超过基线；${improvements.length + stale.length > 0 ? `有 ${improvements.length + stale.length} 项可收紧。` : '基线保持。'}`,
  );
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
