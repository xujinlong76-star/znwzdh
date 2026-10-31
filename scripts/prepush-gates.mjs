#!/usr/bin/env node
/**
 * pre-push 门禁：把几枚「只有 CI 才知道」的闸门左移到推送前。
 *
 * 为什么是这几枚：
 *   - 契约生成物同源（scripts/generate-rest-contract-types.mjs --check）：
 *     pre-commit 按目录映射选测，只改 packages/core 时跑的是 packages/core/test，
 *     而漂移用例在 scripts/ 下——**改 core 不重生成**从钩子底下溜过去是常态。
 *   - scope 显式断言（apps/api/test/route-policy.test.ts）：它依赖注册期的真实路由清单，
 *     只有跑起来才知道；漏写 scope 的写路由会静默变成匿名可写。
 *   - 客户端模块图不碰 node 内建（scripts/check-client-node-imports.mjs）：
 *     这类问题的 CI 反馈是最慢也最难懂的——tsc/eslint/build 全绿，直到
 *     `check-bundle-budget` 报「首屏超预算」才知道，且没有线索指向根因
 *     （2026-10-28 实测：`node:crypto` 的垫片让 /videos 首屏 +476 KB）。
 *   - core 镜像与事实源同源（scripts/check-core-mirrors.mjs）：
 *     `packages/core` 的纯算法在覆盖层有一份逐字节副本，CI 用
 *     `sync-core-mirrors --check` 守（.github/workflows/ci.yml:550）。这条闸门
 *     **在工作区里查不出来**——2026-10-28 实测 HEAD 上 `webmcp-bridge` 漂移、
 *     CI 的覆盖层 job 报红，而同一个工作区里 `--check` 是绿的（修复躺在别的会话
 *     没提交）。只有读提交的版本能在这个窗口里说真话。
 *     这枚带 `--baseline <merge-base>`：漂移如果在基线上就以同样根因红着，那是上游的账，
 *     本次推送发不出去既救不了它，还会逼人用 NAVHUB_SKIP_PREPUSH 整条绕过；所以打印警告
 *     放行，新引入的漂移照拦。CI 不带 baseline，那侧继续严格判红。
 *   - 已提交的测试镜像与 overlay 同源（本文件内现算，不读工作区）：
 *     `apps/web/test/**` 是**少数被跟踪的 vendored 副本**，正常由 vendor-web/check-web-overlay
 *     按工作区比对。2026-10-28 连着出现两次「只提交 overlay 侧守卫、漏提交镜像」
 *     （`10e38d3a` mobile-nav、`d7cf72d6` sync-health-card），HEAD 上两份副本互相矛盾；
 *     CI 因为两个测试 job 都先 `node scripts/vendor-web.mjs` 重建镜像而**看不见**这层漂移，
 *     受害的是「不 vendor 直接 pnpm test」的口径（新克隆、IDE）。同 core 镜像那枚的道理：
 *     只有读提交内容能在这个窗口里说真话，所以 baseline 语义也照搬。
 *
 * 为什么不无条件跑前两枚：本仓库长期多会话并行，工作区里常有别人未提交的半成品。
 * 这两枚检查的是**工作区**，而推送出去的是**提交**。两者不一致时跑出来的红
 * 与本次推送无关，只会冤枉人。所以每枚闸门只看自己相关的路径：
 * 干净 → 与推送内容一致，跑；有未提交改动 → 明确跳过并说明（CI 全量兜底），不阻塞。
 *
 * 后两枚没有这个包袱：它们读的是 HEAD 的提交内容（= 正要推出去的东西），
 * 别人的未提交改动进不了它们的视野，所以无条件跑。
 *
 * 退出码：0 = 通过或按规则跳过，1 = 闸门失败。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT_PATHS = [
  "packages/core/src/rest-responses.ts",
  "apps/web-overlay/src/lib/rest-contracts.generated.ts",
];

const SCOPE_PATHS = ["apps/api/src", "apps/api/test/route-policy.test.ts"];

/** 受跟踪的测试镜像两侧前缀：同名文件必须逐字节同源（committed blob 相等）。 */
const MIRROR_SIDES = {
  web: "apps/web/test/",
  overlay: "apps/web-overlay/test/",
};

/**
 * 每枚闸门的执行计划。dirty = 相关路径存在未提交改动（工作区 ≠ HEAD）。
 * 纯函数：跳过语义（「不阻塞、但说清楚为什么」）在这里可测。
 * `unconditional` 的闸门只看提交内容，dirty 与它无关，所以恒跑。
 */
export function planGates({ contractDirty = false, scopeDirty = false } = {}) {
  return [
    {
      id: "rest-contracts",
      title: "契约生成物与源码同源",
      run: !contractDirty,
      skipReason: contractDirty
        ? "工作区里 " + CONTRACT_PATHS.join(" / ") + " 有未提交改动，检查结果与本次推送无关"
        : "",
    },
    {
      id: "scope-explicit",
      title: "写路由必须显式声明 scope",
      run: !scopeDirty,
      skipReason: scopeDirty
        ? "工作区里 " + SCOPE_PATHS.join(" / ") + " 有未提交改动，检查结果与本次推送无关"
        : "",
    },
    {
      id: "client-node-imports",
      title: "客户端模块图不引 node 内建",
      run: true,
      skipReason: "",
    },
    {
      id: "core-mirrors",
      title: "core 与前端运行时镜像同源",
      run: true,
      skipReason: "",
    },
    {
      id: "test-mirror-pairs",
      title: "已提交的测试镜像与 overlay 同源",
      run: true,
      skipReason: "",
    },
    {
      id: "deps-integrity-prepush",
      title: "依赖未被装残",
      run: true,
      skipReason: "",
    },
    {
      id: "mock-hygiene-prepush",
      title: "跨模块 mock 都带 vi.resetModules() 兜底",
      run: true,
      skipReason: "",
    },
  ];
}

/**
 * 纯函数：从 `git ls-tree` 解析出的条目里挑出「两侧同名受跟踪、但 committed blob 不同」的文件名。
 *
 * 只算两侧都存在的情况：
 *   - 只有 overlay 侧有（镜像还没建）不是红灯，root vitest 跑不到它，是覆盖损失；
 *   - 只有 web 侧有（历史上只在底座里写的测试）同理不管。
 * 返回排序后的相对名数组，调用方负责与 baseline 求差集。
 */
export function pairMirrorDrift(entries) {
  const sides = { web: new Map(), overlay: new Map() };
  for (const entry of entries) {
    for (const side of ["web", "overlay"]) {
      const prefix = MIRROR_SIDES[side];
      if (entry.path.startsWith(prefix)) {
        sides[side].set(entry.path.slice(prefix.length), entry.sha);
        break;
      }
    }
  }
  const drift = [];
  for (const [name, sha] of sides.web) {
    const other = sides.overlay.get(name);
    if (other !== undefined && other !== sha) drift.push(name);
  }
  return drift.sort();
}

function isDirty(paths) {
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...paths], { stdio: "ignore" });
    return false;
  } catch (error) {
    // 1 = 有差异；128 之类的真实错误不该被当成「干净」
    if (error && typeof error.status === "number" && error.status === 1) return true;
    throw error;
  }
}

function runNode(args) {
  execFileSync(process.execPath, args, { stdio: "inherit" });
}

function runContractGate() {
  runNode(["scripts/generate-rest-contract-types.mjs", "--check"]);
}

function runScopeGate() {
  const vitestEntry = resolve("node_modules/vitest/vitest.mjs");
  if (!existsSync(vitestEntry)) {
    throw new Error("找不到 vitest 入口 " + vitestEntry + "（请先 pnpm install）；不做「什么都没跑就算通过」的降级");
  }
  runNode([vitestEntry, "run", "apps/api/test/route-policy.test.ts", "--reporter=dot"]);
}

function runClientGraphGate() {
  runNode(["scripts/check-client-node-imports.mjs"]);
}

/**
 * 依赖完整性：pre-commit 只看本次提交，pre-push 时再扫一遍全仓。
 * 装残的包会让几百个测试套件同时报「找不到模块」，推送前认出来比推上去再红便宜。
 */
function runDepsIntegrityGate() {
  runNode(["scripts/check-deps-integrity.mjs"]);
}

/**
 * mock 卫生：pre-commit 只查本次提交集，**分多次提交累积出的缺口**要在这里兜住
 * （甲提交加了 vi.mock、乙提交才补 afterAll——分开看都对，合起来漏）。
 *
 * 按 HEAD 判而不是按工作区：推送出去的只有 HEAD。按工作区判会把并行会话
 * 尚未提交的测试文件算进来——2026-10-31 实测，别人 19:06 新建的
 * video-shrink-confirm.test.ts 缺兜底，把只含 gate 脚本的推送挡了两次，
 * 而那个文件根本不在要推的提交里。与 core 镜像 / 测试镜像配对同一口径。
 */
function runMockHygieneGate() {
  runNode(["scripts/fix-mock-hygiene.mjs", "--head"]);
}

/**
 * 本次推送的基线 = HEAD 与上游分支的 merge-base。
 * 拿不到（没配 upstream、浅克隆、 detached HEAD）就返回 null，让闸门退回「按 HEAD 严格判红」——
 * 未知比较对象时收紧不放宽。
 */
function upstreamBaseline() {
  try {
    const out = execFileSync("git", ["merge-base", "HEAD", "@{upstream}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

function runCoreMirrorGate() {
  const baseline = upstreamBaseline();
  const args = ["scripts/check-core-mirrors.mjs"];
  if (baseline !== null) args.push("--baseline", baseline);
  console.log(
    "[pre-push-gates] core 镜像基线 = " +
      (baseline === null ? "（拿不到上游 merge-base，按 HEAD 严格判红）" : baseline.slice(0, 10)),
  );
  runNode(args);
}

/** 读某个提交上两侧 test 目录的 committed blob 清单（不碰工作区）。 */
function lsTreeMirrorEntries(ref) {
  const out = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      ref,
      "--format=%(objectname) %(path)",
      "--",
      MIRROR_SIDES.web,
      MIRROR_SIDES.overlay,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const sp = line.indexOf(" ");
      return { sha: line.slice(0, sp), path: line.slice(sp + 1) };
    });
}

function runTestMirrorPairGate() {
  const atHead = pairMirrorDrift(lsTreeMirrorEntries("HEAD"));
  const baseline = upstreamBaseline();
  const atBase = baseline === null ? [] : pairMirrorDrift(lsTreeMirrorEntries(baseline));
  const known = new Set(atBase);
  const fresh = atHead.filter((name) => !known.has(name));
  const inherited = atHead.length - fresh.length;

  if (inherited > 0) {
    console.log(
      "[pre-push-gates] ⚠️ " +
        inherited +
        " 份已提交测试镜像在基线上就已经不同源，不是本次推送引入的，放行：" +
        atHead
          .filter((name) => known.has(name))
          .map((n) => "apps/web/test/" + n)
          .join(" / "),
    );
  }
  if (fresh.length > 0) {
    throw new Error(
      fresh.length +
        " 份测试镜像本次推送后两侧不同源：" +
        fresh.map((n) => "apps/web/test/" + n + " ≠ apps/web-overlay/test/" + n).join(" / ") +
        "（HEAD 上的 committed blob 不等；root vitest 跑的是 apps/web/test 那份）",
    );
  }
}

const RUNNERS = {
  "rest-contracts": runContractGate,
  "scope-explicit": runScopeGate,
  "client-node-imports": runClientGraphGate,
  "core-mirrors": runCoreMirrorGate,
  "test-mirror-pairs": runTestMirrorPairGate,
  "deps-integrity-prepush": runDepsIntegrityGate,
  "mock-hygiene-prepush": runMockHygieneGate,
};

const FIX_HINTS = {
  "rest-contracts": "修复：node --experimental-strip-types scripts/generate-rest-contract-types.mjs",
  "scope-explicit": "修复：给新写路由补 config.scope（或进 IMPLICIT_SCOPE_BASELINE 并说明理由）",
  "client-node-imports":
    "修复：用到 node 内建的逻辑留在服务端（route handler / Server Component），客户端只消费结果；参考 0e720839 的签名下沉做法",
  "core-mirrors":
    "修复：node scripts/sync-core-mirrors.mjs 重新生成镜像，并把 core 事实源与两份镜像一起提交（只改事实源不重生成 = 前端在跑旧算法）",
  "test-mirror-pairs":
    "修复：node scripts/vendor-web.mjs 重生成 apps/web/test 那份，然后把 overlay 与镜像**同批提交**（只提交 overlay 侧 = HEAD 上两份守卫互相矛盾，CI 因先跑 vendor-web 看不见）",
  "deps-integrity-prepush":
    "修复：这是安装被中断留下的、与代码无关。先看有没有进程占着这些目录，然后 npm pack <name>@<version> 解压补缺失文件（别覆盖占用中的 .node），或确认无安装进程后 pnpm install --frozen-lockfile",
  "mock-hygiene-prepush":
    "修复：node scripts/fix-mock-hygiene.mjs --apply 自动补 afterAll(() => vi.resetModules())",
};

/**
 * 每枚闸门都要同时有 runner 和修复提示：漏 runner 会让钩子遍历时直接 TypeError，
 * 漏 fixHint 会打印 "undefined"——两种都是「闸门自己坏掉」，测试钉住这条不变量。
 */
export function hasImpl(gateId) {
  return Boolean(RUNNERS[gateId] && FIX_HINTS[gateId]);
}

function main() {
  if (process.env.NAVHUB_SKIP_PREPUSH === "1") {
    console.log("[pre-push-gates] NAVHUB_SKIP_PREPUSH=1，跳过");
    return 0;
  }

  const plan = planGates({
    contractDirty: isDirty(CONTRACT_PATHS),
    scopeDirty: isDirty(SCOPE_PATHS),
  });

  for (const gate of plan) {
    if (!gate.run) {
      console.log("[pre-push-gates] 跳过「" + gate.title + "」：" + gate.skipReason + "（CI 会查）");
      continue;
    }
    console.log("[pre-push-gates] 检查「" + gate.title + "」…");
    try {
      RUNNERS[gate.id]();
    } catch (error) {
      console.error("[pre-push-gates] 「" + gate.title + "」未通过：" + (error instanceof Error ? error.message : String(error)));
      console.error("[pre-push-gates] " + FIX_HINTS[gate.id]);
      return 1;
    }
  }

  console.log("[pre-push-gates] 通过");
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(main());
  } catch (error) {
    console.error("[pre-push-gates] " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
