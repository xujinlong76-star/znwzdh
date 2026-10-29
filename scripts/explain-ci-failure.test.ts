import { describe, expect, it, vi, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSnapshot,
  collectAttribution,
  fetchResilient,
  fetchWithRetry,
  main,
  snapshotFileName,
  writeSnapshot,
} from "./explain-ci-failure.mjs";
import {
  classifyFailure,
  cleanLogLines,
  diffFailures,
  extractAttribution,
  FAILURE_LAYERS,
  failingStep,
  failureKey,
  fixHintFor,
  isFailedJob,
  isSupersededCancel,
  LAYER_FIX_HINTS,
  layerCounts,
  parseRepoSlug,
  renderAttributionTable,
  renderBaselineDiff,
  renderFixHints,
  splitSuperseded,
  summarizeJob,
  waitForRunConclusion,
} from "./lib/ci-attribution.mjs";
import {
  MAX_ANNOTATIONS,
  annotationLine,
  annotationLines,
  collectFailures,
  escapeData,
  escapeProperty,
  lineFromStack,
} from "./vitest-github-reporter.mjs";

/**
 * CI 红灯归因的纯函数层。
 *
 * 这层代码的唯一用途是**在红灯时给出可执行的下一步**，所以测试重点不是
 * 「输出好看」，而是：根因分层不被表象带偏（ECONNREFUSED + ISR 断言失败
 * 必须归到环境），以及 `##[error]` 这种工具主动标注优先于日志里的偶然
 * `Error:` 字样。
 */
// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("cleanLogLines：去噪但不动行数", () => {
  it("剥掉 ANSI 色码与 Actions 行首时间戳", () => {
    const raw = "\u001b[31m2026-10-27T10:34:49.1234567Z error TS2307\u001b[0m\r\n2026-10-27T10:34:50.1Z done";
    expect(cleanLogLines(raw)).toEqual(["error TS2307", "done"]);
  });

  it("空输入返回空数组", () => {
    expect(cleanLogLines("")).toEqual([]);
    expect(cleanLogLines(undefined as any)).toEqual([]);
  });
});

describe("classifyFailure：按根因优先级分层", () => {
  it("包没装上是依赖层，哪怕日志后面还有构建错误", () => {
    const { layer, signals } = classifyFailure("ERR_PNPM_NO_MATCHING_VERSION  No matching version\nFailed to compile");
    expect(layer).toBe("依赖");
    expect(signals[0]).toContain("ERR_PNPM");
  });

  it("环境故障优先于契约断言（ISR 红是因为中枢没起来）", () => {
    const log = "ECONNREFUSED 127.0.0.1:4000\nISR 抽查失败：sitemap 契约不满足";
    expect(classifyFailure(log).layer).toBe("环境");
  });

  it("包装错误不参与分层：pnpm 递归失败只是「子命令失败」", () => {
    const log = "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  root@ test: `vitest run`\nerror TS2307: Cannot find module '@/lib/x'";
    expect(classifyFailure(log).layer).toBe("构建");
    // 只有包装错误时不许硬猜成依赖
    expect(classifyFailure("ELIFECYCLE  Command failed with exit code 1").layer).toBe("未知");
  });

  it("TypeScript 报错是构建层", () => {
    expect(classifyFailure("src/x.ts(3,1): error TS2307: Cannot find module '@/lib/x'").layer).toBe("构建");
  });

  it("契约门禁的固定文案是契约层", () => {
    expect(classifyFailure("check:rest-contracts 失败：生成物与源码同源校验不通过").layer).toBe("契约");
  });

  it("断言失败是运行时层", () => {
    expect(classifyFailure("FAIL packages/core/test/a.test.ts > x\nAssertionError: expected 1 to be 2").layer).toBe("运行时");
    // 注解正文里没有 AssertionError 前缀，只有断言文案
    expect(classifyFailure("expected false to be true // Object.is equality").layer).toBe("运行时");
  });

  it("runner 侧 self-installer 失败算环境层（真实 run #40654949211 分片 1/3）", () => {
    const log = "Something went wrong, self-installer exits with code 1\n##[error]Process completed with exit code 1.";
    const { layer, signals } = classifyFailure(log);
    expect(layer).toBe("环境");
    expect(signals.join(" ")).toContain("self-installer");
  });

  it("每个 job 日志都有的 Running self-installer 不许把代码红盖成环境问题", () => {
    // 真实 run #40659065545 覆盖层 job 的日志片段：装机那行是 runner 的常规开场，
    // 真正的失败是 core 镜像门禁。判据放宽到裸 self-installer 时这里会变成「环境」。
    const log = [
      "##[group]Running self-installer...",
      "##[group]Run node scripts/sync-core-mirrors.mjs --check",
      "[core-mirror] 1 个镜像与事实源不一致。修复：node scripts/sync-core-mirrors.mjs",
      "##[error]Process completed with exit code 1.",
    ].join("\n");
    expect(classifyFailure(log).layer).toBe("契约");
  });

  it("core 镜像不同源直接给重生成命令，不放契约层那条 rest-contracts 长命令", () => {
    const row = summarizeJob(
      { id: 1, name: "覆盖层与扩展规范性检查", conclusion: "failure", steps: [{ name: "Run node scripts/sync-core-mirrors.mjs --check", conclusion: "failure" }] },
      { logText: "[core-mirror] 1 个镜像与事实源不一致。修复：node scripts/sync-core-mirrors.mjs\n##[error]Process completed with exit code 1." },
    );
    expect(row.layer).toBe("契约");
    expect(row.fixHint.command).toBe("node scripts/sync-core-mirrors.mjs");
    // 同一条 override 不能被「镜像一致」的成功输出误触：判据只看归因头，而 OK 行不是错误行
    expect(summarizeJob({ id: 2, name: "x", conclusion: "failure" }, { logText: "[core-mirror] OK：13 个 verbatim 镜像一致" }).firstError).not.toContain("OK");
  });

  it("认不出来就是未知，不硬猜", () => {
    expect(classifyFailure("something odd happened").layer).toBe("未知");
    expect(classifyFailure("").layer).toBe("未知");
  });

  it("打包器解析不到本地源码算构建层，解析不到包名算依赖层", () => {
    expect(classifyFailure('✘ [ERROR] Could not resolve "./scripts/worker-budget.ts"').layer).toBe("构建");
    expect(classifyFailure('✘ [ERROR] Could not resolve "react"').layer).toBe("依赖");
  });
});

describe("extractAttribution：第一处具体错误 + 栈帧 + 尾巴", () => {
  const LOG = [
    "2026-10-27T10:00:00.000Z ##[group]Run pnpm test",
    "2026-10-27T10:00:01.000Z src/x.ts(3,1): error TS2307: Cannot find module '@/lib/x'",
    "2026-10-27T10:00:01.100Z     at runSuite (/repo/node_modules/vitest/dist/x.js:10:20)",
    "2026-10-27T10:00:03.000Z DEBUG tail line 1",
    "2026-10-27T10:00:03.100Z DEBUG tail line 2",
    "2026-10-27T10:00:04.000Z ##[error]Process completed with exit code 1.",
    "##[endgroup]",
    "",
  ].join("\n");

  it("跳过 exit code 包装行，取真正的原因行", () => {
    const { firstError } = extractAttribution(LOG);
    expect(firstError).toBe("src/x.ts(3,1): error TS2307: Cannot find module '@/lib/x'");
  });

  it("直接的工具注解（非包装）也能当归因头", () => {
    const log = "##[error]契约漂移：生成物与源码同源校验不通过\n##[error]Process completed with exit code 1.";
    expect(extractAttribution(log).firstError).toContain("契约漂移");
  });

  it("栈帧取错误行之后的第一条 at", () => {
    expect(extractAttribution(LOG).stackLine).toContain("runSuite");
  });

  it("尾巴保留末尾 N 行有效内容（含缩进），且不含 endgroup", () => {
    const { tail } = extractAttribution(LOG, { maxTail: 3 });
    expect(tail).toEqual([
      "DEBUG tail line 1",
      "DEBUG tail line 2",
      "##[error]Process completed with exit code 1.",
    ]);
  });

  it("自定义门禁的 [tag] 结论行能当归因头（没有 ##[error] 前缀）", () => {
    // 真实案例：sync-core-mirrors 只打印这一行，整条 job 的归因头因此是空的
    const log = "[core-mirror] 1 个镜像与事实源不一致。修复：node scripts/sync-core-mirrors.mjs\n##[error]Process completed with exit code 1.";
    expect(extractAttribution(log).firstError).toBe("[core-mirror] 1 个镜像与事实源不一致。修复：node scripts/sync-core-mirrors.mjs");
    // 测试里刻意注入的「失败」字样不在此列（那是注解要压制的那类噪音）
    expect(extractAttribution("[navhub] 审计写入失败（主操作结果不受影响）: Error: simulated").firstError).toContain("simulated");
  });

  it("没有任何错误行时 firstError 为空，不编造", () => {
    expect(extractAttribution("all good\nnothing to see").firstError).toBe("");
    expect(extractAttribution("##[error]Process completed with exit code 1.").firstError).toBe("");
  });

  it("esbuild：概览行是包装，取 ✘ [ERROR] 具体行并带上位置", () => {
    // 真实案例：vitest.config.ts 引用了未入库的 scripts/worker-budget.ts
    const log = [
      "✘ [ERROR] Could not resolve \"./scripts/worker-budget.ts\"",
      "",
      "    vitest.config.ts:4:36:",
      '      4 │ import { computeWorkerBudget } from "./scripts/worker-budget.ts";',
      "        ╵                                     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
      "",
      "failed to load config from /repo/vitest.config.ts",
      "",
      "⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯",
      "Error: Build failed with 1 error:",
      'vitest.config.ts:4:36: ERROR: Could not resolve "./scripts/worker-budget.ts"',
      "    at failureErrorWithLog (/repo/node_modules/esbuild/lib/main.js:1752:15)",
    ].join("\n");
    const { firstError, stackLine } = extractAttribution(log);
    expect(firstError).toBe('Could not resolve "./scripts/worker-budget.ts" (vitest.config.ts:4:36)');
    expect(stackLine).toContain("failureErrorWithLog");
  });

  it("只有构建概览/启动失败包装行时，不把它当成原因", () => {
    const log = ["failed to load config from /repo/vitest.config.ts", "⎯⎯⎯ Startup Error ⎯⎯⎯", "Error: Build failed with 1 error:"].join("\n");
    expect(extractAttribution(log).firstError).toBe("");
  });
});

describe("parseRepoSlug：三种 remote 形态", () => {
  it("https / ssh / 裸 slug 都能解析", () => {
    expect(parseRepoSlug("https://github.com/xujinlong76-star/znwzdh.git")).toBe("xujinlong76-star/znwzdh");
    expect(parseRepoSlug("https://github.com/xujinlong76-star/znwzdh")).toBe("xujinlong76-star/znwzdh");
    expect(parseRepoSlug("git@github.com:xujinlong76-star/znwzdh.git")).toBe("xujinlong76-star/znwzdh");
    expect(parseRepoSlug("xujinlong76-star/znwzdh")).toBe("xujinlong76-star/znwzdh");
  });

  it("解析不了返回空串", () => {
    expect(parseRepoSlug("")).toBe("");
    expect(parseRepoSlug("https://gitlab.com/a/b")).toBe("");
    expect(parseRepoSlug(null as any)).toBe("");
  });
});

describe("summarizeJob：一个 job 一行归因头", () => {
  const job = {
    id: 7,
    name: "测试（SQLite 默认方言）",
    conclusion: "failure",
    steps: [
      { name: "checkout", conclusion: "success" },
      { name: "运行测试", conclusion: "failure" },
      { name: "上传产物", conclusion: "skipped" },
    ],
  };

  it("失败步骤取 conclusion=failure 的那一步", () => {
    expect(failingStep(job)).toBe("运行测试");
  });

  it("注解参与分层，日志为空时归因头取注解正文", () => {
    const row = summarizeJob(job, {
      annotations: [{ title: "契约漂移", message: "生成物与源码同源校验不通过：apps/web-overlay/src/lib/rest-contracts.generated.ts", path: "x" }],
    });
    expect(row.layer).toBe("契约");
    expect(row.firstError).toContain("生成物与源码同源");
    expect(row.annotationCount).toBe(1);
  });

  it("日志兜底：没有注解时也能给出归因头与尾巴", () => {
    const row = summarizeJob(job, { logText: "##[error]pnpm test exited 1\nAssertionError: expected 2 to be 3" });
    expect(row.firstError).toBe("pnpm test exited 1");
    expect(row.notes ?? row.tail).toBeDefined();
    expect(row.layer).toBe("运行时");
  });

  it("注解优先于日志：测试里刻意打的错误日志不冒充根因", () => {
    // 真实案例：日志先出现测试注入的 simulated audit failure，真失败在注解里
    const row = summarizeJob(job, {
      logText: "[navhub] 审计写入失败（主操作结果不受影响）: Error: simulated audit failure\nAssertionError: expected false to be true",
      annotations: [
        { annotation_level: "failure", path: ".github", start_line: 657, message: "Process completed with exit code 1." },
        {
          annotation_level: "failure",
          path: "packages/store/test/migrate-dialect.test.ts",
          start_line: 56,
          title: "pg：部分唯一索引与身份索引都下发了",
          message: "expected false to be true // Object.is equality",
        },
        { annotation_level: "notice", path: ".github", start_line: 1, message: "runner 镜像迁移提醒" },
      ],
    });
    expect(row.firstError).toBe(
      "packages/store/test/migrate-dialect.test.ts:56 · pg：部分唯一索引与身份索引都下发了 · expected false to be true // Object.is equality",
    );
    expect(row.layer).toBe("运行时");
    expect(row.annotationCount).toBe(3);
  });

  it("注解里只有包装/通知时退回日志，不把 exit code 当归因头", () => {
    const row = summarizeJob(job, {
      logText: "src/x.ts(3,1): error TS2307: Cannot find module '@/lib/x'",
      annotations: [
        { annotation_level: "failure", path: ".github", start_line: 1, message: "Process completed with exit code 1." },
        { annotation_level: "notice", path: ".github", start_line: 2, message: "runner 提醒" },
      ],
    });
    expect(row.firstError).toContain("error TS2307");
    expect(row.layer).toBe("构建");
  });

  it("有注解时栈帧从注解所指文件的段落取，不拿别的文件的帧", () => {
    const logText = [
      "    at Repository.authCtx.repo.audit (/repo/apps/api/test/auth.test.ts:443:46)",
      " ❯ packages/store/test/migrate-dialect.test.ts (5 tests | 1 failed) 16ms",
      " FAIL  packages/store/test/migrate-dialect.test.ts > migrateSiteIndexes > pg：部分唯一索引",
      "AssertionError: expected false to be true",
      " ❯ packages/store/test/migrate-dialect.test.ts:56:106",
    ].join("\n");
    const row = summarizeJob(job, {
      logText,
      annotations: [
        {
          annotation_level: "failure",
          path: "packages/store/test/migrate-dialect.test.ts",
          start_line: 56,
          title: "pg：部分唯一索引",
          message: "expected false to be true",
        },
      ],
    });
    expect(row.stackLine).toContain("migrate-dialect.test.ts:56:106");
  });

  it("产物缺失警告不冒充归因头：真实失败注解在它后面也要被选中", () => {
    // 真实 run：upload-artifact 的警告排在 vitest 注解之前，归因头变成了「junit 不存在」
    const row = summarizeJob(job, {
      logText: "AssertionError: expected false to be true",
      annotations: [
        {
          annotation_level: "failure",
          path: ".github",
          start_line: 15,
          message: "No files were found with the provided path: junit-sqlite-*.xml. No artifacts will be uploaded.",
        },
        {
          annotation_level: "failure",
          path: "packages/store/test/migrate-dialect.test.ts",
          start_line: 56,
          title: "pg：部分唯一索引与身份索引都下发了",
          message: "expected false to be true // Object.is equality",
        },
      ],
    });
    expect(row.firstError).toContain("migrate-dialect.test.ts:56");
    expect(row.firstError).not.toContain("No files were found");
  });

  it("警告级注解不许冒充判红原因：真实 run #40916902103 的「前端门禁」作业", () => {
    // 那一步的失败级注解只有 `Process completed with exit code 1.`（包装，会被剥掉），
    // 剩下全是 eslint 警告（基线 0 error / 834 warning，警告不卡门禁）。按行序取头就把
    // 人引去清不存在的 lint 红——连着 11 轮如此，真红是 step 10 的首屏预算超限。
    const budgetJob = {
      id: 9,
      name: "前端门禁（Web typecheck / lint / build）",
      conclusion: "failure",
      steps: [
        { name: "Run pnpm --filter navsphere build", conclusion: "success" },
        { name: "Run node scripts/check-bundle-budget.mjs", conclusion: "failure" },
      ],
    };
    const row = summarizeJob(budgetJob, {
      annotations: [
        { annotation_level: "failure", path: ".github", start_line: 26, message: "Process completed with exit code 1." },
        {
          annotation_level: "warning",
          path: "apps/web/src/app/admin/collections/page.tsx",
          start_line: 19,
          message: "'Route' is defined but never used. Allowed unused vars must match /^_/u",
        },
      ],
    });
    expect(row.headLevel).toBe("warning");
    // 修复入口取「红的那一步」的原命令，而不是从警告文案推出来的层默认入口
    expect(row.fixHint.command).toBe("node scripts/check-bundle-budget.mjs");
    expect(row.fixHint.note).toContain("别照着警告文案改代码");
    expect(renderAttributionTable([row])).toContain("（警告级·非判红原因）");
  });

  it("失败级注解在场时，警告既不参与取头也不触发步骤改写", () => {
    // 覆盖面必须只针对「只剩警告」这一种情形：真实测试红里警告与失败注解同时存在，
    // 若把步骤命令抢过来，归因头明明指向具体用例、却让人去复跑整条 job。
    const row = summarizeJob(job, {
      annotations: [
        { annotation_level: "warning", path: "packages/store/test/a.test.ts", start_line: 3, message: "Unexpected any." },
        {
          annotation_level: "failure",
          path: "packages/store/test/b.test.ts",
          start_line: 8,
          title: "用例 B",
          message: "expected false to be true",
        },
      ],
    });
    expect(row.headLevel).toBe("failure");
    expect(row.firstError).toContain("packages/store/test/b.test.ts:8");
    expect(row.fixHint.command).toBe("node node_modules/vitest/vitest.mjs run packages/store/test/b.test.ts");
  });

  it("红的那一步不是命令（uses 步骤）时不编造修复入口", () => {
    const row = summarizeJob(
      { id: 3, name: "x", conclusion: "failure", steps: [{ name: "Run actions/checkout@v7", conclusion: "failure" }] },
      { annotations: [{ annotation_level: "warning", path: "a.ts", start_line: 1, message: "某个警告" }] },
    );
    expect(row.headLevel).toBe("warning");
    expect(row.fixHint.command).toBe(LAYER_FIX_HINTS.未知.command);
  });

  it("只有 workflow 上的注解时仍然用它，不因为降级而丢归因头", () => {
    const row = summarizeJob(job, {
      annotations: [{ annotation_level: "failure", path: ".github", start_line: 7, message: "Run failed: 镜像冒烟构建" }],
    });
    expect(row.firstError).toBe(".github:7 · Run failed: 镜像冒烟构建");
  });

  it("workflow 注解没有文件信息时，日志里的 TS 定位更具体，优先于它", () => {
    // 真实 run：tsc 的注解只有行号 863，看不出是哪个组件；日志有 src/components/x.tsx(863,41)
    const row = summarizeJob(job, {
      logText: "##[error]src/components/video-player-page.tsx(863,41): error TS7006: Parameter 'item' implicitly has an 'any' type.",
      annotations: [{ annotation_level: "failure", path: ".github", start_line: 863, message: "Parameter 'item' implicitly has an 'any' type." }],
    });
    expect(row.firstError).toContain("video-player-page.tsx(863,41)");
    expect(row.layer).toBe("构建");
  });

  it("聚合 job 归到汇总层，不把上游的字眼当根因", () => {
    const row = summarizeJob(
      { id: 99, name: "CI 整体通过 (All Checks Passed)", conclusion: "failure", steps: [{ name: "评估检查结果", conclusion: "failure" }] },
      { logText: "以下检查未通过：ISR 抽查、前端门禁" },
    );
    expect(row.layer).toBe("汇总");
    expect(row.signals).toEqual(["上游 job 失败"]);
  });

  it("取消 / 超时也算失败 job", () => {
    expect(isFailedJob({ conclusion: "cancelled" })).toBe(true);
    expect(isFailedJob({ conclusion: "timed_out" })).toBe(true);
    expect(isFailedJob({ conclusion: "success" })).toBe(false);
    expect(isFailedJob(null)).toBe(false);
  });
});

describe("renderAttributionTable / layerCounts", () => {
  const rows = [
    { name: "a", step: "s1", layer: "环境", firstError: "ECONNREFUSED|127.0.0.1", signals: ["ECONNREFUSED"] },
    { name: "b", step: "s2", layer: "运行时", firstError: "boom\nsecond line", signals: [] },
  ];

  it("表格有表头，单元格压平换行并转义竖线", () => {
    const table = renderAttributionTable(rows);
    expect(table.split("\n")[0]).toContain("| job | 失败步骤 | 归因层 | 归因头 | 信号 |");
    expect(table).toContain("ECONNREFUSED\\|127.0.0.1");
    expect(table).toContain("boom second line");
  });

  it("缺失归因头时写明原因而不是留空", () => {
    const table = renderAttributionTable([{ name: "c", step: "", layer: "未知", firstError: "", signals: [] }]);
    expect(table).toContain("日志里没有可识别的错误行");
  });

  it("按层统计只返回非零层", () => {
    expect(layerCounts(rows)).toEqual([
      ["环境", 1],
      ["运行时", 1],
    ]);
  });
});

describe("跨轮对比：新增红 / 同 job 换因 / 仍在红 / 已修复", () => {
  const row = (name: string, firstError: string, extra: Record<string, unknown> = {}) => ({
    name,
    firstError,
    layer: "运行时",
    signals: [],
    ...extra,
  });

  it("身份键剥掉行号：代码挪一行不算新增红", () => {
    const before = row("测试", "packages/store/test/migrate-dialect.test.ts:56 · pg · expected false to be true");
    const after = row("测试", "packages/store/test/migrate-dialect.test.ts:61 · pg · expected false to be true");
    expect(failureKey(before)).toBe(failureKey(after));
  });

  it("同一 job 换了失败用例：算「同 job 换因」，不算新增也不算修复", () => {
    const before = row("测试", "a.test.ts · 用例 A · boom");
    const after = row("测试", "a.test.ts · 用例 B · boom");
    const diff = diffFailures([after], [before]);
    // 老版本这里 introduced 和 fixed 同时各得一条：一边把别人的常驻红报成本轮引入，
    // 一边宣布它被修好了。换因桶就是为了不再说这两句假话。
    expect(diff.introduced).toEqual([]);
    expect(diff.persisted).toEqual([]);
    expect(diff.fixed).toEqual([]);
    expect(diff.changed.map(failureKey)).toEqual([failureKey(after)]);
    expect(diff.changed[0].previousErrors).toEqual(["a.test.ts · 用例 A · boom"]);
  });

  it("换因不影响别的桶：job 名整条消失才叫已修复", () => {
    const before = [row("测试", "a.test.ts · 用例 A"), row("前端", "b.test.ts · 用例 C")];
    const after = [row("测试", "a.test.ts · 用例 B"), row("镜像", "")];
    const diff = diffFailures(after, before);
    expect(diff.changed.map((r) => r.name)).toEqual(["测试"]);
    expect(diff.introduced.map((r) => r.name)).toEqual(["镜像"]);
    expect(diff.fixed.map((r) => r.name)).toEqual(["前端"]);
    expect(diff.persisted).toEqual([]);
  });

  it("同 job 且根因里的行号移动了 -> 仍是「仍在红」，不是换因", () => {
    const before = row("测试", "packages/store/test/migrate-dialect.test.ts:56 · pg · expected false to be true");
    const after = row("测试", "packages/store/test/migrate-dialect.test.ts:61 · pg · expected false to be true");
    const diff = diffFailures([after], [before]);
    expect(diff.persisted.map(failureKey)).toEqual([failureKey(after)]);
    expect(diff.changed).toEqual([]);
  });

  it("基线该 job 没有归因头时，换因行明确说「基线无归因头」", () => {
    const before = row("镜像检查", "");
    const after = row("镜像检查", "overlay 漂移");
    const diff = diffFailures([after], [before]);
    expect(diff.changed[0].previousErrors).toEqual([]);
    const text = renderBaselineDiff(diff, { baselineLabel: "run #1" });
    expect(text).toContain("基线该 job 无归因头");
  });

  it("桶按身份键对齐，缺失归因头时退回 job 名", () => {
    const same = row("镜像检查", "");
    const gone = row("前端门禁", "error TS2304");
    const fresh = row("E2E", "expect(locator)");
    const diff = diffFailures([same, fresh], [same, gone]);
    expect(diff.introduced.map((r) => r.name)).toEqual(["E2E"]);
    expect(diff.persisted.map((r) => r.name)).toEqual(["镜像检查"]);
    expect(diff.fixed.map((r) => r.name)).toEqual(["前端门禁"]);
  });

  it("并发取消两边都摘掉：不虚报「新增红」，也不虚报「已修复」", () => {
    const canceledRun = "Canceling since a higher priority waiting request for CI-refs/heads/main exists";
    expect(isSupersededCancel(canceledRun)).toBe(true);
    expect(isSupersededCancel("AssertionError: expected false to be true")).toBe(false);
    const { code, superseded } = splitSuperseded([row("E2E", canceledRun, { superseded: true }), row("测试", "boom")]);
    expect(code.map((r) => r.name)).toEqual(["测试"]);
    expect(superseded.map((r) => r.name)).toEqual(["E2E"]);

    const diff = diffFailures(
      [row("E2E", canceledRun, { superseded: true })],
      [row("E2E", canceledRun, { superseded: true })],
    );
    expect(diff).toEqual({ introduced: [], changed: [], persisted: [], fixed: [] });
  });

  it("summarizeJob 能从日志里认出并发取消", () => {
    const result = summarizeJob(
      { id: 1, name: "浏览器 E2E", conclusion: "cancelled", steps: [{ name: "Complete job", conclusion: "failure" }] },
      { logText: "##[error]Canceling since a higher priority waiting request for CI-refs/heads/main exists" },
    );
    expect(result.superseded).toBe(true);
  });

  it("对比段：四桶为空时给一句话，不为空时按桶分节", () => {
    expect(renderBaselineDiff({ introduced: [], persisted: [], fixed: [] })).toContain("与基线一致");
    const text = renderBaselineDiff(
      {
        introduced: [row("新", "x.test.ts · 用例 · boom")],
        persisted: [row("旧", "y.test.ts · 用例 · boom")],
        fixed: [row("修好了", "z.test.ts · 用例 · boom")],
      },
      { baselineLabel: "run #1" },
    );
    expect(text).toContain("新增红 1 · 仍在红 1 · 已修复 1（对比 run #1）");
    expect(text).toContain("### 新增红");
    expect(text).toContain("### 仍在红");
    expect(text).toContain("### 已修复");
    expect(text).toContain("新 — x.test.ts · 用例 · boom");
  });

  it("换因段：标题里点明「既不算本轮新增也不算已修复」，并带上基线根因", () => {
    const diff = {
      introduced: [],
      changed: [{ ...row("测试", "a.test.ts · 用例 B"), previousErrors: ["a.test.ts · 用例 A"] }],
      persisted: [],
      fixed: [],
    };
    const text = renderBaselineDiff(diff, { baselineLabel: "run #1" });
    expect(text).toContain("新增红 0 · 换因 1 · 仍在红 0 · 已修复 0（对比 run #1）");
    expect(text).toContain("### 同 job 换因");
    expect(text).toContain("测试 — a.test.ts · 用例 B");
    expect(text).toContain("← 基线是：a.test.ts · 用例 A");
    // 没换因时整段不出现，老报告的形状不能被多出来的空段污染
    expect(renderBaselineDiff({ introduced: [], persisted: [], fixed: [] })).not.toContain("换因");
  });

  it("run 未结束时不许把 pending 报成已修复（真实 run #40605609970 的假绿）", () => {
    const diff = {
      introduced: [row("新", "x.test.ts · 用例 · boom")],
      persisted: [],
      fixed: [row("还没跑到", "y.test.ts · 用例 · boom")],
    };
    const text = renderBaselineDiff(diff, { baselineLabel: "run #1", inProgress: true });
    expect(text).toContain("run 尚未结束，暂不计算「已修复」");
    expect(text).not.toContain("已修复 1");
    expect(text).toContain("### 待确认");
    expect(text).toContain("可能还没跑到");
    // 未结束且零失败：也不能说「与基线一致」
    expect(renderBaselineDiff({ introduced: [], persisted: [], fixed: [row("a", "b")] }, { inProgress: true })).not.toContain("与基线一致");
  });
});

describe("waitForRunConclusion：等终局再算桶", () => {
  it("已结束的 run 不轮询", async () => {
    let calls = 0;
    const result = await waitForRunConclusion({
      run: { id: 1, conclusion: "success" },
      // 必须注入时钟：waitedMs 走真实 Date.now() 时，负载高的 CI 机器上
      // 「同一毫秒返回」不成立（实测 ≥1ms），这条断言会间歇红——断言的是
      // 「没等待」这个语义，就该用假时钟把它钉死。
      now: () => 0,
      fetchRun: async () => {
        calls++;
        return { id: 1, conclusion: "success" };
      },
    });
    expect(result).toMatchObject({ timedOut: false, polls: 0, waitedMs: 0 });
    expect(calls).toBe(0);
  });

  it("queued → in_progress → completed：每次轮询回调最新状态", async () => {
    const states = [
      { id: 7, status: "in_progress", conclusion: null },
      { id: 7, status: "in_progress", conclusion: null },
      { id: 7, status: "completed", conclusion: "failure" },
    ];
    const seen: string[] = [];
    let clock = 0;
    const result = await waitForRunConclusion({
      run: { id: 7, status: "queued", conclusion: null },
      fetchRun: async () => states.shift(),
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      onPoll: (latest) => seen.push(latest.status),
    });
    expect(result.timedOut).toBe(false);
    expect(result.polls).toBe(3);
    expect(result.run.conclusion).toBe("failure");
    // 等待期间的进度必须反映最新状态，而不是停留在调用时的 queued
    expect(seen).toEqual(["in_progress", "in_progress", "completed"]);
  });

  it("超时返回最后快照而不是抛错；最后一次等待不超过剩余预算", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const result = await waitForRunConclusion({
      run: { id: 9, status: "queued", conclusion: null },
      fetchRun: async () => ({ id: 9, status: "queued", conclusion: null }),
      intervalMs: 20_000,
      timeoutMs: 50_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    expect(result.timedOut).toBe(true);
    expect(result.run.status).toBe("queued");
    // 40s 之后只剩 10s 预算：最后一段等待必须缩到 10s，不能越过超时线
    expect(sleeps).toEqual([20_000, 20_000, 10_000]);
  });
});

describe("fixHint：每层一条可执行入口", () => {
  it("所有归因层都有非空、无占位符的命令", () => {
    for (const layer of FAILURE_LAYERS) {
      const hint = LAYER_FIX_HINTS[layer];
      expect(hint, layer).toBeTruthy();
      expect(hint.command.length, layer).toBeGreaterThan(0);
      // 带占位符的命令还得人补参数，算不上「可直接执行」
      expect(hint.command, layer).not.toMatch(/<[^>]+>/);
    }
  });

  it("运行时层从归因头收窄到具体测试文件，拿不到就全量", () => {
    const scoped = fixHintFor({
      layer: "运行时",
      firstError: "packages/store/test/migrate-dialect.test.ts:56 · pg · expected false to be true",
    });
    expect(scoped.command).toBe("node node_modules/vitest/vitest.mjs run packages/store/test/migrate-dialect.test.ts");
    const generic = fixHintFor({ layer: "运行时", firstError: "AssertionError: boom" });
    expect(generic.command).toBe("node node_modules/vitest/vitest.mjs run");
  });

  it("未知层不硬猜：给全量门禁而不是空", () => {
    const hint = fixHintFor({ layer: "神秘层", firstError: "" });
    expect(hint.layer).toBe("未知");
    expect(hint.command).toContain("scripts/verify.mjs");
  });

  it("self-installer 的修复入口换成「复跑」，不让人白跑全量门禁", () => {
    const row = summarizeJob(
      { id: 1, name: "后端测试 (1/3)", conclusion: "failure", steps: [{ name: "Set up pnpm", conclusion: "failure" }] },
      { logText: "Something went wrong, self-installer exits with code 1\n##[error]Process completed with exit code 1." },
    );
    expect(row.layer).toBe("环境");
    expect(row.fixHint.command).toBe("node scripts/ci-status.mjs");
    expect(row.fixHint.note).toContain("Re-run failed jobs");
    // 其它环境类失败仍走默认入口：覆盖只针对这一条信号，不能把整层改掉
    expect(fixHintFor({ layer: "环境", firstError: "EADDRINUSE 127.0.0.1:4000" }).command).toBe("node scripts/doctor.mjs");
  });

  it("红的是自建门禁那一步时，修复入口给那一步的原命令而不是层默认入口", () => {
    // 真实 run 40923501074 的「前端门禁」：归因头已是预算注解，入口却还指向 typecheck
    const hint = fixHintFor({
      layer: "构建",
      headLevel: "failure",
      step: "Run node scripts/check-bundle-budget.mjs",
      firstError: "scripts/bundle-budget.json:54 · 首屏预算超限 /videos/player",
    });
    expect(hint.command).toBe("node scripts/check-bundle-budget.mjs");
    expect(hint.note).toContain("红的是这一步自己的判定");
    // 反向例：非 scripts/check-* 的步骤不抢入口（跑起来就崩的那类仍归层默认前置）
    expect(
      fixHintFor({ layer: "契约", step: "Run node apps/api/src/migrate.ts", firstError: "TypeError: x" }).command,
    ).toBe(LAYER_FIX_HINTS.契约.command);
    // 带旗标的原命令整条印出去，不吞参数
    expect(fixHintFor({ layer: "构建", step: "Run node scripts/check-isr-routes.mjs --json", firstError: "x" }).command).toBe(
      "node scripts/check-isr-routes.mjs --json",
    );
  });

  it("文本段按层去重、只列出现的层，同一层多个文件并列", () => {
    const text = renderFixHints([
      { layer: "运行时", firstError: "a.test.ts · x · boom" },
      { layer: "运行时", firstError: "b.test.ts · y · boom" },
      { layer: "契约", firstError: "rest-contracts 漂移" },
    ]);
    expect(text).toContain("## 修复入口");
    expect(text.match(/- 运行时：/g)).toHaveLength(1);
    expect(text).toContain("a.test.ts（或 node node_modules/vitest/vitest.mjs run b.test.ts）");
    expect(text).toContain("- 契约：");
    expect(text).not.toContain("- 依赖：");
    expect(renderFixHints([])).toBe("");
  });

  it("summarizeJob 每一行都带 fixHint（JSON 可直接消费）", () => {
    const row = summarizeJob(
      { id: 1, name: "x", conclusion: "failure", steps: [] },
      { logText: "src/x.ts(3,1): error TS2307: Cannot find module '@/lib/x'" },
    );
    expect(row.fixHint).toEqual({ layer: "构建", command: "node scripts/typecheck.mjs", note: LAYER_FIX_HINTS.构建.note });
  });
});

describe("vitest → GitHub 注解报告器", () => {
  it("workflow command 转义：属性比正文多处理冒号与逗号", () => {
    expect(escapeProperty("a:b,c%d\ne")).toBe("a%3Ab%2Cc%25d%0Ae");
    expect(escapeData("a:b,c%d\ne")).toBe("a:b,c%25d%0Ae");
  });

  it("注解行格式：file/line/title + 正文换行转义", () => {
    const line = annotationLine({ file: "apps/api/test/x.test.ts", line: 12, title: "用例 A", message: "expected 1 to be 2\nextra" });
    expect(line).toBe("::error file=apps/api/test/x.test.ts,line=12,title=用例 A::expected 1 to be 2%0Aextra");
  });

  it("收集失败：模块加载错误 + 失败用例都进注解", () => {
    const fakeModule = {
      relativeModuleId: "packages/core/test/a.test.ts",
      errors: () => [{ message: "SyntaxError: Unexpected token" }],
      children: {
        allTests: (state: string) =>
          state === "failed"
            ? [{ name: "用例 B", location: { line: 9 }, result: () => ({ errors: [{ message: "AssertionError: nope" }] }) }]
            : [],
      },
    };
    const failures = collectFailures([fakeModule], [{ message: "unhandled boom" }]);
    expect(failures).toHaveLength(3);
    expect(failures[0]).toMatchObject({ file: "packages/core/test/a.test.ts", title: "模块加载失败" });
    expect(failures[1]).toMatchObject({ line: 9, title: "用例 B", message: "AssertionError: nope" });
    expect(failures[2]).toMatchObject({ title: "未捕获异常", file: "" });
  });

  it("location 缺失时从错误栈里取本文件的第一帧行号", () => {
    const stack = "AssertionError: nope\n    at apps/api/test/x.test.ts:42:9\n    at processTicksAndRejections (node:internal:1:1)";
    expect(lineFromStack({ stack }, "apps/api/test/x.test.ts")).toBe(42);
    expect(lineFromStack({ stack }, "packages/core/test/other.test.ts")).toBeNull();
    expect(lineFromStack({}, "apps/api/test/x.test.ts")).toBeNull();
    const fakeModule = {
      relativeModuleId: "apps/api/test/x.test.ts",
      errors: () => [],
      children: { allTests: () => [{ name: "c", result: () => ({ errors: [{ message: "nope", stack }] }) }] },
    };
    expect(collectFailures([fakeModule])[0]).toMatchObject({ line: 42, title: "c" });
  });

  it("超过上限时截断，并补一条总数说明", () => {
    const failures = Array.from({ length: MAX_ANNOTATIONS + 5 }, (_, i) => ({
      file: "f.ts",
      line: i + 1,
      title: "t" + i,
      message: "m" + i,
    }));
    const lines = annotationLines(failures);
    expect(lines).toHaveLength(MAX_ANNOTATIONS + 1);
    expect(lines.at(-1)).toContain("共 " + (MAX_ANNOTATIONS + 5) + " 个失败");
  });
});

/**
 * CLI 自身的传输层健壮性。
 *
 * 真实 run #40609230621：基线对比整段因 `terminated`（undici 对端提前关连接）
 * 被跳过——这正是「工具宣称的降级」在掩盖值得重试的瞬断。瞬断必须重试，
 * 4xx 这类语义结果必须原样交回调用方。
 */
describe("fetchWithRetry：只重试传输层瞬断", () => {
  it("terminated 视为瞬断，重试后成功", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("terminated");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      const res = await fetchWithRetry("https://example.invalid/x", {}, 2);
      expect(await res.text()).toBe("ok");
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("非传输层错误立即抛出，不重试", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError("boom");
    }) as typeof fetch;
    try {
      await expect(fetchWithRetry("https://example.invalid/x", {}, 3)).rejects.toThrow("boom");
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("重试耗尽后抛最后一次错误（不静默吞掉）", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError("terminated");
    }) as typeof fetch;
    try {
      await expect(fetchWithRetry("https://example.invalid/x", {}, 2)).rejects.toThrow("terminated");
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("归因快照：--json 同形落盘", () => {
  const run = { id: 12345, head_sha: "abcdef1234567890abcdef1234567890abcdef12", html_url: "https://example.invalid/run", conclusion: "failure" };
  const rows = [
    { name: "ci / build", firstError: "src/a.ts:1:2: error TS1", fixHint: "pnpm typecheck", superseded: false },
    { name: "ci / test", firstError: "AssertionError: boom", fixHint: "pnpm test", superseded: false },
  ];

  it("文件名带 run / 短 sha / 本地时间戳，可稳定排序", () => {
    const name = snapshotFileName({ runId: 12345, sha: run.head_sha, now: new Date(2026, 9, 28, 9, 15, 0) });
    expect(name).toBe("ci-explain-12345-abcdef123456-20261028-091500.json");
  });

  it("无基线时不含 baseline/diff 键；有基线时三桶带 fixHint", () => {
    const plain = buildSnapshot({ repo: "a/b", run, waitMeta: null, rows, baseline: null, diff: null });
    expect(plain.failures).toHaveLength(2);
    expect(plain.layers["契约"]).toBeUndefined();
    expect("baseline" in plain).toBe(false);
    expect("diff" in plain).toBe(false);

    const baseline = { run: { ...run, id: 999, conclusion: "failure" }, rows: [rows[1]] };
    const diff = diffFailures(rows, baseline.rows);
    const withBaseline = buildSnapshot({ repo: "a/b", run: { ...run, conclusion: null }, waitMeta: null, rows, baseline, diff });
    expect(withBaseline.baseline.id).toBe(999);
    expect(withBaseline.diff.inProgress).toBe(true);
    expect(withBaseline.diff.introduced.map((r) => r.name)).toEqual(["ci / build"]);
    expect(withBaseline.diff.persisted.map((r) => r.name)).toEqual(["ci / test"]);
    expect(withBaseline.diff.introduced[0].fixHint).toBe("pnpm typecheck");
  });

  it("落盘到指定路径：JSON 可读回；同名冲突追加序号而不是覆盖", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-explain-snapshot-"));
    try {
      const snapshot = buildSnapshot({ repo: "a/b", run, waitMeta: null, rows, baseline: null, diff: null });
      const first = writeSnapshot({ target: join(dir, "snap.json"), snapshot });
      const second = writeSnapshot({ target: join(dir, "snap.json"), snapshot });
      expect(first).toBe(join(dir, "snap.json"));
      expect(second).toBe(join(dir, "snap-2.json"));
      expect(JSON.parse(readFileSync(first, "utf8")).run.id).toBe(12345);
      expect(JSON.parse(readFileSync(second, "utf8")).repo).toBe("a/b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("默认目录会自建：写到不存在的嵌套 tmp 也能成功", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-explain-dir-"));
    try {
      const target = join(dir, "nested", "deep", "out.json");
      const path = writeSnapshot({ target, snapshot: { run: { id: 7, sha: "abc" } } });
      expect(path).toBe(target);
      expect(JSON.parse(readFileSync(path, "utf8")).run.id).toBe(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 抗抖层：本脚本跑在推送后的无人值守链路上，「一次瞬断把整轮归因变空白」
 * 比红灯本身更贵——人只能重推一次再等 20 分钟。
 * 所以这里钉的全是失败路径：状态码重试、轮询容错、逐 job 降级、部分快照。
 */
describe("fetchResilient：429/5xx 重试，4xx 原样交回", () => {
  const stub = (responses: Response[]) => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      const res = responses[Math.min(calls, responses.length - 1)];
      calls++;
      return res;
    }) as typeof fetch;
    return { original, calls: () => calls };
  };

  it("429 带 Retry-After：按头里的秒数等待，第二次拿到正文", async () => {
    const waits: number[] = [];
    const fake = stub([
      new Response("{}", { status: 429, headers: { "retry-after": "3" } }),
      new Response('{"ok":1}', { status: 200 }),
    ]);
    try {
      const { res, attempts } = await fetchResilient("https://example.invalid/x", {}, { sleepFn: async (ms: number) => { waits.push(ms); } });
      expect(res.ok).toBe(true);
      expect(attempts).toBe(2);
      expect(await res.json()).toEqual({ ok: 1 });
      // Retry-After 是权威值：不该拿固定退避去撞同一个限流窗口
      expect(waits).toEqual([3000]);
    } finally {
      globalThis.fetch = fake.original;
    }
  });

  it("Retry-After 过大要封顶：无人值守脚本不能为一句话卡住半小时", async () => {
    const waits: number[] = [];
    const fake = stub([
      new Response("slow down", { status: 503, headers: { "retry-after": "999999" } }),
      new Response("ok", { status: 200 }),
    ]);
    try {
      const { attempts } = await fetchResilient("https://example.invalid/x", {}, { sleepFn: async (ms: number) => { waits.push(ms); } });
      expect(attempts).toBe(2);
      expect(waits).toEqual([20_000]);
    } finally {
      globalThis.fetch = fake.original;
    }
  });

  it("5xx 打满预算：返回最后一个响应并如实报尝试次数，不静默说成没数据", async () => {
    const fake = stub([new Response("boom", { status: 500 })]);
    try {
      const { res, attempts } = await fetchResilient("https://example.invalid/x", {}, { sleepFn: async () => {} });
      expect(res.status).toBe(500);
      expect(attempts).toBe(3);
      expect(fake.calls()).toBe(3);
    } finally {
      globalThis.fetch = fake.original;
    }
  });

  it("404 一次就回：语义结果重试只会掩盖真因", async () => {
    const fake = stub([new Response("Not Found", { status: 404 })]);
    try {
      const { res, attempts } = await fetchResilient("https://example.invalid/x", {}, { sleepFn: async () => {} });
      expect(res.status).toBe(404);
      expect(attempts).toBe(1);
      expect(fake.calls()).toBe(1);
    } finally {
      globalThis.fetch = fake.original;
    }
  });

  it("传输层重试耗尽要写明次数：「一次没连上」和「预算用光」是两个结论", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("terminated");
    }) as typeof fetch;
    try {
      const error = await fetchWithRetry("https://example.invalid/x", {}, 2).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("terminated");
      expect(error.message).toContain("传输层重试 2 次仍失败");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("waitForRunConclusion：轮询瞬断继续等", () => {
  it("中途失败一次：计数但等到终局，polls 只算成功的那几次", async () => {
    let clock = 0;
    let calls = 0;
    const result = await waitForRunConclusion({
      run: { id: 7, status: "queued", conclusion: null },
      fetchRun: async () => {
        calls++;
        if (calls === 1) throw new TypeError("terminated（传输层重试 3 次仍失败）");
        return { id: 7, status: "completed", conclusion: "failure" };
      },
      intervalMs: 1000,
      timeoutMs: 60_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(result.timedOut).toBe(false);
    expect(result.run.conclusion).toBe("failure");
    expect(result.polls).toBe(1);
    expect(result.pollErrors).toBe(1);
  });

  it("全程取不到：按超时收尾，并说明这轮结论是「等出来的」", async () => {
    let clock = 0;
    const result = await waitForRunConclusion({
      run: { id: 8, status: "queued", conclusion: null },
      fetchRun: async () => {
        throw new Error("fetch failed");
      },
      intervalMs: 1000,
      timeoutMs: 3000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(result.timedOut).toBe(true);
    expect(result.polls).toBe(0);
    expect(result.pollErrors).toBe(3);
    // 状态没推进也不能抛：调用方要拿最后一次已知快照落盘
    expect(result.run.id).toBe(8);
  });
});

describe("collectAttribution：一个 job 的证据缺口不拖垮整轮", () => {
  const jobsRun = { id: 12345 };
  const jobA = { id: 1, name: "ci / build", conclusion: "failure", check_run_url: "" };
  const jobB = { id: 2, name: "ci / test", conclusion: "failure", check_run_url: "" };
  const client = (overrides: Record<string, unknown> = {}) =>
    ({
      api: async () => ({ jobs: [jobA, jobB] }),
      fetchJobLog: async () => "src/a.ts:1:2: error TS1\n",
      ...overrides,
    }) as never;

  it("日志抛错：该行标 partial 并带上原因，其余行照常归因", async () => {
    const { rows, degraded } = await collectAttribution(
      client({
        fetchJobLog: async (_repo: string, jobId: number) => {
          if (jobId === 1) throw new TypeError("terminated（传输层重试 3 次仍失败）");
          return "AssertionError: boom\n";
        },
      }),
      "a/b",
      jobsRun,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].partial).toBe(true);
    expect(rows[0].partialReason).toContain("日志：terminated");
    expect(rows[1].partial).toBeUndefined();
    expect(degraded).toEqual(["ci / build"]);
  });

  it("job 清单本身取不到要往上抛：那是「整轮没有结论」，不是「没有红灯」", async () => {
    await expect(collectAttribution(client({ api: async () => { throw new Error("GitHub API 403 x：resource not accessible"); } }), "a/b", jobsRun)).rejects.toThrow("403");
  });
});

describe("buildSnapshot：归因完整性也要进快照", () => {
  const run = { id: 12345, head_sha: "abcdef1234567890abcdef1234567890abcdef12", html_url: "https://example.invalid/run", conclusion: "failure" };
  const rows = [
    { name: "ci / build", firstError: "src/a.ts:1:2: error TS1", fixHint: "pnpm typecheck", superseded: false },
    { name: "ci / test", firstError: "AssertionError: boom", fixHint: "pnpm test", superseded: false },
  ];

  it("证据完整时不写 attribution：键存在本身就是「这轮不完整」的标记", () => {
    const clean = buildSnapshot({ repo: "a/b", run, waitMeta: null, rows, baseline: null, diff: null });
    expect("attribution" in clean).toBe(false);
  });

  it("degraded 与 partial 分别记账，部分快照照样带 run 身份", () => {
    const snapshot = buildSnapshot({
      repo: "a/b",
      run,
      waitMeta: null,
      rows: [],
      baseline: null,
      diff: null,
      degraded: ["ci / build"],
      partial: { stage: "jobs", error: "GitHub API 500 x" },
    });
    expect(snapshot.attribution.degraded).toEqual(["ci / build"]);
    expect(snapshot.attribution.partial).toEqual({ stage: "jobs", error: "GitHub API 500 x" });
    expect(snapshot.run.id).toBe(12345);
  });

  it("基线失败集内嵌：日志过期后也能重算谁新增、谁关掉", () => {
    const baseline = { run: { ...run, id: 999 }, rows: [rows[1]], degraded: ["ci / test"] };
    const snapshot = buildSnapshot({ repo: "a/b", run, waitMeta: null, rows, baseline, diff: diffFailures(rows, baseline.rows) });
    expect(snapshot.baseline.failures.map((f: { name: string }) => f.name)).toEqual(["ci / test"]);
    expect(snapshot.baseline.failures[0].fixHint).toBe("pnpm test");
    expect(snapshot.baseline.degraded).toEqual(["ci / test"]);
  });

  it("换因行落盘带上「基线那一条红」：日志过期后仍能判新因是不是本轮造成的", () => {
    const baseline = {
      run: { ...run, id: 999 },
      rows: [{ name: "ci / test", firstError: "Something went wrong, self-installer exits with code 1", fixHint: "node scripts/verify.mjs", superseded: false }],
    };
    const current = [{ name: "ci / test", firstError: "AssertionError: boom", fixHint: "pnpm test", superseded: false }];
    const snapshot = buildSnapshot({ repo: "a/b", run, waitMeta: null, rows: current, baseline, diff: diffFailures(current, baseline.rows) });
    expect(snapshot.diff.introduced).toEqual([]);
    expect(snapshot.diff.fixed).toEqual([]);
    expect(snapshot.diff.changed).toEqual([
      {
        name: "ci / test",
        firstError: "AssertionError: boom",
        fixHint: "pnpm test",
        previousErrors: ["Something went wrong, self-installer exits with code 1"],
      },
    ]);
  });
});

describe("main：失败也要落部分快照，绝不空白退出", () => {
  const run = {
    id: 12345,
    head_sha: "abcdef1234567890abcdef1234567890abcdef12",
    html_url: "https://example.invalid/run",
    conclusion: "failure",
    head_branch: "main",
  };
  const capture = () => {
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => errors.push(args.map(String).join(" ")));
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      errors.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    return { logs, errors, restore: () => vi.restoreAllMocks() };
  };

  const tokenGuard = <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";
    return fn().finally(() => {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    });
  };

  it("jobs 清单 403：--json 仍是可解析 JSON，--save 仍落盘，退出码 2，且不算跨轮对比", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-explain-partial-"));
    const target = join(dir, "snap.json");
    const cap = capture();
    try {
      const rc = await tokenGuard(() =>
        main(
          ["--repo", "a/b", "--json", "--save", target, "--baseline", "999"],
          {
            clientFactory: () =>
              ({
                api: async (path: string) => {
                  if (path.includes("/actions/runs?")) return { workflow_runs: [run] };
                  throw new Error("GitHub API 403 /repos/a/b/actions/runs/12345/jobs：resource not accessible by integration");
                },
                fetchJobLog: async () => "",
              }) as never,
          },
        ),
      );
      expect(rc).toBe(2);
      const stdout = JSON.parse(cap.logs.at(-1) ?? "");
      expect(stdout.attribution.partial.stage).toBe("jobs");
      expect(stdout.run.id).toBe(12345);
      // 本轮没证据 → 基线整段省略：把「基线有、本轮没取到」说成「已修复」是最坏的假绿灯
      expect("diff" in stdout).toBe(false);
      expect("baseline" in stdout).toBe(false);
      const saved = JSON.parse(readFileSync(target, "utf8"));
      expect(saved.attribution.partial.error).toContain("403");
    } finally {
      cap.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("逐 job 降级：文本模式点名证据不全的 job，退出码仍是有红灯的 1", async () => {
    const cap = capture();
    try {
      const rc = await tokenGuard(() =>
        main(
          ["--repo", "a/b"],
          {
            clientFactory: () =>
              ({
                api: async (path: string) => {
                  if (path.includes("/actions/runs?")) return { workflow_runs: [run] };
                  return { jobs: [{ id: 1, name: "ci / build", conclusion: "failure" }, { id: 2, name: "ci / test", conclusion: "failure" }] };
                },
                fetchJobLog: async (_repo: string, jobId: number) => {
                  if (jobId === 1) throw new TypeError("terminated");
                  return "AssertionError: boom\n    at Object.<anonymous> (src/a.test.ts:3:1)\n";
                },
              }) as never,
          },
        ),
      );
      expect(rc).toBe(1);
      const out = cap.logs.join("\n");
      expect(out).toContain("证据不全的 job 1 个");
      expect(out).toContain("ci / build");
      // 另一条 job 的归因不受影响：这是「不拖垮整轮」的实际含义
      expect(out).toContain("ci / test");
      expect(out).not.toContain("没有失败的 job");
    } finally {
      cap.restore();
    }
  });
});
