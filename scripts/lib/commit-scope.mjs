/**
 * 「提交说明的主题域 ↔ 文件域」一致性判定。
 *
 * ## 为什么需要它
 *
 * 2026-10-30 出过一次错位：`6dbadb83` 的 message 写的是
 * `feat(tooling): 事实源判据扩到目录级`，实际装入的却是并行会话的
 * `ci-defused` 文件集——safe-commit 与对方同刻提交时 HEAD 竞态，索引串了。
 *
 * `safe-commit` 原本只核对「文件集 == 我传的 pathspec」，那个检查在竞态下
 * 会跟着一起错（它读的也是同一个索引）。**message 与文件域的对照是独立的第二道**：
 * 写的是 `tooling`，装的却是 `ci.yml` + `docs/`，一眼就能看出来。
 *
 * ## 判据
 *
 * 从 subject 取 `type(scope[,scope…])`，把 scope 映射到顶层目录集合，
 * 与提交文件的顶层目录比对：**文件域必须是主题域的子集**（少写可以，多写不行）。
 * 判不了（没 scope / 未知 scope）就放行——宁可漏报，不可误杀。
 */

/** scope → 允许的顶层路径前缀。多 scope 取并集。 */
export const SCOPE_DIRS = {
  api: ["apps/api/"],
  web: ["apps/web-overlay/", "apps/web/"],
  core: ["packages/core/"],
  store: ["packages/store/"],
  ai: ["packages/ai/"],
  mcp: ["packages/mcp/"],
  tooling: ["scripts/"],
  scripts: ["scripts/"],
  ci: [".github/"],
  docs: ["docs/", "deliverables/"],
  deliverables: ["deliverables/"],
  test: ["e2e/"],
  e2e: ["e2e/"],
};

/**
 * 单个文件是否落在某个 scope 的目录下。
 * 测试目录（test 与 tests 两种拼写）对 test/e2e 放行——测试镜像跟着源走。
 */
export function fileMatchesScope(file, scope) {
  const dirs = SCOPE_DIRS[scope];
  if (!dirs) return null; // 未知 scope：判不了
  if (dirs.some((d) => file.startsWith(d))) return true;
  if (scope === "test" || scope === "e2e") {
    if (/(^|\/)tests?\//.test(file)) return true;
  }
  return false;
}

/**
 * 纯函数：核对 subject 与 files 是否同一域。
 *
 * 返回 `{ ok, reason, scope, outsiders }`：
 *   - `ok: true`            一致，或判不了（放行）；
 *   - `ok: false`           文件域超出主题域，`outsiders` 列出越界文件。
 */
export function checkCommitScope(subject, files) {
  const m = /^(\w+)(?:\(([^)]+)\))?\s*[!:]/.exec(subject.trim());
  if (!m) return { ok: true, reason: "subject 无 type(scope) 形式，判不了，放行" };

  const scopes = (m[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (scopes.length === 0) return { ok: true, reason: "subject 无 scope，判不了，放行" };

  const known = scopes.filter((s) => SCOPE_DIRS[s]);
  if (known.length === 0) return { ok: true, reason: `scope ${scopes.join("/")} 均不在映射表，判不了，放行` };

  const outsiders = files.filter((f) => !known.some((s) => fileMatchesScope(f, s) === true));
  if (outsiders.length === 0) {
    return { ok: true, reason: `文件域落在 ${known.join("/")} 内`, scope: known };
  }
  return {
    ok: false,
    reason: `subject 写的是 ${known.join("/")}，但这些文件在域外`,
    scope: known,
    outsiders,
  };
}
