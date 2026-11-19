#!/usr/bin/env node
/**
 * 考试节点存档核验脚本（01-verification-workflow §8 / §12.1）。
 *
 * 串行执行：读 exam-calendar.ts 节点 → CDX 查档 → SPN2 提交存档 → CDX 反查
 * → 写 exam_verifications。一次只处理一个节点，CDX 与 SPN2 均 ≤1 请求/秒。
 *
 * 诚实口径（不造假存档、不谎报核实）：
 *  - 本脚本只做「存档查验」：确认来源 URL 在 Wayback 有可复现的快照。
 *    它不读公告内容、不做逐字核对，所以写入的行一律是
 *    verification_level='unverified' / verdict='unverifiable' / confidence='low'，
 *    notes 写明“仅完成存档查验，未做内容核对”。内容定级（verified/false）只能由
 *    七步流水线人工核查后写入，本脚本绝不写 verified。
 *  - 无 IA_S3_ACCESS_KEY / IA_S3_SECRET_KEY 时只跑 CDX 查档模式（不提交 SPN2，
 *    不伪造 archived_url）；密钥只读环境变量，绝不进仓库、不写进任何文件。
 *  - 节点没有 url 时跳过、不写行（没有来源就没有什么可查的）。
 *
 * 限流（§12.1 写死）：遇 429 立即停、指数退避 60→120→240 秒，三次后中止当批，
 * 剩余节点只记入本次运行报告（不写库、不重试——没查过的节点不配拥有一行
 * “最新核查”，否则会掩盖之前真实的核查行）。
 *
 * 用法：
 *   node scripts/exam-verify.mjs                              # 试运行：只 CDX 查档，不写库、不提交 SPN2
 *   node scripts/exam-verify.mjs --apply                      # 真跑：SPN2 存档 + 写 exam_verifications
 *   node scripts/exam-verify.mjs --apply --exam jingkao       # 只跑一场考试
 *   node scripts/exam-verify.mjs --apply --node 报名 --limit 5
 *   node scripts/exam-verify.mjs --db data/navhub.db --apply  # 指定 SQLite 库
 *   node scripts/exam-verify.mjs --url postgres://... --apply # PostgreSQL（读 NAVHUB_DATABASE_URL 亦可）
 *
 * 环境变量：IA_S3_ACCESS_KEY / IA_S3_SECRET_KEY（archive.org/account/s3.php 领取）。
 */
import { EXAMS } from "../apps/web-overlay/src/lib/exam-calendar.ts";
import { openDb } from "../packages/store/src/driver.ts";
import {
  assertionHash,
  insertExamVerification,
} from "../packages/store/src/exam-verification-store.ts";

const CDX_BASE = "https://web.archive.org/cdx/search/cdx";
const SPN2_BASE = "https://web.archive.org/save";
/** SPN2 参数写死（§12.1）：30 天内已有快照则跳过 + 截图 + 延迟约 12 小时入库降负载。 */
const SPN2_PARAMS = "if_not_archived_within=30d&capture_screenshot=1&delay_wb_availability=1";
const REQUEST_TIMEOUT_MS = 30_000;
/** 两次请求之间至少间隔 1 秒（CDX 与 SPN2 共用同一个节流器）。 */
const MIN_REQUEST_GAP_MS = 1_000;
/** 遇 429 的退避阶梯（秒）：三次后中止当批。 */
const BACKOFF_SECONDS = [60, 120, 240];
const SPN2_POLL_INTERVAL_MS = 5_000;
const SPN2_POLL_MAX = 12;

class AbortBatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "AbortBatchError";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--exam") args.exam = argv[++i];
    else if (a === "--node") args.node = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--checked-by") args.checkedBy = argv[++i];
    else if (a.startsWith("--")) throw new Error(`未知参数：${a}（用 --help 查看用法）`);
  }
  return args;
}

/** 节流器：保证任意两次外发请求之间 ≥1 秒。 */
let lastRequestStartedAt = 0;
async function throttle() {
  const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestStartedAt);
  if (wait > 0) await sleep(wait);
  lastRequestStartedAt = Date.now();
}

/**
 * 带 429 退避的请求：429 时立即停、按 60→120→240 秒退避重试同一请求，
 * 三次后抛 AbortBatchError 中止当批（调用方不再碰剩余节点）。
 */
async function fetchWith429Backoff(url, init) {
  let attempt = 0;
  for (;;) {
    await throttle();
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status !== 429) return res;
    if (attempt >= BACKOFF_SECONDS.length) {
      throw new AbortBatchError(
        `Wayback 连续 429（已退避 ${BACKOFF_SECONDS.join("→")} 秒）：中止当批，剩余节点不重试`,
      );
    }
    const waitSec = BACKOFF_SECONDS[attempt];
    attempt += 1;
    console.warn(`[exam-verify] 429：停 ${waitSec} 秒后重试同一请求（第 ${attempt}/3 次退避）`);
    await sleep(waitSec * 1_000);
  }
}

/**
 * CDX 查档：返回该 URL 全部 statuscode:200 的快照（按时间戳升序）。
 * CDX output=json 首行是表头；每行形如
 * [urlkey, timestamp(14 位), original, mimetype, statuscode, digest(SHA-1), length]。
 */
async function cdxLookup(url) {
  const query = new URLSearchParams({
    url,
    output: "json",
    limit: "-1",
    "filter": "statuscode:200",
  });
  const res = await fetchWith429Backoff(`${CDX_BASE}?${query}`);
  if (!res.ok) throw new Error(`CDX 查询失败：HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const data = rows[0]?.[0] === "urlkey" ? rows.slice(1) : rows;
  return data
    .map((r) => ({ timestamp: String(r[1] ?? ""), digest: String(r[5] ?? "") }))
    .filter((s) => /^\d{14}$/.test(s.timestamp))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

/** SPN2 提交存档：返回 { jobId, timestamp }（timestamp 可能为空，由 CDX 反查补）。 */
async function spn2Submit(url, auth) {
  const target = `${SPN2_BASE}/${encodeURIComponent(url)}?${SPN2_PARAMS}`;
  const res = await fetchWith429Backoff(target, {
    method: "POST",
    headers: { Authorization: `LOW ${auth.key}:${auth.secret}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SPN2 提交失败：HTTP ${res.status} ${text.slice(0, 200)}`);
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    // SPN2 偶尔返回非 JSON 成功体：job_id 拿不到时靠 CDX 反查兜底。
  }
  return { jobId: body.job_id ? String(body.job_id) : null, timestamp: body.timestamp ? String(body.timestamp) : null };
}

/** SPN2 状态轮询：success 返回 timestamp；error 返回 null；超时返回 null（靠 CDX 反查兜底）。 */
async function spn2Poll(jobId) {
  for (let i = 0; i < SPN2_POLL_MAX; i += 1) {
    await sleep(SPN2_POLL_INTERVAL_MS);
    const res = await fetchWith429Backoff(`${SPN2_BASE}/status/${encodeURIComponent(jobId)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    let body = {};
    try {
      body = JSON.parse(await res.text());
    } catch {
      return null;
    }
    if (body.status === "success") return body.timestamp ? String(body.timestamp) : null;
    if (body.status === "error") return null;
    // pending：继续轮询。
  }
  return null;
}

function waybackUrl(timestamp, url) {
  return `https://web.archive.org/web/${timestamp}id_/${url}`;
}

/** CDX 14 位时间戳（UTC）转毫秒时间戳。 */
function cdxTimestampToMs(timestamp) {
  return Date.parse(
    `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}` +
      `T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`,
  );
}

function selectNodes(args) {
  const nodes = [];
  for (const exam of EXAMS) {
    if (args.exam && exam.id !== args.exam) continue;
    for (const node of exam.nodes ?? []) {
      if (args.node && node.label !== args.node) continue;
      nodes.push({ examId: exam.id, examName: exam.name, nodeLabel: node.label, url: node.url ?? null });
    }
  }
  return typeof args.limit === "number" && Number.isFinite(args.limit) ? nodes.slice(0, args.limit) : nodes;
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
    console.log("用法：node scripts/exam-verify.mjs [--apply] [--exam <id>] [--node <label>] [--limit N] [--db <path>] [--url <pg>] [--checked-by <name>]");
    console.log("默认试运行（只 CDX 查档，不提交 SPN2、不写库）；--apply 才提交存档并写 exam_verifications。");
    console.log("SPN2 认证读环境变量 IA_S3_ACCESS_KEY / IA_S3_SECRET_KEY；无密钥时仅 CDX 查档模式。");
    return 0;
  }
  const checkedBy = args.checkedBy ?? "exam-verify.mjs";
  const auth = process.env.IA_S3_ACCESS_KEY && process.env.IA_S3_SECRET_KEY
    ? { key: process.env.IA_S3_ACCESS_KEY, secret: process.env.IA_S3_SECRET_KEY }
    : null;
  if (!auth) {
    console.warn("[exam-verify] 未设置 IA_S3_ACCESS_KEY / IA_S3_SECRET_KEY：仅 CDX 查档模式，不提交 SPN2，不伪造存档。");
  }
  if (!args.apply) {
    console.warn("[exam-verify] 试运行模式：不提交 SPN2、不写库。加 --apply 才真正执行。");
  }

  const nodes = selectNodes(args);
  const report = {
    mode: args.apply ? "apply" : "dry-run",
    cdxOnly: !auth,
    total: nodes.length,
    checked: 0,
    archivedConfirmed: 0,
    spn2Submitted: 0,
    skippedNoUrl: 0,
    failed: 0,
    abortedBy429: false,
    remainingAfterAbort: [],
    details: [],
  };

  let db = null;
  if (args.apply) db = await openTargetDb(args);
  try {
    for (const node of nodes) {
      const detail = { examId: node.examId, nodeLabel: node.nodeLabel, url: node.url };
      try {
        if (!node.url) {
          report.skippedNoUrl += 1;
          detail.result = "skipped_no_url";
          detail.note = "节点无 url，不写行";
          report.details.push(detail);
          continue;
        }
        const assertion = `入口 URL 为 ${node.url}`;
        const base = {
          examId: node.examId,
          nodeLabel: node.nodeLabel,
          assertion,
          verificationLevel: "unverified",
          verdict: "unverifiable",
          rating: null,
          confidence: "low",
          sourceUrl: node.url,
          sourceKind: "official_announcement",
          checkedAt: Date.now(),
          checkedBy,
          evidenceJson: JSON.stringify([{ kind: "official_document", url: node.url, note: "节点 url（exam-calendar.ts）" }]),
        };
        report.checked += 1;

        // 1) CDX 查档
        let snapshots = await cdxLookup(node.url);
        let latest = snapshots[snapshots.length - 1] ?? null;
        detail.cdxSnapshots = snapshots.length;
        detail.latestBefore = latest?.timestamp ?? null;

        // 2) 30 天内无快照且有密钥且 --apply：SPN2 提交存档
        let spn2JobId = null;
        if (args.apply && auth) {
          const thirtyDaysAgo = Date.now() - 30 * 24 * 3_600_000;
          const freshEnough = latest !== null && cdxTimestampToMs(latest.timestamp) >= thirtyDaysAgo;
          if (!freshEnough) {
            const submitted = await spn2Submit(node.url, auth);
            spn2JobId = submitted.jobId;
            report.spn2Submitted += 1;
            detail.spn2JobId = spn2JobId;
            if (spn2JobId) await spn2Poll(spn2JobId);
            // 3) CDX 反查：确认快照确实存在才回填 archived_url
            snapshots = await cdxLookup(node.url);
            latest = snapshots[snapshots.length - 1] ?? null;
            detail.cdxSnapshotsAfter = snapshots.length;
          }
        }

        const notes = latest
          ? `存档查验：CDX 确认快照 ${latest.timestamp} 存在。仅完成存档查验，未做公告内容逐字核对；内容定级须另走七步流水线人工核查。`
          : `存档查验：CDX 未查到 statuscode:200 的快照${spn2JobId ? `；SPN2 已提交 job ${spn2JobId}，delay_wb_availability=1 延迟约 12 小时入库，待复核反查` : "；无密钥未提交 SPN2"}。仅完成存档查验，未做公告内容逐字核对。`;
        if (latest) report.archivedConfirmed += 1;
        detail.result = latest ? "archived_confirmed" : "no_snapshot";
        detail.archivedTimestamp = latest?.timestamp ?? null;
        detail.note = notes;

        if (args.apply && db) {
          const row = await insertExamVerification(db, {
            ...base,
            archivedUrl: latest ? waybackUrl(latest.timestamp, node.url) : null,
            archivedTimestamp: latest?.timestamp ?? null,
            archivedDigest: latest?.digest || null,
            notes,
          });
          detail.rowId = row.id;
          detail.assertionHash = row.assertionHash;
        } else {
          // 试运行也算一遍指纹，保证 --apply 时同一断言的 hash 一致。
          detail.assertionHash = assertionHash(assertion);
        }
        report.details.push(detail);
      } catch (err) {
        if (err instanceof AbortBatchError) {
          report.abortedBy429 = true;
          const idx = nodes.indexOf(node);
          report.remainingAfterAbort = nodes.slice(idx).map((n) => `${n.examId}:${n.nodeLabel}`);
          console.error(`[exam-verify] ${err.message}`);
          break;
        }
        report.failed += 1;
        detail.result = "failed";
        detail.note = err instanceof Error ? err.message : String(err);
        report.details.push(detail);
      }
    }
  } finally {
    if (db) await db.close();
  }

  console.log(JSON.stringify(report, null, 2));
  return report.abortedBy429 || report.failed > 0 ? 1 : 0;
}

process.exitCode = await main().catch((err) => {
  console.error(`[exam-verify] 致命错误：${err instanceof Error ? err.message : String(err)}`);
  return 1;
});
