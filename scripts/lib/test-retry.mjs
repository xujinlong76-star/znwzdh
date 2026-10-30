/**
 * 全量测试「抖动收敛」的纯逻辑。
 *
 * 抽成独立模块是为了可测：`verify.mjs` 是个跑完整流程的脚本，
 * 没法在测试里 import 它而不触发主流程。这里只放判定，不碰进程。
 *
 * ## 为什么需要抖动收敛
 *
 * 全量 566 文件跑 15 分钟，本机又常有并行会话争用，高并发下单用例超时是常态
 * （2026-10-30 三次实测：连跑两次即绿）。整段重跑等于再花 15 分钟，
 * 而红的往往只有一两个文件。所以：**只重跑红的文件**，重跑仍红才算真回归。
 *
 * 但「抖动放行」必须**点名是哪些文件抖过**——静默当通过就是把守卫变摆设。
 */

/**
 * 从 vitest 输出里抽出失败的测试文件路径（去重、保持出现顺序）。
 *
 * vitest 的失败行形如：
 *     FAIL  apps/web/test/silent-catch.test.ts > 吞掉失败的 catch 都要写明理由 > ...
 *     FAIL  scripts/ci-defused.test.ts [ scripts/ci-defused.test.ts ]
 *
 * 只认 `.test.` / `.spec.` 结尾的 TS/JS 文件，避免把断言文本里的路径当文件。
 */
export function parseFailedTestFiles(output) {
  const out = [];
  const seen = new Set();
  const re = /^\s*FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)\b/gm;
  let m;
  while ((m = re.exec(output)) !== null) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * 纯函数：按「首轮结果 + 重跑结果」判定最终结论。
 *
 * 返回 `{ kind, message }`：
 *   - `pass`         首轮就绿；
 *   - `flaky`        首轮红、重跑绿 ⇒ 抖动放行，但必须点名抖过的文件；
 *   - `regression`   重跑仍红 ⇒ 真回归，必须挡下；
 *   - `unparseable`  首轮红却抽不出文件名（崩溃/配置错）⇒ 不猜，按真失败处理。
 */
export function decideTestOutcome({ firstOk, failedFiles, retryOk }) {
  if (firstOk) return { kind: "pass", message: "全量测试通过" };
  if (failedFiles.length === 0) {
    return {
      kind: "unparseable",
      message: "全量测试失败，且未能从输出解析出失败文件（可能是崩溃或配置错），不重试",
    };
  }
  const names = failedFiles.join(" / ");
  if (retryOk) {
    return {
      kind: "flaky",
      message: `首轮 ${failedFiles.length} 个文件红，重跑全绿 ⇒ 判定为高并发抖动，放行；抖过的文件：${names}`,
    };
  }
  return {
    kind: "regression",
    message: `重跑后仍红 ${failedFiles.length} 个文件，是真回归不是抖动：${names}`,
  };
}

/**
 * 脆弱测试的累进判定：同一文件被「抖动放行」到一定次数就转红。
 *
 * 为什么需要：放行一次是宽容，放行十次就是把守卫变成摆设——
 * 同一个文件反复抖，说明它是真脆弱（依赖墙钟 / 全局状态 / 网络），
 * 该修的是它，不是每次重跑蒙混过关。
 *
 * 纯函数，计数由调用方持久化。
 */
export function escalateFlaky(history, failedFiles, threshold = 3) {
  const counts = { ...(history ?? {}) };
  const escalated = [];
  for (const f of failedFiles) {
    counts[f] = (counts[f] ?? 0) + 1;
    if (counts[f] >= threshold) escalated.push(f);
  }
  return { counts, escalated };
}
