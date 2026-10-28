import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  cleanLogLines,
  diffFailures,
  extractAttribution,
  failingStep,
  failureKey,
  isFailedJob,
  isSupersededCancel,
  layerCounts,
  parseRepoSlug,
  renderAttributionTable,
  renderBaselineDiff,
  splitSuperseded,
  summarizeJob,
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

describe("跨轮对比：新增红 / 仍在红 / 已修复", () => {
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

  it("同一 job 换了失败用例算新增，不算「老问题还在」", () => {
    const before = row("测试", "a.test.ts · 用例 A · boom");
    const after = row("测试", "a.test.ts · 用例 B · boom");
    const diff = diffFailures([after], [before]);
    expect(diff.introduced.map(failureKey)).toEqual([failureKey(after)]);
    expect(diff.persisted).toEqual([]);
    expect(diff.fixed.map(failureKey)).toEqual([failureKey(before)]);
  });

  it("三个桶按身份键对齐，缺失归因头时退回 job 名", () => {
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
    expect(diff).toEqual({ introduced: [], persisted: [], fixed: [] });
  });

  it("summarizeJob 能从日志里认出并发取消", () => {
    const result = summarizeJob(
      { id: 1, name: "浏览器 E2E", conclusion: "cancelled", steps: [{ name: "Complete job", conclusion: "failure" }] },
      { logText: "##[error]Canceling since a higher priority waiting request for CI-refs/heads/main exists" },
    );
    expect(result.superseded).toBe(true);
  });

  it("对比段：三桶为空时给一句话，不为空时按桶分节", () => {
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
