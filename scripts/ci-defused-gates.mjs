#!/usr/bin/env node
/**
 * 撤防账（CI 作业内的一步）：点名「本作业里没跑成的门禁」和「是谁挡住它的」。
 *
 * 为什么这一步必须存在：GitHub 默认条件 = 上一步红 ⇒ 后面每一步 skipped，
 * 而 skipped 不判红。作业结论因此只说明「没新增红」，不说明「门禁判过没有」
 * （2026-10-29→30 的实际失效：首屏预算常驻红，把紧跟其后的 ISR 路由门禁整步跳过
 * 连着几天，而每轮结论都写成「前端只有预算问题」）。
 *
 * 只报不拦（rc 恒 0）：判红会把「一次根因多处红」请回来，那正是 CASCADE_RULES
 * 花两轮压下去的东西。要拦的是**接线**（check-ci-gate 第 7 项：删掉这一步 / 改掉 id /
 * 把 always() 换成默认条件 ⇒ 本地 verify 红），不是运行结果。
 * 想在本地拿非零退出做一次性核对：`--strict`。
 *
 * 用法（CI 内）：
 *   - name: 撤防账
 *     id: defused-gates
 *     if: ${{ always() }}
 *     env: { NAVHUB_STEP_CONCLUSIONS: "${{ toJSON(steps) }}" }
 *     run: node scripts/ci-defused-gates.mjs --job test-web
 *
 * 为什么读 steps 上下文而不是 REST API：本仓库的工作流权限是
 * `permissions: contents: read`，拿不到 actions:read ⇒ `/actions/jobs/{id}/logs` 恒 403，
 * 跨机器只剩 annotations 可读。在作业内算完 ⇒ 不扩权限、不需要 token，且当场就能写进
 * Step Summary 和注解。
 */
import { appendFileSync } from "node:fs";
import { defusedEntryFor, findDefused } from "./lib/ci-defused.mjs";

const TOTAL_LABEL = {
  skipped: "被跳过",
  cancelled: "被取消",
  // 中性措辞：GitHub 的 steps 上下文对「没跑成的步骤」到底留不留条目，两种实现都有过实例，
  // 首轮 CI 的读数会给出答案——留条目就是「被跳过」，不留就是这一条。两种都算撤防，不许漏报。
  absent: "没出现在读数里（被整步跳过，或 id 被改名/删除）",
};

function parseArgs(argv) {
  const opts = { job: "", strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--job") opts.job = String(argv[i + 1] ?? "").trim();
    else if (arg.startsWith("--job=")) opts.job = arg.slice(6).trim();
    else if (arg === "--strict") opts.strict = true;
  }
  return opts;
}

function readConclusions() {
  const raw = String(process.env.NAVHUB_STEP_CONCLUSIONS ?? "").trim();
  if (!raw) return { error: "NAVHUB_STEP_CONCLUSIONS 未设置（那一步没把 toJSON(steps) 传进来）" };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "NAVHUB_STEP_CONCLUSIONS 不是 steps 映射对象" };
    }
    return { value: parsed };
  } catch (error) {
    return { error: `NAVHUB_STEP_CONCLUSIONS 解析不了：${error.message}` };
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const label = "[撤防账]";
  if (!opts.job) {
    console.error(`${label} 缺少 --job <作业名>：登记表按作业登记，不能猜`);
    return 0;
  }
  const entry = defusedEntryFor(opts.job);
  if (!entry) {
    console.log(`::warning title=CI 门禁撤防::作业 ${opts.job} 没有撤防登记表（scripts/lib/ci-defused.mjs 的 DEFUSED_GATES）——这一步在跑一件没人记账的事`);
    console.error(`${label} 作业 ${opts.job} 未登记。登记表里没有它 ⇒ 这道作业的撤防仍然无声。`);
    return 0;
  }
  const gateTotal = (entry.gates ?? []).length;
  const read = readConclusions();
  if (read.error) {
    // 读不到结论时不许静默通过：那等于账没出、看起来像出了
    console.log(`::warning title=CI 门禁撤防::${opts.job}：${read.error}`);
    console.error(`${label} ${read.error} ⇒ 撤防账失效（不是「没有撤防」）`);
    return 0;
  }

  const { defused, failed, blocker } = findDefused({ entry, conclusions: read.value });
  if (defused.length === 0) {
    console.log(`${label} ${opts.job}：${gateTotal} 道门禁全部跑过${failed.length > 0 ? `（其中 ${failed.length} 道判红，见那一步自己）` : ""}`);
    return 0;
  }

  const gateNames = defused.map((d) => d.id).join("、");
  // 「几道门禁没跑成」只能数 kind==='gate'：准备步骤（install / vendor / 装浏览器）也在
  // defused 里，把它们算进门禁数会把账读成「门禁红了」，而它们本来就不是判定。
  const gateDefused = defused.filter((d) => d.kind === "gate");
  const envDefused = defused.filter((d) => d.kind === "env");
  const head = `${gateTotal} 道门禁里 ${gateDefused.length} 道没跑成`;
  const envNote =
    envDefused.length > 0 ? `（另有 ${envDefused.length} 个准备步骤没跑成：${envDefused.map((d) => d.label).join("、")}）` : "";
  const blockerText = blocker
    ? blocker.id
      ? `根因：${blocker.label}（id: ${blocker.id}）${blocker.kind === "cancelled" ? "被取消" : "判红"}——默认条件下排在它后面的每一步都会被跳过`
      : `根因读不出来：${blocker.label}`
    : "根因读不出来";
  console.log(`${label} ${opts.job}：${head}${envNote}`);
  for (const d of defused) {
    const note = d.note ? `｜${d.note}` : "";
    console.log(`  · ${d.label}（id: ${d.id}）— ${TOTAL_LABEL[d.outcome] ?? d.outcome}${note}`);
  }
  console.log(`  ${blockerText}`);
  console.log(
    `::warning title=CI 门禁撤防::${opts.job} ${head}${envNote}；没跑成的步骤 id：${gateNames}；${blockerText}`,
  );

  const summaryPath = String(process.env.GITHUB_STEP_SUMMARY ?? "").trim();
  if (summaryPath) {
    const rows = defused
      .map((d) => `| ${d.label} | \`${d.id}\` | ${TOTAL_LABEL[d.outcome] ?? d.outcome} | ${d.note ?? "—"} |`)
      .join("\n");
    appendFileSync(
      summaryPath,
      [
        `### 撤防账 · ${opts.job}`,
        "",
        `**${head}**${envNote}。skipped 不判红，所以作业结论里看不见它们。`,
        "",
        "| 门禁 | 步骤 id | 状态 | 备注 |",
        "| --- | --- | --- | --- |",
        rows,
        "",
        `- ${blockerText}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  if (opts.strict) {
    console.error(`${label} --strict：把撤防当失败看待（CI 故意不开这个开关，开了就是多处红）`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
