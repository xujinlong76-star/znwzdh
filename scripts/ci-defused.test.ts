/**
 * 撤防账（scripts/lib/ci-defused.mjs + scripts/ci-defused-gates.mjs）。
 *
 * 这一组管的是「门禁没跑成」这件事本身：GitHub 默认条件是「上一步红 ⇒ 后面每一步
 * skipped」，而 skipped 不判红 ⇒ 作业结论只说明「没新增红」，不说明「门禁判过没有」。
 * 2026-10-29 起首屏预算常驻红，把 test-web 的 ISR 路由门禁整步跳过连着几天，
 * 每轮结论都写成「前端只有预算问题」——那句结论不成立（`11108bf2` 修的是那一步的守卫，
 * 本文件修的是「其余没跑成的必须显式记账」）。
 *
 * 三件事各自有正反两面，缺一面就是空断言：
 *   - 读数（findDefused）：撤防要点名，红不是撤防，读不出根因要说「读不出来」；
 *   - 接线（defusedWiringProblems / defusedCoverageProblems）：只认代码行不认注释，
 *     豁免条件（continue-on-error）要有一条「必须不报」反向用例；
 *   - 判据本身：下面用 importPatchedLib 逐条把判据拆掉，确认对应用例真的会转红
 *     （否则「必须不报」那几条只是删掉功能也会绿的假断言）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO_ROOT, "scripts/lib/ci-defused.mjs");
const CI_WORKFLOW_LIB = join(REPO_ROOT, "scripts/lib/ci-workflow.mjs");
const CLI = join(REPO_ROOT, "scripts/ci-defused-gates.mjs");
const REAL_CI = join(REPO_ROOT, ".github/workflows/ci.yml");

type Entry = NonNullable<ReturnType<typeof lib.defusedEntryFor>>;
type FindResult = ReturnType<typeof lib.findDefused>;

let dir: string;
let lib: typeof import("../scripts/lib/ci-defused.mjs");
let realCi: string;

/**
 * 真实 ci.yml 里单个作业的片段（按顶层两空格缩进的作业名切）。
 * 夹具全部在**片段**上做增删：被测函数吃的就是片段，整文件替换会牵动别的作业。
 */
function jobBlock(name: string, source = realCi): string {
  const body = source.slice(source.indexOf("\njobs:"));
  const matches = [...body.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)];
  const i = matches.findIndex((m) => m[1] === name);
  expect(i, `夹具里找不到作业 ${name}`).toBeGreaterThan(-1);
  const from = matches[i].index ?? 0;
  const to = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
  return body.slice(from, to);
}

function entryOf(job: string): Entry {
  const entry = lib.defusedEntryFor(job);
  expect(entry, `登记表里没有作业 ${job}`).toBeTruthy();
  return entry as Entry;
}

/** 造一份 steps 读数：登记的 id 默认全 success，按参数改成 failure / skipped / 缺失 */
function conclusionsOf(
  entry: Entry,
  opts: { fail?: string[]; softFail?: string[]; skip?: string[]; absent?: string[]; cancel?: string[] } = {},
) {
  const map: Record<string, { outcome: string; conclusion?: string }> = {};
  for (const step of lib.trackedSteps(entry)) {
    if (opts.absent?.includes(step.id)) continue;
    if (opts.fail?.includes(step.id)) map[step.id] = { outcome: "failure" };
    // `continue-on-error: true` 的步骤：outcome=failure，conclusion=success。
    // runner 按 conclusion 决定要不要跳过后面 ⇒ 它既不是红也不算挡住别人。
    else if (opts.softFail?.includes(step.id)) map[step.id] = { outcome: "failure", conclusion: "success" };
    else if (opts.skip?.includes(step.id)) map[step.id] = { outcome: "skipped" };
    else if (opts.cancel?.includes(step.id)) map[step.id] = { outcome: "cancelled" };
    else map[step.id] = { outcome: "success", conclusion: "success" };
  }
  return map;
}

const REPORTER_LINE = "        run: node scripts/ci-defused-gates.mjs --job";
/** 取 test-web 片段里那一步读数（整步 6 行），供「删除 / 搬家」类夹具复用 */
function reporterStepBlock(block: string, job: string): string {
  const at = block.indexOf(`${REPORTER_LINE} ${job}`);
  expect(at, `${job} 的读数步骤不在片段里`).toBeGreaterThan(-1);
  const start = block.lastIndexOf("      - name: 撤防账", at);
  expect(start).toBeGreaterThan(-1);
  return block.slice(start, at + `${REPORTER_LINE} ${job}`.length + 1);
}

/**
 * 把 lib 源码原样复制进临时目录、打一个补丁再 import 回来——用来证明「每条判据都在
 * 真正起作用」。同目录再拷一份 ci-workflow.mjs，因为被测 lib 用相对路径 import 它。
 */
async function importPatchedLib(needle: string, replacement: string, tag: string) {
  const source = readFileSync(LIB, "utf8");
  expect(source, `变异锚点找不到：${needle.slice(0, 48)}`).toContain(needle);
  const folder = join(dir, `lib-${tag}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "ci-workflow.mjs"), readFileSync(CI_WORKFLOW_LIB, "utf8"), "utf8");
  const path = join(folder, "ci-defused.mjs");
  writeFileSync(path, source.replace(needle, replacement), "utf8");
  return (await import(pathToFileURL(path).href)) as typeof lib;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-defused-"));
  lib = (await import(pathToFileURL(LIB).href)) as typeof lib;
  // 夹具统一按 LF 派生（CI 检出的是 LF）；工作区 CRLF 由下面那条专门的用例证明判定不变
  realCi = readFileSync(REAL_CI, "utf8").replace(/\r\n/g, "\n");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("撤防账：读数（findDefused）", () => {
  it("全部跑过 ⇒ 一道都不算撤防", () => {
    const entry = entryOf("test-web");
    const res = lib.findDefused({ entry, conclusions: conclusionsOf(entry) }) as FindResult;
    expect(res.defused).toEqual([]);
    expect(res.blocker).toBeNull();
    expect(res.ran).toHaveLength((entry.gates ?? []).length + (entry.env ?? []).length);
  });

  it("上游红 ⇒ 后面每一步的撤防全部点名，根因指向红的那一步", () => {
    const entry = entryOf("test-web");
    const res = lib.findDefused({
      entry,
      conclusions: conclusionsOf(entry, {
        fail: ["web-typecheck"],
        skip: ["web-lint", "web-build", "web-budget", "web-isr"],
      }),
    });
    expect(res.defused.map((d) => d.id)).toEqual(["web-lint", "web-build", "web-budget", "web-isr"]);
    expect(res.blocker?.id).toBe("web-typecheck");
    expect(res.blocker?.kind).toBe("failure");
    // 根因点名要用人看得懂的话，不能只给一个 YAML id
    expect(res.blocker?.label).toContain("tsc");
  });

  it("登记表里的 id 没出现在读数里 ⇒ 也算撤防（改名或删除不许把它从账上抹掉）", () => {
    const entry = entryOf("test-web");
    const res = lib.findDefused({ entry, conclusions: conclusionsOf(entry, { absent: ["web-isr"] }) });
    expect(res.defused.find((d) => d.id === "web-isr")?.outcome).toBe("absent");
    expect(res.defused).toHaveLength(1);
  });

  it("门禁自己判红不是撤防：进 failed，撤防清单里不许有它", () => {
    const entry = entryOf("test-web");
    const res = lib.findDefused({
      entry,
      conclusions: conclusionsOf(entry, { fail: ["web-budget"], skip: ["web-isr"] }),
    });
    expect(res.defused.map((d) => d.id)).toEqual(["web-isr"]);
    expect(res.failed.map((d) => d.id)).toEqual(["web-budget"]);
    expect(res.blocker?.id).toBe("web-budget");
  });

  it("挡住它的步骤没有 id ⇒ 老实说「读不出来」，不猜一个根因", () => {
    const entry = entryOf("test-sqlite");
    const res = lib.findDefused({
      entry,
      conclusions: conclusionsOf(entry, { skip: ["typecheck", "vitest"] }),
    });
    expect(res.defused.map((d) => d.id)).toEqual(["typecheck", "vitest"]);
    expect(res.blocker?.kind).toBe("unknown");
    expect(res.blocker?.id).toBeNull();
    expect(res.blocker?.label).toContain("没有 id");
  });

  it("准备步骤（env）红 ⇒ 根因用它登记的中文名点出来，而不是裸 id", () => {
    const entry = entryOf("test-e2e");
    const res = lib.findDefused({
      entry,
      conclusions: conclusionsOf(entry, { fail: ["e2e-playwright"], skip: ["e2e"] }),
    });
    expect(res.defused.map((d) => d.id)).toEqual(["e2e"]);
    expect(res.blocker?.id).toBe("e2e-playwright");
    expect(res.blocker?.label).toContain("Playwright");
  });

  it("作业被取消 ⇒ 撤防与取消都看得见，措辞不能写成「判红」", () => {
    const entry = entryOf("test-web");
    const res = lib.findDefused({
      entry,
      conclusions: conclusionsOf(entry, {
        cancel: ["web-install"],
        skip: ["web-typecheck", "web-lint", "web-build", "web-budget", "web-isr"],
      }),
    });
    expect(res.defused).toHaveLength(6);
    // 取消的那一步本身，加上被它连带跳过的 5 道门禁——两者都在账上，但状态不同
    expect(res.defused.filter((d) => d.outcome === "cancelled").map((d) => d.id)).toEqual(["web-install"]);
    expect(res.defused.filter((d) => d.outcome === "skipped")).toHaveLength(5);
    expect(res.failed).toEqual([]);
    expect(res.blocker?.kind).toBe("cancelled");
  });

  it("读数里混着没登记的 id（pkg-build）时，它红也能当根因点名", () => {
    const entry = entryOf("test-sqlite");
    // pkg-build 是最后一步、且按矩阵合法跳过 ⇒ 不进登记表；这条钉「根因扫描范围比登记表更宽」
    const conclusions = { ...conclusionsOf(entry), "pkg-build": { outcome: "failure" } };
    const res = lib.findDefused({ entry, conclusions });
    expect(res.blocker?.id).toBe("pkg-build");
  });

  it("带 continue-on-error 的步骤（outcome=failure / conclusion=success）不算判红、也不当根因", () => {
    // runner 决定「后面要不要跳过」看的是 conclusion。拿 outcome 当判据会把一步
    // 明明放行过的步骤点成根因——那等于给一个不存在的原因记账。
    const entry = entryOf("test-web");
    const res = lib.findDefused({
      entry,
      conclusions: conclusionsOf(entry, { softFail: ["web-lint"] }),
    });
    expect(res.failed).toEqual([]);
    expect(res.defused).toEqual([]);
    expect(res.blocker).toBeNull();
    expect(res.ran).toContain("web-lint");
  });

  it("软失败后面真有一道 skipped 时，根因不许赖在软失败那一步", () => {
    // 撤防照报（web-isr 确实没跑成），但根因必须说「读不出来」：
    // 账上唯一那些「红」的步骤 conclusion 都是 success，它没挡路，真凶多半是没有 id 的一环。
    const entry = entryOf("test-web");
    const res = lib.findDefused({
      entry,
      conclusions: conclusionsOf(entry, { softFail: ["web-budget"], skip: ["web-isr"] }),
    });
    expect(res.defused.map((d) => d.id)).toEqual(["web-isr"]);
    expect(res.failed).toEqual([]);
    expect(res.blocker?.kind).toBe("unknown");
    expect(res.blocker?.id).toBeNull();
  });
});

describe("撤防账：接线（对真实 ci.yml 的作业片段派生夹具）", () => {
  // 8 个阻塞作业全部接线（2026-10-30 第二轮补齐 test-postgres / check-isr-live /
  // docker-smoke / audit）。没接的只剩 seo-audit-prod（手动/定时，多一处红不阻塞合并）
  // 和 ci-passed（只做聚合）——口径见 docs/GATES-OPERATIONS.md §2.3。
  const WIRED = [
    "test-sqlite",
    "test-postgres",
    "test-web",
    "test-e2e",
    "check-isr-live",
    "check-web-overlay",
    "docker-smoke",
    "audit",
  ];

  it("仓库现状：八个接入作业的接线与覆盖面全部通过", () => {
    for (const job of WIRED) {
      expect(lib.defusedWiringProblems(jobBlock(job), entryOf(job)), job).toEqual([]);
      expect(lib.defusedCoverageProblems(jobBlock(job), entryOf(job)), job).toEqual([]);
    }
  });

  it("登记表覆盖的正好是这八个阻塞作业 ⇒ 增删作业必须在这里改口", () => {
    // 覆盖面判据是「按作业」跑的：作业不在 DEFUSED_GATES 里，它里面的门禁 skipped 就无人记账。
    // 把范围钉成一条断言，避免「新作业接了读数步骤但没登记」被反向检查之外的空隙漏掉。
    expect(lib.DEFUSED_GATES.map((e) => e.job).sort()).toEqual([...WIRED].sort());
  });

  it("工作区是 CRLF 时判定不变（autocrlf 检出与 CI 检出必须同口径）", () => {
    const crlf = jobBlock("test-web").replace(/\n/g, "\r\n");
    expect(crlf).toContain("id: web-build\r\n");
    expect(lib.defusedWiringProblems(crlf, entryOf("test-web"))).toEqual([]);
    expect(lib.defusedCoverageProblems(crlf, entryOf("test-web"))).toEqual([]);
  });

  it("登记表覆盖的每道门禁在 YAML 里都有真实 id", () => {
    for (const job of WIRED) {
      for (const gate of entryOf(job).gates ?? []) {
        expect(jobBlock(job), `${job} 缺 id: ${gate.id}`).toMatch(new RegExp(`^\\s*id: ${gate.id}\\s*$`, "m"));
      }
    }
  });

  it("删掉读数步骤 ⇒ 红：登记表只是愿望", () => {
    const block = jobBlock("test-web");
    const weakened = block.replace(reporterStepBlock(block, "test-web"), "");
    expect(weakened).not.toContain("defused-gates");
    expect(lib.defusedWiringProblems(weakened, entryOf("test-web")).join("\n")).toContain("撤防账没接线");
  });

  it("读数步骤的条件退回默认 ⇒ 红：它自己就是最大的那条撤防", () => {
    const weakened = jobBlock("test-web").replace("        id: defused-gates\n        if: ${{ always() }}\n", "        id: defused-gates\n");
    expect(weakened).not.toBe(jobBlock("test-web"));
    expect(lib.defusedWiringProblems(weakened, entryOf("test-web")).join("\n")).toContain("条件不是 always()");
  });

  it("注释里写 always() / toJSON(steps) 不算接线：判定只看代码行", () => {
    // 与「遥测判定先剥 YAML 注释」同一条铁律：注释里解释口径时常提到这些字样，
    // 若判定看注释，删掉真的 if/env 两行还会「绿」
    const block = jobBlock("test-web");
    const weakened = block
      .replace("        id: defused-gates\n        if: ${{ always() }}\n", "        id: defused-gates\n")
      .replace(
        "        env:\n          NAVHUB_STEP_CONCLUSIONS: ${{ toJSON(steps) }}\n",
        "        # 条件应为 if: ${{ always() }}，读数来自 ${{ toJSON(steps) }}\n",
      );
    expect(weakened).toContain("# 条件应为 if:");
    const text = lib.defusedWiringProblems(weakened, entryOf("test-web")).join("\n");
    expect(text).toContain("条件不是 always()");
    expect(text).toContain("没有把 toJSON(steps)");
  });

  it("读数步骤没把 steps 上下文传进来 ⇒ 红：账每次都会报「读不到」却没人看", () => {
    const weakened = jobBlock("test-web").replace(
      "        env:\n          NAVHUB_STEP_CONCLUSIONS: ${{ toJSON(steps) }}\n",
      "",
    );
    expect(weakened).not.toContain("NAVHUB_STEP_CONCLUSIONS");
    expect(lib.defusedWiringProblems(weakened, entryOf("test-web")).join("\n")).toContain("toJSON(steps)");
  });

  it("--job 写成别的作业名 ⇒ 红：一步抄错就永远读不到自己的账", () => {
    const weakened = jobBlock("test-web").replace(`${REPORTER_LINE} test-web`, `${REPORTER_LINE} test-sqlite`);
    expect(weakened).toContain(`${REPORTER_LINE} test-sqlite`);
    expect(lib.defusedWiringProblems(weakened, entryOf("test-web")).join("\n")).toContain("--job test-web");
  });

  it("登记的门禁 id 被改名 ⇒ 红：账上还在等它，YAML 里已经没有这一步", () => {
    const weakened = jobBlock("test-web").replace("        id: web-budget\n", "");
    expect(weakened).not.toContain("id: web-budget");
    const text = lib.defusedWiringProblems(weakened, entryOf("test-web")).join("\n");
    expect(text).toContain("id: web-budget 在作业里找不到");
  });

  it("读数步骤被挪到门禁前面 ⇒ 红：它打完账以后跑的门禁永远进不了账", () => {
    const block = jobBlock("test-web");
    const reporter = reporterStepBlock(block, "test-web");
    const anchor = "      - run: node scripts/check-bundle-budget.mjs\n";
    expect(block).toContain(anchor);
    const moved = block.replace(reporter, "").replace(anchor, `${reporter}${anchor}`);
    expect(lib.defusedWiringProblems(block, entryOf("test-web"))).toEqual([]);
    expect(lib.defusedWiringProblems(moved, entryOf("test-web")).join("\n")).toContain("排在读数步骤之后");
  });

  it("新加一道门禁不给 id ⇒ 覆盖面红：skipped 时报不出名字", () => {
    const injected = jobBlock("check-web-overlay").replace(
      "      - run: node scripts/check-extensions.mjs\n",
      "      - run: node scripts/check-brand-newgate.mjs\n      - run: node scripts/check-extensions.mjs\n",
    );
    expect(injected).toContain("check-brand-newgate.mjs");
    expect(lib.defusedCoverageProblems(injected, entryOf("check-web-overlay")).join("\n")).toContain("没有 id");
  });

  it("给了 id 但没登进登记表 ⇒ 覆盖面红：撤防又变回无声", () => {
    const injected = jobBlock("check-web-overlay").replace(
      "      - run: node scripts/check-extensions.mjs\n",
      "      - run: node scripts/check-brand-newgate.mjs\n        id: gate-brand\n      - run: node scripts/check-extensions.mjs\n",
    );
    expect(injected).toContain("id: gate-brand");
    expect(lib.defusedCoverageProblems(injected, entryOf("check-web-overlay")).join("\n")).toContain(
      "没登进 check-web-overlay 的撤防登记表",
    );
  });

  it("补进登记表 ⇒ 覆盖面转绿（证明判据不是「凡新步骤都红」）", () => {
    const base = entryOf("check-web-overlay");
    const entry = { ...base, gates: [...(base.gates ?? []), { id: "gate-brand", label: "品牌新门禁" }] };
    const injected = jobBlock("check-web-overlay").replace(
      "      - run: node scripts/check-extensions.mjs\n",
      "      - run: node scripts/check-brand-newgate.mjs\n        id: gate-brand\n      - run: node scripts/check-extensions.mjs\n",
    );
    expect(lib.defusedCoverageProblems(injected, entry)).toEqual([]);
  });

  it("continue-on-error 的门禁不逼登记（反向豁免：它红了也挡不住别人）", () => {
    // 豁免分支要靠合成夹具才走得通：今天真带 continue-on-error 的那步（test-sqlite 的后端 lint）
    // 已经**自愿登记**成软门禁，而它的命令形状本来就不在 GATE_STEP_RE 里 ⇒
    // 在 check-web-overlay 末尾插一道「形状是门禁、但允许失败」的步骤来走那条分支。
    const block = jobBlock("test-sqlite");
    expect(block).toMatch(/lint:backend\n        id: backend-lint\n        continue-on-error: true/);
    expect(lib.defusedCoverageProblems(block, entryOf("test-sqlite"))).toEqual([]);

    const exempt = jobBlock("check-web-overlay").replace(
      "      - run: node scripts/check-extensions.mjs\n",
      "      - run: node scripts/check-brand-soft.mjs\n        continue-on-error: true\n      - run: node scripts/check-extensions.mjs\n",
    );
    expect(exempt).toContain("check-brand-soft.mjs");
    expect(lib.defusedCoverageProblems(exempt, entryOf("check-web-overlay"))).toEqual([]);
  });
});

describe("撤防账：判据自证（逐条拆掉，对应用例必须转红）", () => {
  it("拆掉「absent 也算撤防」那半 ⇒ 改名删除就从账上消失", async () => {
    const patched = await importPatchedLib("if (value === undefined) {", "if (false) {", "absent");
    const entry = entryOf("test-web");
    const res = patched.findDefused({ entry, conclusions: conclusionsOf(entry, { absent: ["web-isr"] }) });
    expect(res.defused.map((d) => d.id)).not.toContain("web-isr");
  });

  it("拆掉「读不出根因也要说」的兜底 ⇒ 无 id 上游红时读数变成「没原因」", async () => {
    const patched = await importPatchedLib("if (!blocker && gateCount > 0) {", "if (false) {", "unknown-blocker");
    const entry = entryOf("test-sqlite");
    const res = patched.findDefused({ entry, conclusions: conclusionsOf(entry, { skip: ["typecheck", "vitest"] }) });
    expect(res.blocker).toBeNull();
  });

  it("拆掉 continue-on-error 豁免 ⇒ 允许失败的步骤被当成撤防盲区", async () => {
    const patched = await importPatchedLib("if (/continue-on-error:\\s*true/.test(step)) continue;", "", "coe-exempt");
    const exempt = jobBlock("check-web-overlay").replace(
      "      - run: node scripts/check-extensions.mjs\n",
      "      - run: node scripts/check-brand-soft.mjs\n        continue-on-error: true\n      - run: node scripts/check-extensions.mjs\n",
    );
    expect(lib.defusedCoverageProblems(exempt, entryOf("check-web-overlay"))).toEqual([]);
    // 豁免拆掉后必须点名那道步骤：证明上面那条「不报」是判据在起作用，不是漏判
    expect(patched.defusedCoverageProblems(exempt, entryOf("check-web-overlay")).join("\n")).toContain(
      "check-brand-soft.mjs",
    );
  });

  it("拆掉「读数步骤必须在门禁之后」⇒ 搬到家门口也算通过", async () => {
    const patched = await importPatchedLib("if (at > reporter) {", "if (false) {", "order");
    const block = jobBlock("test-web");
    const reporter = reporterStepBlock(block, "test-web");
    const anchor = "      - run: node scripts/check-bundle-budget.mjs\n";
    const moved = block.replace(reporter, "").replace(anchor, `${reporter}${anchor}`);
    expect(patched.defusedWiringProblems(moved, entryOf("test-web")).join("\n")).not.toContain("排在读数步骤之后");
  });

  it("拆掉 always() 判据 ⇒ 撤防账只在平安的时候才出也没人管", async () => {
    const patched = await importPatchedLib(
      "if (!/if:\\s*(?:\\$\\{\\{\\s*)?always\\(\\)/.test(reporterBlock)) {",
      "if (false) {",
      "always",
    );
    const weakened = jobBlock("test-web").replace(
      "        id: defused-gates\n        if: ${{ always() }}\n",
      "        id: defused-gates\n",
    );
    expect(patched.defusedWiringProblems(weakened, entryOf("test-web")).join("\n")).not.toContain("条件不是 always()");
  });

  it("run: | 多行脚本里的门禁也要登记（test-e2e 的 Playwright 正是这种写法）", () => {
    const block = jobBlock("check-web-overlay");
    const injected = block.replace(
      "      - run: node scripts/check-extensions.mjs\n",
      [
        "      - name: 品牌批量门禁",
        "        run: |",
        "          node scripts/check-brand-a.mjs",
        "          node scripts/check-brand-b.mjs",
        "      - run: node scripts/check-extensions.mjs",
      ].join("\n") + "\n",
    );
    const problems = lib.defusedCoverageProblems(injected, entryOf("check-web-overlay"));
    expect(problems.join("\n")).toContain("check-brand-a.mjs");
  });

  it("拆掉「块标量要看整步」⇒ 多行脚本里的门禁成了盲区（上面那条转绿即自证）", async () => {
    const patched = await importPatchedLib(
      "const haystack = isBlockScalar ? step : inline;",
      "const haystack = inline;",
      "block-scalar",
    );
    const injected = jobBlock("check-web-overlay").replace(
      "      - run: node scripts/check-extensions.mjs\n",
      ["      - name: 品牌批量门禁", "        run: |", "          node scripts/check-brand-a.mjs", "      - run: node scripts/check-extensions.mjs"].join("\n") + "\n",
    );
    // 判据被拆掉后：块标量只剩 `run: |` 那一行，认不出这是道门禁 ⇒ 盲区重新无声
    expect(patched.defusedCoverageProblems(injected, entryOf("check-web-overlay"))).toEqual([]);
  });

  it("拆掉「先看代码行再判接线」⇒ 注释里的 always() 被当成真接线", async () => {
    const patched = await importPatchedLib(
      "const steps = splitJobSteps(stripYamlCommentLines(jobBlock));",
      "const steps = splitJobSteps(jobBlock);",
      "strip-comments",
    );
    // 与上面「注释里写 always()/toJSON(steps) 不算接线」同一条夹具：判据拆掉后必须变成假绿
    const block = jobBlock("test-web");
    const weakened = block
      .replace("        id: defused-gates\n        if: ${{ always() }}\n", "        id: defused-gates\n")
      .replace(
        "        env:\n          NAVHUB_STEP_CONCLUSIONS: ${{ toJSON(steps) }}\n",
        "        # 条件应为 if: ${{ always() }}，读数来自 ${{ toJSON(steps) }}\n",
      );
    expect(lib.defusedWiringProblems(weakened, entryOf("test-web")).join("\n")).toContain("条件不是 always()");
    expect(patched.defusedWiringProblems(weakened, entryOf("test-web"))).toEqual([]);
  });

  it("拆掉「conclusion 优先」⇒ 允许失败的步骤被点成根因", async () => {
    const patched = await importPatchedLib(
      'return String(stepValue.conclusion ?? stepValue.outcome ?? "").trim() || null;',
      'return String(stepValue.outcome ?? stepValue.conclusion ?? "").trim() || null;',
      "outcome-first",
    );
    const entry = entryOf("test-web");
    const conclusions = conclusionsOf(entry, { softFail: ["web-budget"], skip: ["web-isr"] });
    // 判据在位时：web-budget 的 conclusion=success ⇒ 它不挡路，根因只能报「读不出来」
    expect(lib.findDefused({ entry, conclusions }).blocker?.kind).toBe("unknown");
    // 判据拆掉后：同一份读数里它成了根因——一个不存在的原因被写进账
    expect(patched.findDefused({ entry, conclusions }).blocker?.id).toBe("web-budget");
  });
});

describe("撤防账：CLI（ci-defused-gates.mjs）", () => {
  /**
   * 用 spawnSync 而不是 execFileSync：账失效与「作业没登记」这两条走的是 stderr，
   * 而 execFileSync 成功时只回 stdout ⇒ 「rc 是 0 但话没说出来」这类回归测不到。
   */
  function runCli(args: string[], env: Record<string, string>) {
    const res = spawnSync(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  }

  it("全绿输入 ⇒ 打印「全部跑过」，不发警告注解", () => {
    const res = runCli(["--job", "test-web"], {
      NAVHUB_STEP_CONCLUSIONS: JSON.stringify(conclusionsOf(entryOf("test-web"))),
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("5 道门禁全部跑过");
    expect(res.out).not.toContain("::warning");
  });

  it("全绿也留痕：Step Summary 与 ::notice 都要有（否则「没接线」和「跑过且全绿」同形）", () => {
    // 2026-10-30 直证：tip 2ca11031 那一轮 13 个作业的注解池总数为 0，
    // 也就是说绿色路径跨机器读不到任何东西——账出没出过，只能靠人信一次。
    const summaryPath = join(dir, "summary-green.md");
    const res = runCli(
      ["--job", "test-web"],
      {
        NAVHUB_STEP_CONCLUSIONS: JSON.stringify(conclusionsOf(entryOf("test-web"))),
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    );
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("::notice title=CI 门禁撤防::");
    expect(res.out).toContain("5 道门禁全部跑过");
    const summary = readFileSync(summaryPath, "utf8").replace(/\r\n/g, "\n");
    expect(summary).toContain("撤防账 · test-web");
    expect(summary).toContain("`web-isr`"); // 跑过的门禁 id 逐个列出来，才算「判过」的证据
    expect(summary).toContain("门禁真的判过");
  });

  it("全绿 + --strict ⇒ 仍是 0：严格档只把真撤防当失败，不罚平安的那一轮", () => {
    const res = runCli(["--job", "audit", "--strict"], {
      NAVHUB_STEP_CONCLUSIONS: JSON.stringify(conclusionsOf(entryOf("audit"))),
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("2 道门禁全部跑过");
  });

  it("有撤防 ⇒ rc 仍然 0（只报不拦），但注解与 Step Summary 都点名", () => {
    const summaryPath = join(dir, "summary.md");
    const res = runCli(
      ["--job", "test-web"],
      {
        NAVHUB_STEP_CONCLUSIONS: JSON.stringify(
          conclusionsOf(entryOf("test-web"), {
            fail: ["web-typecheck"],
            skip: ["web-lint", "web-build", "web-budget", "web-isr"],
          }),
        ),
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    );
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("::warning title=CI 门禁撤防::");
    expect(res.out).toContain("web-budget");
    expect(res.out).toContain("根因");
    const summary = readFileSync(summaryPath, "utf8").replace(/\r\n/g, "\n");
    expect(summary).toContain("撤防账 · test-web");
    expect(summary).toContain("skipped 不判红");
    expect(summary).toContain("`web-isr`");
    // 带守卫的门禁要把「为什么它可能合法地不跑」写在同一行，否则读数会被当成新 bug
    expect(summary).toContain("半份产物");
  });

  it("准备步骤没跑成不计入「门禁没跑成」：两个数分开报，读数不夸大", () => {
    const res = runCli(["--job", "test-sqlite"], {
      NAVHUB_STEP_CONCLUSIONS: JSON.stringify({
        "sqlite-install": { outcome: "success" },
        "sqlite-vendor": { outcome: "skipped" },
        typecheck: { outcome: "failure" },
        // 软门禁带着告警跑完：outcome=failure 而 conclusion=success ⇒ 它算跑过，不算判红
        "backend-lint": { outcome: "failure", conclusion: "success" },
        vitest: { outcome: "skipped" },
      }),
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("3 道门禁里 1 道没跑成");
    expect(res.out).toContain("另有 1 个准备步骤没跑成：vendor 重建 apps/web");
    // id 列表里不许出现 backend-lint：它带着告警跑完了，软门禁的红被吞掉 ⇒ 算跑过
    expect(res.out).toContain("没跑成的步骤 id：sqlite-vendor、vitest");
  });

  it("读不到 steps 上下文 ⇒ 说「账失效」而不是「没有撤防」", () => {
    const res = runCli(["--job", "test-web"], { NAVHUB_STEP_CONCLUSIONS: "" });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("撤防账失效");
    expect(res.out).toContain("::warning");
  });

  it("传了未登记的作业 ⇒ 红字说清「这一步在跑一件没人记账的事」，不静默", () => {
    // 今天唯一真没登记的是 seo-audit-prod：手动/定时作业，多一处红不阻塞合并（口径同第 6 项
    // 的覆盖面收窄）。用一个真实存在但刻意不登记的作业名，而不是随手编一个——
    // 将来谁给它接上读数步骤，这条会立刻变成「已登记」的失败，逼人来把口径改掉。
    const res = runCli(["--job", "seo-audit-prod"], {
      NAVHUB_STEP_CONCLUSIONS: JSON.stringify({ typecheck: { outcome: "skipped" } }),
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("没有撤防登记表");
    expect(res.out).toContain("::warning");
  });

  it("--strict 才转非零：CI 故意不开，开了就是把撤防变成第二处红", () => {
    const conclusions = JSON.stringify(conclusionsOf(entryOf("test-web"), { fail: ["web-budget"], skip: ["web-isr"] }));
    expect(runCli(["--job", "test-web"], { NAVHUB_STEP_CONCLUSIONS: conclusions }).status).toBe(0);
    const strict = runCli(["--job", "test-web", "--strict"], { NAVHUB_STEP_CONCLUSIONS: conclusions });
    expect(strict.status).not.toBe(0);
    expect(strict.out).toContain("把撤防当失败看待");
  });
});

/**
 * 读侧：把作业日志正文里的那行账读回来（`parseDefusedTrace` / `renderDefusedTable`）。
 *
 * 为什么单独一组：账写在作业里，跨机器只有 `/actions/jobs/{id}/logs` 读得到正文
 * （`/jobs/{id}/summary` 要 actions:read；同一轮 13 个作业的 annotations 返回 0 条——
 * 2026-10-30 run 41010267114 直证）。而 `explain-ci-failure.mjs` 原先只给**失败作业**
 * 取日志 ⇒ 绿色作业那句「5 道门禁全部跑过」从来没被读出来过。
 *
 * 夹具一律用 **CLI 自己的 stdout**（再套一层 Actions 的行首时间戳与 ANSI），
 * 这样写侧改措辞时读侧立刻红，而不是测试里供着一份早已不真实的字符串。
 */
/** 直接跑真实 CLI（Step Summary 置空），回退出码与合并输出——判据自证要走的正是 CI 里那条命令 */
function runCliRaw(job: string, conclusions: unknown, args: string[] = []) {
  const res = spawnSync(process.execPath, [CLI, "--job", job, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: "",
      NAVHUB_STEP_CONCLUSIONS: JSON.stringify(conclusions),
    },
  });
  return { status: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/**
 * 软门禁 backend-lint：本仓唯一的 `continue-on-error` 步骤，2026-10-30 起登进登记表。
 *
 * 为什么要它在账上：「conclusion 优先」这条判据此前只有夹具能证明——CI 里唯一会用到它的
 * 那一步既没有 id 也没登记，等于判据长期不执勤。现在它是活体样本：那步红了（outcome=failure
 * 而 conclusion=success）时账必须说「跑过」而不是「判红」，判据若退回 outcome 优先就会当场
 * 把它写成根因——一个不存在的原因，而且写在全仓唯一的公共作业里，人人看得见。
 */
describe("撤防账：软门禁 backend-lint（conclusion 优先的活体样本）", () => {
  it("现状：登记为软门禁 ⇔ YAML 里真的带 continue-on-error ⇒ 接线与覆盖面都不报", () => {
    const block = jobBlock("test-sqlite");
    const entry = entryOf("test-sqlite");
    expect(block).toMatch(/- run: pnpm run lint:backend\n        id: backend-lint\n        continue-on-error: true/);
    expect(entry.gates?.find((g) => g.id === "backend-lint")?.soft).toBe(true);
    expect(lib.defusedWiringProblems(block, entry)).toEqual([]);
    expect(lib.defusedCoverageProblems(block, entry)).toEqual([]);
  });

  it("它红了 ⇒ 账写「3 道门禁全部跑过」并说破软门禁，不写判红、不点根因（rc 0，--strict 也 0）", () => {
    const entry = entryOf("test-sqlite");
    const conclusions = conclusionsOf(entry, { softFail: ["backend-lint"] });
    const read = lib.findDefused({ entry, conclusions });
    expect(read.defused).toEqual([]);
    expect(read.failed).toEqual([]);
    expect(read.ran).toContain("backend-lint");
    expect(read.blocker).toBeNull();

    const res = runCliRaw("test-sqlite", conclusions);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("3 道门禁全部跑过");
    // 「全部跑过」必须带上这句：否则读的人会以为后端 lint 干净过了，而它可能正带着几十条告警
    expect(res.out).toContain("软门禁 1 道：红了不判红、也不挡路");
    // 不许把它写成判红，也不许把它点成根因（「红了不判红」那句是说明，不是判定）
    expect(res.out).not.toContain("道判红");
    expect(res.out).not.toContain("根因");
    expect(res.out).toContain("::notice title=CI 门禁撤防::");
    // 严格档拦的是真撤防；软门禁红被吞掉不是撤防
    expect(runCliRaw("test-sqlite", conclusions, ["--strict"]).status).toBe(0);
  });

  it("判据退回 outcome 优先 ⇒ 同一份读数把软门禁写成判红与根因（上面那条不是「反正都绿」）", async () => {
    const patched = await importPatchedLib(
      'return String(stepValue.conclusion ?? stepValue.outcome ?? "").trim() || null;',
      'return String(stepValue.outcome ?? stepValue.conclusion ?? "").trim() || null;',
      "outcome-first-live",
    );
    const entry = entryOf("test-sqlite");
    const conclusions = conclusionsOf(entry, { softFail: ["backend-lint"] });
    const read = patched.findDefused({ entry, conclusions });
    expect(read.failed.map((f: { id: string }) => f.id)).toEqual(["backend-lint"]);
    expect(read.blocker?.id).toBe("backend-lint");
    // 真判据在位时同一份输入既没有 failed 也没有根因（上一条已证，这里钉住「差的就是这条判据」）
    expect(lib.findDefused({ entry, conclusions }).failed).toEqual([]);
  });

  it("软门禁被上游红跳过 ⇒ 账里点得出它的名字，并把「红了不算红」写在同一行", () => {
    const entry = entryOf("test-sqlite");
    const conclusions = conclusionsOf(entry, {
      fail: ["typecheck"],
      skip: ["sqlite-vendor", "backend-lint", "vitest"],
    });
    const res = runCliRaw("test-sqlite", conclusions);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("3 道门禁里 2 道没跑成");
    expect(res.out).toContain("没跑成的步骤 id：sqlite-vendor、backend-lint、vitest");
    expect(res.out).toContain("根因：根 typecheck（packages/* + apps/api）（id: typecheck）判红");
    expect(res.out).toContain("自己红不判红、也不挡后面的路");
  });

  it("工作流去掉 continue-on-error 而登记表还标 soft ⇒ 接线红：账里那句「红了不算红」成了假话", () => {
    const hardened = jobBlock("test-sqlite").replace(
      "        id: backend-lint\n        continue-on-error: true\n",
      "        id: backend-lint\n",
    );
    // 注释里本来就写着 continue-on-error（解释口径），判据读的是那一步的 YAML ⇒ 只断言步骤本身
    expect(hardened).not.toMatch(/- run: pnpm run lint:backend\s*\n\s*id: backend-lint\s*\n\s*continue-on-error:/);
    expect(lib.defusedWiringProblems(hardened, entryOf("test-sqlite")).join("\n")).toContain(
      "登记为软门禁，但作业里已经没有 continue-on-error 了",
    );
  });

  it("登记表摘掉 soft 而那步还软 ⇒ 接线红：会把被吞掉的退出码讲成门禁判红", () => {
    const entry = entryOf("test-sqlite");
    const hard = {
      ...entry,
      gates: (entry.gates ?? []).map((g) => (g.id === "backend-lint" ? { id: g.id, label: g.label } : g)),
    };
    expect(lib.defusedWiringProblems(jobBlock("test-sqlite"), hard).join("\n")).toContain("请补 soft: true");
    // 对照：同一步骤同时带 soft 与不带，只差那一个标记 ⇒ 报的确实是新判据
    expect(lib.defusedWiringProblems(jobBlock("test-sqlite"), entry)).toEqual([]);
  });
  it("拆掉 soft 一致性判据 ⇒ 对应那种谎言不再被报（两个方向各拆一次）", async () => {
    // 只拆一边：`softInYaml` 改成常量会同时翻转两个分支，消融就成了自证不了的把戏
    const blindHard = await importPatchedLib("if (gate.soft && !softInYaml) {", "if (false) {", "soft-vs-hard");
    const blindSoft = await importPatchedLib("if (!gate.soft && softInYaml) {", "if (false) {", "hard-vs-soft");
    const entry = entryOf("test-sqlite");
    const block = jobBlock("test-sqlite");
    const hardened = block.replace("        id: backend-lint\n        continue-on-error: true\n", "        id: backend-lint\n");
    const hard = {
      ...entry,
      gates: (entry.gates ?? []).map((g) => (g.id === "backend-lint" ? { id: g.id, label: g.label } : g)),
    };

    expect(lib.defusedWiringProblems(hardened, entry).join("\n")).toContain("已经没有 continue-on-error 了");
    expect(blindHard.defusedWiringProblems(hardened, entry)).toEqual([]);
    expect(lib.defusedWiringProblems(block, hard).join("\n")).toContain("请补 soft: true");
    expect(blindSoft.defusedWiringProblems(block, hard)).toEqual([]);
    // 对照：判据在位时现状两边都不报——报的确实只是那两个被改坏的形状
    expect(lib.defusedWiringProblems(block, entry)).toEqual([]);
  });
});

describe("撤防账：从日志读回（parseDefusedTrace / renderDefusedTable）", () => {
  function cliText(job: string, overrides: Record<string, { outcome: string; conclusion?: string }> = {}, env: Record<string, string> = {}) {
    const res = spawnSync(process.execPath, [CLI, "--job", job], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: "",
        NAVHUB_STEP_CONCLUSIONS: JSON.stringify(conclusionsOf(entryOf(job), overrides)),
        ...env,
      },
    });
    return `${res.stdout ?? ""}${res.stderr ?? ""}`;
  }
  /** GitHub 原始日志每行前面是 UTC 时间戳，中间还夹着 ANSI 色码 ⇒ 判据只按「包含」切 */
  function asRawLog(text: string) {
    return text
      .split(/\r?\n/)
      .map((l, i) => `${i % 2 === 0 ? "\x1b[36m" : ""}2026-10-30T05:12:3${i % 10}.4567890Z ${l}`)
      .join("\n");
  }

  it("绿色一轮的日志 ⇒ 读出 5 道全跑过、0 道撤防、准备步骤 2 个在册", () => {
    const t = lib.parseDefusedTrace(asRawLog(cliText("test-web")));
    expect(t.found).toBe(true);
    expect(t.job).toBe("test-web");
    expect(t.gateTotal).toBe(5);
    expect(t.defused).toBe(0);
    expect(t.ran).toBe(5);
    expect(t.envTotal).toBe(2);
    expect(t.green).toBe(true);
    expect(t.ids).toEqual([]);
    expect(t.blocker).toBeNull();
  });

  it("有撤防的日志 ⇒ 读出没跑成的门禁 id 列表与根因步骤（不是只有一句「没跑成」）", () => {
    const log = asRawLog(
      cliText("test-web", {
        fail: ["web-typecheck"],
        skip: ["web-lint", "web-build", "web-budget", "web-isr"],
      }),
    );
    const t = lib.parseDefusedTrace(log);
    expect(t.found).toBe(true);
    expect(t.gateTotal).toBe(5);
    expect(t.defused).toBe(4);
    expect(t.ran).toBe(1);
    expect(t.ids).toEqual(["web-lint", "web-build", "web-budget", "web-isr"]);
    expect(t.blocker).toBe("web-typecheck");
    expect(t.blockerKind).toBe("判红");
    expect(t.green).toBe(false);
  });

  it("折叠掉注解行、只剩 stdout 那份时同样读得出（含带全角括号的登记名）", () => {
    const full = cliText("test-sqlite", {
      fail: ["typecheck"],
      skip: ["sqlite-vendor", "vitest"],
    });
    const onlyStdout = full
      .split(/\r?\n/)
      .filter((l) => !l.includes("title=CI 门禁撤防::"))
      .join("\n");
    const t = lib.parseDefusedTrace(onlyStdout);
    expect(t.found).toBe(true);
    // 3 道：typecheck、backend-lint（软门禁，这份读数里它跑过了）、vitest
    expect(t.gateTotal).toBe(3);
    expect(t.defused).toBe(1);
    // 准备步骤（sqlite-vendor）不混进门禁 id：数字只数门禁，id 列表也必须只数门禁
    expect(t.ids).toEqual(["vitest"]);
    expect(t.envIds).toEqual(["sqlite-vendor"]);
    // 登记名是「根 typecheck（packages/* + apps/api）」——label 里带全角括号，
    // 贪婪的 `[^（]+` 会把根因整个读丢
    expect(t.blocker).toBe("typecheck");
    expect(t.blockerLabel).toContain("根 typecheck");
    expect(t.envTotal).toBeNull();
  });

  it("账失效 / 作业没登记 / 根本没有账：三种「读不到」各自说清是哪一种", () => {
    const invalid = lib.parseDefusedTrace(cliText("test-web", {}, { NAVHUB_STEP_CONCLUSIONS: "" }));
    expect(invalid.found).toBe(false);
    expect(invalid.broken).toContain("账失效");
    expect(invalid.job).toBe("test-web");

    const rows = lib.renderDefusedTable([
      { name: "audit", conclusion: "success", ...invalid },
      { name: "seo-audit-prod", conclusion: "success", ...lib.parseDefusedTrace("Run pnpm build\nBuild complete") },
    ]);
    expect(rows[0]).toContain("账失效");
    // 「没接线」与「跑过且全绿」不许同形：读不到必须明说，且不许出现「全部跑过」字样
    expect(rows[1]).toContain("没有撤防账");
    expect(rows.join("\n")).not.toContain("全部跑过");
  });

  it("只有 ::warning 注解那一行时也读得出", () => {
    const full = cliText("test-web", { fail: ["web-typecheck"], skip: ["web-lint", "web-build", "web-budget", "web-isr"] });
    const only = full
      .split(/\r?\n/)
      .filter((l) => l.includes("title=CI 门禁撤防::"))
      .join("\n");
    const t = lib.parseDefusedTrace(only);
    expect(t.found).toBe(true);
    expect(t.defused).toBe(4);
    expect(t.ids).toEqual(["web-lint", "web-build", "web-budget", "web-isr"]);
    expect(t.blocker).toBe("web-typecheck");
  });

  /**
   * run 41010267114 的 test-web 日志**逐字**抄下来的那一段（8 行，含行首时间戳）。
   *
   * 为什么必须供一份真日志而不是继续用 CLI 派生夹具：真日志到这里已经不是我写出去的样子了——
   * runner 把 `::warning title=CI 门禁撤防::正文` 改写成 `##[warning]正文`（**title 整段被吃掉**），
   * 又给每行前面加了 `...Z ` 时间戳。上一版按原文找注解、按「行首是 `·`」找逐步骤行，
   * 两条在真日志上都命中不了 ⇒ 数字读得出、id 却写成「未列出」，而 42 条夹具全绿。
   */
  const REAL_WEB_LOG = [
    "2026-10-30T05:47:20.1829048Z ##[endgroup]",
    "2026-10-30T05:47:20.2193330Z [撤防账] test-web：5 道门禁里 4 道没跑成",
    "2026-10-30T05:47:20.2195016Z   · Web eslint（id: web-lint）— 被跳过",
    "2026-10-30T05:47:20.2195789Z   · next build（id: web-build）— 被跳过",
    "2026-10-30T05:47:20.2196379Z   · 首屏预算硬门禁（id: web-budget）— 被跳过",
    "2026-10-30T05:47:20.2197207Z   · ISR 路由硬门禁（id: web-isr）— 被跳过｜守卫是 web-build.outcome == 'success'（build 真失败时 .next 是半份产物，读了只判假红）⇒ 它 skipped 说明根因在 build",
    "2026-10-30T05:47:20.2198490Z   根因：Web tsc --noEmit（id: web-typecheck）判红——默认条件下排在它后面的每一步都会被跳过",
    "2026-10-30T05:47:20.2219023Z ##[warning]test-web 5 道门禁里 4 道没跑成；没跑成的步骤 id：web-lint、web-build、web-budget、web-isr；根因：Web tsc --noEmit（id: web-typecheck）判红——默认条件下排在它后面的每一步都会被跳过",
    "2026-10-30T05:47:20.2345147Z Post job cleanup.",
  ].join("\n");

  it("真日志形状（##[warning] + 行首时间戳）⇒ id 列表和根因都读得出，不落「未列出」", () => {
    const t = lib.parseDefusedTrace(REAL_WEB_LOG);
    expect(t.found).toBe(true);
    expect(t.job).toBe("test-web");
    expect(t.gateTotal).toBe(5);
    expect(t.defused).toBe(4);
    expect(t.ran).toBe(1);
    expect(t.ids).toEqual(["web-lint", "web-build", "web-budget", "web-isr"]);
    expect(t.blocker).toBe("web-typecheck");
    expect(t.blockerLabel).toBe("Web tsc --noEmit");
    expect(t.blockerKind).toBe("判红");
    const line = lib.renderDefusedTable([{ name: "前端门禁", conclusion: "failure", ...t }]).join("\n");
    expect(line).toContain("1/5 道跑过，4 道没跑成（web-lint、web-build、web-budget、web-isr）");
    expect(line).not.toContain("未列出");
  });

  it("绿色那行带软门禁标记 ⇒ 读侧也说破「红了不判红」，不把「跑过」读成「后端 lint 过了」", () => {
    // 写侧在 softNote 里说破了，读侧丢掉就等于把这句话吞回去
    const log = [
      "2026-10-30T06:12:00.1110000Z [撤防账] test-sqlite：3 道门禁全部跑过（软门禁 1 道：红了不判红、也不挡路）",
      "2026-10-30T06:12:00.1120000Z ##[notice]test-sqlite 3 道门禁全部跑过（软门禁 1 道：红了不判红、也不挡路）（在册准备步骤 2 个）",
    ].join("\n");
    const t = lib.parseDefusedTrace(log);
    expect(t.green).toBe(true);
    expect(t.gateTotal).toBe(3);
    expect(t.softTotal).toBe(1);
    const line = lib
      .renderDefusedTable([{ name: "测试（SQLite 分片 1/3）", conclusion: "success", ...t }])
      .join("\n");
    expect(line).toContain("3 道门禁全部跑过（软门禁 1 道：红了不判红、也不挡路）（准备步骤 2 个在册）");
  });

  it("拆掉「读回软门禁数目」⇒ 绿色那行把软门禁吞掉（就是补这一条之前的形状）", async () => {
    const patched = await importPatchedLib(
      "const softTotal = Number(/软门禁\\s*(\\d+)\\s*道/.exec(whole)?.[1] ?? 0);",
      "const softTotal = 0;",
      "soft-count",
    );
    const log =
      "2026-10-30T06:12:00.1120000Z ##[notice]test-sqlite 3 道门禁全部跑过（软门禁 1 道：红了不判红、也不挡路）（在册准备步骤 2 个）";
    expect(lib.parseDefusedTrace(log).softTotal).toBe(1);
    expect(patched.parseDefusedTrace(log).softTotal).toBe(0);
    const line = patched
      .renderDefusedTable([
        { name: "测试（SQLite 分片 1/3）", conclusion: "success", ...patched.parseDefusedTrace(log) },
      ])
      .join("\n");
    expect(line).not.toContain("软门禁");
  });

  it("真日志里只剩改写后的注解那一行（stdout 那份没有）⇒ 照样读得出", () => {
    const annotationOnly = REAL_WEB_LOG.split(/\r?\n/)
      .filter((l) => l.includes("##[warning]"))
      .join("\n");
    const t = lib.parseDefusedTrace(annotationOnly);
    expect(t.found).toBe(true);
    expect(t.ids).toEqual(["web-lint", "web-build", "web-budget", "web-isr"]);
    expect(t.blocker).toBe("web-typecheck");
  });

  it("真日志里只剩带时间戳的 stdout（注解那行没有）⇒ 逐步骤行也得自己顶上", () => {
    const stdoutOnly = REAL_WEB_LOG.split(/\r?\n/)
      .filter((l) => !l.includes("##[warning]"))
      .join("\n");
    const t = lib.parseDefusedTrace(stdoutOnly);
    expect(t.found).toBe(true);
    expect(t.defused).toBe(4);
    expect(t.ids).toEqual(["web-lint", "web-build", "web-budget", "web-isr"]);
    expect(t.blocker).toBe("web-typecheck");
  });

  it("全绿那行的真实形状是 ##[notice]（title 同样被吃掉）⇒ 计数与在册准备步骤数都读得出", () => {
    const rendered = cliText("test-web")
      .split(/\r?\n/)
      .filter((l) => l.includes("::notice title=CI 门禁撤防::"))
      .map((l) => l.replace("::notice title=CI 门禁撤防::", "##[notice]"))
      .join("\n");
    // 这条夹具是「CLI 原文 → runner 改写」的等价变换，措辞仍跟着写侧走
    expect(rendered).toMatch(/^##\[notice\]test-web 5 道门禁全部跑过（在册准备步骤 2 个）$/);
    const t = lib.parseDefusedTrace(`${rendered}\n2026-10-30T05:47:20.2345147Z Post job cleanup.`);
    expect(t.found).toBe(true);
    expect(t.green).toBe(true);
    expect(t.gateTotal).toBe(5);
    expect(t.envTotal).toBe(2);
  });

  it("拆掉「剥行首时间戳」⇒ 真日志的逐步骤行全部落空（就是这次踩到的形状）", async () => {
    const patched = await importPatchedLib(
      'const lines = text.split(/\\r?\\n/).map((l) => l.replace(LOG_TIMESTAMP, ""));',
      "const lines = text.split(/\\r?\\n/);",
      "strip-timestamp",
    );
    const stdoutOnly = REAL_WEB_LOG.split(/\r?\n/)
      .filter((l) => !l.includes("##[warning]"))
      .join("\n");
    expect(lib.parseDefusedTrace(stdoutOnly).ids).toHaveLength(4);
    // 不剥时间戳 ⇒ `·` 行首锚点落在 `2026-…Z` 上：数字还在，id 列表空掉
    expect(patched.parseDefusedTrace(stdoutOnly).ids).toEqual([]);
  });

  it("拆掉「认改写后的 ##[warning] 前缀」⇒ 只剩注解那行时整份账读不出来", async () => {
    const patched = await importPatchedLib(
      'else if (RENDERED_ANNOTATION.test(l) && l.includes("道门禁")) body = l.replace(RENDERED_ANNOTATION, "");',
      'else if (false) body = "";',
      "rendered-annotation",
    );
    const annotationOnly = REAL_WEB_LOG.split(/\r?\n/)
      .filter((l) => l.includes("##[warning]"))
      .join("\n");
    expect(lib.parseDefusedTrace(annotationOnly).found).toBe(true);
    expect(patched.parseDefusedTrace(annotationOnly).found).toBe(false);
  });

  it("拆掉「按登记表分开门禁与准备步骤」⇒ 准备步骤冒充门禁没跑成", async () => {
    // 反向自证：不筛的话 ids 会比 defused 数字长，读的人以为门禁红了其实是 vendor 没跑成
    const patched = await importPatchedLib(
      "const gateIds = entry ? ids.filter((id) => !envSet.has(id)) : ids;",
      "const gateIds = ids;",
      "env-split",
    );
    const log = cliText("test-sqlite", { fail: ["typecheck"], skip: ["sqlite-vendor", "vitest"] });
    expect(lib.parseDefusedTrace(log).ids).toEqual(["vitest"]);
    expect(patched.parseDefusedTrace(log).ids).toContain("sqlite-vendor");
  });

  it("拆掉「根因用惰性匹配」⇒ 带全角括号的登记名读不出根因", async () => {
    const patched = await importPatchedLib(
      "const hit = /根因：(.+?)（id:\\s*([A-Za-z0-9_-]+)）(判红|被取消)/.exec(text);",
      "const hit = /根因：[^（]+（id:\\s*([A-Za-z0-9_-]+)）(判红|被取消)/.exec(text);",
      "blocker-greedy",
    );
    const log = cliText("test-sqlite", { fail: ["typecheck"], skip: ["sqlite-vendor", "vitest"] });
    expect(lib.parseDefusedTrace(log).blocker).toBe("typecheck");
    expect(patched.parseDefusedTrace(log).blocker).toBeNull();
  });
});
