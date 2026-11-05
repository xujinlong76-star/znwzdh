// 使用 Node 24 原生 fetch

async function check() {
  const cats = await fetch("http://127.0.0.1:8787/api/categories").then(r => r.json());
  const countsResp = await fetch("http://127.0.0.1:8787/api/categories/counts").then(r => r.json());
  const countsMap = new Map((countsResp.counts || countsResp).map(c => [c.categoryId, c.sites]));
  
  const parentMap = new Map();
  for (const c of cats) {
    if (!c.parentId) {
      parentMap.set(c.id, { info: c, subcats: [] });
    }
  }
  for (const c of cats) {
    if (c.parentId && parentMap.has(c.parentId)) {
      parentMap.get(c.parentId).subcats.push({
        id: c.id,
        title: c.title,
        description: c.description,
        sites: countsMap.get(c.id) || 0
      });
    }
  }

  let totalEmptySubcats = 0;
  let totalSubcats = 0;
  const emptyList = [];

  for (const [pId, p] of parentMap.entries()) {
    const emptySubcats = p.subcats.filter(s => s.sites === 0);
    const lowSubcats = p.subcats.filter(s => s.sites > 0 && s.sites <= 2);
    totalEmptySubcats += emptySubcats.length;
    totalSubcats += p.subcats.length;
    console.log(`\n[${p.info.title}] (总子类: ${p.subcats.length}, 空分类: ${emptySubcats.length}, 1-2个: ${lowSubcats.length})`);
    if (emptySubcats.length > 0) {
      console.log("  空缺分类:", emptySubcats.map(s => `${s.title} (${s.id})`).join(", "));
      for (const es of emptySubcats) {
        emptyList.push({ parent: p.info.title, parentId: pId, ...es });
      }
    }
  }
  console.log(`\n========================================`);
  console.log(`子分类总数: ${totalSubcats}, 仍为空的子分类: ${totalEmptySubcats}`);
  console.log(`覆盖率: ${(((totalSubcats - totalEmptySubcats) / totalSubcats) * 100).toFixed(1)}%`);

  console.log(`\n=== 63 个空缺子分类明细 ===`);
  for (const item of emptyList) {
    console.log(`'${item.id}': { parent: '${item.parent}', title: '${item.title}', desc: '${item.description || ""}' },`);
  }
}
check().catch(console.error);
