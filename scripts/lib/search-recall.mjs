/**
 * 检索召回回归的纯判定层（被 scripts/check-search-recall.mjs 与其单元测试共用）。
 *
 * 单独成文件的理由：判据（怎么算命中、怎么算越界）必须能被小语料钉死，
 * 而不能只在真库上「跑一次看看」。真库上的结果会随站点增删漂移，
 * 判据本身错了的话，回归集会静默地一直通过。
 */

/** 取站点 URL 的 host（小写、去端口、去 www. 前缀噪音保留原样，匹配按后缀）。 */
export function hostOf(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 单个匹配项是否命中站点。
 *
 * host 按**后缀**匹配：`docker.com` 同时收到 `www.docker.com` 与 `docs.docker.com`，
 * 但不会收到 `notdocker.com`（要求整段或带点边界）。
 */
export function matchSite(site, matcher) {
  if (!site) return false;
  const host = String(matcher?.host ?? "").trim().toLowerCase();
  const title = String(matcher?.title ?? "").trim().toLowerCase();
  if (host) {
    const h = hostOf(site.url);
    if (h === host || h.endsWith(`.${host}`)) return true;
  }
  if (title) {
    const t = String(site.title ?? "").toLowerCase();
    if (t.includes(title)) return true;
  }
  return false;
}

/** 返回第一个命中的匹配项；都没命中返回 null。 */
export function matchAny(sites, matchers) {
  for (const m of matchers ?? []) {
    for (const s of sites) {
      if (matchSite(s, m)) return m;
    }
  }
  return null;
}

/** 没有任何匹配项命中（forbid 的判据）。 */
export function matchNone(sites, matchers) {
  return matchAny(sites, matchers) === null;
}

/**
 * 把一条用例打到引擎上。
 *
 * 调用方负责给出 engine / repo / loadSites：loadSites(ids) 必须返回
 * `Map<siteId, {id,url,title,status}>`，这样测试可以用假仓储钉住判据。
 */
export async function runCase(engine, loadSites, testCase, defaults = {}) {
  const k = Number.isInteger(testCase.k) && testCase.k > 0 ? testCase.k : defaults.k ?? 5;
  const query = {
    q: String(testCase.query ?? ""),
    limit: k,
    offset: 0,
    // 语义通道默认关掉：它要加载 bge 模型、结果随向量索引漂移，回归集要的是可复现的确定性。
    disableSemantic: testCase.disableSemantic ?? defaults.disableSemantic ?? true,
    disablePersonal: testCase.disablePersonal ?? defaults.disablePersonal ?? true,
  };
  if (testCase.tag) query.tag = testCase.tag;
  if (testCase.categoryId) query.categoryId = testCase.categoryId;
  if (testCase.facets) query.facets = testCase.facets;
  if (testCase.mode) query.mode = testCase.mode;
  if (testCase.status) query.statuses = [testCase.status];

  const result = await engine.search(query);
  const orderedIds = result.hits.map((h) => h.siteId);
  const sitesById = await loadSites(orderedIds);
  const top = orderedIds.slice(0, k).map((id) => sitesById.get(id)).filter(Boolean);

  const expectHit = Array.isArray(testCase.expect) && testCase.expect.length > 0
    ? matchAny(top, testCase.expect)
    : null;
  const forbidOffenders = (testCase.forbid ?? []).filter((m) => !matchNone(top, [m]));
  const expectOk = testCase.expect?.length ? Boolean(expectHit) : true;
  const forbidOk = forbidOffenders.length === 0;

  let suggestionOk = true;
  if (Array.isArray(testCase.didYouMean) && testCase.didYouMean.length > 0) {
    const got = String(result.didYouMean ?? "").trim().toLowerCase();
    suggestionOk = testCase.didYouMean.some((w) => String(w).trim().toLowerCase() === got);
  }

  return {
    query: testCase.query,
    label: testCase.label ?? (testCase.tag ? `#${testCase.tag} ${testCase.query}`.trim() : testCase.query),
    k,
    ok: expectOk && forbidOk && suggestionOk,
    expectOk,
    forbidOk,
    suggestionOk,
    // 用例绿了但依赖一条还没提交的改动：调用方要把它和常规失败分开记，
    // 否则「回归集第一天就红」会把它当成噪声，再也没人回头看。
    pending: typeof testCase.pending === "string" && testCase.pending.trim() ? testCase.pending.trim() : null,
    hits: top.length,
    expected: testCase.expect?.length
      ? expectHit
        ? `命中 ${expectHit.host ?? `标题含「${expectHit.title}」`}`
        : `缺 ${testCase.expect.map((m) => m.host ?? `标题含「${m.title}」`).join(" / ")}`
      : "",
    violated: forbidOffenders.map((m) => m.host ?? `标题含「${m.title}」`),
    didYouMean: result.didYouMean ?? null,
    channels: result.channelsUsed ?? [],
    top: top.map((s) => `${s.title}（${hostOf(s.url)}）`),
  };
}
