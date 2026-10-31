/**
 * 平替雷达的落地层：把 packages/core/src/ecosystem.ts 里手工策划的 ECOSYSTEM_MAP 写进 site_relations。
 *
 * 这一层存在的理由（2026-10-31 线上直证）：策划的边从来没进过库（site_relations 0 行），
 * 面板能显示靠的是读路径兜底 —— rowToSite（packages/store/src/repository/dialect.ts:78）现算一份
 * 塞进内存里的 site.relations。`GET /api/sites/<GitHub>/relations` 返回的两条 alternative
 * 全是 `id: undefined / targetSiteId: undefined`，于是：
 *   · GitLab / Obsidian 这些库里明明有的平替只能当纯文本（前端只在有 targetSiteId 时渲染 `<Link>`）；
 *   · 反向关系推不出来（incoming 恒空，要 target_site_id 有值）；
 *   · 运营 PUT 一次手工编辑，兜底条件（表为空）就不成立了，那条站点的策划平替整批消失。
 * events 的零结果计量里 `chatgpt 平替` ×5 / `figma 平替` ×1 / `notion 平替` ×1 要的恰恰是这份数据
 * （2026-10-31 本机库）。
 *
 * 钉住的八件事，逐条都对应一次真实翻车方式：
 *   1. 库里一个站点都没有时，策划边一条都不写，且**每个源站都被点名**（不许静默成功）；
 *   2. 源站与目标站都在库时，边带着解析出来的 targetSiteId 落地（面板才点得进站内）；
 *   3. 库里 `https://www.obsidian.md/` 与策划里 `https://obsidian.md` 是同一条 —— 口径必须与
 *      core 的 ecosystemUrlKey 共用，逐条精确查会把「其实收进来了」报成站外；
 *   4. 目标站确实没收录时边照样落，但必须出现在 danglingTargets 里（缺的是收录，不是数据）；
 *   5. 运营用 PUT /api/sites/:id/relations 手工编辑过的源站让路，自定义那条不许被覆盖回去；
 *   6. 重跑幂等：第二次一条都不写、行数不变；
 *   7. 「让路」的判据必须是 site_relations 的真实行，不能是 getDetailedSiteRelations ——
 *      它的兜底会把 ECOSYSTEM_MAP 自己算出来，那样每个策划源站都会被当成「运营编辑过」，
 *      种子就一条也写不进（这条先红过，所以才留在测试里）；
 *   8. 每个策划源站都必须在**内置种子** seed-data.json 里 —— 冷启动实测曾因此少落 7 条边。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ECOSYSTEM_MAP, ecosystemUrlKey } from "@navhub/core";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { allSeedPluginDefs } from "../src/seed-data/index.ts";
import { seedEcosystemRelations } from "../src/seed.ts";

let dir: string;
let ctx: AppContext;
let categoryId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-eco-seed-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "eco.db"),
      embedding: {
        model: "Xenova/bge-small-zh-v1.5",
        endpoint: "https://hf-mirror.com",
        dtype: "q8",
        cacheDir: join(dir, "models"),
        dim: 512,
        enabled: false,
      },
      corsOrigins: ["*"],
    }),
  );
  categoryId = await ctx.repo.ensureUncategorized();
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 有策划边的 ECOSYSTEM_MAP 键；没有 relations 的条目（mdn / leetcode / docker hub）不参与落库 */
const curatedKeys = Object.keys(ECOSYSTEM_MAP).filter((k) => (ECOSYSTEM_MAP[k].relations ?? []).length > 0);
const curatedEdgeCount = curatedKeys.reduce((n, k) => n + (ECOSYSTEM_MAP[k].relations ?? []).length, 0);

/** 内置种子（与垂类包无关的那一份）里所有站点的归一键 */
const seedData = JSON.parse(readFileSync(new URL("../src/seed-data.json", import.meta.url), "utf8")) as {
  sites: Array<{ url: string }>;
};
const seededKeys = new Set(
  seedData.sites.map((s) => ecosystemUrlKey(s.url)).filter((k): k is string => Boolean(k)),
);

async function addSite(url: string, title: string) {
  return ctx.repo.createSite({ url, title, categoryId, source: "seed" });
}

async function siteRows() {
  return (await ctx.repo.raw("SELECT id, url FROM sites WHERE deleted_at IS NULL")) as unknown as Array<{
    id: string;
    url: string;
  }>;
}

describe("seedEcosystemRelations", () => {
  it("空库：一条不写，但每个策划源站都被点名（不静默成功）", async () => {
    const res = await seedEcosystemRelations(ctx.repo, []);
    expect(res.written).toBe(0);
    expect(res.danglingTargets).toEqual([]);
    expect(res.missingSources.sort()).toEqual([...curatedKeys].sort());
  });

  it("源站与目标站都在库：边带解析好的 targetSiteId 落地", async () => {
    const curated = ECOSYSTEM_MAP["chatgpt.com"].relations ?? [];
    expect(curated.length).toBeGreaterThan(0);

    const source = await addSite("https://chatgpt.com", "ChatGPT");
    const targets = new Map<string, string>();
    for (const rel of curated) {
      targets.set(ecosystemUrlKey(rel.targetUrl)!, (await addSite(rel.targetUrl, rel.targetTitle)).id);
    }
    // 落库**之前**读路径就已经有 6 条了 —— 那是 rowToSite 现算的内存兜底（没有 id / targetSiteId）。
    // 「运营编辑过就让路」的判据如果用它，每个策划源站都会被判成已编辑，种子一条也写不进。
    const before = (await ctx.repo.getDetailedSiteRelations(source.id)).outgoing;
    expect(before).toHaveLength(curated.length);
    expect(before[0].id ?? before[0].targetSiteId).toBeUndefined();

    const res = await seedEcosystemRelations(ctx.repo, await siteRows());
    expect(res.missingSources).not.toContain("chatgpt.com");
    // chatgpt.com 的平替里 claude.ai / deepseek / ollama 自己也是策划源站，
    // 所以 written 只会 ≥ 本条条数；断言只盯自己这条源站落地的行。
    expect(res.written).toBeGreaterThanOrEqual(curated.length);

    const outgoing = (await ctx.repo.getDetailedSiteRelations(source.id)).outgoing;
    expect(outgoing).toHaveLength(curated.length);
    for (const row of outgoing) {
      expect(row.relationType).toBe("alternative");
      // 解析不到就只能当站外链接显示，面板点不进站内详情页
      expect(row.targetSiteId).toBe(targets.get(ecosystemUrlKey(row.targetUrl)!));
      expect(row.note).toBeTruthy();
    }
  });

  it("库里是 www + 尾斜杠形态也算同一条产品，不报成站外目标", async () => {
    const curated = ECOSYSTEM_MAP["notion.so"].relations ?? [];
    const source = await addSite("https://www.notion.so/", "Notion");
    const stored = new Map<string, string>();
    for (const rel of curated) {
      const key = ecosystemUrlKey(rel.targetUrl)!;
      // 把 obsidian.md 存成带 www 和尾斜杠的形态，其余按策划原样
      const url = key === "obsidian.md" ? "https://www.obsidian.md/" : rel.targetUrl;
      stored.set(key, (await addSite(url, rel.targetTitle)).id);
    }

    const res = await seedEcosystemRelations(ctx.repo, await siteRows());
    expect(res.missingSources).not.toContain("notion.so");
    expect(res.danglingTargets.filter((d) => d.startsWith("notion.so → "))).toEqual([]);

    const outgoing = (await ctx.repo.getDetailedSiteRelations(source.id)).outgoing;
    expect(outgoing).toHaveLength(curated.length);
    for (const row of outgoing) {
      expect(row.targetSiteId).toBe(stored.get(ecosystemUrlKey(row.targetUrl)!));
    }
  });

  it("目标站没收录：边照样落，但点名进 danglingTargets", async () => {
    const key = "figma.com";
    const curated = ECOSYSTEM_MAP[key].relations ?? [];
    expect(curated.length).toBeGreaterThan(0);

    const source = await addSite("https://www.figma.com/", "Figma");
    // 只收第一条平替，其余留在库外
    const inLibrary = await addSite(curated[0].targetUrl, curated[0].targetTitle);

    const res = await seedEcosystemRelations(ctx.repo, await siteRows());
    expect(res.missingSources).not.toContain(key);
    expect(res.danglingTargets).toContain(`${key} → ${curated[1].targetUrl}`);

    const outgoing = (await ctx.repo.getDetailedSiteRelations(source.id)).outgoing;
    expect(outgoing).toHaveLength(curated.length);
    expect(outgoing.find((r) => ecosystemUrlKey(r.targetUrl) === ecosystemUrlKey(curated[0].targetUrl))?.targetSiteId).toBe(
      inLibrary.id
    );
    // 站外那条不是被丢掉，而是没有站内 id：面板仍显示它和它的 URL
    expect(outgoing.find((r) => ecosystemUrlKey(r.targetUrl) === ecosystemUrlKey(curated[1].targetUrl))?.targetSiteId).toBeNull();
  });

  it("运营手工编辑过的源站让路：不覆盖，自定义那条原样留着", async () => {
    const key = "github.com";
    const source = await addSite("https://github.com", "GitHub");
    await ctx.repo.setSiteRelations(source.id, [
      {
        id: "rel-manual",
        sourceSiteId: source.id,
        targetSiteId: null,
        targetTitle: "我自己选的平替",
        targetUrl: "https://gitlab.example.org",
        relationType: "alternative",
        isFreeOrOpenSource: true,
        note: "运营手写的那条",
      },
    ]);

    const res = await seedEcosystemRelations(ctx.repo, await siteRows());
    expect(res.missingSources).not.toContain(key);
    const outgoing = (await ctx.repo.getDetailedSiteRelations(source.id)).outgoing;
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].id).toBe("rel-manual");
    expect(outgoing[0].note).toBe("运营手写的那条");
  });

  it("重跑幂等：第二次一条都不写、行数不变", async () => {
    const count = async () => {
      const rows = (await ctx.repo.raw("SELECT COUNT(*) AS n FROM site_relations")) as unknown as Array<{ n: number }>;
      return Number(rows[0].n);
    };
    const sites = await siteRows();
    // 前面几条用例是分批把站点建进来的，所以第一次全量跑还会补上「此刻才出现在库里」的源站
    await seedEcosystemRelations(ctx.repo, sites);
    const afterFirst = await count();

    const res = await seedEcosystemRelations(ctx.repo, await siteRows());
    expect(res.written).toBe(0);
    // 此刻库里已有的那些策划源站，每一条都已带出边 → 第二轮只能走「运营编辑让路」这一支；
    // 没建进来的（cursor / npmjs / vercel / tinypng…）继续留在 missingSources 里点名。
    const present = new Set(sites.map((s) => ecosystemUrlKey(s.url)).filter(Boolean));
    const inLibrary = curatedKeys.filter((k) => present.has(ecosystemUrlKey(`https://${k}`)!));
    expect(res.preserved).toBe(inLibrary.length);
    expect(res.missingSources.sort()).toEqual(curatedKeys.filter((k) => !present.has(ecosystemUrlKey(`https://${k}`)!)).sort());
    expect(await count()).toBe(afterFirst);
  });

  it("策划数据自身：源站键与目标 URL 都能被同一口径归一", async () => {
    // 键漏协议是 ECOSYSTEM_MAP 的写法约定；seed 补 https:// 后必须能归一，
    // 否则这个源站会永远落在 missingSources 里（面板空白，且不报错）。
    for (const key of curatedKeys) {
      expect(ecosystemUrlKey(`https://${key}`), `键 ${key} 无法归一`).not.toBeNull();
    }
    for (const key of curatedKeys) {
      for (const rel of ECOSYSTEM_MAP[key].relations ?? []) {
        expect(ecosystemUrlKey(rel.targetUrl), `${key} 的目标 ${rel.targetUrl} 无法归一`).not.toBeNull();
      }
    }
    expect(curatedEdgeCount).toBeGreaterThan(0);
  });

  it("每个策划源站都在内置种子里：冷启动第一遍就落全边，不靠装了垂类包", () => {
    /**
     * 这组断言是 2026-10-31 冷启动实测逼出来的：清空 NAVHUB_SQLITE_PATH 跑
     * `node apps/api/src/seed-main.ts`，第一轮拿到的是
     * `written 26 / missingSources ["github.com","notion.so"]`，
     * 而不是本机库（装过垂类包）那一轮的 33/0。
     *
     * 原因是内置种子只收了 10 条 `github.com/**` 深链接，没有 GitHub 主页，
     * Notion 则整个不在 `seed-data.json` 里（本机那条来自 `plugin:seed-dev-efficiency`）。
     * 于是新部署的「平替雷达」恰好缺策划里边最多的两个源站，而面板靠 core 的
     * 内存兜底仍能显示——缺的是能点进站内的 targetSiteId，看不出来。
     *
     * 判据只认内置种子这一份文件：垂类包是可选安装，不能当成平替雷达的前提。
     */
    const absent = curatedKeys.filter((k) => !seededKeys.has(ecosystemUrlKey(`https://${k}`)!));
    expect(absent, `这些策划源站不在内置种子中，冷启动时它们的平替边整条丢失：${absent.join("、")}`).toEqual([]);
  });

  /**
   * 冷启动（只有内置种子、没装任何垂类包）剩下的悬空平替：边照样落库、面板照样显示标题与外链，
   * 但点不进站内详情页，incoming 也推不出来。所以给这本账加主——每条写明「装哪个网址包才会解析」。
   *
   * 双向判据（缺一边账就会悄悄长或烂）：
   *   · 新悬空目标不在账上 → 红：补进 seed-data.json，或写明归属它的网址包；
   *   · 账上的目标已经不悬空（种子收下了 / 策划边删了）→ 也红：把账收紧。
   * 归属不是注释：断言该网址包的 payload 里真有这条 URL（归一后精确匹配）。
   * 2026-10-31 建账时 23 条悬空里 7 条哪儿都不在（npmmirror / Coolify / Zeabur / Cloudflare Pages /
   * Pexels / Pixabay / Draw.io），已补进内置种子；剩下 16 条全部由下列网址包认领。
   */
  const DANGLING_TARGET_PACKS: Record<string, string> = {
    "continue.dev": "seed-dev-efficiency",
    "kimi.moonshot.cn": "ai-tools-arsenal",
    "gemini.google.com": "ai-tools-arsenal",
    "chatglm.cn": "ai-tools-arsenal",
    "about.gitlab.com": "seed-dev-efficiency",
    "penpot.app": "seed-design-inspiration",
    "pixso.cn": "seed-design-inspiration",
    "squoosh.app": "front-end-arsenal",
    "tldraw.com": "seed-design-inspiration",
    "lucide.dev": "front-end-arsenal",
    "appflowy.io": "homelab-selfhosted-pro",
    "obsidian.md": "seed-dev-efficiency",
    "affine.pro": "homelab-selfhosted-pro",
    "logseq.com": "seed-dev-efficiency",
    "b3log.org/siyuan": "seed-dev-efficiency",
  };

  it("冷启动剩下的悬空平替有主：每条钉到具体网址包，账只能缩不能长", () => {
    const packs = new Map(
      allSeedPluginDefs
        .filter((def) => (def.manifest as { kind?: string } | null)?.kind === "site-pack")
        .map((def) => [def.slug, def] as const),
    );
    const packKeys = (slug: string) =>
      new Set(
        ((packs.get(slug)?.manifest as { payload?: { sites?: Array<{ url: string }> } } | undefined)?.payload?.sites ?? [])
          .map((s) => ecosystemUrlKey(s.url))
          .filter((k): k is string => Boolean(k)),
      );

    const dangling = new Map<string, string[]>();
    for (const key of curatedKeys) {
      if (!seededKeys.has(ecosystemUrlKey(`https://${key}`)!)) continue;
      for (const rel of ECOSYSTEM_MAP[key].relations ?? []) {
        const targetKey = ecosystemUrlKey(rel.targetUrl);
        if (!targetKey || seededKeys.has(targetKey)) continue;
        dangling.set(targetKey, [...(dangling.get(targetKey) ?? []), `${key} → ${rel.targetUrl}`]);
      }
    }

    const unowned = [...dangling].filter(([targetKey]) => !(targetKey in DANGLING_TARGET_PACKS));
    expect(
      unowned.map(([targetKey, edges]) => `${targetKey}（${edges.join("、")}）`),
      "这些平替目标既不在内置种子、也不在账上：补进 seed-data.json，或在 DANGLING_TARGET_PACKS 写明装哪个网址包才有它",
    ).toEqual([]);

    const stale = Object.keys(DANGLING_TARGET_PACKS).filter((targetKey) => !dangling.has(targetKey));
    expect(stale, `账上这些目标已经不再悬空（种子收下了，或策划边被删）——把账收紧：${stale.join("、")}`).toEqual([]);

    const ownerGaps: string[] = [];
    for (const [targetKey, packSlug] of Object.entries(DANGLING_TARGET_PACKS)) {
      if (!packs.has(packSlug)) {
        ownerGaps.push(`${targetKey} → 网址包 ${packSlug} 不存在`);
      } else if (!packKeys(packSlug).has(targetKey)) {
        ownerGaps.push(`${targetKey} → 网址包 ${packSlug} 的 payload 里没有这条 URL`);
      }
    }
    expect(ownerGaps, `归属声明的网址包里找不到这些目标站：${ownerGaps.join("；")}`).toEqual([]);
  });
});
