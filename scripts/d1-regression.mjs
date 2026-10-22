/* D1 缺陷回归验证：提交不含 API 创建站点的快照，验证站点幸存
 *
 * 这个脚本会真的写数据：向目标实例 PUT /api/storage（触发快照全量对齐，
 * 从而删除快照外的 navsphere/seed 源站点），并消耗一个 seed 站点。
 * 因此默认拒绝运行，必须显式确认目标是「一次性库」：
 *   NAVHUB_D1_ALLOW_DESTRUCTIVE=1 node scripts/d1-regression.mjs
 * 目标地址默认 127.0.0.1:8791，用 NAVHUB_D1_BASE 覆盖。
 * 运行结束后会把开头读到的快照原文写回去；但被检查项删掉的 seed 站点
 * 无法从快照恢复（站点行已经不存在），这是检查 B 本身的代价。
 */
const B = (process.env.NAVHUB_D1_BASE?.trim() || "http://127.0.0.1:8791").replace(/\/$/, "");
const SNAPSHOT = "src/navsphere/content/navigation.json";

if (process.env.NAVHUB_D1_ALLOW_DESTRUCTIVE !== "1") {
  console.error(
    "D1-REGRESSION: REFUSED — 该脚本会向 " + B + " 写入快照并删除站点。\n" +
      "确认目标是可丢弃的测试库后，加 NAVHUB_D1_ALLOW_DESTRUCTIVE=1 重跑。",
  );
  process.exit(2);
}

async function j(method, url, body) {
  const res = await fetch(B + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, text, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

let nsSiteId = "";
let originalSnapshot = null;

async function restore() {
  if (originalSnapshot === null) return;
  const put = await j("PUT", "/api/storage", { path: SNAPSHOT, content: originalSnapshot });
  console.log("[restore] snapshot put back:", put.status);
}

(async () => {
  const before = await j("GET", "/api/stats");
  console.log("[before] sites =", before.json.sites);

  // 1. 取当前快照（原文留一份，收尾时写回）
  const snap = await j("GET", "/api/storage?path=" + encodeURIComponent(SNAPSHOT));
  if (snap.status !== 200 || !snap.json) {
    console.error("[snapshot] 读取失败 (HTTP " + snap.status + ")，中止：没有可对齐的快照，继续跑只会误判。");
    process.exit(1);
  }
  originalSnapshot = snap.text;
  const data = snap.json;
  let removedFromSnapshot = 0;
  for (const c of data.navigationItems || []) {
    if (c.items) c.items = c.items.filter((i) => { if (i.title === "端到端测试站") { removedFromSnapshot++; return false; } return true; });
    for (const s of c.subCategories || []) s.items = (s.items || []).filter((i) => i.title !== "端到端测试站");
  }
  console.log("[snapshot] removed e2e site from snapshot:", removedFromSnapshot);

  // 2. 写回快照（旧行为：全量对齐会删掉不在快照里的站点）
  const put = await j("PUT", "/api/storage", { path: SNAPSHOT, content: JSON.stringify(data) });
  console.log("[put]", put.status, JSON.stringify(put.json).slice(0, 120));

  // 3. 验证 e2e 站幸存
  const hits = await j("GET", "/api/search?q=" + encodeURIComponent("端到端"));
  const survived = (hits.json.hits || []).some((h) => h.site && h.site.title === "端到端测试站");
  console.log("[verify] e2e site survived snapshot write:", survived);

  const after = await j("GET", "/api/stats");
  console.log("[after] sites =", after.json.sites, "(before =", before.json.sites + ")");

  // 4. 反向验证 A：快照托管的站点（source=navsphere）仍然会被全量对齐删除
  //    先通过快照写入制造一个 navsphere 源站点
  nsSiteId = "d1-navsphere-" + Date.now();
  for (const c of data.navigationItems || []) {
    if (c.id) {
      c.items = [...(c.items || []), { id: nsSiteId, title: "快照托管站", href: "https://example.com/ns", enabled: true }];
      break;
    }
  }
  await j("PUT", "/api/storage", { path: SNAPSHOT, content: JSON.stringify(data) });
  const nsCreated = await j("GET", "/api/sites/" + nsSiteId);
  console.log("[verify] navsphere-source site created via snapshot:", nsCreated.status === 200);

  // 从快照中去掉它，写回，确认被删除（全量对齐语义未被破坏）
  for (const c of data.navigationItems || []) {
    if (c.items) c.items = c.items.filter((i) => i.id !== nsSiteId);
    for (const s of c.subCategories || []) s.items = (s.items || []).filter((i) => i.id !== nsSiteId);
  }
  await j("PUT", "/api/storage", { path: SNAPSHOT, content: JSON.stringify(data) });
  const nsCheck = await j("GET", "/api/sites/" + nsSiteId);
  console.log("[verify] navsphere-source site removed by snapshot alignment:", nsCheck.status === 404);

  // 5. 反向验证 B：seed 源站点同样可被快照删除（管理员照常管理初始内容）
  //    只允许牺牲真正 source=seed 的站点：没有就跳过。
  //    早先的 `.json?.[0]` 兜底会在无 seed 内容时挑走用户库里排第一的真实站点并删掉它。
  const seedList = (await j("GET", "/api/sites?limit=100")).json;
  const seedSite = Array.isArray(seedList) ? seedList.find((s) => s.source === "seed") : undefined;
  let seedRemoved = null;
  if (seedSite) {
    for (const c of data.navigationItems || []) {
      if (c.items) c.items = c.items.filter((i) => i.id !== seedSite.id);
      for (const s of c.subCategories || []) s.items = (s.items || []).filter((i) => i.id !== seedSite.id);
    }
    await j("PUT", "/api/storage", { path: SNAPSHOT, content: JSON.stringify(data) });
    const seedCheck = await j("GET", "/api/sites/" + seedSite.id);
    seedRemoved = seedCheck.status === 404;
    console.log("[verify] seed-source site removed by snapshot alignment:", seedRemoved);
  } else {
    console.log("[verify] seed-source site removed by snapshot alignment: SKIPPED (库里没有 seed 源站点)");
  }

  const pass = survived && nsCheck.status === 404 && (seedRemoved === null || seedRemoved === true);
  console.log(pass ? "D1-REGRESSION: PASS" : "D1-REGRESSION: FAIL");
  await restore();
  process.exit(pass ? 0 : 1);
})().catch(async (e) => { console.error(e); await restore(); process.exit(1); });
