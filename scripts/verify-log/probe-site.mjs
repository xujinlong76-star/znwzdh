/**
 * 公开核验日志 PoC — 单站探针（骨架）。
 *
 * 依据：每日战略研究 2026-11-24 20:00 门禁底稿 §3（公开核验日志，过门禁）。
 * 设计要点（只陈述事实，不打分、不排名、不发徽章）：
 *   - 每站 ≥2 种独立核验方法：① 探活（HTTP 状态 + 响应字节数）
 *     ② 标题比对（响应 <title> 与站名比对）或官方域名比对（canonicalDomain）。
 *   - 结论三态：verified（已核实）/ unverified（未核实）/ unknown（未知）。
 *     「未知」≠「不安全」，探针没跑通（超时/网络错）一律记 unknown，不猜结论。
 *   - append-only：本脚本只追加新记录，不改写、不删除旧记录。
 *   - 探针口径复用站内现有思路（apps/api/src/site-probe.ts）：
 *     单条硬超时、不伪装浏览器 UA；不依赖任何外部 API 与密钥。
 *
 * 零新依赖：只用 Node 24 内置 fetch / URL / fs。
 */

export const VERDICTS = ["verified", "unverified", "unknown"];

/** 结论三态中文名（展示用，与 verdict 一一对应）。 */
export const VERDICT_LABELS = {
  verified: "已核实",
  unverified: "未核实",
  unknown: "未知",
};

/** 单条探活硬超时（毫秒），与站内 candidate profile 的 2.5 秒一致。 */
export const PROBE_TIMEOUT_MS = 2500;

/** PoC 复检周期：记录 7 天后复检（门禁底稿 §3.4 T4：记录年龄 ≤7 天）。 */
export const REVIEW_INTERVAL_DAYS = 7;

/**
 * 下次复检日 = 核验时间 + 7 天（ISO 日期，YYYY-MM-DD）。
 */
export function nextReviewDate(checkedAt) {
  const d = new Date(checkedAt);
  d.setUTCDate(d.getUTCDate() + REVIEW_INTERVAL_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * 从 HTML 里抽 <title>（只取前 64KB 内第一个 title 标签；抽不到返回 ""）。
 */
export function extractTitle(html) {
  const m = String(html).slice(0, 65536).match(/<title[^>]*>([\s\S]{0,200})<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

/**
 * 校验一条核验记录是否含全部 5 要素且取值合法。
 * 5 要素（门禁底稿 §3.4 T1）：时间戳、方法、证据、结论三态、下次复检日。
 * 返回 string[] 错误列表；空数组 = 合法。
 */
export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object") return ["record 不是对象"];
  if (typeof record.checkedAt !== "string" || Number.isNaN(Date.parse(record.checkedAt))) {
    errors.push("checkedAt 缺失或不是合法 ISO 时间戳");
  }
  if (!Array.isArray(record.methods) || record.methods.length < 2) {
    errors.push("methods 缺失或少于 2 种核验方法");
  } else {
    for (const m of record.methods) {
      if (!m || typeof m.name !== "string" || !m.name) errors.push("methods[] 缺 name");
    }
  }
  if (!record.evidence || typeof record.evidence !== "object") {
    errors.push("evidence 缺失");
  }
  if (!VERDICTS.includes(record.verdict)) {
    errors.push(`verdict 非法：${String(record.verdict)}（须为 ${VERDICTS.join(" / ")}）`);
  }
  if (typeof record.nextReviewAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.nextReviewAt)) {
    errors.push("nextReviewAt 缺失或不是 YYYY-MM-DD 日期");
  }
  return errors;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "navhub-verification-log-poc/0.1 (+probe)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对一个站点做 ≥2 种方法探针，返回一条核验记录（JSONL 一行）。
 *
 * @param {object} site - { siteId, title, url, canonicalDomain? }
 * @param {object} [opts] - { timeoutMs?, now? }（now 供测试注入固定时间）
 */
export async function probeSite(site, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const checkedAt = (opts.now ?? new Date()).toISOString();
  const methods = [];
  const evidence = { url: site.url, sourceLinks: [site.url] };

  // 方法 1：探活（HTTP 状态 + 响应字节数）。
  let status = null;
  let byteLength = null;
  let bodyText = "";
  let httpError = null;
  try {
    const res = await fetchWithTimeout(site.url, timeoutMs);
    status = res.status;
    const buf = Buffer.from(await res.arrayBuffer());
    byteLength = buf.length;
    bodyText = buf.toString("utf8", 0, Math.min(buf.length, 65536));
  } catch (err) {
    httpError = err?.name === "AbortError" ? "timeout" : String(err?.message ?? err);
  }
  methods.push({ name: "http-probe", status, byteLength, error: httpError });
  evidence.httpStatus = status;
  evidence.responseBytes = byteLength;
  if (httpError) evidence.httpError = httpError;

  // 方法 2a：标题比对（响应 <title> 是否含站名或站名是否含标题关键词）。
  const pageTitle = bodyText ? extractTitle(bodyText) : "";
  const titleMatched =
    pageTitle !== "" &&
    (pageTitle.toLowerCase().includes(String(site.title).toLowerCase()) ||
      String(site.title).toLowerCase().includes(pageTitle.toLowerCase()));
  methods.push({ name: "title-match", pageTitle, matched: pageTitle !== "" ? titleMatched : null });
  evidence.pageTitle = pageTitle || null;

  // 方法 2b：官方域名比对（仅官方名单站：实际访问域名 == 核实过的规范域名）。
  let domainMatched = null;
  if (site.canonicalDomain) {
    let host = null;
    try {
      host = new URL(site.url).hostname;
    } catch {
      host = null;
    }
    domainMatched =
      host !== null && (host === site.canonicalDomain || host.endsWith(`.${site.canonicalDomain}`));
    methods.push({ name: "official-domain-match", canonicalDomain: site.canonicalDomain, host, matched: domainMatched });
    evidence.canonicalDomain = site.canonicalDomain;
    evidence.host = host;
  }

  // 结论三态：只陈述可复现的事实。
  // 已核实：HTTP 2xx 且第二种方法至少一种通过。
  // 未核实：探针跑通但证据不符（非 2xx，或标题/域名比对均失败）。
  // 未知：探针本身没跑通（超时/网络错，无证据可判断）。
  let verdict;
  if (httpError !== null || status === null) {
    verdict = "unknown";
  } else if (status >= 200 && status < 300 && (titleMatched || domainMatched === true)) {
    verdict = "verified";
  } else {
    verdict = "unverified";
  }

  return {
    siteId: site.siteId,
    title: site.title,
    url: site.url,
    checkedAt,
    methods,
    evidence,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    nextReviewAt: nextReviewDate(checkedAt),
  };
}
