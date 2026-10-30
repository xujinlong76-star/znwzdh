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
  opts: { fail?: string[]; skip?: string[]; absent?: string[]; cancel?: string[] } = {},
) {
  const map: Record<string, { outcome: string }> = {};
  for (const step of lib.trackedSteps(entry)) {
    if (opts.absent?.includes(step.id)) continue;
    if (opts.fail?.includes(step.id)) map[step.id] = { outcome: "failure" };
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
});

describe("撤防账：接线（对真实 ci.yml 的作业片段派生夹具）", () => {
  const WIRED = ["test-sqlite", "test-web", "test-e2e", "check-web-overlay"];

  it("仓库现状：四个接入作业的接线与覆盖面全部通过", () => {
    for (const job of WIRED) {
      expect(lib.defusedWiringProblems(jobBlock(job), entryOf(job)), job).toEqual([]);
      expect(lib.defusedCoverageProblems(jobBlock(job), entryOf(job)), job).toEqual([]);
    }
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
    // 今天的真实例子是 test-sqlite 的后端 lint（带 continue-on-error，红被吞掉、不挡路），
    // 但它的命令形状本来就不在 GATE_STEP_RE 里 ⇒ 豁免分支要靠合成夹具才走得通：
    // 在 check-web-overlay 末尾插一道「形状是门禁、但允许失败」的步骤。
    const block = jobBlock("test-sqlite");
    expect(block).toMatch(/lint:backend\n        continue-on-error: true/);
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
        vitest: { outcome: "skipped" },
      }),
    });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("2 道门禁里 1 道没跑成");
    expect(res.out).toContain("另有 1 个准备步骤没跑成：vendor 重建 apps/web");
  });

  it("读不到 steps 上下文 ⇒ 说「账失效」而不是「没有撤防」", () => {
    const res = runCli(["--job", "test-web"], { NAVHUB_STEP_CONCLUSIONS: "" });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("撤防账失效");
    expect(res.out).toContain("::warning");
  });

  it("传了未登记的作业 ⇒ 红字说清「这一步在跑一件没人记账的事」，不静默", () => {
    const res = runCli(["--job", "test-postgres"], {
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
