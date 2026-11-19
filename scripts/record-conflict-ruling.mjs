#!/usr/bin/env node
/**
 * 双源冲突裁决记录 · 一次性落库脚本（01-verification-workflow §5.1 第 4 条 / §13）。
 *
 * 用途：把天津 D2 裁决（2026-11-20 02:35 紧急核实结论 A，已落定）写入
 * exam_verifications（notes 裁决正文）+ audit_logs
 *（action='exam_verification_conflict_ruling'），供执行人在开发库/生产库上落库。
 * 写入走 packages/store 的 recordConflictRuling()，与单测同一入口。
 *
 * 天津 D2 裁决（已核实，不再是“例外升级待用户裁决”）：
 *  - 裁决：采信库内值，天津成考复核窗口确为 11-19 09:00–18:00、已关闭；
 *    PEAK 与 chip 的“已截止”显示正确，无需改动。
 *  - 依据：11-20 12:00 已证实是 eol.cn 所标的 2025 年窗口——eol.cn
 *    2026-10-22 原文（https://www.eol.cn/chengkao/ck-tjckdy/20261022152837.html）
 *    自述“2025年的复核时段为11月19日9时至20日12时；2026年沿用同一节奏，
 *    具体时段以当次公告为准”；其“现场办理”描述与 2026 年实际“网上申请缴费”
 *    矛盾；全网无信源称 2026 年窗口到 11-20 12:00。
 *  - 级别：节点仍为 reprint 级（zhaokao.net 官方原文仍未直读到，U-162 仍为
 *    转载级，升级仍待人工直访核对）；复核结果查询窗口 11-25 09:00–11-30 17:00
 *    同为转载级。
 *  - 裁决前级别（Y10）：不写死——recordConflictRuling() 缺省取目标库里该
 *    节点最新核查行的级别；天津裁决时无既往核查行（F1b 自认快照仍为
 *    unverified/low），故 before 为 unverified，diff 应为 unverified →
 *    reprint。显式 --before-level 可覆盖。注意：不得以 exam-calendar.ts
 *    当前文件值作 before——该文件裁决落定后已是 reprint，读它会重演
 *    reprint → reprint 空转。
 *
 * 惯例（仿 scripts/exam-verify.mjs）：
 *  - 默认试运行：只打印将写入的 notes 与 audit diff，不写库。加 --apply 才写库。
 *  - 数据库：--db <sqlite 路径> 或 --url <postgres URL>；缺省读
 *    NAVHUB_DATABASE_URL（postgres）或 NAVHUB_SQLITE_PATH / ./data/navhub.db。
 *  - 本脚本不联网、不读 IA_S3 凭据、不读任何密钥；裁决内容全部写死在本文件，
 *    不从外部输入拼贴（§5.1 第 3 条：不取平均、不拼贴）。
 *
 * 用法：
 *   node scripts/record-conflict-ruling.mjs                              # 试运行：打印，不写库
 *   node scripts/record-conflict-ruling.mjs --apply --db /tmp/tianjin-ruling.db  # 写临时开发库
 *   node scripts/record-conflict-ruling.mjs --apply --db data/navhub.db  # 写开发库（执行人落库）
 *   node scripts/record-conflict-ruling.mjs --apply --url postgres://...  # PostgreSQL
 */
import { openDb } from "../packages/store/src/driver.ts";
import { recordConflictRuling } from "../packages/store/src/exam-verification-store.ts";

/** 天津 D2 裁决（2026-11-20 02:35 紧急核实结论 A）。裁决前级别不写死，
 *  由 recordConflictRuling() 按目标库快照推导（Y10），见文件头注释。 */
const TIANJIN_RULING = {
  examId: "chengkao",
  nodeLabel: "天津成绩复核",
  assertion: "天津成考复核 11-19 09:00–18:00",
  verificationLevelAfter: "reprint",
  sourceAUrl: "https://www.hqwx.com/chengrengk-kaoshi/news/17859084897258.html",
  sourceAClaim:
    "天津成考复核 11 月 19 日 9 时至 18 时网上申请缴费；复核结果 11 月 25 日 9 时至 11 月 30 日 17 时可查",
  sourceBUrl: "https://www.eol.cn/chengkao/ck-tjckdy/20261022152837.html",
  sourceBClaim:
    "2025 年的复核时段为 11 月 19 日 9 时至 20 日 12 时；2026 年沿用同一节奏，具体时段以当次公告为准；复核申请为现场办理",
  ruling:
    "采信库内值：天津成考复核窗口确为 11-19 09:00–18:00、已关闭；PEAK 与 chip 的“已截止”显示正确，无需改动",
  rulingBasis:
    "11-20 12:00 已证实是 eol.cn 所标的 2025 年窗口——eol.cn 2026-10-22 原文自述“2025年的复核时段为11月19日9时至20日12时；2026年沿用同一节奏，具体时段以当次公告为准”；其“现场办理”描述与 2026 年实际“网上申请缴费”矛盾；全网无信源称 2026 年窗口到 11-20 12:00；zhaokao.net 官方原文仍未直读到，节点仍为转载级",
  checkedAt: Date.parse("2026-11-20T02:35:00+08:00"),
  checkedBy: "batch0-fix-f1",
};

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--before-level") args.beforeLevel = argv[++i];
    else if (a === "--checked-by") args.checkedBy = argv[++i];
    else if (a.startsWith("--")) throw new Error(`未知参数：${a}（用 --help 查看用法）`);
  }
  return args;
}

async function openTargetDb(args) {
  const databaseUrl = args.url ?? process.env.NAVHUB_DATABASE_URL;
  if (databaseUrl && /^postgres(ql)?:\/\//.test(databaseUrl)) {
    return openDb({ dialect: "pg", databaseUrl });
  }
  const sqlitePath = args.db ?? process.env.NAVHUB_SQLITE_PATH ?? "data/navhub.db";
  return openDb({ dialect: "sqlite", sqlitePath });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法：node scripts/record-conflict-ruling.mjs [--apply] [--db <path>] [--url <pg>] [--before-level <level>] [--checked-by <name>]");
    console.log("默认试运行（只打印裁决正文与 audit diff，不写库）；--apply 才写库。");
    console.log("裁决前级别缺省由 recordConflictRuling() 按目标库快照推导；--before-level 可显式覆盖。");
    return 0;
  }
  const ruling = {
    ...TIANJIN_RULING,
    checkedBy: args.checkedBy ?? TIANJIN_RULING.checkedBy,
    ...(args.beforeLevel ? { verificationLevelBefore: args.beforeLevel } : {}),
  };
  if (!args.apply) {
    console.warn("[record-conflict-ruling] 试运行模式：不写库。加 --apply 才真正写入。");
    console.log(JSON.stringify({ mode: "dry-run", ruling }, null, 2));
    return 0;
  }
  const db = await openTargetDb(args);
  try {
    const { verification, auditId } = await recordConflictRuling(db, ruling);
    console.log(
      JSON.stringify(
        {
          mode: "apply",
          verificationId: verification.id,
          assertionHash: verification.assertionHash,
          auditId,
          examId: verification.examId,
          nodeLabel: verification.nodeLabel,
          verificationLevel: verification.verificationLevel,
          verdict: verification.verdict,
          notes: verification.notes,
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    await db.close();
  }
}

process.exitCode = await main().catch((err) => {
  console.error(`[record-conflict-ruling] 致命错误：${err instanceof Error ? err.message : String(err)}`);
  return 1;
});
