import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { loginViaAdmin } from './helpers';

/**
 * Phase 2 批 A e2e：搜索范围 + 排序注明 + 空态下一步 + !gh bang。
 *
 * 口径说明（2026-11-17 实测修正）：搜「翻译」在当前种子上得 0 是正确的——
 * 没有任何插件清单含「翻译」（旧本地库才有含 DeepL Write 的网址包）。
 * 真正的搜索 bug 由只在清单里出现过的词证明（DuckDuckGo / GitHub /
 * bundlephobia），本文件用现造的同类词（E2EDuckEngine / E2EOnlyInPayload）
 * 在空 e2e 库里复现同一机制。
 */
test.describe('插件市场 Phase 2 批 A：搜索、排序注明、空态、bang', () => {
  test.describe.configure({ retries: 1 });

  let adminRequest: APIRequestContext;
  let adminContext: BrowserContext | undefined;
  // 自造数据的 stamp：排序注明用例用 ?q=<stamp> 把断言收窄到这 2 个包，
  // 不再依赖「全库全 0」（U-141：同分片 p3-5 / sorting 造出带安装量的
  // 插件后，无筛选全量列表的注明前提即被打破）。
  let stamp = '';
  test.beforeAll(async ({ browser }, testInfo) => {
    adminContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    await loginViaAdmin(await adminContext.newPage());
    adminRequest = adminContext.request;

    // 登录与导入必须在同一个 beforeAll：分开写时登录失败只会让 adminRequest
    // 保持 undefined，导入处报误导的 TypeError（实测教训）。
    stamp = Date.now().toString(36);
    // 搜索引擎包：引擎名 E2EDuckEngine 只在清单里，不在名称/简介/slug 里
    const searchPack = await adminRequest.post('/api/hub/plugins/import', {
      data: {
        slug: `e2e-phase2a-search-${stamp}`,
        manifest: {
          manifestVersion: 1,
          kind: 'search-pack',
          name: `E2E 搜索范围包 ${stamp}`,
          description: '仅用于 Phase 2 批 A 搜索范围测试',
          version: '1.0.0',
          tags: ['搜索'],
          payload: {
            engines: [
              { name: 'E2EDuckEngine', prefix: '!e2e', searchUrl: 'https://e2e-duck.example.com/search?q={q}' },
            ],
          },
        },
      },
    });
    expect(searchPack.ok(), `搜索包导入失败 ${searchPack.status()}: ${await searchPack.text()}`).toBeTruthy();
    // 网址包：站点标题 E2EOnlyInPayload 只在清单里；带「主题」标签供空态推荐词点击验证
    const sitePack = await adminRequest.post('/api/hub/plugins/import', {
      data: {
        slug: `e2e-phase2a-site-${stamp}`,
        manifest: {
          manifestVersion: 1,
          kind: 'site-pack',
          name: `E2E 站点名包 ${stamp}`,
          description: '仅用于 Phase 2 批 A 搜索范围测试',
          version: '1.0.0',
          tags: ['主题', '测试'],
          payload: {
            categories: [{ title: 'E2E 类目' }],
            sites: [{ url: 'https://e2e-only-in-payload.example.com', title: 'E2EOnlyInPayload' }],
          },
        },
      },
    });
    expect(sitePack.ok(), `网址包导入失败 ${sitePack.status()}: ${await sitePack.text()}`).toBeTruthy();
  });
  test.afterAll(async () => {
    await adminContext?.close().catch(() => {});
  });

  test('搜索范围：只在清单里的引擎名 / 站点名能搜到', async ({ page }) => {
    await page.goto('/marketplace?q=E2EDuckEngine');
    await expect(page.getByText(/E2E 搜索范围包/, { exact: false }).first()).toBeVisible();

    await page.goto('/marketplace?q=E2EOnlyInPayload');
    await expect(page.getByText(/E2E 站点名包/, { exact: false }).first()).toBeVisible();
  });

  test('排序注明：计数型排序在全 0 时如实注明与最新发布一致', async ({ page }) => {
    // 作用域收窄到自造数据：只断言 ?q=<stamp> 过滤后的列表（本文件
    // beforeAll 导入的 2 个 0 安装包）。无筛选全量列表的前提是「全库
    // 全 0」，同分片其他 spec（如 p3-5 的 3 个安装量 1 的插件、sorting
    // 的安装 3/2/1/1）一落账就打破（U-141）。注明判定只看当前列表
    // （countSortDegenerateKind），过滤视图同样出注明，文案口径也是
    // 「当前列表」——收窄后断言的仍是同一行为，只是换了作用域。
    await page.goto(`/marketplace?q=${stamp}&sort=popular`);
    // 作用域自检：过滤后只能是自造的 2 个包；数对不上说明 q 漏网或撞 stamp。
    await expect(page.getByText('共 2 个插件')).toBeVisible();
    await expect(page.getByTestId('sort-degenerate-note')).toBeVisible();
    await expect(page.getByTestId('sort-degenerate-note')).toContainText('均为 0');
  });

  test('空态 K18：范围说明 + 推荐词可点 + 相关插件 + 一键清除', async ({ page }) => {
    await page.goto('/marketplace?q=不存在的词-zzz-phase2a');
    await expect(page.getByText('没有匹配的插件，换个筛选条件试试')).toBeVisible();
    await expect(page.getByText(/搜索范围：插件名称、描述、包内站点与引擎名/)).toBeVisible();
    await expect(page.getByText('换个词试试：')).toBeVisible();
    await expect(page.getByTestId('empty-related')).toBeVisible();
    await expect(page.getByText('相关插件')).toBeVisible();

    // 推荐词 chips：点 #主题 → 该标签的插件出现（导入的网址包带「主题」标签）
    await page.getByText('#主题', { exact: true }).last().click();
    await expect(page.getByText(/E2E 站点名包/, { exact: false }).first()).toBeVisible();

    // 一键清除：回到无筛选列表
    await page.goto('/marketplace?q=不存在的词-zzz-phase2a');
    await expect(page.getByTestId('empty-clear-filters')).toBeVisible();
    await page.getByTestId('empty-clear-filters').click();
    await expect(page.getByText(/E2E 站点名包/, { exact: false }).first()).toBeVisible();
  });

  test('bang：首页搜索面板输 !gh react 出现直达建议行', async ({ page }) => {
    // 首页重、O2M 压力下 load 事件常超时：输入框是 SSR 直出的，等 domcontentloaded
    // + 输入框可见即可测「输入 !gh react → omni 行」这一行为，不必等整页 load。
    test.setTimeout(180_000)
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const searchInput = page.getByPlaceholder(/搜索(导航|站点)/);
    await expect(searchInput).toBeVisible({ timeout: 60_000 });
    await searchInput.fill('!gh react');
    // Batch 1（f3f68008）后直达建议行是 quicklink 横幅（源码注释写明「命中时 OMNI 横幅让位」）：
    // 旧断言的 OMNI 行文案「按 Enter 直达外部搜索：」/ 裸词 'react' / github 锚链自此不再渲染——
    // OMNI 行被 `quicklinkMatch.kind !== 'hit'` 门挡住，对内置前缀恒不可达（U-363 余项根因）；
    // 行为本身正确（横幅在、回车直达），故断言按现行横幅契约重写，标题与意图不变。
    const banner = page.getByRole('button', { name: /在 GitHub 搜索/ });
    await expect(banner).toBeVisible();
    await expect(banner.getByText('"react"', { exact: true })).toBeVisible();
    // 「回车直达」是横幅 <button> 的兄弟 <span>（不在 button 内），且结果列表里另有一处同文案；
    // 以 button 的父级横幅行（px-3.5 bg-primary/10）为作用域断言，避开 strict mode 多匹配。
    await expect(banner.locator('xpath=..').getByText('回车直达')).toBeVisible();
    // 行为断言：回车直达外部搜索——新标签页即 github 搜索地址（横幅是 <button>，
    // 无 href 锚链可断言，故以 popup URL 为准，比「存在一个 href」更强）。
    // 外跳目标是 github 外站：本 VM 浏览器无代理、直连失败瞬间落到 chrome-error 页
    // （连 popup.url() 即读都已是 chrome-error；curl 经代理是 200），CI 有外网则能直达。
    // 为让断言只验「开的是什么地址」而不依赖外站可达性，用 context.route 把这次
    // github 搜索导航本地 fulfill（URL 保持不变），popup 正常落到目标地址。
    await page.context().route(/github\.com\/search\?q=react/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
    );
    const popupPromise = page.waitForEvent('popup');
    await searchInput.press('Enter');
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/github\.com\/search\?q=react/);
    await popup.close();
  });
});
