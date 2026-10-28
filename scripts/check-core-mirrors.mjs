#!/usr/bin/env node
/**
 * core 镜像一致性闸门：**读 HEAD 的提交内容**。
 *
 * 为什么必须有（2026-10-28 真实红灯）：`packages/core/src/webmcp-bridge.ts` 被改了，
 * 而由它生成的 `apps/web-overlay/src/lib/webmcp-bridge.ts` 没重生成。这条漂移
 * 在本地完全看不见——`node scripts/sync-core-mirrors.mjs --check` 当时是**绿的**，
 * 因为修复正躺在另一个会话的工作区里没提交；推出去的提交却是红的，
 * 要等 20 分钟后由 CI 的「覆盖层与扩展规范性检查」job（`.github/workflows/ci.yml:550`）
 * 报出来。这就是「只有 CI 才知道」的闸门该左移的教科书案例。
 *
 * 为什么读 HEAD 而不是工作区：钩子在推送前跑，推出去的是提交不是工作区；
 * 多会话并行时别人的未提交改动不该挡我的推送，也不该把我的推送判成绿。
 * 和 `check-client-node-imports.mjs` 同一个口径。
 *
 * 判定复用 `scripts/lib/core-mirror.mjs` 的 `checkMirrors`——**和写盘的同步器同一份逻辑**，
 * 这样闸门不可能比修复工具更宽松（自己发明一套「看起来一致」的定义就是假绿灯的入口）。
 * 唯一差别是腿：`apps/web/src` 整棵树被 gitignore（`.gitignore:45`），提交里不存在，
 * 所以 HEAD 模式只查 core↔overlay 这条已入库的腿；第三条腿仍由 CI 的
 * `sync-core-mirrors --check`（工作区口径）和 `check-web-overlay` 兜。
 *
 * 用法：
 *   node scripts/check-core-mirrors.mjs [--json] [--ref <git-ref>] [--working-tree]
 * 退出码：0 = 一致；1 = 有漂移/缺失；2 = 跑不起来（不是「没查就算过」）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkMirrors, overlayPathOf, parseManifest, sourcePathOf } from "./lib/core-mirror.mjs";
import { readBlobs, refExists } from "./lib/git-blobs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "scripts", "core-mirrors.json");

/** 清单需要的全部路径：事实源 + overlay 生成物（去重、保持清单顺序） */
export function trackedPathsOf(entries) {
  const paths = [];
  for (const entry of entries) {
    for (const p of [sourcePathOf(entry), overlayPathOf(entry)]) {
      if (!paths.includes(p)) paths.push(p);
    }
  }
  return paths;
}

/**
 * 纯函数：给一批「路径 → 内容」算镜像结论。
 * `legs: ["overlay"]` 在这里写死，是为了让「提交里没有 apps/web 这条腿」这件事
 * 只出现在一个地方——夹具可以直接喂一份内存 Map 断言它，不依赖真实 git。
 */
export function assess(entries, contents) {
  const io = { exists: (p) => contents.has(p), read: (p) => contents.get(p) };
  return checkMirrors(entries, io, { legs: ["overlay"] });
}

/** 读 HEAD（或任意 ref）的已入库副本 */
export function run({ ref = "HEAD" } = {}) {
  const entries = parseManifest(readFileSync(MANIFEST, "utf8")).verbatim;
  if (!refExists(ref, { cwd: ROOT })) {
    throw new Error(`ref「${ref}」在这个仓库里不存在（还没 fetch？），继续跑只会把「读不到」当成「都漂移」`);
  }
  const contents = readBlobs(ref, trackedPathsOf(entries), { cwd: ROOT });
  const result = assess(entries, contents);
  if (contents.size === 0) {
    throw new Error(`ref「${ref}」里一个镜像文件都没读到，判定无意义（清单路径错了还是这棵树不存在？）`);
  }
  return { ref, entries, contents, result };
}

/** 工作区模式：只用于本地排查（钩子与 CI 的 HEAD 口径不走这里） */
export function runWorkingTree() {
  const entries = parseManifest(readFileSync(MANIFEST, "utf8")).verbatim;
  const contents = new Map();
  for (const p of trackedPathsOf(entries)) {
    if (existsSync(join(ROOT, p))) contents.set(p, readFileSync(join(ROOT, p), "utf8"));
  }
  if (contents.size === 0) {
    throw new Error(`工作区里一个镜像文件都没读到，判定无意义（${ROOT} 不是仓库根？）`);
  }
  return { ref: "working-tree", entries, contents, result: assess(entries, contents) };
}

function main(argv) {
  const asJson = argv.includes("--json");
  const refIdx = argv.indexOf("--ref");
  const ref = refIdx >= 0 ? argv[refIdx + 1] : "HEAD";

  let out;
  try {
    out = argv.includes("--working-tree") ? runWorkingTree() : run({ ref });
  } catch (error) {
    console.error(`❌ core 镜像闸门跑不起来：${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const { result } = out;
  const failures = result.failures.map((p) => ({
    name: p.name,
    source: p.source,
    overlay: p.overlay,
    reasons: p.reasons,
  }));

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ref: out.ref,
          checked: result.plans.length,
          legs: ["core", "overlay"],
          ok: result.ok,
          failures,
        },
        null,
        2,
      ),
    );
  } else if (failures.length > 0) {
    console.error(
      `❌ ${out.ref} 上有 ${failures.length} 个 core 镜像不满足「与事实源逐字节一致」：`,
    );
    for (const f of failures) {
      console.error(`   ${f.name}`);
      for (const r of f.reasons) console.error(`      - ${r}`);
    }
    console.error("\n   为什么要拦：apps/web 是独立安装的 vendored 底座，import 不到 @navhub/core，");
    console.error("   所以 packages/core 的纯算法必须在覆盖层留一份逐字节副本。只改事实源不重生成，");
    console.error("   前端就在跑一份旧算法——工作区里可能还是绿的，因为修复没提交，CI 只认提交。");
    console.error("   修复：node scripts/sync-core-mirrors.mjs，然后把 core 事实源与镜像一起提交。");
  } else {
    console.log(
      `✅ core 镜像：${out.ref} 上 ${result.plans.length} 个 verbatim 镜像与事实源逐字节一致` +
        "（已入库的 core↔overlay 两条腿；apps/web 那条是 gitignore 生成物，由 CI 兜）。",
    );
  }
  return failures.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
