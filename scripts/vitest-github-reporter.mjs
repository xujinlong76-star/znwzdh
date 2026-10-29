/**
 * vitest → GitHub Actions 注解（workflow command）报告器。
 *
 * 为什么需要它：测试作业的失败信息在 Actions UI 里默认只是一大段日志，
 * 哪个用例红了、红在哪个文件哪一行，要人肉翻。这里把每个失败用例转成
 * `::error file=…,line=…,title=…::message`，GitHub 会把它渲染成注解；
 * scripts/explain-ci-failure.mjs 再把这些注解聚合成归因表。
 *
 * 只在 `GITHUB_ACTIONS=true` 时输出——本地跑测试不应该多出任何噪音。
 * 注解有上限（GitHub 单步 10 条），所以自己先截断并补一条总数说明，
 * 避免「UI 里只看到 10 条，以为只有 10 个失败」。
 */

export const MAX_ANNOTATIONS = 20;

/** workflow command 属性值转义（file/title 等） */
export function escapeProperty(value) {
  return String(value ?? "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

/** workflow command 正文转义（只处理 %、CR、LF） */
export function escapeData(value) {
  return String(value ?? "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function firstLine(message) {
  const text = String(message ?? "").trim();
  if (!text) return "（无错误信息）";
  return text.split(/\r?\n/, 1)[0].slice(0, 400);
}

/**
 * 用例行号：vitest 的 TestCase.location 在部分版本为空，
 * 退而求其次从错误栈里找本文件的第一帧（`at …/x.test.ts:12:5`）。
 */
export function lineFromStack(error, file) {
  const stack = String(error?.stack ?? error?.stacks?.[0] ?? "");
  const base = String(file ?? "").split("/").pop();
  if (!stack || !base) return null;
  for (const frame of stack.split(/\r?\n/)) {
    if (!frame.includes(base)) continue;
    const match = frame.match(/:(\d+):(\d+)\)?\s*$/);
    if (match) return Number(match[1]);
  }
  return null;
}

/** 一条注解（workflow command 格式） */
export function annotationLine({ file, line, title, message }) {
  const props = [];
  if (file) props.push("file=" + escapeProperty(file));
  if (Number.isInteger(line) && line > 0) props.push("line=" + line);
  if (title) props.push("title=" + escapeProperty(title));
  return "::error" + (props.length > 0 ? " " + props.join(",") : "") + "::" + escapeData(message);
}

/**
 * 从 vitest 的 TestModule 列表里收集失败（模块加载错误 + 失败用例）。
 * 只依赖公开访问器（children.allTests / errors()），不碰内部字段。
 */
export function collectFailures(testModules, unhandledErrors = []) {
  const failures = [];
  for (const testModule of testModules ?? []) {
    const file = testModule?.relativeModuleId ?? testModule?.moduleId ?? "";
    for (const error of testModule?.errors?.() ?? []) {
      failures.push({ file, line: null, title: "模块加载失败", message: firstLine(error?.message) });
    }
    const tests = testModule?.children?.allTests?.("failed") ?? [];
    for (const test of tests) {
      let result;
      try {
        result = test.result?.();
      } catch {
        result = null;
      }
      const error = result?.errors?.[0];
      const line = test?.location?.line ?? result?.location?.line ?? lineFromStack(error, file);
      failures.push({ file, line, title: test?.name ?? "(未命名用例)", message: firstLine(error?.message) });
    }
  }
  for (const error of unhandledErrors ?? []) {
    failures.push({ file: "", line: null, title: "未捕获异常", message: firstLine(error?.message) });
  }
  return failures;
}

/** 注解行 + 截断说明（超出 MAX_ANNOTATIONS 时只输出前 N 条） */
export function annotationLines(failures) {
  const shown = failures.slice(0, MAX_ANNOTATIONS);
  const lines = shown.map(annotationLine);
  if (failures.length > shown.length) {
    lines.push(
      annotationLine({
        title: "vitest 失败总数",
        message:
          "共 " + failures.length + " 个失败，这里只标注前 " + shown.length + " 个；" +
          "完整列表在本作业的 junit artifact（`junit-*.xml`），test-sqlite / test-e2e 还写成" +
          "「红灯光谱（Step Summary）」——作业日志要 Actions 权限才读得到，别拿它当能核对的通道。",
      }),
    );
  }
  return lines;
}

export default class GitHubAnnotationsReporter {
  onTestRunEnd(testModules, unhandledErrors) {
    if (process.env.GITHUB_ACTIONS !== "true") return;
    const failures = collectFailures(testModules, unhandledErrors);
    if (failures.length === 0) return;
    for (const line of annotationLines(failures)) console.log(line);
  }
}
