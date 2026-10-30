#!/usr/bin/env node
/**
 * Monorepo 统一自动化验证门禁 (Monorepo Verification Gate)
 * 跨平台设置 4GB V8 堆内存上限，避免多工作线程并发执行 AI/AST 时触发 OOM。
 *
 * 输出铁律：结尾只报「跑了几项、跳了几项、没覆盖什么」，不报「100% 通过」。
 * 首屏预算这类依赖构建产物的步骤，本地经常跳过；把它算进「通过」等于
 * 用一条绿灯掩盖一个没测的事实——CI 与人都会据此认为覆盖面比实际更大。
 *
 * ## 三档（2026-10-29 起）
 *
 * | 命令 | 内容 | 耗时 |
 * |---|---|---|
 * | `node scripts/verify.mjs` | 语法/覆盖层/CI 门禁/镜像/扩展/lint/typecheck/组件契约/全库文本不变量/首屏预算 | 约 1–2 分钟 |
 * | `node scripts/verify.mjs --guards` | 只跑组件契约 + 全库文本不变量 | 约 15 秒 |
 * | `node scripts/verify.mjs --full` | 默认档 + **全量测试**（400+ 文件） | **20 分钟以上** |
 *
 * 为什么拆：全量测试实测跑到 22 分 38 秒仍未结束（`maxWorkers: 3`），
 * 结果就是「没人跑 `pnpm verify`」——那等于全量门禁不存在，比跑得慢更糟。
 * 拆开之后默认档能在 2 分钟内给出可信结论，全量档留给「专门安排时间」的场合。
 *
 * 为什么 `--guards` 另成一档：全库文本不变量（吞异常、硬编码口令、未包扎的外部
 * URL、无名字控件……）过去只躺在全量档里，而全量档实际上没人跑——守卫写了等于没写。
 * 它们合计约 10 秒，既可进默认档，也值得在提交前单独跑一遍。
 *
 * ⚠️ 全量档**不能与其它任务并行**：机器满载会让墙钟型断言假红
 * （已实测：`backup-restore-job` 的耗时用例在并发下误报）。
 *
 * ⚠️ 取证命令**不要用管道收尾**（`… | tail -40`）：管道的退出码是 tail 的 0，
 * vitest 明明报了 `2 failed`，harness 仍会看到 rc=0。要看结论只读汇总行
 * （`Test Files … failed` / `Tests … failed`），不要截断输出。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideTestOutcome, escalateFlaky, parseFailedTestFiles } from "./lib/test-retry.mjs";

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim(),
};

/** 已执行的步骤与因前置条件不满足而跳过的步骤，最后如实汇总 */
const passed = [];
const skipped = [];

function run(label, cmd, args, options = {}) {
  console.log(`\n[verify] ----------------------------------------------------`);
  console.log(`[verify] 执行: ${label}`);
  console.log(`[verify] ----------------------------------------------------`);
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true, env, ...options });
  if (res.status !== 0) {
    console.error(`\n❌ [verify] 门禁在以下步骤失败 (exit ${res.status}): ${label}`);
    console.error(`[verify] 已完成 ${passed.length} 项；本次没有「全部通过」这回事。`);
    process.exit(res.status ?? 1);
  }
  passed.push(label);
}

function skip(label, reason) {
  console.log(`\n[verify] 跳过 ${label}：${reason}\n`);
  skipped.push({ label, reason });
}

/**
 * 临时目录残留：**只提示，不阻断**。
 *
 * 为什么不做成门禁：这是本机环境问题，不是代码问题；而且 CI 容器用完即弃，
 * 不存在跨 job 累积——放进 CI 只会永远绿。做成一行常驻提示的目的是「让它可见」：
 * 这类垃圾没人看就没人管。2026-10-25 一次清出 820MB / 796 个目录（最早 6 天前）。
 *
 * 不设阈值：设了就会「要么天天响（变噪音）、要么永远不响（等于没有）」，
 * 而一行数字本身不吵。
 *
 * 放在**最前面**而不是末尾：verify 是顺序执行、任一步失败即退出，
 * 放末尾的话只要前面有一步红（例如覆盖层漂移），这条提示就永远看不到。
 */
(() => {
  const r = spawnSync(process.execPath, ["scripts/clean-temp-probes.mjs", "--json"], { encoding: "utf8" });
  if (r.status !== 0) return; // 工具缺失/出错都不该影响 verify
  const line = String(r.stdout ?? "").trim().split("\n").pop() ?? "";
  try {
    const info = JSON.parse(line);
    if (info.matched > 0) {
      const mb = Math.round(info.bytes / 1024 / 1024);
      console.log(
        `[verify] 临时目录残留 ${info.matched} 个 / ${mb}MB —— 清理：node scripts/clean-temp-probes.mjs（先看清单，再加 --apply）`,
      );
    }
  } catch {
    // 解析失败就算了：这是提示，不值得让 verify 报错
  }
})();


/* ------------------------------------------------------------------ *
 * --changed：按改动文件挑门禁
 *
 * 为什么需要：默认档已有 11 步，改一行文档也要跑全套。`--changed` 用
 * `git diff --name-only` 判断哪些门禁真的可能被影响，其余**显式 skip**
 * （进最后的「未执行」清单，不伪装成通过）。
 * ------------------------------------------------------------------ */
const CHANGED_MODE = process.argv.includes("--changed");

function changedFiles() {
  try {
    const base = process.env.VERIFY_BASE || "HEAD";
    const out = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const CHANGED = CHANGED_MODE ? changedFiles() : null;
const touches = (prefix) => (CHANGED ?? []).some((f) => f.startsWith(prefix));

/** 代码或测试改动才可能影响文本不变量守卫；纯文档改动不必为它付 10 秒 */
const GUARD_INPUT_PREFIXES = [
  "apps/web-overlay/src/",
  "apps/web-overlay/test/",
  "apps/web/src/",
  "apps/web/test/",
  "apps/api/",
  "packages/",
  "extensions/",
];
const touchesGuardInputs = () => (CHANGED ?? []).some((f) => GUARD_INPUT_PREFIXES.some((p) => f.startsWith(p)));

/**
 * 全库文本不变量守卫（源文件扫描，不依赖构建产物）。
 *
 * 收录标准：判据是「扫源码文本」，不属于任何单页/单组件的行为测试；
 * 每个文件秒级、合计约 10 秒。**不收录**视频/插件等业务套件——它们属于全量档。
 *
 * 测试执行面是 apps/web/test（overlay/test 是源，镜像由 check-web-overlay 保证
 * 逐字节一致；vitest 不会收集 overlay/test，见 vitest.config.ts 的注释）。
 */
const GUARD_TESTS = [
  "silent-catch",
  "mock-hygiene",
  "url-hygiene",
  "client-hardcoded-credentials",
  "tw-source-coverage",
  "tw-variant-guard",
  "tailwind-source",
  "field-names",
  "control-names",
  "label-association",
  "nested-interactive",
  "keyboard-activation",
  "main-landmark",
  "a11y-contrast",
  "design-system",
  "indexation-policy",
  "seo-invariants",
  "canonical-coverage",
  "json-ld",
].map((name) => `apps/web/test/${name}.test.ts`);

/**
 * 直接用 node 调 vitest，不经过 `pnpm exec`：pnpm 在 `.bin` 缺失（一次中断的安装
 * 就是这样）时会先尝试修复安装状态，可能触发二次安装；而依赖树是否健康由
 * `node scripts/doctor.mjs` 负责报告，这里只负责跑测试。
 */
const VITEST_ARGV = ["node_modules/vitest/vitest.mjs", "run"];

/** 条件门禁：--changed 模式下不相关就 skip，其余模式一律执行 */
function gate(label, cmd, args, shouldRun, options) {
  if (!CHANGED_MODE || shouldRun) run(label, cmd, args, options);
  else skip(label, `--changed：本次改动未触及相关文件（${CHANGED.length} 个变更）`);
}

function runGuardTier() {
  run("组件 props 契约", "node", ["scripts/check-component-contracts.mjs"]);
  run(`全库文本不变量（${GUARD_TESTS.length} 个文件）`, "node", [...VITEST_ARGV, ...GUARD_TESTS]);
}

/**
 * 默认档（含 --changed 的条件门禁）。
 *
 * 包成函数是为了让 `--guards` 走另一条分支；分支里不能写 `process.exit(0)`
 * 提前结束——Windows 上管道输出是异步的，直接 exit 会把汇总截断
 * （scripts/doctor.mjs 头部记过同一个坑）。
 */
function runStandardTier() {
  // 语法解析门禁放最前：秒级，先把「少一个括号」这类错误挡在 tsc 之前。
  run("语法解析", "node", ["scripts/check-syntax.mjs"]);
  // 依赖完整性同样秒级，而且它挡的是**环境损坏**而非代码问题：包装残了会让
  // 几百个测试套件同时报「找不到模块 / resolve entry 失败」，看起来像代码全坏。
  // 先在这里认出「是依赖残了」，省掉一整轮无谓的排查（2026-10-29 一天两次）。
  run("依赖完整性", "node", ["scripts/check-deps-integrity.mjs"]);
  gate("覆盖层同步", "node", ["scripts/check-web-overlay.mjs"], touches("apps/web-overlay/") || touches("apps/web/"));
  // 网关策略表由枢纽注册声明生成；枢纽新增路由没重跑生成器 = 网关按旧白名单放行/拒绝，
  // 这类分叉只在真实请求时才暴露，所以必须在这里挡住。
  gate("网关路由策略新鲜度", "node", ["scripts/gen-hub-route-policy.mjs", "--check"], touches("apps/api/src/routes/") || touches("packages/core/src/route-policy"));
  gate("CI 合并门禁", "node", ["scripts/check-ci-gate.mjs"], touches(".github/workflows/") || touches("scripts/check-ci-gate"));
  run("提交完整性（已跟踪文件不引用未入库文件）", "node", ["scripts/check-committed-refs.mjs"]);
  run("依赖边界（vendored 底座 / 分层单向）", "node", ["scripts/check-import-boundaries.mjs"]);
  run("同构副本一致性", "node", ["scripts/sync-vendored.mjs", "--check"]);
  gate("core 镜像一致", "node", ["scripts/sync-core-mirrors.mjs", "--check"], touches("packages/core/src/") || touches("apps/web-overlay/src/lib/"));
  gate("扩展校验", "node", ["scripts/check-extensions.mjs"], touches("extensions/"));
  // 后端 lint 已是硬门禁（error + --max-warnings 0），必须进这条链：
  // 只在 CI 单独跑的规则等于没有规则，本地会一路绿灯直到推上去才红。
  // 直接调各包自己的 eslint，不走 `pnpm --filter … run lint`：pnpm 在 .bin 缺失时
  // 会先尝试修复安装状态（见上），而 lint 本身与这层包装无关。
  const lintShouldRun = touches("apps/api/") || touches("packages/");
  gate("后端 lint（api）", "node", ["node_modules/eslint/bin/eslint.js", ".", "--max-warnings", "0"], lintShouldRun, {
    cwd: "apps/api",
  });
  gate("后端 lint（store）", "node", ["node_modules/eslint/bin/eslint.js", ".", "--max-warnings", "0"], lintShouldRun, {
    cwd: "packages/store",
  });
  gate("类型检查", "node", ["scripts/typecheck.mjs"], touches("apps/api/") || touches("packages/"));
  // 组件 props 契约（零依赖静态分析，见该脚本头注释）：当前基线为 0 处问题，
  // 因此这里不做基线豁免——任何一条都是真的不一致（改名漏改调用方 / 死字段）。
  gate(
    "组件 props 契约",
    "node",
    ["scripts/check-component-contracts.mjs"],
    touches("apps/web-overlay/src/") || touches("apps/web/src/"),
  );
  gate("全库文本不变量", "node", [...VITEST_ARGV, ...GUARD_TESTS], touchesGuardInputs());

  // 口径提示：typecheck 只覆盖 @navhub/*（apps/web 是 vendored 底座），前端
  // tsc / eslint / next build 在 CI 的 test-web 作业里，e2e 在 test-e2e 作业里。
  // 本脚本绿灯 ≠ CI 绿灯；本地要补前端门禁用 `pnpm verify:web`。
  console.log(
    "\n[verify] 提示：本门禁不含前端 tsc / eslint / next build 与 Playwright（CI 口径见 ci.yml 的 test-web / test-e2e）\n",
  );

  // 首屏预算：只有存在构建产物时才检查。CI 的 test-web 在 build 后显式调用，
  // 本地 `pnpm verify` 若没 build 则明确提示而不是静默跳过。
  const webDist = "apps/web/.next";
  if (existsSync(`${webDist}/build-manifest.json`) || existsSync(`${webDist}/app-build-manifest.json`)) {
    run("首屏预算", "node", ["scripts/check-bundle-budget.mjs"]);
  } else {
    skip("首屏预算", `未找到 ${webDist} 构建产物（先运行 pnpm --filter navsphere build 才会检查）`);
  }

  /**
   * 全量测试：只有 `--full` 才跑。
   *
   * 用 `skip()` 而不是静默略过——`skip` 会进最后的「未执行」清单，
   * 明确告诉读者「这一项本次没有发生，不代表通过」。这正是这个脚本的输出铁律。
   *
   * **失败后只重跑红的文件**：全量 566 文件跑 15 分钟，而本机常有并行会话争用，
   * 高并发下单用例超时是常态（2026-10-30 三次实测：连跑两次即绿）。整段重跑
   * 等于再花 15 分钟，而红的往往只有一两个文件。重跑仍红才是真回归。
   */
  if (process.argv.includes("--full")) {
    runFullTests();
  } else {
    skip(
      "全量测试",
      "默认档不含（400+ 文件，实测 20 分钟以上且不能并行）。要跑：node scripts/verify.mjs --full",
    );
  }
}

/**
 * 全量测试 + 「只重跑红文件」的收敛。
 *
 * 三段式：全量 → 抽出红的文件 → 只跑它们。第二段全绿就当作抖动放行，
 * 但**必须在输出里点名是哪些文件抖过**，不许默默当通过（输出铁律）。
 */
function runFullTests() {
  console.log(`\n[verify] ----------------------------------------------------`);
  console.log(`[verify] 执行: 全量测试`);
  console.log(`[verify] ----------------------------------------------------`);
  const first = spawnSync("node", VITEST_ARGV, { stdio: "pipe", shell: true, env, encoding: "utf8" });
  const out1 = (first.stdout ?? "") + (first.stderr ?? "");
  process.stdout.write(out1);

  const failed = parseFailedTestFiles(out1);
  const firstOk = first.status === 0;
  if (firstOk) {
    // 全绿就清零抖动计数：只对「反复抖」敏感，修好了不该继续背着历史
    try {
      unlinkSync(resolve(".git", "navhub-flaky.json"));
    } catch {
      // 没有计数文件就不用清
    }
    passed.push("全量测试");
    return;
  }

  console.log(`\n[verify] 全量测试首轮 ${failed.length} 个文件红；只重跑这些文件判定是抖动还是真回归：`);
  for (const f of failed) console.log(`[verify]   · ${f}`);

  const retryOk = failed.length > 0 && spawnSync("node", [...VITEST_ARGV, ...failed], { stdio: "inherit", shell: true, env }).status === 0;
  const verdict = decideTestOutcome({ firstOk, failedFiles: failed, retryOk });

  if (verdict.kind === "flaky") {
    /**
     * 累进：同一文件被抖动放行到阈值就转红。
     * 放行一次是宽容，放行十次就是把守卫变成摆设——反复抖的文件是真脆弱
     * （依赖墙钟 / 全局状态 / 网络），该修的是它，不是每次重跑蒙混过关。
     * 计数落在 .git/ 下（不入库，随仓库走）；全绿时清零。
     */
    const flakyPath = resolve(".git", "navhub-flaky.json");
    let history = {};
    try {
      history = JSON.parse(readFileSync(flakyPath, "utf8"));
    } catch {
      history = {};
    }
    const { counts, escalated } = escalateFlaky(history, failed, 3);
    if (escalated.length > 0) {
      writeFileSync(flakyPath, JSON.stringify(counts, null, 2), "utf8");
      console.error(`\n❌ [verify] 全量测试：这些文件已被抖动放行 3 次，判定为真脆弱测试，不再放行：`);
      for (const f of escalated) console.error(`   · ${f}（累计 ${counts[f]} 次）`);
      console.error(`[verify] 请修掉它的脆弱性（墙钟断言 / 全局状态 / 网络依赖），而不是继续靠重跑。`);
      console.error(`[verify] 已完成 ${passed.length} 项；本次没有「全部通过」这回事。`);
      process.exit(1);
    }
    writeFileSync(flakyPath, JSON.stringify(counts, null, 2), "utf8");
    console.log(`\n⚠️ [verify] 全量测试：${verdict.message}`);
    console.log(`[verify] 抖动计数已记入 ${flakyPath}；同文件累计 3 次将转红。`);
    passed.push("全量测试（抖动放行）");
    return;
  }
  console.error(`\n❌ [verify] 全量测试：${verdict.message}`);
  console.error(`[verify] 已完成 ${passed.length} 项；本次没有「全部通过」这回事。`);
  process.exit(1);
}

// --guards：只跑文本不变量与组件契约，约 15 秒。提交前的最小技术底线。
if (process.argv.includes("--guards")) runGuardTier();
else runStandardTier();

printSummary();

function printSummary() {
  console.log(`\n[verify] ----------------------------------------------------`);
  console.log(`[verify] 通过 ${passed.length} 项：${passed.join("、")}`);
  if (skipped.length > 0) {
    console.log(`[verify] 跳过 ${skipped.length} 项（这些检查本次没有发生，不代表通过）：`);
    for (const s of skipped) console.log(`  - ${s.label}：${s.reason}`);
  }
  console.log(
    `[verify] 未覆盖：前端 tsc / eslint / next build、Playwright e2e（本地用 pnpm verify:web 与 pnpm test:e2e 补跑）`,
  );
  if (!process.argv.includes("--full")) {
    console.log(`[verify] 未覆盖：全量测试（本次为默认档；用 pnpm verify:full 跑，约 20 分钟以上，勿与其它任务并行）`);
  }
  console.log("");
  console.log(
    `✅ [verify] 上述 ${passed.length} 项全部退出码 0${skipped.length > 0 ? `（另有 ${skipped.length} 项未执行）` : ""}。`,
  );
}
