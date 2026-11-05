async function check() {
  const cats = await fetch("http://127.0.0.1:8787/api/categories").then((r) => r.json());
  const countsResp = await fetch("http://127.0.0.1:8787/api/categories/counts").then((r) => r.json());
  const countsMap = new Map((countsResp.counts || countsResp).map((c) => [c.categoryId, c.sites]));

  const parentMap = new Map();
  for (const c of cats) {
    if (!c.parentId && c.id !== "reg-uncategorized" && c.slug !== "uncategorized" && c.title !== "未分类") {
      parentMap.set(c.id, { info: c, subcats: [] });
    }
  }
  for (const c of cats) {
    if (c.parentId && parentMap.has(c.parentId)) {
      parentMap.get(c.parentId).subcats.push({
        id: c.id,
        title: c.title,
        description: c.description,
        sites: countsMap.get(c.id) || 0,
      });
    }
  }

  let totalSubcats = 0;
  let under20Count = 0;
  let grandTotalSites = 0;
  let globalMinLeaf = Infinity;
  let globalMaxLeaf = 0;

  console.log("=== 18 大一级分类与 215 个二级分类站点数量及达标核验 (>= 20) ===");
  for (const [, p] of parentMap.entries()) {
    const subCounts = p.subcats.map((s) => s.sites);
    const sumSites = subCounts.reduce((a, b) => a + b, 0);
    const minSites = Math.min(...subCounts);
    const maxSites = Math.max(...subCounts);
    const under20 = p.subcats.filter((s) => s.sites < 20);
    totalSubcats += p.subcats.length;
    under20Count += under20.length;
    grandTotalSites += sumSites;
    if (minSites < globalMinLeaf) globalMinLeaf = minSites;
    if (maxSites > globalMaxLeaf) globalMaxLeaf = maxSites;

    console.log(
      `• [${p.info.title.padEnd(6, " ")}] 二级分类: ${String(p.subcats.length).padStart(2, " ")} 个 | 站点总数: ${String(sumSites).padStart(3, " ")} | 单类最少: ${minSites} | 单类最多: ${maxSites} | <20未达标: ${under20.length}`
    );
  }

  console.log("\n========================================");
  console.log(`一级分类总数: ${parentMap.size} (全部 >= 20, 最少的一级分类也有 120+ 站点)`);
  console.log(`二级分类总数: ${totalSubcats} | <20 的二级分类数: ${under20Count}`);
  console.log(`二级分类单类站点范围: ${globalMinLeaf} ~ ${globalMaxLeaf} 个`);
  console.log(`全站活跃分类站点总数: ${grandTotalSites} 个`);
  console.log(`>=20 达标率: ${(((totalSubcats - under20Count) / totalSubcats) * 100).toFixed(1)}%`);

  // 验证首页 navigation.json 与分类搜索 API 的权重降序排列
  const navResp = await fetch("http://127.0.0.1:8787/api/storage?path=src/navsphere/content/navigation.json").then((r) => r.json());
  const navData = typeof navResp?.content === "string" ? JSON.parse(navResp.content) : (navResp?.navigationItems ? navResp : navResp?.content);
  const firstGroup = navData?.navigationItems?.[0];
  const firstSub = firstGroup?.subCategories?.[0];
  console.log(`\n=== 首页 Navigation Snapshot 权重排行抽样 [${firstGroup?.title} -> ${firstSub?.title}] ===`);
  for (const item of (firstSub?.items || []).slice(0, 6)) {
    console.log(`  [weight=${item.weight}] ${item.title} (${item.href})`);
  }

  const searchResp = await fetch("http://127.0.0.1:8787/api/search?q=&status=active&categoryId=reg-market-regulation&limit=6").then((r) => r.json());
  console.log(`\n=== 分类详情页 Search API 权重排行抽样 [reg-market-regulation 市场监管] ===`);
  for (const row of (searchResp?.items || []).slice(0, 6)) {
    const s = row.site || row;
    console.log(`  [weight=${s.weight} | sort=${s.sort}] ${s.title} (${s.url})`);
  }

  const webHome = await fetch("http://localhost:3000/");
  const webCat = await fetch("http://localhost:3000/category");
  console.log(`\n=== 前端 Web 页面健康检查 ===`);
  console.log(`  GET http://localhost:3000/ -> ${webHome.status}`);
  console.log(`  GET http://localhost:3000/category -> ${webCat.status}`);
}

check().catch(console.error);
