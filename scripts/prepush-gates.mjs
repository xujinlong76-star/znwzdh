#!/usr/bin/env node
/**
 * pre-push 门禁：把两枚「只有 CI 才知道」的闸门左移到推送前。
 *
 * 为什么是这两枚：
 *   - 契约生成物同源（scripts/generate-rest-contract-types.mjs --check）：
 *     pre-commit 按目录映射选测，只改 packages/core 时跑的是 packages/core/test，
 *     而漂移用例在 scripts/ 下——**改 core 不重生成**从钩子底下溜过去是常态。
 *   - scope 显式断言（apps/api/test/route-policy.test.ts）：它依赖注册期的真实路由清单，
 *     只有跑起来才知道；漏写 scope 的写路由会静默变成匿名可写。
 *
 * 为什么不无条件跑：本仓库长期多会话并行，工作区里常有别人未提交的半成品。
 * 这些闸门检查的是**工作区**，而推送出去的是**提交**。两者不一致时跑出来的红
 * 与本次推送无关，只会冤枉人。所以每枚闸门只看自己相关的路径：
 * 干净 → 与推送内容一致，跑；有未提交改动 → 明确跳过并说明（CI 全量兜底），不阻塞。
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
      if (gate.id === "rest-contracts") runContractGate();
      else runScopeGate();
    } catch (error) {
      console.error("[pre-push-gates] 「" + gate.title + "」未通过：" + (error instanceof Error ? error.message : String(error)));
      if (gate.id === "rest-contracts") {
        console.error("[pre-push-gates] 修复：node --experimental-strip-types scripts/generate-rest-contract-types.mjs");
      } else {
        console.error("[pre-push-gates] 修复：给新写路由补 config.scope（或进 IMPLICIT_SCOPE_BASELINE 并说明理由）");
      }
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
