/* D1 缺陷回归验证：提交不含 API 创建站点的快照，验证站点幸存 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
const B = "http://127.0.0.1:8791";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "navhub-d1-"));

async function j(method, url, body) {
  const res = await fetch(B + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

(async () => {
  const before = await j("GET", "/api/stats");
  console.log("[before] sites =", before.json.sites);

  // 1. 取当前快照
  const snap = await j("GET", "/api/storage?path=" + encodeURIComponent("src/navsphere/content/navigation.json"));
  const data = snap.json;
  let removedFromSnapshot = 0;
  for (const c of data.navigationItems || []) {
    if (c.items) c.items = c.items.filter((i) => { if (i.title === "端到端测试站") { removedFromSnapshot++; return false; } return true; });
    for (const s of c.subCategories || []) s.items = (s.items || []).filter((i) => i.title !== "端到端测试站");
  }
  console.log("[snapshot] removed e2e site from snapshot:", removedFromSnapshot);

  // 2. 写回快照（旧行为：全量对齐会删掉不在快照里的站点）
  const put = await j("PUT", "/api/storage", { path: "src/navsphere/content/navigation.json", content: JSON.stringify(data) });
  console.log("[put]", put.status, JSON.stringify(put.json).slice(0, 120));

  // 3. 验证 e2e 站幸存
  const hits = await j("GET", "/api/search?q=" + encodeURIComponent("端到端"));
  const survived = (hits.json.hits || []).some((h) => h.site && h.site.title === "端到端测试站");
  console.log("[verify] e2e site survived snapshot write:", survived);

  const after = await j("GET", "/api/stats");
  console.log("[after] sites =", after.json.sites, "(before =", before.json.sites + ")");

  // 4. 反向验证 A：快照托管的站点（source=navsphere）仍然会被全量对齐删除
  //    先通过快照写入制造一个 navsphere 源站点
  const nsSiteId = "d1-navsphere-" + Date.now();
  for (const c of data.navigationItems || []) {
    if (c.id) {
      c.items = [...(c.items || []), { id: nsSiteId, title: "快照托管站", href: "https://example.com/ns", enabled: true }];
      break;
    }
  }
  await j("PUT", "/api/storage", { path: "src/navsphere/content/navigation.json", content: JSON.stringify(data) });
  const nsCreated = await j("GET", "/api/sites/" + nsSiteId);
  console.log("[verify] navsphere-source site created via snapshot:", nsCreated.status === 200);

  // 从快照中去掉它，写回，确认被删除（全量对齐语义未被破坏）
  for (const c of data.navigationItems || []) {
    if (c.items) c.items = c.items.filter((i) => i.id !== nsSiteId);
    for (const s of c.subCategories || []) s.items = (s.items || []).filter((i) => i.id !== nsSiteId);
  }
  await j("PUT", "/api/storage", { path: "src/navsphere/content/navigation.json", content: JSON.stringify(data) });
  const nsCheck = await j("GET", "/api/sites/" + nsSiteId);
  console.log("[verify] navsphere-source site removed by snapshot alignment:", nsCheck.status === 404);

  // 5. 反向验证 B：seed 源站点同样可被快照删除（管理员照常管理初始内容）
  const seedSite = (await j("GET", "/api/sites?limit=100")).json?.find?.((s) => s.source === "seed")
    ?? (await j("GET", "/api/sites?limit=100")).json?.[0];
  let seedRemoved = null;
  if (seedSite) {
    for (const c of data.navigationItems || []) {
      if (c.items) c.items = c.items.filter((i) => i.id !== seedSite.id);
      for (const s of c.subCategories || []) s.items = (s.items || []).filter((i) => i.id !== seedSite.id);
    }
    await j("PUT", "/api/storage", { path: "src/navsphere/content/navigation.json", content: JSON.stringify(data) });
    const seedCheck = await j("GET", "/api/sites/" + seedSite.id);
    seedRemoved = seedCheck.status === 404;
    console.log("[verify] seed-source site removed by snapshot alignment:", seedRemoved);
  }

  const pass = survived && nsCheck.status === 404 && (seedRemoved === null || seedRemoved === true);
  console.log(pass ? "D1-REGRESSION: PASS" : "D1-REGRESSION: FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
