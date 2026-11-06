/**
 * recipes 域四个 AI 内存缓存的判据测试（`GET /api/recipes`、`GET /api/comparisons`、
 * `POST /api/recipes/scaffold`、`GET /api/intent/action`）。
 *
 * 四处原本是「拿请求体的一部分当整段提示词的键」：
 *  - recipes 只用查询词，而配方条目是从这次召回到的候选里挑的；
 *  - comparisons 只用两侧工具名，而矩阵是从两侧站点记录展开的；
 *  - scaffold 的 key 只含配方标题与工具名，`targetGoal` 与各层描述/网址不进 key，
 *    同标题换个目标场景就会命中前一个人的脚手架；
 *  - intent 的 key 只是查询词，而结论同时取决于这次召回到的候选工具，
 *    候选集变了仍然命中旧推荐（primaryTool 标题还可能已经不在候选里）。
 * 断言方式是「第 N 次生成」的计数标记：命中就复用同一份产物，
 * 因此标记不变即串答案，标记变了即真的重算——不依赖模型文案本身。
 * 模型端点由 fetch 桩接管，测试不出网。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-recipes-cache-"));
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let generations: number[];

function stubLlm() {
  const original = globalThis.fetch;
  generations = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // 非模型端点一律就地回空，绝不 fall through 到真实网络：
    // 真发一次就取决于当天网络，测试结果也跟着抖。
    if (!url.includes("/chat/completions")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const n = generations.length + 1;
    generations.push(n);
    // 四个场景共用一个壳：scaffold 读 envTemplate、intent 读 steps[0]、
    // recipes 读 title、comparisons 读 verdict，都带上第几次生成。
    // steps 不带数字序号——序号是否被剥掉属展示层口径，本测试只验缓存判据。
    const content = JSON.stringify({
      recipeType: "coding_tech",
      envTemplate: `第${n}次生成的脚手架`,
      cliQuickStart: `pnpm add tool-${n}`,
      sopChecklist: [{ step: 1, title: "t", toolName: "x", action: "a", pitfallWarning: "p" }],
      isActionable: true,
      actionSummary: `3步完成：第${n}次`,
      primaryTool: { title: "声纹切分测试工具", whyBest: "免登录" },
      steps: [`第${n}次第一步`, "第二步", "第三步"],
      proTip: "p",
      alternativeTool: { title: "声纹切分测试工具", reason: "开源" },
      title: `第${n}次生成的配方`,
      layers: [{ layerName: "L1", recommended: { title: "声纹切分测试工具", url: "https://voice-cut.example.com" } }],
      verdict: `第${n}次选型结论`,
      itemA: { name: "甲", primaryPros: ["p"], tradeoffs: ["t"], bestFor: "b" },
      itemB: { name: "乙", primaryPros: ["p"], tradeoffs: ["t"], bestFor: "b" },
      dimensions: [{ dimName: "核心能力", valueA: "a", valueB: "b", winner: "TIE" }],
    });
    return new Response(
      JSON.stringify({ model: "cache-test-model", choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const layers = [
  { layerName: "采集层", recommended: { title: "工具甲", url: "https://a.example.com", description: "负责采集" } },
  { layerName: "存储层", recommended: { title: "工具乙", url: "https://b.example.com", description: "负责存储" } },
];

function scaffold(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/recipes/scaffold", payload: body });
}

beforeAll(async () => {
  ctx = await createContext(
    loadConfig({
      mode: "lite" as const,
      embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
      // 端点主机写成字面 IP：网关在发请求前会先解析端点域名做 SSRF 校验
      // （llm.ts assertLlmEndpoint → resolveAndCheck），假域名等于让本套件依赖本机真实 DNS，
      // 全量并发下会偶发「DNS 解析失败」并让路由直接 500。字面 IP 走 isIP 分支，不查 DNS；
      // 出站请求由下方 fetch 桩接管，一个包都不会离开进程。
      llm: { baseUrl: "https://93.184.216.34/v1", apiKey: "test-key", model: "cache-test-model", timeoutMs: 3000 },
      fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
      sqlitePath: join(dir, "recipes.db"),
    }),
  );
  app = await buildServer(ctx);
  await app.ready();
  // 候选站点必须挂在真实存在的类目下，否则建不进来
  await ctx.repo.createCategory({ id: "cat-intent", title: "意图缓存类目" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/recipes/scaffold 缓存判据", () => {
  it("完全相同的请求命中缓存，不再打模型", async () => {
    const restore = stubLlm();
    try {
      const body = { recipeTitle: "独立开发变现", targetGoal: "上线一个订阅制小工具", layers };
      const first = await scaffold(body);
      // 带上响应体：这里是 500 时，光看状态码猜不出是桩没装上还是网关侧异常
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().cached).toBe(false);
      expect(first.json().envTemplate).toBe("第1次生成的脚手架");
      expect(generations).toHaveLength(1);

      const second = await scaffold(body);
      expect(second.json().cached).toBe(true);
      expect(second.json().envTemplate).toBe("第1次生成的脚手架");
      expect(generations).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("同标题换目标场景不再命中：那是另一个问题，不是同一次请求", async () => {
    const restore = stubLlm();
    try {
      const a = await scaffold({ recipeTitle: "短视频创作", targetGoal: "口播文案转成片", layers });
      expect(a.json().cached).toBe(false);
      expect(a.json().envTemplate).toBe("第1次生成的脚手架");

      // 标题与工具链完全一致，只有 targetGoal 变了
      const b = await scaffold({ recipeTitle: "短视频创作", targetGoal: "直播切片二次分发", layers });
      expect(b.json().cached).toBe(false);
      // 旧 key 下这里会直接返回第1次的产物——即答非所问
      expect(b.json().envTemplate).toBe("第2次生成的脚手架");
      expect(generations).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it("工具描述变了同样重算：描述进提示词就必须进判据", async () => {
    const restore = stubLlm();
    try {
      const a = await scaffold({ recipeTitle: "数据看板", targetGoal: "内部指标周报", layers });
      expect(a.json().envTemplate).toBe("第1次生成的脚手架");

      const shifted = [{ layerName: "采集层", recommended: { title: "工具甲", url: "https://a.example.com", description: "改口：负责埋点" } }, layers[1]];
      const b = await scaffold({ recipeTitle: "数据看板", targetGoal: "内部指标周报", layers: shifted });
      expect(b.json().cached).toBe(false);
      expect(b.json().envTemplate).toBe("第2次生成的脚手架");
    } finally {
      restore();
    }
  });
});

describe("GET /api/intent/action 缓存判据", () => {
  const Q = "声纹切分测试工具";

  /** 每个用例一条独立候选：缓存是进程级的，用例之间会互相看见，描述必须各不相同 */
  async function seedCandidate(marker: string) {
    const created = await ctx.repo.createSite({
      url: `https://voice-cut-${marker}.example.com`,
      title: Q,
      description: `初版描述：按声纹自动切分录音（${marker}）`,
      categoryId: "cat-intent",
    });
    return String(created.id);
  }

  it("同一查询词命中缓存，不再打模型", async () => {
    const id = await seedCandidate("same");
    const restore = stubLlm();
    try {
      const first = await app.inject({ method: "GET", url: `/api/intent/action?q=${encodeURIComponent(Q)}` });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().cached).toBe(false);
      expect(generations).toHaveLength(1);

      const second = await app.inject({ method: "GET", url: `/api/intent/action?q=${encodeURIComponent(Q)}` });
      expect(second.json().cached).toBe(true);
      expect(generations).toHaveLength(1);
    } finally {
      restore();
      await ctx.repo.deleteSite(id);
    }
  });

  it("候选工具信息变了不再命中：推荐必须落在当前候选集上", async () => {
    const id = await seedCandidate("changed");
    const restore = stubLlm();
    try {
      const before = await app.inject({ method: "GET", url: `/api/intent/action?q=${encodeURIComponent(Q)}` });
      expect(before.json().cached).toBe(false);

      // 候选站点被富化改写：提示词里的 candidateContext 变了，旧答案描述的是已经不成立的候选
      await ctx.repo.updateSite(id, { description: "改版描述：新增说话人分离与时间轴导出" });
      const after = await app.inject({ method: "GET", url: `/api/intent/action?q=${encodeURIComponent(Q)}` });
      expect(after.json().cached).toBe(false);
      expect(after.json().steps?.[0]).toBe("第2次第一步");
      expect(generations).toHaveLength(2);

      // 失效是一次性重算，不是打穿缓存
      const third = await app.inject({ method: "GET", url: `/api/intent/action?q=${encodeURIComponent(Q)}` });
      expect(third.json().cached).toBe(true);
      expect(generations).toHaveLength(2);
    } finally {
      restore();
      await ctx.repo.deleteSite(id);
    }
  });
});

/**
 * `/api/recipes` 与 `/api/comparisons` 的两个更早落地的内存缓存：
 * key 只含查询词（或两侧工具名），而提示词还吃了这次召回到的站点记录。
 * 站点被富化改写、下架或检索改指另一个同名工具之后，缓存里的 recommended.id
 * 与对比条目就指向了已经不成立的对象。
 */
describe("GET /api/recipes 缓存判据", () => {
  const Q = "缓存判据专用场景甲";

  async function seedCorpus(marker: string) {
    const created = await ctx.repo.createSite({
      url: `https://recipe-${marker}.example.com`,
      title: Q,
      description: `初版描述：这套馆藏只有一条候选（${marker}）`,
      categoryId: "cat-intent",
    });
    return String(created.id);
  }

  const get = () => app.inject({ method: "GET", url: `/api/recipes?q=${encodeURIComponent(Q)}` });

  it("同一查询与同一候选集命中缓存，不再打模型", async () => {
    const id = await seedCorpus("hit");
    const restore = stubLlm();
    try {
      const first = await get();
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().cached).toBeUndefined();
      expect(first.json().item?.title).toBe("第1次生成的配方");
      expect(generations).toHaveLength(1);

      const second = await get();
      expect(second.json().cached).toBe(true);
      expect(second.json().item?.title).toBe("第1次生成的配方");
      expect(generations).toHaveLength(1);
    } finally {
      restore();
      await ctx.repo.deleteSite(id);
    }
  });

  it("候选站点描述变了不再命中：配方里的工具条目就是从这批候选挑的", async () => {
    const id = await seedCorpus("drift");
    const restore = stubLlm();
    try {
      expect((await get()).json().item?.title).toBe("第1次生成的配方");

      await ctx.repo.updateSite(id, { description: "改版描述：换了定价与主推能力" });
      const after = await get();
      expect(after.json().cached).toBeUndefined();
      expect(after.json().item?.title).toBe("第2次生成的配方");
      expect(generations).toHaveLength(2);

      // 一次性重算，不是此后每次都打模型
      expect((await get()).json().cached).toBe(true);
      expect(generations).toHaveLength(2);
    } finally {
      restore();
      await ctx.repo.deleteSite(id);
    }
  });
});

describe("GET /api/comparisons 缓存判据", () => {
  const A = "缓存判据甲工具";
  const B = "缓存判据乙工具";
  const get = (q: string) => app.inject({ method: "GET", url: `/api/comparisons?q=${encodeURIComponent(q)}` });

  async function seedLeft(marker: string) {
    const created = await ctx.repo.createSite({
      url: `https://cmp-${marker}.example.com`,
      title: A,
      description: `初版描述：甲工具的真实馆藏条目（${marker}）`,
      categoryId: "cat-intent",
    });
    return String(created.id);
  }

  it("A vs B 与 B vs A 共用一条，第二次不再打模型", async () => {
    const id = await seedLeft("sym");
    const restore = stubLlm();
    try {
      const first = await get(`${A} vs ${B}`);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().matrix?.verdict).toBe("第1次选型结论");
      expect(generations).toHaveLength(1);

      // 换序：同一对工具，同一个结论——旧 key 靠名字排序保证这一点，改造后必须仍然成立
      const flipped = await get(`${B} vs ${A}`);
      expect(flipped.json().cached).toBe(true);
      expect(flipped.json().matrix?.verdict).toBe("第1次选型结论");
      expect(generations).toHaveLength(1);
    } finally {
      restore();
      await ctx.repo.deleteSite(id);
    }
  });

  it("参考条目变了不再命中：矩阵是从两侧站点记录展开的", async () => {
    const id = await seedLeft("drift");
    const restore = stubLlm();
    try {
      expect((await get(`${A} vs ${B}`)).json().matrix?.verdict).toBe("第1次选型结论");

      await ctx.repo.updateSite(id, { description: "改版描述：甲工具改成了订阅制" });
      const after = await get(`${A} vs ${B}`);
      expect(after.json().cached).toBeUndefined();
      expect(after.json().matrix?.verdict).toBe("第2次选型结论");
      expect(generations).toHaveLength(2);

      expect((await get(`${A} vs ${B}`)).json().cached).toBe(true);
      expect(generations).toHaveLength(2);
    } finally {
      restore();
      await ctx.repo.deleteSite(id);
    }
  });
});
