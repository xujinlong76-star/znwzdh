/**
 * CI 红灯归因（纯函数层，零 IO）。
 *
 * 目标：把「某个 job 红了」变成「哪个 job、哪一步、哪一层、第一处错误是什么」。
 * 输入是 GitHub Actions 的 job 元数据 + 原始日志（已去 ANSI/时间戳），
 * 输出是一行可直接贴进排查记录的归因头。
 *
 * 分层刻意只有五类，且按**根因优先级**排列（依赖 → 环境 → 构建 → 契约 → 运行时）：
 * 同一个日志里既有 `ECONNREFUSED` 又有 ISR 断言失败时，根因是环境，
 * 把两层都报出来反而会把人引向错误的修复方向。
 */

/** 归因层：从「外部条件」到「代码行为」，前者通常才是红灯的根因 */
export const FAILURE_LAYERS = ["依赖", "环境", "构建", "契约", "运行时", "汇总", "未知"];

/**
 * 每条红的下一步：按归因层给**一条可直接执行**的修复入口。
 *
 * 层名只是诊断，修复动作仍然要人来做——但如果停在「归因层：契约」，
 * 读报告的人还得自己想起该跑哪个脚本。这里把每层默认的第一步固化成命令，
 * 文本报告按层去重打印，JSON 每行都带（无人值守轮可直接取用）。
 *
 * 约束：command 必须能在仓库根目录原样执行，不允许 `<占位符>`；
 * 运行时层的具体测试文件由归因头推断，推断不出就是全量测试。
 */
export const LAYER_FIX_HINTS = {
  依赖: {
    command: "pnpm install",
    note: "锁文件变更要一起提交；ERR_PNPM_NO_MATCHING_VERSION 指向的包优先核对版本是否存在",
  },
  环境: {
    command: "node scripts/doctor.mjs",
    note: "端口占用 / 浏览器缺失 / 资源不足类失败先复现环境，别把环境问题当代码问题修",
  },
  构建: {
    command: "node scripts/typecheck.mjs",
    note: "TS 与打包错误本地复现后再推；CI 的报错行号与本地一致",
  },
  契约: {
    command: "node --experimental-strip-types scripts/generate-rest-contract-types.mjs && node scripts/check-web-overlay.mjs",
    note: "ISR / sitemap / seo-audit 类先本地跑同一条门禁；生成物只许由生成脚本改写",
  },
  运行时: {
    command: "node node_modules/vitest/vitest.mjs run",
    note: "先跑归因头里的失败文件；断言改不动时先确认是契约变了还是行为回归",
  },
  汇总: {
    command: "node scripts/ci-status.mjs",
    note: "本 job 自身没有代码路径，修复看其余行的上游失败；不要为一个纯汇总 job 改代码",
  },
  未知: {
    command: "node scripts/verify.mjs",
    note: "归因头为空说明日志里没有可识别错误：先跑全量本地门禁，再带 --json 看该 job 的 tail",
  },
};

/** 运行时层能从归因头里拿到具体测试文件时，把命令收窄到那一个文件 */
function runtimeCommand(firstError) {
  const match = String(firstError ?? "").match(/([\w./@-]+\.(?:test|spec)\.[cm]?[jt]sx?)/);
  const base = LAYER_FIX_HINTS.运行时.command;
  return match ? base + " " + match[1] : base;
}

/** 单行失败对应的修复入口：{ layer, command, note } */
export function fixHintFor(row) {
  const layer = FAILURE_LAYERS.includes(row?.layer) ? row.layer : "未知";
  const hint = LAYER_FIX_HINTS[layer];
  return {
    layer,
    command: layer === "运行时" ? runtimeCommand(row?.firstError) : hint.command,
    note: hint.note,
  };
}

/** 文本报告的「修复入口」段：按层去重，只列本轮真实出现的层 */
export function renderFixHints(rows) {
  const byLayer = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const hint = fixHintFor(row);
    if (!byLayer.has(hint.layer)) byLayer.set(hint.layer, hint);
    else if (hint.command !== byLayer.get(hint.layer).command) byLayer.get(hint.layer).command += "（或 " + hint.command + "）";
  }
  if (byLayer.size === 0) return "";
  const lines = ["## 修复入口（按归因层，一条命令起步）"];
  for (const layer of FAILURE_LAYERS) {
    const hint = byLayer.get(layer);
    if (!hint) continue;
    lines.push("- " + layer + "：" + hint.command);
    if (hint.note) lines.push("  " + hint.note);
  }
  return lines.join("\n");
}

/**
 * 聚合 job（`CI 整体通过` 这类）没有自己的代码，它红只是因为上游红了。
 * 把它算进任何一层都会污染统计：真实 run 里它因为输出里出现 "ISR" 被归成契约。
 */
const AGGREGATE_JOB = /All Checks Passed|整体通过|汇总/;

const RULES = [
  {
    layer: "依赖",
    // 只匹配「包本身没装上 / 版本解析失败」。pnpm 的包装错误
    // （ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL / ELIFECYCLE）只是「某个子命令失败了」，
    // 把它算成依赖会让真正的 TS / 测试错误被盖掉——真实红 job 里踩过。
    patterns: [
      /ERR_PNPM_NO_MATCHING_VERSION/g,
      /ERR_PNPM_FETCH_[A-Z_]+/g,
      /ERR_PNPM_MISSING_[A-Z_]+/g,
      /ERR_MODULE_NOT_FOUND/g,
      /Cannot find package '[^']+'/g,
      /pnpm: command not found/g,
      /\bnpm error\b/g,
      // 打包器解析不了**包名**（@scope/x、react）；解析不了 ./ 或 / 开头的是本地源码，归构建层
      /Could not resolve "[@A-Za-z][^"]*"/g,
    ],
  },
  {
    layer: "环境",
    patterns: [
      /\bEADDRINUSE\b/g,
      /\bECONNREFUSED\b/g,
      /\bENOSPC\b/g,
      /\bENOMEM\b/g,
      /\bEAI_AGAIN\b/g,
      /Executable doesn't exist/gi,
      /browserType\.launch/gi,
      /Target page, context or browser has been closed/gi,
      /\bOut of memory\b/gi,
      /\bdocker: .*daemon\b/gi,
    ],
  },
  {
    layer: "构建",
    patterns: [
      /\berror TS\d{4}\b/g,
      /Failed to compile/gi,
      /\bSyntaxError:/g,
      /Cannot find module '@\//g,
      /\bnext build\b/gi,
      /\bvite build\b/gi,
      // esbuild：配置/源码引用的本地文件不存在（真实案例：vitest.config.ts import 了未入库的 scripts/worker-budget.ts）
      /Could not resolve "[./][^"]*"/g,
      /failed to load config/gi,
    ],
  },
  {
    layer: "契约",
    patterns: [
      /check:rest-contracts/g,
      /rest-contracts\.generated/g,
      /生成物与源码同源/g,
      /check:overlay/g,
      /overlay 漂移/g,
      /\bsitemap\b/gi,
      /\bISR\b/g,
      /\bseo-audit\b/gi,
      /link-graph/gi,
      /\bcontract\b/gi,
      /契约/g,
    ],
  },
  {
    layer: "运行时",
    patterns: [
      /\bAssertionError\b/g,
      /^\s*FAIL\s+\S+/gm,
      /\bexpect\(/g,
      // 断言文案（Vitest 的 `::error` 注解正文只有这一句，没有 AssertionError 前缀）
      /expected\s+.+?\s+to\s+(?:be|equal|contain|match|throw|have)/g,
      /\bObject\.is equality\b/g,
      /Test Files\s+\d+/g,
      /✕/g,
    ],
  },
];

const ANSI = /\u001b\[[0-9;]*m/g;
const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;

/** 去掉 ANSI 色码与 Actions 日志行首时间戳，保留内容（行数不变） */
export function cleanLogLines(logText) {
  if (typeof logText !== "string" || logText.length === 0) return [];
  return logText.split(/\r?\n/).map((line) => line.replace(ANSI, "").replace(LOG_TIMESTAMP, ""));
}

/** 按根因优先级判定归因层；返回第一个命中的层与命中信号 */
export function classifyFailure(text) {
  if (typeof text !== "string" || text.trim() === "") return { layer: "未知", signals: [] };
  for (const rule of RULES) {
    const signals = [];
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      const m = text.match(pattern);
      if (m) signals.push(m[0]);
    }
    if (signals.length > 0) return { layer: rule.layer, signals: [...new Set(signals)].slice(0, 5) };
  }
  return { layer: "未知", signals: [] };
}

const ERROR_LINE = /(^|\s)(Error:|TypeError:|RangeError:|ReferenceError:|SyntaxError:|AssertionError|error TS\d{4})/;
/**
 * 自定义门禁的错误行：这类脚本用 `[tag]` 前缀 + 中文结论（「不一致」「不通过」），
 * 既不写 `##[error]` 也不抛异常，真实 run 里整条 job 的归因头因此是空的。
 * 只认这两个结论词，不放宽到「失败」——`[navhub] 审计写入失败` 是测试刻意注入的，
 * 把它当根因正是注解优先级要解决的问题。
 */
const TOOL_GATE_FAILURE = /^\s*\[[a-z][a-z0-9-]*\]\s.*(?:不一致|不通过)/;
const WORKFLOW_ERROR = /^##\[error\]\s?/;
/**
 * 包装错误：Actions 与 pnpm 在步骤失败时各补一条「进程退出码非零」，
 * 它们描述的是**结果**不是**原因**。真实日志里 TS2307 出现在这行之前，
 * 若优先取它，归因头会退化成一句「exit code 1」。
 */
const WRAPPER_ERROR =
  /^(Process completed with exit code|The process '.+' failed with exit code|Error: Process completed with exit code|Command failed with exit code|Error: Build failed with \d+ errors?:|failed to load config from\b|(?:⎯+\s*)?Startup Error\b)/;

/**
 * esbuild 的具体错误行：`✘ [ERROR] <原因>`。
 * Vite/Vitest 加载配置失败时先打这一行，再补一条概览 `Error: Build failed with N error(s):`。
 * 概览行是包装，具体行才是根因——真实红 job 里工具曾只报出概览。
 */
const ESBUILD_ERROR = /^\s*✘\s*\[ERROR\]\s?(.+)$/;
const LOCATION_ONLY = /^\s*([^\s:]+:\d+:\d+):\s*$/;
/** 栈帧两种写法：Node 的 `at fn (...)`、Vitest 的 `❯ file:line:col`（结果行的 `❯ file (n tests)` 不是帧） */
const STACK_LINE = /^\s*(?:at\s+\S+|❯\s+\S+:\d+:\d+)/;

function isWrapper(line) {
  return WRAPPER_ERROR.test(line.replace(WORKFLOW_ERROR, "").trim());
}

/** esbuild 的 `✘ [ERROR]` 行本身不带位置，位置在下几行的 `file:line:col:` 单独一行 */
function withLocation(message, lines, at) {
  for (let i = at + 1; i < Math.min(lines.length, at + 5); i++) {
    const m = lines[i].match(LOCATION_ONLY);
    if (m) return `${message} (${m[1]})`;
  }
  return message;
}

/**
 * 从日志里提取「第一处错误 + 它的第一行栈帧 + 末尾关键行」。
 *
 * 按出现顺序取**第一处具体错误**：`##[error]` 与普通错误行一起排序，
 * 包装错误（exit code 1）直接跳过。不再让工具标签优先于真实错误——
 * 真实 CI 里 `##[error]Process completed with exit code 1.` 永远在最后，
 * 优先它等于永远报「exit 1」。
 */
export function extractAttribution(logText, { maxTail = 12 } = {}) {
  const lines = cleanLogLines(logText);
  const content = lines.map((line) => line.trimEnd());

  let firstErrorIndex = -1;
  let firstError = "";
  for (let i = 0; i < content.length; i++) {
    const line = content[i];
    if (line.trim() === "" || isWrapper(line)) continue;
    if (WORKFLOW_ERROR.test(line)) {
      firstErrorIndex = i;
      firstError = line.replace(WORKFLOW_ERROR, "").trim();
      break;
    }
    const esbuild = line.match(ESBUILD_ERROR);
    if (esbuild) {
      firstErrorIndex = i;
      firstError = withLocation(esbuild[1].trim(), content, i);
      break;
    }
    if (ERROR_LINE.test(line) || TOOL_GATE_FAILURE.test(line)) {
      firstErrorIndex = i;
      firstError = line.trim();
      break;
    }
  }

  let stackLine = "";
  if (firstErrorIndex !== -1) {
    for (let i = firstErrorIndex + 1; i < Math.min(content.length, firstErrorIndex + 40); i++) {
      if (STACK_LINE.test(content[i])) {
        stackLine = content[i].trim();
        break;
      }
    }
  }

  const meaningful = content.filter((line) => line.trim() !== "" && line.trim() !== "##[endgroup]");
  const tail = meaningful.slice(-maxTail);
  return { firstError, stackLine, tail };
}

/** `owner/repo` 从各种 remote URL 形态里解析；解析不出返回空串 */
export function parseRepoSlug(remoteUrl) {
  if (typeof remoteUrl !== "string") return "";
  const text = remoteUrl.trim();
  const ssh = text.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  const https = text.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if (https) return https[1];
  const bare = text.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
  if (bare) return bare[1];
  return "";
}

/**
 * 并发取消：GitHub 在 main 上启用 concurrency 后，新推送会取消旧 run 里排队/运行中的 job。
 * 这种红表示「这次没验完」，不表示「代码错了」——把它算进代码失败会让人去查不存在的回归。
 * 只认 GitHub 的固定文案，不按 conclusion=cancelled 泛化：手动取消往往是真问题。
 */
const SUPERSEDED_CANCEL = /Canceling since a higher priority waiting request|was canceled by a newer run/i;

export function isSupersededCancel(text) {
  return typeof text === "string" && SUPERSEDED_CANCEL.test(text);
}

const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required"]);

export function isFailedJob(job) {
  return Boolean(job && FAILED_CONCLUSIONS.has(job.conclusion));
}

/** 失败发生在哪一步：优先 conclusion=failure 的 step，其次最后一步 */
export function failingStep(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const failed = steps.find((step) => step && step.conclusion === "failure");
  if (failed) return failed.name;
  const last = steps.filter((step) => step && step.conclusion !== "skipped").at(-1);
  return last?.name ?? "";
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0].trim();
}

/**
 * 能当归因头用的注解：失败级别 + 非包装文案。
 * 通知（runner 的镜像迁移提醒之类）与 `Process completed with exit code 1.`
 * 都是噪音，留在里面会把归因头带偏。
 *
 * 例外：「No files were found with the provided path」是 upload-artifact 的
 * 产物缺失警告。它永远排在真实失败注解之前，且描述的是**结果**（测试崩了所以没产物），
 * 真实 run 里它把归因头挤成了「junit-sqlite-*.xml 不存在」，比没有归因头更误导。
 */
export function usableAnnotations(annotations) {
  return (Array.isArray(annotations) ? annotations : []).filter((a) => {
    if (!a || a.annotation_level === "notice") return false;
    const message = firstLine(a.message);
    if (message === "" || isWrapper(message)) return false;
    return !/No files were found with the provided path/i.test(message);
  });
}

/** 注解挂在 workflow 文件上而不是源码/测试上：它描述的是 CI 配置，不是失败点 */
function isWorkflowPath(path) {
  return /^\.github(?:\/|$)/.test(String(path ?? "").trim());
}

/** 优先源码/测试上的注解，其次才是 .github 上的；同优先级保持原顺序 */
function primaryAnnotation(usable) {
  return usable.find((a) => !isWorkflowPath(a.path)) ?? usable[0] ?? null;
}

/** `路径:行 · 用例名 · 首行错误`——三样都有时才拼，缺的留空 */
function annotationHead(annotation) {
  const message = firstLine(annotation.message);
  const title = String(annotation.title ?? "").trim();
  const line = annotation.line ?? annotation.start_line;
  const location = annotation.path ? annotation.path + (Number.isFinite(line) ? ":" + line : "") : "";
  return [location, title, message].filter(Boolean).join(" · ");
}

/**
 * 注解锚定的栈帧：从日志里注解所指文件那一行之后找。
 * 直接复用「第一处错误之后的 at」会取到别的测试/别的文件的帧（真实 run 里取到过）。
 */
function stackNearPath(logText, annotation) {
  const path = String(annotation?.path ?? "").trim();
  if (!path) return "";
  const lines = cleanLogLines(logText);
  const at = lines.findIndex((line) => line.includes(path));
  if (at === -1) return "";
  if (STACK_LINE.test(lines[at])) return lines[at].trim();
  for (let i = at + 1; i < Math.min(lines.length, at + 40); i++) {
    if (STACK_LINE.test(lines[i])) return lines[i].trim();
  }
  return "";
}

/**
 * 单个 job 的归因行。
 *
 * 文本来源有两处，优先级不同：
 *   - annotations（注解）是工具主动标注的——失败用例带文件/行号/用例名，最精确；
 *   - 日志兜底所有没有注解的 job（tsc / next build / docker）。
 *
 * 为什么注解必须**先于**日志：日志里混着测试自己打的错误（例如
 * `[navhub] 审计写入失败: Error: simulated audit failure` 是刻意的失败注入），
 * 按行序取第一处错误会把它当成根因。真实 run 里踩过——归因头指向了模拟错误，
 * 而真正的失败用例在注解里。
 */
export function summarizeJob(job, { logText = "", annotations = [] } = {}) {
  const usable = usableAnnotations(annotations);
  const annotationText = usable
    .map((a) => [a.title, a.message, a.raw_details].filter(Boolean).join(" "))
    .join("\n");
  const aggregate = AGGREGATE_JOB.test(String(job?.name ?? ""));
  let layer;
  let signals;
  if (aggregate) {
    layer = "汇总";
    signals = ["上游 job 失败"];
  } else {
    ({ layer, signals } = classifyFailure(annotationText));
    // 注解太泛（如只有一句 "Process completed"）时再让日志说话
    if (layer === "未知") ({ layer, signals } = classifyFailure(annotationText + "\n" + logText));
  }
  const { firstError, stackLine, tail } = extractAttribution(logText);
  const primary = primaryAnnotation(usable);
  // 挂在 .github 上的注解没有文件信息（真实 run：tsc 注解只给了 863 行，看不出是哪个组件）；
  // 这种情况下日志里的 `src/x.tsx(863,41): error TS7006` 更具体，让日志先说话。
  const useAnnotationHead = Boolean(primary) && !isWorkflowPath(primary.path);
  const head = useAnnotationHead ? annotationHead(primary) : firstError || (primary ? annotationHead(primary) : "");
  const row = {
    id: job?.id ?? null,
    name: job?.name ?? "(unknown job)",
    conclusion: job?.conclusion ?? "unknown",
    step: failingStep(job),
    layer,
    firstError: head || firstError,
    stackLine: useAnnotationHead ? stackNearPath(logText, primary) : stackLine,
    tail,
    signals,
    annotationCount: Array.isArray(annotations) ? annotations.length : 0,
    superseded: isSupersededCancel(annotationText + "\n" + logText),
  };
  return { ...row, fixHint: fixHintFor(row) };
}

/** 归因表的渲染（markdown 表格；单元格内换行会被压成空格） */
export function renderAttributionTable(rows) {
  const cell = (value) => String(value ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  const lines = ["| job | 失败步骤 | 归因层 | 归因头 | 信号 |", "| --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(
      `| ${cell(row.name)} | ${cell(row.step)} | ${cell(row.layer)} | ${cell(row.firstError) || "（日志里没有可识别的错误行）"} | ${cell(row.signals.join(", "))} |`,
    );
  }
  return lines.join("\n");
}

/** 按层汇总，给报告一个一句话结论 */
export function layerCounts(rows) {
  const counts = new Map(FAILURE_LAYERS.map((layer) => [layer, 0]));
  for (const row of rows) counts.set(row.layer, (counts.get(row.layer) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 0);
}

/* ------------------------------------------------------------------ *
 * 跨轮对比：把「这一轮红在哪」变成「这一轮**新**红在哪」
 * ------------------------------------------------------------------ */

/**
 * 失败身份键 = job 名 + 归一化后的归因头。
 *
 * 只按 job 名对齐不够：同一个 job 里换个用例挂，会被误判成「老问题还在」。
 * 归因头里的行号必须剥掉——代码增删一行就让「同一条用例」变成「新增红」，
 * 对比表会天天报假新增（真实痛点：migrate-dialect 的 56 行前后移动过）。
 */
export function failureKey(row) {
  const name = String(row?.name ?? "").trim();
  const head = String(row?.firstError ?? "")
    .trim()
    .replace(/([^\s:]+):\d+(?::\d+)?/g, "$1")
    .replace(/\s+/g, " ");
  return head ? name + " :: " + head : name;
}

/** 把并发取消从代码失败里摘出去：它表示「没验完」，不表示「验不过」 */
export function splitSuperseded(rows) {
  const code = [];
  const superseded = [];
  for (const row of Array.isArray(rows) ? rows : []) (row?.superseded ? superseded : code).push(row);
  return { code, superseded };
}

/**
 * 三轮桶：新增红 / 仍在红 / 已修复。
 *
 * 并发取消两边都先摘掉——上一轮被取消的 job 不该在「已修复」里虚报一次修复，
 * 本轮的取消也不该进「新增红」。
 */
export function diffFailures(current, baseline) {
  const after = splitSuperseded(current).code;
  const before = splitSuperseded(baseline).code;
  const beforeKeys = new Set(before.map(failureKey));
  const afterKeys = new Set(after.map(failureKey));
  return {
    introduced: after.filter((row) => !beforeKeys.has(failureKey(row))),
    persisted: after.filter((row) => beforeKeys.has(failureKey(row))),
    fixed: before.filter((row) => !afterKeys.has(failureKey(row))),
  };
}

function renderRowBrief(row) {
  const head = String(row?.firstError ?? "").trim();
  return "- " + row.name + (head ? " — " + head : " —（无归因头）");
}

/** 对比段的 markdown。三桶都为空时给一句「与基线一致」，不留空白让人猜 */
/**
 * `inProgress` 是必须的：run 未结束时「本轮没有这个失败」只说明 job 还没跑到，
 * 不是已修复。真实 run #40605609970 上第一版把 6 条 pending 报成「已修复」——
 * 这种假绿比不报更危险，所以未结束时就明确不算「已修复」。
 */
export function renderBaselineDiff(diff, { baselineLabel = "基线", inProgress = false } = {}) {
  const { introduced = [], persisted = [], fixed = [] } = diff ?? {};
  const lines = [];
  if (inProgress) {
    lines.push(
      `新增红 ${introduced.length} · 仍在红 ${persisted.length}（对比 ${baselineLabel}）· run 尚未结束，暂不计算「已修复」`,
    );
  } else {
    lines.push(
      `新增红 ${introduced.length} · 仍在红 ${persisted.length} · 已修复 ${fixed.length}（对比 ${baselineLabel}）`,
    );
  }
  if (introduced.length === 0 && persisted.length === 0 && fixed.length === 0) {
    lines.push("");
    lines.push(inProgress ? "目前还没有失败的 job（run 尚未结束，结论以最终为准）。" : "与基线一致：没有新增或消失的失败。");
    return lines.join("\n");
  }
  if (introduced.length > 0) {
    lines.push("", "### 新增红（本轮引入，需要本次推送负责）");
    for (const row of introduced) lines.push(renderRowBrief(row));
  }
  if (persisted.length > 0) {
    lines.push("", "### 仍在红（基线已存在，不是本轮引入）");
    for (const row of persisted) lines.push(renderRowBrief(row));
  }
  if (fixed.length > 0 && inProgress) {
    lines.push("", "### 待确认（基线有、本轮尚未失败）");
    lines.push("run 尚未结束：这些 job 可能还没跑到，结束后再看是否真的修复。");
    for (const row of fixed) lines.push(renderRowBrief(row));
  } else if (fixed.length > 0) {
    lines.push("", "### 已修复（基线有、本轮没有）");
    for (const row of fixed) lines.push(renderRowBrief(row));
  }
  return lines.join("\n");
}

/**
 * 轮询直到 run 结束（conclusion 非空）。
 *
 * 为什么需要：刚推送就跑归因时 run 往往还是 queued/in_progress，
 * 此时「本轮没有某个失败」只代表 job 还没跑到——上一版就是在这里把
 * pending 误报成「已修复」。等终局再算三桶，才谈得上「这条红是不是我造成的」。
 *
 * 依赖全部注入（fetchRun / now / sleep），核心只是状态机的可测性：
 *   - 超时返回最后一次快照并标记 timedOut，由调用方以独立退出码收尾，
 *     绝不把超时伪装成「查询失败」(2) 或「有失败 job」(1)。
 *   - 单次轮询失败只计数不中止：预算 30 分钟的等待不该在第 25 分钟因为一条
 *     断掉的连接整轮作废（那等于让人重推一次才拿到归因）。全部失败照样超时收尾，
 *     但 pollErrors 会告诉调用方「这次结论是等出来的还是查出来的」。
 */
export async function waitForRunConclusion({
  run,
  fetchRun,
  intervalMs = 20_000,
  timeoutMs = 1_800_000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onPoll,
} = {}) {
  const startedAt = now();
  let current = run;
  let polls = 0;
  let pollErrors = 0;
  while (!current?.conclusion) {
    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      return { run: current, timedOut: true, waitedMs: elapsedMs, polls, pollErrors };
    }
    await sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
    try {
      current = await fetchRun(current.id);
      polls++;
    } catch (error) {
      pollErrors++;
      if (onPoll) onPoll(current, { polls, waitedMs: now() - startedAt, error });
      continue;
    }
    if (onPoll) onPoll(current, { polls, waitedMs: now() - startedAt });
  }
  return { run: current, timedOut: false, waitedMs: now() - startedAt, polls, pollErrors };
}
