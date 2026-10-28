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
 *   node scripts/check-core-mirrors.mjs --baseline <git-ref>
 *     只把「本次要推的提交相对基线新引入的漂移」算失败，基线上本来就红的改成显式警告放行。
 *     这是给 pre-push 用的：闸门该拦住把漂移推上去的人，而不该让后面所有提交都发不出去
 *     ——漂移已经在 main 上时，拦别人既救不了它，还会逼人用 NAVHUB_SKIP_PREPUSH 绕过整条钩子。
 *     CI 不加 --baseline，那侧继续按 HEAD 严格判红。
 * 退出码：0 = 一致（或漂移全部早于基线）；1 = 有漂移/缺失；2 = 跑不起来（不是「没查就算过」）。
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

/** 漂移身份：条目名 + 全部根因。刻意不把行号/内容指纹剥掉——见 splitDrift 注释 */
const driftKey = (f) => `${f.name} :: ${[...(f.reasons ?? [])].sort().join(" | ")}`;

/**
 * 纯函数：把当前 ref 的漂移按「基线 ref 上是否已经以同样方式红着」分组。
 *
 * 为什么键里带根因而不是只用条目名：同名条目从「overlay 缺失」变成「overlay 被手改」
 * 是一次**新的**破坏，不能因为这条早就红过就免检——和 CI 归因里的「同 job 换因」
 * 同一个口径（见 scripts/lib/ci-attribution.mjs 的 reasonSignature）。
 * 返回三组：introduced（要拦）、preexisting（同样根因，放行但报出）、
 * changed（名字在基线上红过、根因不同，归入 introduced 但另给一句话说明）。
 */
export function splitDrift(nowFailures, baseFailures) {
  const baseKeys = new Set(baseFailures.map(driftKey));
  const baseNames = new Set(baseFailures.map((f) => f.name));
  const introduced = [];
  const preexisting = [];
  const changed = [];
  for (const f of nowFailures) {
    if (baseKeys.has(driftKey(f))) {
      preexisting.push(f);
    } else {
      introduced.push(f);
      if (baseNames.has(f.name)) changed.push(f);
    }
  }
  return { introduced, preexisting, changed };
}

/**
 * 纯函数：把分组结果折成「退出码 + 要不要打印早于基线的警告」。
 * 单独拆出来是为了让「放行」这个决定可测——它是最容易写反的一条（写成 rc 1 就白改，
 * 写成 rc 0 且不报就是把别人的漂移藏起来了）。
 */
export function verdictWithBaseline(nowFailures, baseFailures) {
  const split = splitDrift(nowFailures, baseFailures);
  return { ...split, rc: split.introduced.length > 0 ? 1 : 0, passWithWarning: nowFailures.length > 0 && split.introduced.length === 0 };
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
  const baseIdx = argv.indexOf("--baseline");
  const baseline = baseIdx >= 0 ? argv[baseIdx + 1] : undefined;
  if (baseIdx >= 0 && (baseline === undefined || baseline.startsWith("--"))) {
    // 给了旗标却没值：宁可rc 2，也不要在「比较对象未知」时悄悄当成「没有基线」再放行
    console.error("❌ --baseline 需要一个 git ref 作值（例：--baseline origin/main）");
    return 2;
  }

  let out;
  let base;
  try {
    out = argv.includes("--working-tree") ? runWorkingTree() : run({ ref });
    if (baseline !== undefined) base = run({ ref: baseline });
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
  const baseFailures = base
    ? base.result.failures.map((p) => ({ name: p.name, source: p.source, overlay: p.overlay, reasons: p.reasons }))
    : null;
  const verdict = baseFailures === null ? null : verdictWithBaseline(failures, baseFailures);

  // 钩子传进来的是 merge-base 的 40 位 sha；提示语要能一眼读完，展示一律截到 10 位
  const baseLabel = baseline === undefined ? "" : /^[0-9a-f]{12,40}$/.test(baseline) ? baseline.slice(0, 10) : baseline;
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ref: out.ref,
          checked: result.plans.length,
          legs: ["core", "overlay"],
          ok: result.ok,
          failures,
          baseline:
            baseFailures === null
              ? null
              : {
                  ref: base.ref,
                  ok: base.result.ok,
                  failures: baseFailures,
                  introduced: verdict.introduced,
                  preexisting: verdict.preexisting,
                  changed: verdict.changed,
                  rc: verdict.rc,
                },
        },
        null,
        2,
      ),
    );
  } else if (failures.length > 0 && verdict && verdict.passWithWarning) {
    console.warn(
      `⚠️ ${failures.length} 个 core 镜像漂移在基线 ${baseLabel} 上就已经以同样的根因存在，不是 ${out.ref} 新引入的：闸门放行，但这条红是真的。`,
    );
    for (const f of failures) console.warn(`   · ${f.name}：${f.reasons.join("；")}`);
    console.warn(`   谁该修：把 ${baseLabel} 上那条漂移带进来的提交作者。`);
    console.warn("   怎么修：node scripts/sync-core-mirrors.mjs，然后把 core 事实源与镜像一起提交。");
    console.warn("   CI 不带 --baseline，那侧仍按 HEAD 严格判红——左移是为了早发现，不是给 main 减绿。");
  } else if (failures.length > 0) {
    console.error(
      `❌ ${out.ref} 上有 ${failures.length} 个 core 镜像不满足「与事实源逐字节一致」${
        verdict ? `（其中 ${verdict.introduced.length} 个相对基线 ${baseLabel} 是新引入的）` : ""
      }：`,
    );
    for (const f of failures) {
      const mark =
        verdict === null
          ? ""
          : verdict.preexisting.includes(f)
            ? "（基线上已存在，同样的根因）"
            : verdict.changed.includes(f)
              ? "（同名条目基线上也红，但根因变了 = 新的破坏）"
              : "（本次新引入）";
      console.error(`   ${f.name}${mark}`);
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
  if (verdict !== null) return verdict.rc;
  return failures.length > 0 ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
