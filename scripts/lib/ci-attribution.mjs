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
    patterns: [/\bAssertionError\b/g, /^\s*FAIL\s+\S+/gm, /\bexpect\(/g, /Test Files\s+\d+/g, /✕/g],
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
    if (ERROR_LINE.test(line)) {
      firstErrorIndex = i;
      firstError = line.trim();
      break;
    }
  }

  let stackLine = "";
  if (firstErrorIndex !== -1) {
    for (let i = firstErrorIndex + 1; i < Math.min(content.length, firstErrorIndex + 40); i++) {
      if (/^\s+at\s+\S+/.test(content[i])) {
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

/**
 * 单个 job 的归因行。
 *
 * 文本来源有两处，合并分类：
 *   - annotations（注释）是工具主动标注的，先于日志；
 *   - 日志兜底所有没有注释的 job（tsc / next build / docker）。
 */
export function summarizeJob(job, { logText = "", annotations = [] } = {}) {
  const annotationText = annotations
    .map((a) => [a.title, a.message, a.raw_details].filter(Boolean).join(" "))
    .join("\n");
  const combined = annotationText + "\n" + logText;
  const aggregate = AGGREGATE_JOB.test(String(job?.name ?? ""));
  const { layer, signals } = aggregate
    ? { layer: "汇总", signals: ["上游 job 失败"] }
    : classifyFailure(combined);
  const { firstError, stackLine, tail } = extractAttribution(logText);
  const primaryAnnotation = annotations[0];
  return {
    id: job?.id ?? null,
    name: job?.name ?? "(unknown job)",
    conclusion: job?.conclusion ?? "unknown",
    step: failingStep(job),
    layer,
    firstError: firstError || primaryAnnotation?.message || "",
    stackLine,
    tail,
    signals,
    annotationCount: annotations.length,
  };
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
