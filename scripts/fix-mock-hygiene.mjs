#!/usr/bin/env node
/**
 * 自动补测试文件的 mock 卫生钩子。
 *
 * ## 为什么需要它
 *
 * `apps/web/test/mock-hygiene.test.ts` 要求：跨模块 `vi.mock(` 的测试文件必须有
 * `vi.resetModules()` 兜底（isolate:false 下同 worker 的后续文件会拿到假模块）。
 * 这条规则拦得对，但**每新加一个测试文件就可能踩一次**——2026-10-29 一晚上追了三轮，
 * 每轮都是「守卫红 → 手工补 afterAll → 又来一个新文件」。守卫本身没法自愈，
 * 于是把「补钩子」做成确定性操作，谁加文件谁跑一下，或直接丢进 pre-commit。
 *
 * ## 做法
 *
 * 1. 扫测试文件：有跨模块 `vi.mock(`（目标是包名/`@scope`，不是 `./` 相对路径）
 *    且全文没有 `vi.resetModules()` 的，视为待补；
 * 2. 在**第一条 `describe(` 之前**插入 `afterAll(() => { vi.resetModules() })`；
 * 3. 把 `afterAll` 加进 vitest 的 import（已导入就不动）。
 *
 * 幂等：补过一次后 `vi.resetModules()` 已存在，再跑不会重复插入。
 *
 * ## 用法
 *
 *   node scripts/fix-mock-hygiene.mjs           # 只报告工作区，不改
 *   node scripts/fix-mock-hygiene.mjs --apply   # 真改工作区
 *   node scripts/fix-mock-hygiene.mjs --head    # 只报告 HEAD（pre-push 用）
 *
 * ## 为什么 pre-push 要按 HEAD 扫
 *
 * 推送出去的只有 HEAD。按工作区扫会把**并行会话尚未提交的测试文件**算进来：
 * 2026-10-31 实测，同事 19:06 新建的 video-shrink-confirm.test.ts 还缺兜底，
 * 我的推送（只含 gate 脚本）被它挡下两次——而那个文件根本不在我要推的提交里。
 * pre-commit 的 --changed 已管本次提交集，全仓口径归 HEAD 与 CI。
 * 反过来，HEAD 里真积累出的缺口照样会被这一档点名（甲加 mock、乙忘了补 afterAll）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

/** 与 mock-hygiene.test.ts 同口径：只有包名 / @scope 开头的目标才算跨模块 */
const CROSS_MODULE_MOCK = /vi\.mock\(\s*['"](@[^'"]+|[a-z@][^'".]*[a-z])['"]/;

const SCAN_DIRS = ["apps/web-overlay/test", "apps/web/test", "apps/api/test", "packages/store/test", "packages/core/test", "packages/ai/test", "scripts"];

function testFiles() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry.name) && statSync(full).isFile()) out.push(full);
    }
  };
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  return out;
}

/**
 * mock 卫生的两条规则（与 mock-hygiene.test.ts 同口径）：
 *   1. 跨模块 vi.mock → 必须有 vi.resetModules()；
 *   2. 写 process.env.X = → 必须有 afterAll（清理挂载点）。
 * 两条任一不满足就补一个 afterAll，钩子体统一清模块缓存。
 */
const ENV_WRITE = /process\.env\.[A-Z_]+\s*=(?!=)/;

export function needsHook(src) {
  if (src.includes("mock-hygiene: exempt")) return false;
  const crossModuleMock = src.includes("vi.mock(") && CROSS_MODULE_MOCK.test(src);
  const writesEnv = ENV_WRITE.test(src);
  if (!crossModuleMock && !writesEnv) return false;
  if (crossModuleMock && !src.includes("vi.resetModules()")) return true;
  if (writesEnv && !/\bafterAll\b/.test(src)) return true;
  return false;
}

/**
 * HEAD 口径的违规清单：`entries` 是 `{ path, src }`，只认测试文件。
 *
 * 纯函数，让「工作区里的未跟踪文件不算数、HEAD 里的缺口算数」这条行为可被单测钉住。
 */
export function findHygieneViolations(entries) {
  return entries
    .filter((entry) => /\.test\.tsx?$/.test(entry.path) && needsHook(entry.src))
    .map((entry) => entry.path);
}

/** HEAD 下的全部候选测试文件及其内容（内容取 git blob，不受工作区与换行符影响） */
function headEntries() {
  const listed = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", "--full-tree", "HEAD", "--", ...SCAN_DIRS],
    { cwd: ROOT, encoding: "utf8" },
  );
  return listed
    .split(/\r?\n/)
    .filter((path) => /\.test\.tsx?$/.test(path))
    .map((path) => ({
      path,
      src: execFileSync("git", ["show", `HEAD:${path}`], { cwd: ROOT, encoding: "utf8" }),
    }));
}

/**
 * 补上 afterAll 兜底。返回改写后的源码；已是干净的原样返回。
 * 纯函数，便于回归。
 */
export function addResetModulesHook(src) {
  if (!needsHook(src)) return src;

  // 1) import 里带上 afterAll 与 vi（钩子体调 vi.resetModules()，缺 vi 会 ReferenceError）
  let out = src.replace(
    /^import\s*\{([^}]*)\}\s*from\s*['"]vitest['"];?\s*$/m,
    (whole, names) => {
      const list = names.split(",").map((s) => s.trim()).filter(Boolean);
      let changed = false;
      for (const need of ["afterAll", "vi"]) {
        if (!list.includes(need)) {
          list.push(need);
          changed = true;
        }
      }
      if (!changed) return whole;
      // 保持原分隔风格：单行还是多行由原 import 决定
      const joined = whole.includes("\n") ? list.join(",\n  ") : list.join(", ");
      return whole.replace(names.trim(), joined);
    },
  );

  // 2) 在第一条 describe( 之前插入钩子
  const hook =
    "\n// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的\n" +
    "// 跨模块 mock 与 process.env 改写，这里统一清掉。\n" +
    "afterAll(() => {\n  vi.resetModules();\n});\n";
  const idx = out.indexOf("\ndescribe(");
  if (idx === -1) {
    // 没有 describe：追加到文件末尾
    return out.trimEnd() + "\n" + hook;
  }
  return out.slice(0, idx) + hook + out.slice(idx);
}

function main() {
  /**
   * `--head`：pre-push 档。只判 HEAD——推送出去的只有 HEAD，
   * 工作区里别人的在途测试不参与（见文件头 2026-10-31 的实测）。
   * 只报告不修：HEAD 是历史，不能就地改。
   */
  if (process.argv.includes("--head")) {
    const violations = findHygieneViolations(headEntries());
    if (violations.length === 0) {
      console.log("✅ mock 卫生（HEAD，即本次推送的内容）：所有跨模块 mock 的测试文件都已有 vi.resetModules() 兜底");
      return;
    }
    console.log(`⚠ mock 卫生（HEAD）：${violations.length} 个已入库文件缺 vi.resetModules() 兜底：`);
    for (const path of violations) console.log(`  · ${path}`);
    console.log("修复方式：在工作区补齐 afterAll 后提交；HEAD 不能就地改。");
    process.exit(1);
  }

  /**
   * `--changed`：只扫位置参数里给的文件，不扫全仓。
   *
   * pre-commit 用这个档——全仓扫描会把**并行会话在途的文件**也拦进我的提交
   * （2026-10-30 实测：我改了 tools 的测试，门禁却因为对方一个没提交的测试文件
   * 把我挡住，而那个文件还依赖它没入库的源码，连锁卡死）。
   * 全仓口径归全量测试里的 `apps/web/test/mock-hygiene.test.ts`。
   */
  const changedIdx = process.argv.indexOf("--changed");
  const useChanged = changedIdx !== -1;
  const explicit = useChanged
    ? process.argv.slice(changedIdx + 1).filter((a) => !a.startsWith("--")).map((p) => join(ROOT, p)).filter((p) => existsSync(p))
    : null;

  const candidates = explicit ?? testFiles();
  const targets = [];
  for (const file of candidates) {
    if (!/\.test\.tsx?$/.test(file)) continue; // --changed 传进来的可能是源码，只看测试文件
    const src = readFileSync(file, "utf8");
    if (!needsHook(src)) continue;
    targets.push({ file, src });
  }

  if (targets.length === 0) {
    console.log("✅ mock 卫生：所有跨模块 mock 的测试文件都已有 vi.resetModules() 兜底");
    return;
  }

  if (!APPLY) {
    console.log(`⚠ mock 卫生：${targets.length} 个文件缺 vi.resetModules() 兜底（加 --apply 自动补）：`);
    for (const t of targets) console.log(`  · ${relative(ROOT, t.file).replace(/\\/g, "/")}`);
    process.exit(1);
  }

  for (const { file, src } of targets) {
    writeFileSync(file, addResetModulesHook(src), "utf8");
    console.log(`已补 afterAll 兜底：${relative(ROOT, file).replace(/\\/g, "/")}`);
  }
  console.log(`\n共补 ${targets.length} 个文件。`);
}

const invokedDirectly = process.argv[1] && /fix-mock-hygiene\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
