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
  ];
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

const RUNNERS = {
  "rest-contracts": runContractGate,
  "scope-explicit": runScopeGate,
  "client-node-imports": runClientGraphGate,
  "core-mirrors": runCoreMirrorGate,
};

const FIX_HINTS = {
  "rest-contracts": "修复：node --experimental-strip-types scripts/generate-rest-contract-types.mjs",
  "scope-explicit": "修复：给新写路由补 config.scope（或进 IMPLICIT_SCOPE_BASELINE 并说明理由）",
  "client-node-imports":
    "修复：用到 node 内建的逻辑留在服务端（route handler / Server Component），客户端只消费结果；参考 0e720839 的签名下沉做法",
  "core-mirrors":
    "修复：node scripts/sync-core-mirrors.mjs 重新生成镜像，并把 core 事实源与两份镜像一起提交（只改事实源不重生成 = 前端在跑旧算法）",
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
