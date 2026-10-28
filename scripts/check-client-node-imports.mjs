#!/usr/bin/env node
/**
 * 客户端模块图门禁：`'use client'` 够得着的任何文件，都不许 import node 内建模块。
 *
 * 为什么必须有（2026-10-28 真实事故）：`apps/web-overlay/src/lib/media-proxy.ts` 为了
 * 给封面 URL 签名写了 `import { createHmac } from 'node:crypto'`，而 `'use client'`
 * 的 `video-card.tsx` 直接 import 了这个 lib。Next 把整条客户端图打进浏览器包，
 * 于是 node 的 crypto/buffer 垫片被内联进首屏 JS——实测 `/videos` 首屏 **+476 KB**，
 * 把 `/videos` 与 `/videos/player` 两条首屏预算一起压红。更糟的是 tsc / eslint /
 * next build 全绿，只有排在最后的 `check-bundle-budget` 才报，而体积红了看不出原因。
 * 顺带第二个后果：签名兜底密钥 `MEDIA_PROXY_SECRET` 的默认值也被打进浏览器产物。
 *
 * 本门禁在源码层挡住同一类问题，只依赖两条静态事实：
 *   1. 指令边界：文件第一处非空、非注释语句是 `'use client'`（与 Next 的判定同口径）；
 *   2. 引用边：`import` / `export … from` / `require()` / 动态 `import()`。
 *   客户端组件 import 的无指令模块同样进浏览器包，所以边按**传递闭包**走到底。
 *
 * 刻意不算的（写明，避免假装有精度）：
 *   - `import type` / `export type` 在编译期被整条擦除，不构成边。真实例子：
 *     `admin/videos/components/HarvestModal.tsx` 只 `import type` 了 video-harvester，
 *     于是 `bilibili-wbi.ts` 的 `node:crypto` 并不进浏览器包——算成违规就是假红灯。
 *     `import { type X } from 'y'` 这种行内写法仍按真实边处理（保守，宁多报不漏报）。
 *   - 模板字符串里的示例代码不是引用：`video-ocr-code-extractor-dialog.tsx` 的 OCR
 *     演示文案里有一句 `import { createServer } from 'node:http'`。
 *   - 第三方包内部的 node 依赖不在射程内（那是打包器的取舍，本仓库无此类实例）。
 *
 * 检查对象默认是 **HEAD 的提交内容**：钩子在推送前跑，推出去的是提交而不是工作区；
 * 多会话并行时别人的未提交改动不该挡你的推送。排查用 `--working-tree`。
 *
 * 用法：node scripts/check-client-node-imports.mjs [--json] [--ref <git-ref>] [--working-tree]
 * 退出码：0 = 干净；1 = 有违规或有陈旧例外；2 = 参数/仓库状态错误。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractSpecifiers, maskTemplateLiterals, normalizePath, resolveSpecifier, stripComments } from "./lib/source-refs.mjs";

const ROOT = process.cwd();

/** 扫描范围：vendored 底座的源真相。apps/web/src 由它生成，不重复判。 */
const SRC_ROOT = "apps/web-overlay/src";
const SOURCE_RE = /\.(ts|tsx|js|jsx)$/;
const ALIAS_ROOTS = { "@/": SRC_ROOT };

/**
 * node 内建（裸名写法）。带 `node:` 前缀的一律算内建；裸名只在命中这张表时报，
 * 免得把同名的 npm 包误伤。裸名在打包器里要么「解析不到」要么静默 polyfill，两种都不该上线。
 */
const BARE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http",
  "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process",
  "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys",
  "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

/** 说明符 → 内建段名；不是内建返回 ""。`node:dns/promises` 按 `dns` 算。 */
export function builtinSegment(spec) {
  if (!spec) return "";
  const first = (spec.startsWith("node:") ? spec.slice(5) : spec).split("/")[0];
  if (!first) return "";
  if (spec.startsWith("node:")) return first;
  return BARE_BUILTINS.has(first) ? first : "";
}

/**
 * 例外登记处：只放「确实需要、且有明确理由」的边。
 * 每条必须带 reason；不再命中就判为陈旧例外并失败——例外不能烂尾。
 */
const EXCEPTIONS = [];

/**
 * 整条擦除类型引用语句（编译期不存在，不是运行时的边）。
 *
 * 逐行扫而不是一个大正则：`import type` 有两种真实形状——
 *   - 单行：`import type { R } from '@/lib/video-harvester'`
 *   - 跨行：`import type {\n  A,\n} from '@/lib/x'`（本仓库有）
 * 而 `export type { A }` 这种**没有 from** 的纯类型再导出，如果用「向后找 from」
 * 的写法会把下一条真实 `import … from 'y'` 一起吃掉 —— 那是漏检，比假红灯严重得多。
 * 所以按大括号是否闭合决定吞几行，边界只由语法本身决定。
 */
export function maskTypeOnlyImports(text) {
  const lines = text.split("\n");
  const braceDelta = (line) => {
    let d = 0;
    for (const ch of line) {
      if (ch === "{") d += 1;
      else if (ch === "}") d -= 1;
    }
    return d;
  };
  let i = 0;
  while (i < lines.length) {
    if (!/^(?:import|export)\s+type\s/.test(lines[i].trimStart())) {
      i += 1;
      continue;
    }
    let j = i;
    let depth = braceDelta(lines[j]);
    while (depth > 0 && j + 1 < lines.length) {
      j += 1;
      depth += braceDelta(lines[j]);
    }
    for (let k = i; k <= j; k += 1) lines[k] = " ".repeat(lines[k].length);
    i = j + 1;
  }
  return lines.join("\n");
}

/** 客户端源码视图：遮模板串 → 遮类型引用 → 剥注释（都不改动行号） */
function view(text) {
  return maskTypeOnlyImports(maskTemplateLiterals(text));
}

/** 第一处非空、非注释语句是不是 'use client'（Next 要求指令先于一切代码） */
export function hasUseClientDirective(text) {
  const code = stripComments(view(text));
  for (const line of code.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    return /^['"]use client['"]\s*;?$/.test(t);
  }
  return false;
}

/**
 * 纯函数：给定「仓库相对路径 → 源码」，算客户端闭包与其中的 node 内建引用。
 * 拆出来是为了能在夹具里同时钉住「漏检」和「假红灯」两个方向。
 * `exceptions` 默认用上面登记的例外；夹具要能自己喂一份，否则「陈旧例外」这条
 * 规则只能靠真的往仓库里塞一条例外来测——那正是它会烂尾的方式。
 */
export function analyzeSources(contents, { exceptions = EXCEPTIONS } = {}) {
  const has = (p) => contents.has(p);
  const roots = [];
  for (const [path, text] of contents) {
    if (hasUseClientDirective(text)) roots.push(path);
  }

  const parent = new Map();
  const inGraph = new Set(roots);
  const queue = [...roots];
  const hits = [];

  while (queue.length > 0) {
    const file = queue.shift();
    const text = contents.get(file) ?? "";
    const code = view(text);
    for (const { spec, line } of extractSpecifiers(code)) {
      const seg = builtinSegment(spec);
      if (seg) {
        hits.push({ file, line, spec, node: seg });
        continue;
      }
      const target = resolveSpecifier(file, spec, { aliasRoots: ALIAS_ROOTS, exists: has });
      if (!target || !has(target) || inGraph.has(target)) continue;
      inGraph.add(target);
      parent.set(target, file);
      queue.push(target);
    }
  }

  const chainOf = (file) => {
    const chain = [file];
    let cur = file;
    while (parent.has(cur)) {
      cur = parent.get(cur);
      chain.unshift(cur);
    }
    return chain;
  };

  const violations = [];
  const matched = new Set();
  for (const hit of hits) {
    const exc = exceptions.find((e) => e.file === hit.file && e.spec === hit.spec);
    if (exc) {
      matched.add(exc);
      continue;
    }
    violations.push({ ...hit, entry: chainOf(hit.file)[0], chain: chainOf(hit.file) });
  }

  return {
    scanned: contents.size,
    clientRoots: roots.length,
    graphFiles: inGraph.size,
    violations,
    exceptions: exceptions.filter((e) => matched.has(e)),
    staleExceptions: exceptions.filter((e) => !matched.has(e)),
  };
}

function gitBuf(args, input) {
  const r = spawnSync("git", args, { cwd: ROOT, input, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} 失败：${(r.stderr ? r.stderr.toString("utf8") : "").trim()}`);
  }
  return r.stdout;
}

/**
 * 批量读 ref 里的源码：一次 `git cat-file --batch`，不是每文件一次 `git show`。
 * 客户端闭包要读 450+ 个文件，逐个子进程实测 29 s——pre-push 里没人会留着这种闸门。
 * 注意 blob 的 size 是**字节数**，所以必须按 Buffer 切片再解码（本仓库源码里全是中文，
 * 用 utf8 字符串的 length 切会错位）。
 */
function readTree(ref) {
  const listing = gitBuf(["ls-tree", "-r", "--name-only", "-z", ref, "--", SRC_ROOT]).toString("utf8");
  const paths = listing.split("\0").filter((p) => p && SOURCE_RE.test(p)).map(normalizePath);
  const contents = new Map();
  if (paths.length === 0) throw new Error(`ref ${ref} 下 ${SRC_ROOT} 一个源码文件都没读到`);
  const out = gitBuf(["cat-file", "--batch"], Buffer.from(paths.map((p) => `${ref}:${p}`).join("\n") + "\n", "utf8"));
  let i = 0;
  for (const path of paths) {
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
    if (header.endsWith(" missing")) {
      i = nl + 1;
      continue;
    }
    throw new Error(`git cat-file --batch 输出解析不了（位置 ${i}）：${header.slice(0, 80)}`);
  }
  if (contents.size === 0) throw new Error(`ref ${ref} 下 ${SRC_ROOT} 一个源码文件都没读到`);
  return contents;
}

/** 工作区模式：递归读目录。只用于本地排查，钩子与 CI 都走 ref 模式。 */
function readWorkingTree() {
  const contents = new Map();
  const walk = (absDir, relDir) => {
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile() && SOURCE_RE.test(entry.name)) {
        contents.set(`${SRC_ROOT}/${rel}`, readFileSync(abs, "utf8"));
      }
    }
  };
  walk(resolve(ROOT, SRC_ROOT), "");
  if (contents.size === 0) throw new Error(`工作区里 ${SRC_ROOT} 一个源码文件都没读到`);
  return contents;
}

/** 供 pre-push 闸门与测试复用 */
export function run({ ref = "HEAD", workingTree = false } = {}) {
  const contents = workingTree ? readWorkingTree() : readTree(ref);
  return { contents, result: analyzeSources(contents) };
}

function formatChain(chain) {
  return chain.map((f, i) => (i === 0 ? `${f}  ← 'use client' 入口` : f)).join("\n      →  ");
}

function main(argv) {
  const asJson = argv.includes("--json");
  const refIdx = argv.indexOf("--ref");
  const ref = refIdx >= 0 ? argv[refIdx + 1] : "HEAD";
  const workingTree = argv.includes("--working-tree");

  let result;
  try {
    ({ result } = run({ ref, workingTree }));
  } catch (error) {
    console.error(`❌ 客户端模块图门禁跑不起来：${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const bad = result.violations.length + result.staleExceptions.length;
  if (asJson) {
    console.log(JSON.stringify({ ref: workingTree ? "working-tree" : ref, ...result }, null, 2));
  } else if (bad > 0) {
    const stale = result.staleExceptions.length;
    console.error(
      `❌ 客户端模块图里有 ${result.violations.length} 处 node 内建引用` +
        (stale ? `，另有 ${stale} 条形同虚设的例外` : ""),
    );
    for (const v of result.violations) {
      console.error(`   ${v.file}:${v.line}  →  ${v.spec}`);
      console.error(`      引入链：${formatChain(v.chain)}`);
    }
    for (const e of result.staleExceptions) {
      console.error(`   例外已陈旧：${e.file} → ${e.spec}（源码里已经没有这条引用，请删掉例外）`);
    }
    console.error("\n   为什么要拦：'use client' 组件 import 到的模块会一起打进浏览器包，");
    console.error("   node 内建再带上 polyfill 垫片（本仓库实测首屏 +476 KB），兜底密钥之类还可能被内联进产物。");
    console.error("   修复：把用到 node 内建的逻辑移到服务端（route handler / Server Component），");
    console.error("   客户端只消费签好的 URL 或接口结果；确需保留时在 EXCEPTIONS 登记带理由的例外。");
  } else {
    console.log(
      `✅ 客户端模块图：扫描 ${result.scanned} 个文件，${result.clientRoots} 个 'use client' 入口，` +
        `闭包内 ${result.graphFiles} 个文件，node 内建引用 0 处。`,
    );
    for (const e of result.exceptions) console.log(`   显式例外：${e.file} → ${e.spec} — ${e.reason}`);
  }
  return bad > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
