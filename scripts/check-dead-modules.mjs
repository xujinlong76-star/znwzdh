#!/usr/bin/env node
/**
 * 死模块候选扫描（task-2 / 守卫 1）
 *
 * 静态扫 apps/web-overlay/src 下 .ts/.tsx 的 import 关系，找出「0 引用」模块。
 * 这是**候选清单守卫**（棘轮），不是编译器的 tree-shaking 结论：
 *   - 排除 Next.js 框架入口（page/layout/route/loading/error/opengraph-image/
 *     manifest/robots/sitemap/proxy/middleware 等）、index barrel、.d.ts 声明文件；
 *   - 仓库事实：apps/web-overlay 是 NavHub 自研覆盖层，vendor 时与 vendored
 *     底座 apps/web 合并（见 scripts/generate-web-mirror.mjs）。overlay 里
 *     '@/components/ui/card' 这类说明符在 overlay 自身并不存在，但合并后由
 *     apps/web/src 提供。因此解析顺序为「先 overlay 自身、再 web 镜像」，
 *     且只把「指向 overlay 模块」的引用计入引用计数。
 *   - BASELINE 是首次实测登记的历史候选；只有「不在基线里的新候选」才判红。
 *     基线项会如实输出（不隐藏），基线项消失会提示可清理（只降不升）。
 *
 * 用法：node scripts/check-dead-modules.mjs [--json] [--update]
 * 退出码：0 通过；1 出现新增 0 引用候选；2 形状错误（目录缺失 / 参数非法）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OVERLAY_SRC = join(ROOT, "apps", "web-overlay", "src");
const WEB_SRC = join(ROOT, "apps", "web", "src");
const NL = String.fromCharCode(10);
const P = "[dead-modules] ";
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const UPDATE = argv.includes("--update");
const UNKNOWN = argv.filter((a) => a !== "--json" && a !== "--update");

/** 首次实测（2026-11-06）登记的 0 引用候选；新增项才判红。 */
let BASELINE = [
  "apps/web-overlay/src/app/admin/navigation/components/AddCategoryForm.tsx",
  "apps/web-overlay/src/app/admin/navigation/components/AddItemForm.tsx",
  "apps/web-overlay/src/components/quick-access-tray.tsx",
  "apps/web-overlay/src/components/speculative-prerender.tsx",
  "apps/web-overlay/src/components/ui/search-input.tsx",
  "apps/web-overlay/src/components/video-scrubber-preview.tsx",
  "apps/web-overlay/src/components/video-heatmap-timeline.tsx",
  "apps/web-overlay/src/components/video-shader-filter.tsx",
  "apps/web-overlay/src/components/video-spectrogram-canvas.tsx",
  "apps/web-overlay/src/components/video-neural-audio-controls.tsx",
  "apps/web-overlay/src/components/video-danmaku-mesh-monitor.tsx",
  "apps/web-overlay/src/components/video-audio-stem-mixer-dialog.tsx",
  "apps/web-overlay/src/components/video-p2p-swarm-hud.tsx",
  "apps/web-overlay/src/components/video-terminal-player.tsx",
  "apps/web-overlay/src/lib/lazy-dnd.tsx",
  "apps/web-overlay/src/lib/session.ts",
  "apps/web-overlay/src/registry/new-york/ui/chart.tsx",
  "apps/web-overlay/src/registry/new-york/ui/input-otp.tsx",
  "apps/web-overlay/src/registry/new-york/ui/toggle.tsx",
];

/**
 * 基线条目的**逐项结论**（2026-11-08 复核）。
 *
 * 为什么需要：基线原先只登记「0 引用」这个事实，不记录**为什么保留**，于是
 * 「基线只防新增、不催收清理」，也没人知道哪些能删、哪些删了会炸。
 * 本门禁的静态分析有四个已知盲区，下列结论正是逐项核对这些盲区得出的：
 *   A. 模块别名目标（package.json 的 imports/别名，构建期解析，静态 import 看不见）
 *   B. 跨文件**字符串契约**（DOM id / data 属性等，不是 import）
 *   C. 守卫测试按**源码路径**读取并断言（readFileSync，文件不存在即失败）
 *   D. vendored 覆盖 / 上游占位（删了会让 vendored 目录重建或 tsc 失败）
 *
 * 结论分两类：
 *   keep   —— 必须保留（命中 A/B/C/D 之一；删除会破坏机制或让守卫测试变红）
 *   delete —— 真死，可安全删除（删除时须同步 apps/web 镜像与 BASELINE 条目）
 *
 * 复核到的铁证（行内已注明）：
 *   - lazy-dnd.tsx          属于 A：`"@hello-pangea/dnd": "./src/lib/lazy-dnd.tsx"` 别名目标
 *   - chart.tsx             属于 D：为修 CI tsc 存量错误刻意纳入 overlay 的 vendored 覆盖
 *   - session.ts            属于 D：为上游 vendored 文件保留的空模块（header 已注明）
 *   - speculative-prerender.tsx 属于 C：prerender-cleanup-guard.test.ts 读源码断言
 *   - quick-access-tray.tsx 属于 B+C：quick-jump-bar 用 DOM id 关联 + 效率测试读源码
 *   - search-input.tsx      属于 C：a11y-token-contrast.test.ts 的 CONTROL_FILES 读源码
 *   - input-otp.tsx         属于 C：同上 CONTROL_FILES
 * 可安全删除（仅需同步镜像与基线）：
 *   - VideoIconUpload.tsx / video-scrubber-preview.tsx / components/notification-badge.tsx
 *     （最后一个注意与**活跃**的 lib/notification-badge.ts 区分：前者是组件、后者是工具）
 */
let BASELINE_NOTES = {
  "apps/web-overlay/src/app/admin/navigation/components/AddCategoryForm.tsx":
    "keep（C 守卫测试）：test/admin-lazy-guard.test.ts 按源码路径读取包装器并断言其 dynamic 懒加载形态；同目录 .impl 才引表单库，包装器本身无业务引用是该模式的预期形态（2026-11-10 复核）",
  "apps/web-overlay/src/app/admin/navigation/components/AddItemForm.tsx":
    "keep（C 守卫测试）：同 AddCategoryForm，admin-lazy-guard.test.ts 按源码路径读取断言（2026-11-10 复核）",
  "apps/web-overlay/src/registry/new-york/ui/toggle.tsx":
    "keep（C 守卫测试）：a11y-token-contrast.test.ts 的 CONTROL_FILES 清单按源码路径读取并断言 border-border-strong（2026-11-10 复核）",
  "apps/web-overlay/src/lib/lazy-dnd.tsx":
    "keep（A 别名目标）：package.json 把 @hello-pangea/dnd 指向本文件，构建期解析；另有 types/hello-pangea-dnd-deep.d.ts 与 test/lazy-dnd-guard.test.ts 依赖",
  "apps/web-overlay/src/registry/new-york/ui/chart.tsx":
    "keep（D vendored 覆盖）：为修 CI tsc 存量 recharts 类型错误刻意纳入 overlay（docs/UPGRADE-EXECUTION-2026-10-18.md 第五轮更正）；删除会被 vendored 重建覆盖回坏版本",
  "apps/web-overlay/src/lib/session.ts":
    "keep（D 上游占位）：上游 src/lib/session.ts 依赖已移除的 iron-session，本文件是覆盖用的空模块，删了 tsc 会 Cannot find module",
  "apps/web-overlay/src/components/speculative-prerender.tsx":
    "keep（C 守卫测试）：test/prerender-cleanup-guard.test.ts 按源码路径读取断言；注意业务引用的是同名的 lib/speculative-prerender.ts",
  "apps/web-overlay/src/components/ui/search-input.tsx":
    "keep（C 守卫测试）：a11y-token-contrast.test.ts 的 CONTROL_FILES 用 readFileSync 读取并断言 border-border-strong",
  "apps/web-overlay/src/registry/new-york/ui/input-otp.tsx":
    "keep（C 守卫测试）：同上 CONTROL_FILES 清单",
  "apps/web-overlay/src/components/quick-access-tray.tsx":
    "keep（B 字符串契约 + C 守卫测试）：category-quick-jump-bar.tsx 按 DOM id 'quick-access-tray' 关联；navigation-efficiency-enhancements.test.ts 读源码断言",
  "apps/web-overlay/src/app/admin/videos/components/VideoIconUpload.tsx":
    "delete（真死）：除基线与文档索引外无任何引用（含字符串/测试/别名）",
  "apps/web-overlay/src/components/video-scrubber-preview.tsx":
    "delete（真死）：除基线外无引用；视频播放器未接入（接入前勿删，见 2026-11-08 外部改动）",
  "apps/web-overlay/src/components/notification-badge.tsx":
    "delete（真死）：组件级死代码；勿与活跃的 lib/notification-badge.ts（unreadBadgeText）混淆",
  "apps/web-overlay/src/components/video-heatmap-timeline.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：章节热力图无全站观众回放数据源，曲线为本地合成；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
  "apps/web-overlay/src/components/video-shader-filter.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：CAS 锐化对 iframe 嵌入视频无任何渲染消费者，调参零效果；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
  "apps/web-overlay/src/components/video-spectrogram-canvas.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：频谱为正弦+噪声合成，与实际播放音频无关；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
  "apps/web-overlay/src/components/video-neural-audio-controls.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：神经降噪控制器从未接进任何 AudioContext 音频链路；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
  "apps/web-overlay/src/components/video-danmaku-mesh-monitor.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：P2P 弹幕网格无传输层，节点/延迟均为本地虚构；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
  "apps/web-overlay/src/components/video-audio-stem-mixer-dialog.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：分轨混音从未有音频喂入，推子不影响声音；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
  "apps/web-overlay/src/components/video-p2p-swarm-hud.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：P2P 分片加速无 RTCPeerConnection，分片只是内存记账；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
  "apps/web-overlay/src/components/video-terminal-player.tsx":
    "keep（入口已下线，2026-11-11 播放器审计第二批）：终端回放是按章节合成的录像，并非视频的真实终端记录；播放器已按『无数据不给入口』移除入口，组件保留待接入真实数据后恢复，勿当普通死代码删除（其 lib 依赖仍由本组件引用）",
};

// ---------- 形状校验（退出码 2） ----------
function shapeError(msg) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, exitCode: 2, error: "shape", message: msg }, null, 2));
  else console.error(P + "❌ 形状错误：" + msg);
  process.exit(2);
}
if (UNKNOWN.length) shapeError("未知参数：" + UNKNOWN.join(" "));
if (!existsSync(OVERLAY_SRC)) shapeError("找不到 apps/web-overlay/src");
if (!Array.isArray(BASELINE) || BASELINE.some((x) => typeof x !== "string")) shapeError("BASELINE 形状非法");

// ---------- 收集文件 ----------
const EXTS = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "coverage", ".vercel", ".turbo"]);
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (EXTS.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const overlayFiles = walk(OVERLAY_SRC);
const webFiles = existsSync(WEB_SRC) ? walk(WEB_SRC) : [];
if (!overlayFiles.length) shapeError("apps/web-overlay/src 下没有 .ts/.tsx 文件");

// 相对 src 根的正斜杠小写键 → 绝对路径（overlay 优先）
const fwd = (p) => p.replaceAll("\\", "/").toLowerCase();
const byRel = new Map();
for (const f of [...overlayFiles, ...webFiles]) {
  const under = f.startsWith(OVERLAY_SRC) ? relative(OVERLAY_SRC, f) : relative(WEB_SRC, f);
  const k = fwd(under);
  if (!byRel.has(k)) byRel.set(k, f);
}

/** 框架入口 / barrel / 声明文件：由框架按约定加载，不算「0 引用死模块」。 */
const FRAMEWORK_ENTRY = /(?:^|[/\\])(?:page|layout|route|loading|error|global-error|not-found|template|default|middleware|instrumentation|providers|manifest|robots|sitemap|opengraph-image|twitter-image|icon|apple-icon|proxy)\.(?:ts|tsx)$/;
const BARREL = /(?:^|[/\\])index\.(?:ts|tsx)$/;
const DECLARATION = /\.d\.ts$/;
const isExcluded = (f) => FRAMEWORK_ENTRY.test(f) || BARREL.test(f) || DECLARATION.test(f);

/** 解析局部说明符：@/ → src 根；./ ../ → 相对当前文件。返回绝对路径或 null。 */
const CAND_SUFFIX = ["", ".ts", ".tsx", ".mts", ".cts", "/index.ts", "/index.tsx"];
function resolveLocal(fromFile, spec) {
  let rel;
  if (spec.startsWith("@/")) rel = spec.slice(2);
  else if (spec.startsWith(".")) {
    const base = resolve(dirname(fromFile), spec);
    if (base.startsWith(OVERLAY_SRC)) rel = relative(OVERLAY_SRC, base);
    else if (base.startsWith(WEB_SRC)) rel = relative(WEB_SRC, base);
    else return null;
  } else return null; // 裸包名（react / lucide-react / next 等）不参与本地引用图
  rel = fwd(rel);
  for (const s of CAND_SUFFIX) {
    const hit = byRel.get(rel + s);
    if (hit) return hit;
  }
  return null;
}

/** 抽取 import/export from、动态 import()、require() 的说明符。 */
const SPEC_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
function extractSpecs(text) {
  const out = [];
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(text))) {
    const s = m[1] ?? m[2] ?? m[3];
    if (s) out.push(s);
  }
  return out;
}

// 引用计数：只统计「指向 overlay 自身模块」的引用
const overlayKey = new Set(overlayFiles.map(fwd));
const refs = new Map(overlayFiles.map((f) => [fwd(f), 0]));
const unresolved = [];
for (const f of [...overlayFiles, ...webFiles]) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const spec of extractSpecs(text)) {
    if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
    const target = resolveLocal(f, spec);
    if (!target) { unresolved.push({ file: relative(ROOT, f).replaceAll("\\", "/"), spec }); continue; }
    const k = fwd(target);
    if (overlayKey.has(k)) refs.set(k, (refs.get(k) ?? 0) + 1);
  }
}

const candidates = overlayFiles
  .filter((f) => !isExcluded(f) && (refs.get(fwd(f)) ?? 0) === 0)
  .map((f) => relative(ROOT, f).replaceAll("\\", "/"))
  .sort();

const known = new Set(BASELINE);
const brandNew = candidates.filter((c) => !known.has(c));
const stale = BASELINE.filter((c) => !candidates.includes(c));

if (UPDATE) {
  // --update 只打印「把下面这些登记进 BASELINE」，不改动任何已存在文件：
  // 本脚本自身是唯一允许写入的文件，但为了并行会话安全，这里刻意只输出结果。
  console.log(P + "当前候选（复制进 BASELINE 即完成登记，" + candidates.length + " 项）：");
  console.log(JSON.stringify(candidates, null, 2));
  process.exit(0);
}

const result = {
  ok: brandNew.length === 0,
  exitCode: brandNew.length ? 1 : 0,
  scanned: { overlayFiles: overlayFiles.length, webMirrorFiles: webFiles.length, localSpecsUnresolved: unresolved.length },
  totalCandidates: candidates.length,
  baseline: BASELINE,
  baselineNotes: BASELINE_NOTES,
  brandNew,
  staleBaselineEntries: stale,
  candidates,
  unresolvedSample: unresolved.slice(0, 20),
};
if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(P + "扫描 overlay " + overlayFiles.length + " 个模块（web 镜像 " + webFiles.length + " 个），0 引用候选 " + candidates.length + " 个");
  for (const c of candidates) {
    const note = BASELINE_NOTES[c];
    console.log(P + (known.has(c) ? "· 基线 " : "❌ 新增 ") + c + (note ? "  ⟶ " + note : ""));
  }
  // 新登记的候选若还没做取舍，提醒补结论 —— 避免基线退化成「只防新增、不催收」
  const unclassified = BASELINE.filter((b) => !BASELINE_NOTES[b]);
  if (unclassified.length) console.log(P + "ℹ 以下基线项尚无结论（请在 BASELINE_NOTES 补 keep/delete 与理由）：" + unclassified.join("、"));
  if (stale.length) console.log(P + "ℹ 以下基线项已不再命中，可移出 BASELINE：" + stale.join("、"));
  if (brandNew.length) console.error(P + "❌ 出现 " + brandNew.length + " 个新增 0 引用候选（见上），请确认是死代码还是漏了引用");
  else console.log(P + "✅ 无新增死模块候选（基线 " + BASELINE.length + " 项）");
}
process.exit(brandNew.length ? 1 : 0);
