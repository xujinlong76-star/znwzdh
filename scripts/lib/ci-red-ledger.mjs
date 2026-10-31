/**
 * CI 红灯台账（纯逻辑，CLI 在 scripts/ci-red-ledger.mjs）。
 *
 * 为什么需要：`junit-summary` 只把「这一次」的红写进 Step Summary，跨轮对比仍靠人肉。
 * 2026-10-29 的两片红里，4 例是「测试已提交、源码还在别人暂存区」——它们会在每一轮
 * CI 里以同一指纹重复出现；没有台账时，每次都要重新查 HEAD/工作区/本地实跑才能
 * 确认「不是本轮引入的」。台账把这件事变成一次字符串比较。
 *
 * 指纹分两层：
 *   - identity = `测试文件 :: 用例名`（这条红是谁）；
 *   - signature = 错误消息首行（这条红**为什么**红）。
 * 只用 identity 会把「同一个用例换了根因」当成旧账放行——和 CI 归因里
 * 「同 job 换因」是同一个陷阱（见 scripts/check-core-mirrors.mjs 的 splitDrift）。
 * 所以 identity 命中但 signature 变了，归入「换因」，按新红处理并重置 TTL。
 *
 * TTL：每条新红带 expiresAt，过期仍在红就单独报「过期未修」。台账不是免死金牌，
 * 它只负责让「已知的债」和「新引入的红」在输出里一眼可分。
 *
 * 别名（signatureAliases）：极少数红是「同一根因、断言里的数字抖动」——例如外站探活
 * 成功数每轮不同，`expected +0 to be 2` 与 `expected 1 to be 2` 交替出现。这种抖动
 * 不是换因，但也不能拿正则/前缀放宽比对（那会把真正的新根因一起放行）。所以别名是
 * **人工逐条登记的确切字符串**：命中仍算已知，未登记的指纹照样按换因处理。别名从属于
 * 当前根因——真换因时随旧条目一起丢弃，不留到新根因上。
 */

export const LEDGER_VERSION = 1;

/** ISO 日期（只到天）：台账跨时区比较用字符串序即可 */
export function isoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(isoDay, days) {
  const d = new Date(isoDay + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/**
 * junit 失败项 → 统一形状（parseJunit 给的是 classname/name/kind/message）。
 * 同一个函数要能吃**两种**输入：原始 junit 形状和已归一化的形状——
 * `identityOf` 与 `updateLedger` 会对已归一化的对象再调一次，只认 name/classname
 * 会让用例名全部退化成「(未命名用例)」，台账里所有同文件的红塌成一条
 * （2026-10-29 首轮建账实测：3 条不同的红合并成 1 条）。
 */
export function normalizeFailure(failure) {
  return {
    file: String(failure.classname || failure.file || "").trim(),
    case: (String(failure.name || failure.case || "").trim() || "(未命名用例)"),
    kind: String(failure.kind || "failure"),
    message: String(failure.message ?? "").replace(/\r\n?/g, "\n").trim(),
  };
}

/** 错误指纹：首行、压平空白、截断。行号/绝对路径变化会让它变——那是刻意的 */
export function signatureOf(message, { limit = 160 } = {}) {
  const first =
    String(message ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  return first.replace(/\s+/g, " ").slice(0, limit);
}

export function identityOf(failure) {
  const f = normalizeFailure(failure);
  return `${f.file} :: ${f.case}`;
}

export function emptyLedger(now = new Date()) {
  return { version: LEDGER_VERSION, updatedAt: isoDate(now), entries: [] };
}

/** 台账基本形状校验：坏账比没账更危险（会把所有红都当成「已知」） */
export function validateLedger(ledger) {
  const problems = [];
  if (!ledger || typeof ledger !== "object") return ["台账不是对象"];
  if (ledger.version !== LEDGER_VERSION) problems.push(`version 应为 ${LEDGER_VERSION}，实际 ${ledger.version}`);
  if (!Array.isArray(ledger.entries)) problems.push("entries 不是数组");
  else {
    for (const [i, e] of ledger.entries.entries()) {
      if (!e || typeof e !== "object") problems.push(`entries[${i}] 不是对象`);
      else if (!e.id || !e.signature || !e.owner || !e.expiresAt) {
        problems.push(`entries[${i}] 缺 id/signature/owner/expiresAt（台账条目必须可追责、会过期）`);
      } else if (e.signatureAliases !== undefined) {
        if (!Array.isArray(e.signatureAliases)) problems.push(`entries[${i}] 的 signatureAliases 不是数组`);
        else if (e.signatureAliases.some((a) => typeof a !== "string" || a.trim() === "")) {
          problems.push(`entries[${i}] 的 signatureAliases 含空值（别名必须是确切字符串，不能放通配）`);
        }
      }
    }
  }
  return problems;
}

/**
 * 当前失败集 vs 台账。
 * 纯函数：`now` 注入是为了让 TTL 判定可测。
 * @returns {{introduced:object[],changed:object[],persisted:object[],fixed:object[],expired:object[]}}
 */
export function diffLedger(ledger, failures, { now = new Date(), includeFixed = false } = {}) {
  const today = isoDate(now);
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const seen = new Set();
  const introduced = [];
  const changed = [];
  const persisted = [];

  for (const raw of failures) {
    const f = normalizeFailure(raw);
    const id = identityOf(f);
    const signature = signatureOf(f.message);
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) {
      introduced.push({ ...f, id, signature, reason: "台账里没有这条红" });
      continue;
    }
    if (entry.signature !== signature) {
      const aliases = Array.isArray(entry.signatureAliases) ? entry.signatureAliases : [];
      if (!aliases.includes(signature)) {
        changed.push({ ...f, id, signature, prevSignature: entry.signature, reason: "同用例换因（错误指纹变了）", entry });
        continue;
      }
      persisted.push({ ...f, id, signature, entry, matchedAlias: true });
      continue;
    }
    persisted.push({ ...f, id, signature, entry });
  }

  // check 模式（单分片）看不到其它分片的失败集，算 fixed 会把别人的账误报成已修复；
  // 只有 --update 拿全量产物时才允许。
  const fixed = includeFixed
    ? entries.filter((e) => !seen.has(e.id)).map((e) => ({
        id: e.id,
        file: e.file,
        case: e.case,
        owner: e.owner,
        firstSeen: e.firstSeen,
      }))
    : [];

  const expired = persisted
    .filter((x) => x.entry.expiresAt && x.entry.expiresAt < today)
    .map((x) => ({ ...x, overdueDays: daysBetween(x.entry.expiresAt, today) }));

  return { introduced, changed, persisted, fixed, expired };
}

function daysBetween(fromIso, toIso) {
  const from = new Date(fromIso + "T00:00:00Z").getTime();
  const to = new Date(toIso + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * 用当前失败集重建台账。
 * 同指纹 → 刷新 lastSeen/message；新指纹或换因 → 重新计时（firstSeen=今天，TTL 重置）。
 * 不在失败集里的条目 → 移除（fixed 由调用方报告）。
 * @param {(failure:object)=>string} ownerOf 新条目的责任人（缺失时用 defaultOwner）
 */
export function updateLedger(ledger, failures, { now = new Date(), ttlDays = 14, ownerOf = () => "", defaultOwner = "unassigned" } = {}) {
  const today = isoDate(now);
  const prev = new Map((Array.isArray(ledger?.entries) ? ledger.entries : []).map((e) => [e.id, e]));
  const seen = new Set();
  const entries = [];

  // 多份产物可能含同一条用例（分片重叠、重试），按 id 去重后再入账，
  // 否则台账里会出现同一 id 的两行，diff 时后者覆盖前者、账目自相矛盾。
  const unique = new Map();
  for (const raw of failures) {
    const f = normalizeFailure(raw);
    const id = identityOf(f);
    if (!unique.has(id)) unique.set(id, f);
  }

  for (const f of unique.values()) {
    const id = identityOf(f);
    const signature = signatureOf(f.message);
    seen.add(id);
    const old = prev.get(id);
    const aliases = Array.isArray(old?.signatureAliases) ? old.signatureAliases : [];
    // 别名命中只续命：主指纹与别名都保持不变，否则主指纹会被抖动值带跑，
    // 下一轮又换一个数字就再报一次换因。
    if (old && (old.signature === signature || aliases.includes(signature))) {
      entries.push({ ...old, lastSeen: today, message: f.message });
      continue;
    }
    const owner = String(ownerOf(f) || old?.owner || defaultOwner).trim() || defaultOwner;
    entries.push({
      id,
      file: f.file,
      case: f.case,
      signature,
      message: f.message,
      owner,
      firstSeen: today,
      lastSeen: today,
      expiresAt: addDays(today, ttlDays),
    });
  }

  const removed = [...prev.keys()].filter((id) => !seen.has(id));
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return {
    ledger: { version: LEDGER_VERSION, updatedAt: today, entries },
    removed,
    added: entries.filter((e) => !prev.has(e.id)).map((e) => e.id),
    renewed: entries.filter((e) => prev.has(e.id) && prev.get(e.id).signature !== e.signature).map((e) => e.id),
  };
}

function cell(value, limit = 120) {
  let text = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/`/g, "'")
    .replace(/\|/g, "\\|")
    .trim();
  if (text.length > limit) text = text.slice(0, limit) + "…";
  return "`" + text + "`";
}

/** 台账小节的 markdown（Step Summary / stdout 同一份） */
export function renderLedger(diff, { label = "CI 红灯台账", max = 20, ledgerPath = "" } = {}) {
  const bad = diff.introduced.length + diff.changed.length;
  const mark = bad > 0 ? "❌" : "✅";
  const aliasHits = diff.persisted.filter((x) => x.matchedAlias).length;
  const known = aliasHits > 0 ? `已知 ${diff.persisted.length}（其中 ${aliasHits} 条按别名命中）` : `已知 ${diff.persisted.length}`;
  const src = ledgerPath ? `（对照 ${ledgerPath}）` : "";
  const lines = [
    `### ${mark} ${label}${src} — 新增 ${diff.introduced.length}，换因 ${diff.changed.length}，${known}，过期 ${diff.expired.length}`,
  ];
  const rows = [
    ...diff.introduced.map((x) => ["新增", x]),
    ...diff.changed.map((x) => ["换因", x]),
    ...diff.expired.map((x) => ["过期未修", x]),
  ];
  const fixedNote = diff.fixed.length > 0 ? `，已修复 ${diff.fixed.length}` : "";
  if (rows.length === 0) {
    lines.push("", `没有台账之外的红${fixedNote}。`);
    return lines.join("\n");
  }
  lines.push("", "| 状态 | 用例 | 错误指纹 | 责任人 / 到期 |", "| --- | --- | --- | --- |");
  for (const [status, x] of rows.slice(0, max)) {
    const owner = x.entry?.owner ?? "—";
    const due = x.entry?.expiresAt ?? "—";
    lines.push(`| ${status} | ${cell(x.id)} | ${cell(x.signature)} | ${cell(owner + " / " + due)} |`);
  }
  if (rows.length > max) lines.push(`| … | 另有 ${rows.length - max} 条未列出 | | |`);
  const added = diff.fixed.length > 0 ? `\n已修复 ${diff.fixed.length} 条（下次 --update 会从台账移除）：${diff.fixed.map((f) => f.id).join("；")}` : "";
  if (added) lines.push("", added.trim());
  return lines.join("\n");
}
