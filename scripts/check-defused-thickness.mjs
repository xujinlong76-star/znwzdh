#!/usr/bin/env node
/**
 * 撤防账「厚度」棘轮：那一轮写出的账，道数还等于登记表期望吗。
 *
 * 为什么单独一个入口：撤防账的总道数由**写侧自己报**，写侧漏登记一道时账会自洽地变薄
 * （跑过 + 没跑成 仍等于它报的总数），读侧看不出异常；本地 `check-ci-gate.mjs` 又只在
 * 推的那台机器上跑 ⇒ 「这道门禁到底判没判」在跨机器口径上重新变成空白。这里吃
 * `explain-ci-failure --defused --json` 的快照，只比数字，不再打一次 GitHub API。
 *
 * 用法：
 *   node scripts/explain-ci-failure.mjs --defused --run <id> --json > snap.json
 *   node scripts/check-defused-thickness.mjs [--from <snap.json|->] [--head <sha>] [--json]
 *
 * `--head` 只在「明知本地这一版登记表就是那一轮的 ci.yml」时用（比如刚推上去的那笔、
 * 或故意做一次可比自证）。默认拿 `git rev-parse HEAD`，对不上就只提示不判红——
 * 把历史轮的登记缺口说成缺陷是假告。
 *
 * 退出码：
 *   0 有可读的账，且没有需要判红的厚度不符（不可比时的 [口径] 提示不算红）
 *   1 有厚度不符**且**本轮口径可比（快照的 head_sha 就是本地 HEAD 那一版 ci.yml）
 *   2 判不了：快照读不了 / 不是撤防账 / 一条可读的账都没有
 *
 * 2 而不是 0 是刻意的：「无账可判」写成绿就是把这个缺口吞回去，那正是撤防账要消灭的形状。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFUSED_GATES } from "./lib/ci-defused.mjs";
import { readableDefusedRows, thicknessFindings, renderThickness } from "./lib/ci-defused-thickness.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message) {
  if (message) console.error("[thickness] " + message);
  console.error("用法：node scripts/check-defused-thickness.mjs [--from <快照|->] [--head <sha>] [--json]");
  return 2;
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : null;
}

function localHeadSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** git 的短 sha 惯例：两边都转小写，短的那边 ≥7 位且是长的那边前缀即算同一版。 */
function shaMatches(a, b) {
  const x = String(a ?? "").toLowerCase();
  const y = String(b ?? "").toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 7 && long.startsWith(short);
}

/**
 * @param {string[]} argv
 * @param {{snapshotOf?: () => string, headShaOf?: () => string}} [deps] 测试注入点
 */
export async function main(argv = [], deps = {}) {
  const asJson = argv.includes("--json");
  const from = argValue(argv, "--from") ?? "-";
  const headArg = argValue(argv, "--head");
  const readSnapshot = deps.snapshotOf ?? (() => (from === "-" ? readFileSync(0, "utf8") : readFileSync(from, "utf8")));
  const headSha = deps.headShaOf ?? (headArg ? () => headArg : localHeadSha);

  let snap;
  try {
    snap = JSON.parse(readSnapshot());
  } catch (error) {
    return usage(
      `快照读不到${from === "-" ? "（标准输入）" : "：" + from}——` + (error instanceof Error ? error.message : String(error)),
    );
  }
  if (snap?.mode !== "defused" || !Array.isArray(snap?.jobs)) {
    return usage("这份快照不是撤防账（mode 应为 \"defused\" 且带 jobs）——先跑 --defused --json");
  }

  const snapshotSha = String(snap.run?.head_sha ?? snap.run?.sha ?? "");
  const localSha = String(headSha() ?? "");
  const comparable = shaMatches(snapshotSha, localSha);
  const outcome = thicknessFindings(snap.jobs, { registry: DEFUSED_GATES, comparable });

  const readable = readableDefusedRows(snap.jobs).length;
  if (readable === 0) {
    // 一条账都没读到 ⇒ 厚度无从判断。这**不是**「没有厚度问题」，也不许顺手判红：
    // 缺账那一档有自己的通道（--defused 的分档 + 它的退出码），这里只说清判不了的原因。
    return usage(
      "这轮没有一条可读的撤防账（" +
        snap.jobs.length +
        " 个作业全无账）⇒ 厚度无从判断；先看 --defused 里「本该有账却读不到」那一档。",
    );
  }

  const rc = outcome.counted.length > 0 ? 1 : 0;
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          mode: "thickness",
          run: snap.run ?? null,
          comparable,
          localHeadSha: localSha,
          readableJobs: readable,
          registryJobs: DEFUSED_GATES.length,
          registryGateTotal: DEFUSED_GATES.reduce((n, e) => n + (e.gates ?? []).length, 0),
          findings: outcome.findings,
          counted: outcome.counted,
          exitCode: rc,
        },
        null,
        2,
      ),
    );
    return rc;
  }

  console.log(
    "厚度棘轮 · run #" + String(snap.run?.id ?? "?") + " · " + snapshotSha.slice(0, 12) +
      " · 读到账 " + readable + " 个作业实例 · 登记表 " + DEFUSED_GATES.length +
      " 作业 / " + DEFUSED_GATES.reduce((n, e) => n + (e.gates ?? []).length, 0) + " 道门禁",
  );
  const shaSource = headArg ? "--head 指定的 sha" : "本地 HEAD";
  console.log(
    comparable
      ? "口径可比：快照的 head_sha 与「" + shaSource + "」同一版 ⇒ 期望道数与写侧是同一版 ci.yml，不符判红"
      : "口径不可比：" + shaSource + "=" + (localSha.slice(0, 12) || "（读不到）") +
          " · 快照=" + (snapshotSha.slice(0, 12) || "（无 head_sha）") +
          " ⇒ 发现只作 [口径] 提示，不参与判红（历史轮的薄账多半是当时还没登记；" +
          "要拿这一版登记表去比那一轮，用 --head <快照里的 sha> 显式指定）",
  );
  const lines = renderThickness(outcome);
  if (lines.length === 0) console.log("账的厚度与登记表一致：无发现");
  else for (const line of lines) console.log(line);
  console.log(
    "\n判定：" + (rc === 1 ? "有 " + outcome.counted.length + " 条厚度不符 ⇒ 退出码 1" : "无判红项 ⇒ 退出码 0") +
      (outcome.findings.length > 0 && rc === 0 ? "（发现 " + outcome.findings.length + " 条，按口径只提示）" : "") +
      "。这道判据盯的是「账变薄」本身：门禁没跑成由撤防账那一档负责，两者分开报才看得出是谁少了。",
  );
  return rc;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((rc) => {
    process.exitCode = rc;
  });
}
