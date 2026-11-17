import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { loginViaAdmin } from './helpers';

/**
 * P1-8：排序 / 筛选 / 分页端到端——非零数据下的真实行为。
 *
 * 背景：此前只有「全 0 退化注明」一条 E2E（phase2-a 的排序注明用例）。
 * popular / rating / new / trending 在非零数据下的实际顺序、kind 筛选的
 * 真实过滤结果集、分页「加载更多」点击，均无端到端覆盖。
 *
 * 造数方式（全部走站内已有 API，不依赖线上真实数据，不改业务代码）：
 *   - 导入：管理员通道 POST /api/hub/plugins/import（直接上架，无发布限流）；
 *   - 安装 / 星标 / 评分：必须走无会话的 Playwright `request` fixture +
 *     `anon-` 前缀身份（`anon-e2e-sort-…`），每身份 +1。管理员上下文
 *     （adminRequest）带登录会话，代理会话优先会把 `?anonId=` 覆盖成会话
 *     身份，7 次造数塌缩成 1 个身份，计数门禁必红；无会话时非 anon- 身份
 *     又会被代理 403（见 beforeAll 注释）。
 *   - 评分：先以同一身份安装（评价门禁要求活跃安装），再 POST
 *     /api/plugins/:slug/reviews?anonId=… 提交星级。
 *   - 四个排序插件 A/B/C/D 依次导入、间隔 50ms，保证 published_at 严格递增
 *    （new 排序的期望顺序才有确定性）；计数设计见下表。
 *
 * 计数设计（排序插件组，stamp = SORT_STAMP）：
 *   - A：安装 3（a1/a2/a3）· 星标 2（a1/a2）· 评价 5★×2（a1/a2）
 *   - B：安装 2（b1/b2）· 星标 1（b1）· 评价 5★×1（b1）
 *   - C：安装 1（c1）· 星标 1（c1）· 评价 4★×1（c1）
 *   - D：安装 1（d1）· 星标 0 · 评价 3★×1（d1）
 *   期望顺序（按 store 层 listPlugins 的排序键推导）：
 *   - popular（安装 DESC，星标 DESC）：A(3,2) > B(2,1) > C(1,1) > D(1,0)
 *   - rating（贝叶斯平滑 (avg*n+10.5)/(n+3)，再安装 DESC）：
 *     A(5.0×2→4.10) > B(5.0×1→3.875) > C(4.0×1→3.625) > D(3.0×1→3.375)
 *   - new（published_at DESC）：D > C > B > A（导入顺序的逆序）
 *   - trending（(安装×3+星标×5-举报×10+1)/(天龄+2) DESC，天龄几乎相等）：
 *     A(20) > B(12) > C(9) > D(4)
 *
 * 断言策略（只做行为断言，不做源码文本断言）：
 *   - 每种排序：UI 列表顺序 == 同条件列表 API 的顺序 == 设计期望顺序；
 *     其中 UI==API 覆盖「列表与榜单/后端同源」，期望顺序覆盖「API 本身排对了」。
 *   - 榜单：无筛选首页的安装榜 / 口碑榜首行是 A、新作榜首行是 D。
 *   - kind 筛选：同一组 stamp 下 2 个网站包 + 1 个主题 + 1 个搜索引擎包，
 *     逐个 kind 断言真实结果集（集合相等）与「共 N 个插件」计数。
 *   - 分页：本用例内先导入 25 个同 stamp 插件（总数 > 24），再等「加载更多」
 *     出现，点击后卡片数增多、按钮计数同步变大。CI E2E 库从空开始、无种子，
 *     不依赖既有数据量。
 *
 * 并行说明：playwright.config 是 workers:1、fullyParallel:false，全文件
 * 顺序执行；kind 组在 kind 用例内现导入（不在 beforeAll），以免抢占
 * 新作榜首行（D 必须是导入时全库最新的插件）。
 */

const SORT_STAMP = Date.now().toString(36);
const KIND_STAMP = `${SORT_STAMP}k`;

const SORT_PLUGINS = [
  { key: 'a', slug: `e2e-sort-${SORT_STAMP}-a`, name: `E2E 排序甲 ${SORT_STAMP}` },
  { key: 'b', slug: `e2e-sort-${SORT_STAMP}-b`, name: `E2E 排序乙 ${SORT_STAMP}` },
  { key: 'c', slug: `e2e-sort-${SORT_STAMP}-c`, name: `E2E 排序丙 ${SORT_STAMP}` },
  { key: 'd', slug: `e2e-sort-${SORT_STAMP}-d`, name: `E2E 排序丁 ${SORT_STAMP}` },
] as const;

type SortKey = (typeof SORT_PLUGINS)[number]['key'];
const slugOf = (key: SortKey) => SORT_PLUGINS.find((p) => p.key === key)!.slug;

function sitePackManifest(name: string, stamp: string) {
  return {
    manifestVersion: 1,
    kind: 'site-pack',
    name,
    description: 'Playwright 排序/筛选/分页端到端测试自动生成的网址包（可安全清理）',
    version: '1.0.0',
    tags: ['e2e'],
    payload: {
      categories: [{ title: `E2E 分类 ${stamp}` }],
      sites: [
        {
          url: `https://e2e-sort-${stamp}.example.com`,
          title: `E2E 示例站 ${stamp}`,
          category: `E2E 分类 ${stamp}`,
          tags: ['e2e'],
        },
      ],
    },
  };
}

async function importPlugin(
  adminRequest: APIRequestContext,
  slug: string,
  manifest: Record<string, unknown>,
) {
  const res = await adminRequest.post('/api/hub/plugins/import', {
    data: { manifest, slug },
  });
  expect(res.ok(), `导入失败 ${slug} ${res.status()}: ${await res.text()}`).toBeTruthy();
}

async function installAs(request: APIRequestContext, slug: string, anonId: string) {
  const res = await request.post(`/api/hub/plugins/${slug}/install?anonId=${anonId}`, {
    data: {},
  });
  expect(res.ok(), `安装失败 ${slug} 身份 ${anonId} ${res.status()}: ${await res.text()}`).toBeTruthy();
}

async function starAs(request: APIRequestContext, slug: string, anonId: string) {
  const res = await request.post(`/api/hub/plugins/${slug}/star?anonId=${anonId}`, {
    data: {},
  });
  expect(res.ok(), `星标失败 ${slug} 身份 ${anonId} ${res.status()}: ${await res.text()}`).toBeTruthy();
}

async function reviewAs(
  request: APIRequestContext,
  slug: string,
  anonId: string,
  rating: number,
) {
  const res = await request.post(`/api/hub/plugins/${slug}/reviews?anonId=${anonId}`, {
    data: { rating, title: `排序测试评价 ${rating} 星`, content: '排序端到端造数评价。' },
  });
  expect(res.status(), `评价失败 ${slug} 身份 ${anonId} ${res.status()}: ${await res.text()}`).toBe(201);
}

/** 列表 API 的顺序（ground truth）：与页面同条件取数，只取本组 stamp 的 slug。 */
async function apiSlugs(
  request: APIRequestContext,
  params: Record<string, string>,
): Promise<string[]> {
  const qs = new URLSearchParams({ limit: '100', ...params }).toString();
  const res = await request.get(`/api/hub/plugins?${qs}`);
  expect(res.ok(), `列表 API 失败 ${res.status()}: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return (body.items as Array<{ slug: string }>).map((item) => item.slug);
}

/**
 * 页面列表的顺序：卡片标题链（aria-label=全名）与「详情」链都指向
 * /marketplace/<slug>，按 DOM 序去重即卡片序；只取本组前缀的 slug。
 */
async function uiSlugs(page: Page, prefix: string): Promise<string[]> {
  const hrefs = await page
    .locator(`main a[href^="/marketplace/${prefix}"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
  const slugs: string[] = [];
  for (const href of hrefs) {
    const slug = href.replace('/marketplace/', '');
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 选类型并等地址栏落 kind（水合容错版）。
 *
 * 直接 selectOption 有冷启动水合竞态：首选若落在 React 水合前，
 * 受控 select 会在水合时被 kind state（''）重置、change 事件丢失，
 * URL 永远不带 kind（run 44125548782 首试即如此，重试才过）。
 * 因此先等落定信号再判定：URL 已带 kind（生效）或下拉值回到 ''
 * （水合已重置，可补选）；未生效才补选一次（与 clickInstallAndAwaitToast
 * 的补击同款）。site-pack 不走这里——下拉里没有该选项（P2-13），
 * 见 kind 用例内的深链注释。
 */
async function selectKind(page: Page, kind: string) {
  const kindSelect = page.getByLabel('按类型筛选');
  const pattern = new RegExp(`[?&]kind=${kind}`);
  await kindSelect.selectOption(kind);
  await expect
    .poll(async () => {
      if (pattern.test(page.url())) return 'applied';
      return (await kindSelect.inputValue()) === '' ? 'reset' : 'pending';
    }, { timeout: 15_000 })
    .not.toBe('pending');
  if (!pattern.test(page.url())) {
    await kindSelect.selectOption(kind);
    await expect(page).toHaveURL(pattern, { timeout: 15_000 });
  }
}

test.describe('插件市场 P1-8：排序 / 筛选 / 分页（非零数据）', () => {
  test.describe.configure({ retries: 1 });

  let adminRequest: APIRequestContext;
  let adminContext: BrowserContext | undefined;
  test.beforeAll(async ({ browser, request }, testInfo) => {
    test.setTimeout(180_000);
    adminContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    await loginViaAdmin(await adminContext.newPage());
    adminRequest = adminContext.request;
    // 注意：`request` 是无会话的 Playwright fixture（已验证可在 beforeAll
    // 里实例化，见 Playwright 1.64.1 实测），专供下面的安装 / 星标 / 评分
    // 造数；导入与列表核对仍走 adminRequest（导入要求管理员会话）。

    // 1. 依次导入 A/B/C/D，间隔 50ms 让 published_at 严格递增。
    for (const plugin of SORT_PLUGINS) {
      await importPlugin(adminRequest, plugin.slug, sitePackManifest(plugin.name, `${SORT_STAMP}-${plugin.key}`));
      await sleep(50);
    }

    // 2. 造安装 / 星标 / 评分（评价须先以同一身份安装）。
    // 身份隔离是造数成立的前提，两者缺一不可：
    //   (a) 无会话 request：代理会话优先（route.ts:158-162「有会话 → 用会话
    //       派生身份，覆盖并剥离客户端自称的一切身份头」），adminRequest 带
    //       管理员会话时会把 ?anonId= 丢弃，7 次造数全落到同一管理员身份；
    //   (b) anon- 前缀：无会话时 claimed 非 anon 身份会被代理 403
    //      （hub-identity-guard.ts:22 ANON_PATTERN ^anon-[A-Za-z0-9_-]{8,64}$）。
    // 存储层按身份幂等（安装只在 !wasActive 时 +1，星标 ON CONFLICT DO
    // NOTHING，评价按 (plugin, identity) upsert），塌缩后 A/B/C/D 全是
    // {安装 1, 星标 1, 评价 1}，门禁与 popular/rating/trending 期望顺序必红。
    // 同一 request 上下文可复用于多个 anon 身份：匿名绑定 cookie 只在合并
    // 时校验，安装 / 星标 / 评分不校验 cookie 与 claimed 的一致（先例见
    // plugin-market.spec.ts:547，同一 request 发 3 个 reporter 身份）。
    const anon = (key: string, n: number) => `anon-e2e-sort-${SORT_STAMP}-${key}${n}`;
    // A：安装 3 · 星标 2 · 5★×2
    for (const n of [1, 2, 3]) await installAs(request, slugOf('a'), anon('a', n));
    for (const n of [1, 2]) await starAs(request, slugOf('a'), anon('a', n));
    for (const n of [1, 2]) await reviewAs(request, slugOf('a'), anon('a', n), 5);
    // B：安装 2 · 星标 1 · 5★×1
    for (const n of [1, 2]) await installAs(request, slugOf('b'), anon('b', n));
    await starAs(request, slugOf('b'), anon('b', 1));
    await reviewAs(request, slugOf('b'), anon('b', 1), 5);
    // C：安装 1 · 星标 1 · 4★×1
    await installAs(request, slugOf('c'), anon('c', 1));
    await starAs(request, slugOf('c'), anon('c', 1));
    await reviewAs(request, slugOf('c'), anon('c', 1), 4);
    // D：安装 1 · 星标 0 · 3★×1
    await installAs(request, slugOf('d'), anon('d', 1));
    await reviewAs(request, slugOf('d'), anon('d', 1), 3);

    // 3. 造数落账门禁：非零计数真的进了库，否则后续顺序断言无意义。
    const qs = new URLSearchParams({ q: SORT_STAMP, sort: 'popular', limit: '100' }).toString();
    const check = await adminRequest.get(`/api/hub/plugins?${qs}`);
    expect(check.ok(), `造数核对失败 ${check.status()}: ${await check.text()}`).toBeTruthy();
    const items = (await check.json()).items as Array<{
      slug: string;
      installCount: number;
      starCount: number;
      reviewCount: number;
      ratingAvg: number;
    }>;
    const bySlug = new Map(items.map((item) => [item.slug, item]));
    expect(items.length, `排序组应有 4 个插件，实得 ${items.length}`).toBe(4);
    const expectedCounts: Record<SortKey, { installCount: number; starCount: number; reviewCount: number; ratingAvg: number }> = {
      a: { installCount: 3, starCount: 2, reviewCount: 2, ratingAvg: 5 },
      b: { installCount: 2, starCount: 1, reviewCount: 1, ratingAvg: 5 },
      c: { installCount: 1, starCount: 1, reviewCount: 1, ratingAvg: 4 },
      d: { installCount: 1, starCount: 0, reviewCount: 1, ratingAvg: 3 },
    };
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      const got = bySlug.get(slugOf(key));
      expect(got, `排序插件 ${key} 未在列表 API 中找到`).toBeTruthy();
      expect(got!.installCount, `${key} 安装数`).toBe(expectedCounts[key].installCount);
      expect(got!.starCount, `${key} 星标数`).toBe(expectedCounts[key].starCount);
      expect(got!.reviewCount, `${key} 评价数`).toBe(expectedCounts[key].reviewCount);
      expect(got!.ratingAvg, `${key} 均分`).toBe(expectedCounts[key].ratingAvg);
    }
  });
  test.afterAll(async () => {
    await adminContext?.close().catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(`[BROWSER ${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.log(`[PAGE ERROR]`, err));
    page.on('response', async (res) => {
      if (!res.ok() && res.url().includes('/api/')) {
        let body = '';
        try { body = await res.text(); } catch {}
        console.log(`[API ERROR ${res.status()}] ${res.url()} => ${body.slice(0, 200)}`);
      }
    });
  });

  /** 同一 sort 下：UI 顺序 == API 顺序 == 设计期望顺序，并确认无退化注明。 */
  async function expectSortOrder(
    page: Page,
    request: APIRequestContext,
    sort: string,
    expected: SortKey[],
  ) {
    const expectedSlugs = expected.map(slugOf);
    await page.goto(`/marketplace?q=${SORT_STAMP}&sort=${sort}`);
    // 先等列表到达（首个卡片标题链可见），再读顺序：SSR 首帧与客户端
    // 静默重取之间顺序一致，但读数必须发生在取数完成后。
    await expect(page.getByRole('link', { name: SORT_PLUGINS[0].name }).first()).toBeVisible({ timeout: 30_000 });
    // 非零数据：计数型排序的退化注明不应出现。
    await expect(page.getByTestId('sort-degenerate-note')).toHaveCount(0);
    await expect
      .poll(async () => uiSlugs(page, `e2e-sort-${SORT_STAMP}-`), { timeout: 30_000 })
      .toEqual(expectedSlugs);
    // UI 顺序与同条件 API 顺序一致（列表与后端同源）。
    const apiOrder = await apiSlugs(request, { q: SORT_STAMP, sort });
    expect(apiOrder).toEqual(expectedSlugs);
  }

  test('popular 排序：安装最多在前（A>B>C>D），与 API 一致', async ({ page, request }) => {
    await expectSortOrder(page, request, 'popular', ['a', 'b', 'c', 'd']);
  });

  test('rating 排序：评分最高在前（A>B>C>D），与 API 一致', async ({ page, request }) => {
    await expectSortOrder(page, request, 'rating', ['a', 'b', 'c', 'd']);
  });

  test('new 排序：最新发布在前（D>C>B>A），与 API 一致', async ({ page, request }) => {
    await expectSortOrder(page, request, 'new', ['d', 'c', 'b', 'a']);
  });

  test('trending 排序：7 天飙升在前（A>B>C>D），与 API 一致', async ({ page, request }) => {
    await expectSortOrder(page, request, 'trending', ['a', 'b', 'c', 'd']);
  });

  test('榜单一致：安装榜 / 口碑榜首行是 A，新作榜首行是 D', async ({ page }) => {
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    // 榜单区是无筛选时才渲染的 grid section（精选区是 space-y-3，不会误取）。
    const rankings = page.locator('main section.grid');
    await expect(rankings).toHaveCount(1);
    const groups = rankings.locator(':scope > div');
    await expect(groups.nth(0)).toContainText('安装榜');
    await expect(groups.nth(1)).toContainText('口碑榜');
    await expect(groups.nth(2)).toContainText('新作榜');
    const firstHref = async (index: number) =>
      groups.nth(index).locator('ol li a').first().getAttribute('href');
    await expect.poll(() => firstHref(0), { timeout: 30_000 }).toBe(`/marketplace/${slugOf('a')}`);
    await expect.poll(() => firstHref(1), { timeout: 30_000 }).toBe(`/marketplace/${slugOf('a')}`);
    await expect.poll(() => firstHref(2), { timeout: 30_000 }).toBe(`/marketplace/${slugOf('d')}`);
  });

  test('kind 筛选：每种类型只返回该类型的真实结果集', async ({ page }) => {
    const kindPlugins = [
      { key: 'pack1', kind: 'site-pack', slug: `e2e-kind-${KIND_STAMP}-pack1`, name: `E2E 种类包壹 ${KIND_STAMP}` },
      { key: 'pack2', kind: 'site-pack', slug: `e2e-kind-${KIND_STAMP}-pack2`, name: `E2E 种类包贰 ${KIND_STAMP}` },
      { key: 'theme1', kind: 'theme', slug: `e2e-kind-${KIND_STAMP}-theme1`, name: `E2E 种类主题 ${KIND_STAMP}` },
      { key: 'search1', kind: 'search-pack', slug: `e2e-kind-${KIND_STAMP}-search1`, name: `E2E 种类搜索包 ${KIND_STAMP}` },
    ] as const;
    const slugByKey = (key: string) => kindPlugins.find((p) => p.key === key)!.slug;

    for (const plugin of kindPlugins) {
      const manifest: Record<string, unknown> =
        plugin.kind === 'theme'
          ? {
              manifestVersion: 1,
              kind: 'theme',
              name: plugin.name,
              description: 'Playwright kind 筛选测试专用主题',
              version: '1.0.0',
              tags: ['e2e'],
              payload: {
                accent: 'rose',
                tokens: { '--primary': '336 90% 65%', '--ring': '336 90% 65%', '--radius': '0.75rem' },
              },
            }
          : plugin.kind === 'search-pack'
            ? {
                manifestVersion: 1,
                kind: 'search-pack',
                name: plugin.name,
                description: 'Playwright kind 筛选测试专用搜索引擎包',
                version: '1.0.0',
                tags: ['e2e'],
                payload: {
                  engines: [
                    {
                      prefix: `!kind${KIND_STAMP}`,
                      name: `E2E种类引擎 ${KIND_STAMP}`,
                      searchUrl: 'https://e2e-kind.example.com/search?q={q}',
                      description: 'kind 筛选用引擎',
                    },
                  ],
                },
              }
            : sitePackManifest(plugin.name, `${KIND_STAMP}-${plugin.key}`);
      await importPlugin(adminRequest, plugin.slug, manifest);
    }

    await page.goto(`/marketplace?q=${KIND_STAMP}`);
    await expect(page.getByRole('link', { name: kindPlugins[0].name }).first()).toBeVisible({ timeout: 30_000 });
    // 未筛选：4 个全在。
    await expect
      .poll(async () => uiSlugs(page, `e2e-kind-${KIND_STAMP}-`), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(kindPlugins.map((p) => p.slug)));
    await expect(page.getByText('共 4 个插件')).toBeVisible();

    const kindSelect = page.getByLabel('按类型筛选');
    // 主题：只剩 theme1。
    await selectKind(page, 'theme');
    await expect
      .poll(async () => uiSlugs(page, `e2e-kind-${KIND_STAMP}-`), { timeout: 30_000 })
      .toEqual([slugByKey('theme1')]);
    await expect(page.getByText('共 1 个插件')).toBeVisible();
    await expect(page.getByRole('link', { name: kindPlugins[0].name })).toHaveCount(0);

    // 网站包：pack1 + pack2（集合相等，顺序不做断言：两者计数全 0，trending
    // 只剩时间项，顺序由导入先后决定，不属于筛选契约）。
    // P2-13 已把 site-pack 移出下拉（种子为 0 时是死入口），下拉里根本
    // 没有该选项，selectOption('site-pack') 永远找不到（run 44125548782
    // 重试即烧掉整个 90s 预算死在这里）；但地址栏契约仍支持
    // ?kind=site-pack（board 注释：仍可解析、可清除），改走深链直达。
    // 直达后的 toHaveURL 不是空断言：若 board 不认 kind，URL 同步
    // effect 会把它写掉。
    await page.goto(`/marketplace?q=${KIND_STAMP}&kind=site-pack`);
    await expect(page.getByRole('link', { name: kindPlugins[0].name }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]kind=site-pack/);
    await expect
      .poll(async () => (await uiSlugs(page, `e2e-kind-${KIND_STAMP}-`)).sort(), { timeout: 30_000 })
      .toEqual([slugByKey('pack1'), slugByKey('pack2')].sort());
    await expect(page.getByText('共 2 个插件')).toBeVisible();
    await expect(page.getByRole('link', { name: kindPlugins[2].name })).toHaveCount(0);

    // 搜索引擎包：只剩 search1。
    await selectKind(page, 'search-pack');
    await expect
      .poll(async () => uiSlugs(page, `e2e-kind-${KIND_STAMP}-`), { timeout: 30_000 })
      .toEqual([slugByKey('search1')]);
    await expect(page.getByText('共 1 个插件')).toBeVisible();

    // 回到全部类型：4 个全回来。
    await kindSelect.selectOption('');
    await expect
      .poll(async () => (await uiSlugs(page, `e2e-kind-${KIND_STAMP}-`)).sort(), { timeout: 30_000 })
      .toEqual(kindPlugins.map((p) => p.slug).sort());
    await expect(page.getByText('共 4 个插件')).toBeVisible();
  });

  test('分页：点「加载更多」后条目增多', async ({ page }) => {
    // 自给自足：CI E2E 库从空开始（e2e-web-server.mjs 只删库重建、dev-all
    // 不播种，pnpm seed 只在 test-web 作业跑），同分片先行导入 + 本文件
    // 自身导入合计约 10 个 < 24，「加载更多」根本不会出现。本用例内先
    // 导入 25 个同 stamp 插件，再按该 stamp 过滤断言，总数只取决于本次
    // 导入，不依赖既有数据量。stamp 在用例内现取：重试时换新 stamp，避免
    // 复用已导入的 slug。
    const pageStamp = Date.now().toString(36);
    for (let i = 0; i < 25; i++) {
      await importPlugin(
        adminRequest,
        `e2e-page-${pageStamp}-${i}`,
        sitePackManifest(`E2E 分页 ${pageStamp} ${i}`, `${pageStamp}-${i}`),
      );
    }

    await page.goto(`/marketplace?q=${pageStamp}`);
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    // 按钮只在「已加载 < 总数」时出现：等它出现即等客户端首屏（24 条）落定，
    // 此时 SSR 全量种子已被 24 条/页的客户端列表取代。过滤视图下精选与三榜
    // 不渲染（board 只在无筛选时加载），卡片数即列表数。
    const loadMore = page.getByRole('button', { name: /加载更多/ });
    await expect(loadMore).toBeVisible({ timeout: 30_000 });
    const beforeText = (await loadMore.textContent()) ?? '';
    const beforeMatch = beforeText.match(/(\d+)\s*\/\s*(\d+)/);
    expect(beforeMatch, `加载更多文案未含计数：${beforeText}`).toBeTruthy();
    const beforeShown = Number(beforeMatch![1]);
    const beforeTotal = Number(beforeMatch![2]);
    expect(beforeShown, '首屏应只加载一页 24 条').toBe(24);
    expect(beforeTotal, '总数应大于一页').toBeGreaterThan(24);

    // 卡片标题链计数（过滤视图无精选区，卡片数即列表数）：点击后必须增多。
    const cardLinks = page.locator('main a[aria-label][href^="/marketplace/"]');
    const cardsBefore = await cardLinks.count();
    expect(cardsBefore, '首屏卡片数').toBeGreaterThanOrEqual(beforeShown);

    await loadMore.click();
    await expect
      .poll(async () => cardLinks.count(), { timeout: 30_000 })
      .toBeGreaterThan(cardsBefore);

    // 按钮计数同步变大；若总数 ≤ 48，按钮在加载完后消失，同样是正确终态。
    const afterCount = await cardLinks.count();
    expect(afterCount).toBeLessThanOrEqual(cardsBefore + 24);
    if (await loadMore.isVisible().catch(() => false)) {
      const afterText = (await loadMore.textContent()) ?? '';
      const afterMatch = afterText.match(/(\d+)\s*\/\s*(\d+)/);
      expect(afterMatch, `加载后文案未含计数：${afterText}`).toBeTruthy();
      expect(Number(afterMatch![1]), '加载更多后已显示条数应变大').toBeGreaterThan(beforeShown);
    } else {
      // 按钮消失 = 已全部加载：显示数应等于总数。
      expect(afterCount).toBeGreaterThanOrEqual(beforeTotal);
    }
  });
});
