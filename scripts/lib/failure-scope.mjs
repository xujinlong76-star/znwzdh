/**
 * 本地测试红的归属：只有「失败与本次提交有关」的那部分才拦提交。
 *
 * 为什么需要：本仓库长期多会话并行，工作区是多人改动的叠加态。pre-commit 的选测
 * 已经只按暂存集挑测试，但测试**跑在工作区**上——别人未提交的源码会真实地改变结果。
 * 2026-10-31 实测：一个只含种子数据的提交跑 259 个测试，红的是
 * `apps/web/test/copilot-stream-guard.test.ts`：它读 `apps/api/src/routes/copilot.ts`
 * 的源码，而那份源码被同事的配额重构改脏、尚未提交——这个红与我的提交无关，
 * 也无法由我的提交修复。CI 检出 HEAD 时那份源码还是旧版本，测试是绿的。
 *
 * 判据不是「有没有脏文件」（脏文件足够多时人人都有，等于把门禁关掉），而是**失败
 * 文件自己的依赖闭包**：闭包里出现「工作区侧与索引不同」或「未跟踪」的节点，这个
 * 红才降级为只报不拦；闭包干净仍判红。与 `check-commit-atomicity` 的「本地判定
 * 不可信（只报不拦）」同一哲学：本地不可验证时点名，不假装通过也不误杀。
 *
 * 第二条判据（2026-10-31 同日实测补）：图看不见「按目录扫全仓」的测试。
 * `apps/web/test/field-names.test.ts` 遍历 `apps/web/src` 找无名字的表单控件，
 * 不 import 被扫的文件——实测它的依赖闭包里 `dir:` 节点为 0，而失败消息点名的
 * 五处源码全在工作区未提交改动里。这类红与种子提交无关，图判据却只能判「真红」。
 * 于是补一条同样收敛的旁证：**失败块内点名的 `path:行号` 若正是未提交改动**，
 * 降级并点名。块作用域按 FAIL 行切分——跨块归因会把别人的失败算到自己头上。
 *
 * 纯函数集中在这里，选测器（生成物）只负责接线——判据要能被单测钉住。
 */

/** vitest 的失败行：` FAIL  apps/api/test/x.test.ts > 套件 > 用例`（可能带 ANSI） */
const FAIL_LINE = /^\s*FAIL\s+([^\s>]+\.(?:test|spec)\.(?:ts|tsx|mts|cts))\b/;

export function parseFailingTestFiles(output) {
  const files = new Set();
  for (const raw of String(output ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const m = line.match(FAIL_LINE);
    if (m) files.add(m[1].replace(/\\/g, "/"));
  }
  return [...files].sort();
}

/**
 * `git status --porcelain` 行 → 工作区侧和索引不同的路径。
 *   - Y 位非空（' M' / 'MM' / ' D'）= 工作区内容没进索引，测试跑的是提交外的代码；
 *   - '??' 未跟踪：文件进 files，折叠目录进 dirs（按前缀匹配依赖节点）。
 * X 位非空但 Y 位为空（'M '）= 只动索引 = 本次提交的内容，不算脏。
 */
export function worktreeDirtyPaths(statusLines) {
  const files = new Set();
  const dirs = [];
  for (const raw of statusLines ?? []) {
    if (!raw || raw.length < 4) continue;
    const x = raw[0];
    const y = raw[1];
    let path = raw.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    path = path.replace(/\\/g, "/");
    if (x === "?" && y === "?") {
      if (path.endsWith("/")) dirs.push(path);
      else files.add(path);
      continue;
    }
    if (y !== " ") files.add(path);
  }
  return { files, dirs };
}

/** 模块图的 reverse（依赖 → 引用者）折成正向（引用者 → 依赖）。 */
export function forwardAdjacency(reverse) {
  const forward = new Map();
  for (const [dep, dependents] of reverse ?? new Map()) {
    for (const dependent of dependents) {
      let set = forward.get(dependent);
      if (!set) forward.set(dependent, (set = new Set()));
      set.add(dep);
    }
  }
  return forward;
}

/** 传递闭包（含起点自身；测试自己脏也要能被认出来）。 */
export function dependencyClosure(forward, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.pop();
    for (const dep of forward.get(node) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      queue.push(dep);
    }
  }
  return seen;
}

/** 闭包里第一个命中工作区未提交改动的节点；没有则 null。 */
export function firstWorktreeHit(closure, worktree) {
  for (const node of closure) {
    if (worktree.files.has(node)) return node;
    const dir = worktree.dirs.find((d) => node.startsWith(d));
    if (dir) return dir;
  }
  return null;
}

/**
 * 一条 FAIL 行开启一个块，到下一条 FAIL 行为止。同文件的多个失败块合并。
 * 作用域必须按块切：vitest 的汇总段（`❯ apps/web/test/x.test.ts:250:7`）落在
 * 最后一个块里，不切块就等于「整份日志点名的脏路径都算给最后一个文件」。
 */
export function parseFailBlocks(output) {
  const blocks = new Map();
  let current = null;
  for (const raw of String(output ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const m = line.match(FAIL_LINE);
    if (m) {
      const file = m[1].replace(/\\/g, "/");
      current = blocks.get(file);
      if (!current) blocks.set(file, (current = []));
      continue;
    }
    if (current) current.push(line);
  }
  return blocks;
}

/**
 * 失败消息里的 `path:行号`。要求带行号：这是「此处违规」的申报，比裸路径可信得多；
 * 不带宽限会连 import 说明一起认，容易把真红误降级（门禁宁可拦住，不可漏放）。
 */
const NAMED_PATH =
  /(?:^|[^A-Za-z0-9_.\-/])((?:apps\/[A-Za-z0-9-]+\/)?src\/[A-Za-z0-9_.\-\[\]@+/]+\.(?:tsx|ts|jsx|js|mjs|cjs)):\d+/g;

/** `src/...` 可能相对 overlay 源码根，也可能是 apps/web 生成镜像——两个候选都试。 */
function namedCandidates(named) {
  if (named.startsWith("apps/web-overlay/src/")) {
    return [named, named.replace(/^apps\/web-overlay\//, "apps/web/")];
  }
  if (named.startsWith("apps/web/src/")) {
    return [named, named.replace(/^apps\/web\//, "apps/web-overlay/")];
  }
  if (named.startsWith("apps/")) return [named];
  return ["apps/web-overlay/" + named, "apps/web/" + named];
}

/** 失败块里点名的路径中，命中工作区未提交改动的那些（去重、排序）。 */
export function namedWorktreeHits(lines, worktree) {
  const hits = new Set();
  for (const line of lines ?? []) {
    for (const m of String(line).matchAll(NAMED_PATH)) {
      for (const candidate of namedCandidates(m[1].replace(/\\/g, "/"))) {
        if (worktree.files.has(candidate)) {
          hits.add(candidate);
          continue;
        }
        const dir = worktree.dirs.find((d) => candidate.startsWith(d));
        if (dir) hits.add(dir);
      }
    }
  }
  return [...hits].sort();
}

/**
 * 失败文件 → 拦（blocked）/ 不拦（downgraded，附归因）。
 * 不在本次提交里的失败文件一律降级：它既不是这次提交引入的，也无法由这次提交修复。
 * `named` 是 parseFailBlocks 的结果；图判据没命中时，用失败消息自己点名的脏路径。
 */
export function attributeFailures(failing, { inIndex, worktree, forward, named }) {
  const downgraded = [];
  const blocked = [];
  for (const raw of failing ?? []) {
    const file = String(raw).replace(/\\/g, "/");
    if (!inIndex.has(file)) {
      downgraded.push({ file, reason: "不在本次提交（未入库且未暂存）" });
      continue;
    }
    const hit = firstWorktreeHit(dependencyClosure(forward, file), worktree);
    if (hit) {
      downgraded.push({ file, reason: "依赖未提交改动 " + hit });
      continue;
    }
    const namedHits = namedWorktreeHits(named?.get(file), worktree);
    if (namedHits.length > 0) {
      downgraded.push({ file, reason: "失败消息点名了未提交改动 " + namedHits.join("、") });
      continue;
    }
    blocked.push({ file, reason: "依赖闭包与失败消息里都没有未提交改动" });
  }
  return { blocked, downgraded };
}
