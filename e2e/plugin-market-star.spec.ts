import { test, expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { loginViaAdmin } from './helpers';

/**
 * 星标点按端到端（P1-8）：卡片 / 详情页点星标 → 星标态与计数变化 →
 * /marketplace?starred=1 看到它 → 取消星标 → 星标列表里消失。
 *
 * 只做行为断言（点按、按钮态、计数、列表内容），不用源码文本断言。
 * 星标接口与状态以现有实现为准（plugin-card.tsx / plugin-detail-view.tsx：
 * aria-label「点亮星标」/「取消星标」、aria-pressed、计数；plugin-market-board.tsx：
 * 「只看已星标插件」开关与 ?starred=1 双向同步，星标空态「你还没有星标任何插件」）。
 *
 * 注意：列表的 onStatusChange 只原地改态、不摘卡——星标列表里取消星标后
 * 卡片当场仍在（变回未星标态），必须重新加载 ?starred=1 才断言它消失。
 * 身份是浏览器本地匿名身份（localStorage anonId）：同一用例内点星与
 * 查星标列表是同一 page，身份一致；每个用例拿全新 context，互不污染。
 */

function sitePackManifest(name: string, stamp: string) {
  return {
    manifestVersion: 1,
    kind: 'site-pack',
    name,
    description: 'Playwright 端到端测试自动生成的网址包（可安全清理）',
    version: '1.0.0',
    tags: ['e2e'],
    payload: {
      categories: [{ title: `E2E 分类 ${stamp}` }],
      sites: [
        {
          url: `https://e2e-star-${stamp}.example.com`,
          title: `E2E 示例站 ${stamp}`,
          category: `E2E 分类 ${stamp}`,
          tags: ['e2e'],
        },
      ],
    },
  };
}

/**
 * 点按星标并等服务端落账。
 *
 * 先注册响应监听再点：导航会中断在途请求，必须确认 POST/DELETE
 * /plugins/:slug/star 已回包才离开当前页，否则星标可能没落库。
 * 冷启动水合竞态导致首击丢失时补击一次（与 plugin-market.spec.ts 的
 * clickInstallAndAwaitToast 同款）；响应监听超时则放过——随后进
 * ?starred=1 的列表断言本身就是落账的 ground truth。
 */
async function toggleStar(
  page: Page,
  scope: Page | Locator,
  slug: string,
  method: 'POST' | 'DELETE',
) {
  const before = method === 'POST' ? '点亮星标' : '取消星标';
  const after = method === 'POST' ? '取消星标' : '点亮星标';
  const pressed = method === 'POST' ? 'true' : 'false';
  const expectedCount = method === 'POST' ? '1' : '0';
  const settled = page
    .waitForResponse(
      (res) =>
        res.url().includes(`/plugins/${slug}/star`) && res.request().method() === method,
      { timeout: 15_000 },
    )
    .catch(() => null);
  await scope.getByRole('button', { name: before, exact: true }).click();
  try {
    await expect(scope.getByRole('button', { name: after, exact: true })).toBeVisible({ timeout: 10_000 });
  } catch {
    // 水合前点击丢失：按钮仍是旧态，补击一次
    await scope.getByRole('button', { name: before, exact: true }).click().catch(() => {});
    await expect(scope.getByRole('button', { name: after, exact: true })).toBeVisible({ timeout: 10_000 });
  }
  const afterButton = scope.getByRole('button', { name: after, exact: true });
  await expect(afterButton).toHaveAttribute('aria-pressed', pressed);
  await expect(afterButton).toContainText(expectedCount);
  await settled;
}

/** 按插件名定位它在列表里的卡片（与 admin 侧用例同款 div.rounded-2xl 圈定）。 */
function pluginCard(page: Page, name: string): Locator {
  return page.locator('div.rounded-2xl').filter({ hasText: name }).first();
}

/** 进星标列表并断言插件在其中（筛选开关态 + 地址栏 + 列表内容三重确认）。 */
async function expectInStarredList(page: Page, name: string) {
  await page.goto('/marketplace?starred=1');
  await expect(page).toHaveURL(/[?&]starred=1/);
  await expect(page.getByRole('button', { name: '只看已星标插件' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** 重新加载星标列表并断言插件已消失（先等空态出现，再断言名字不在——避免加载中误判）。 */
async function expectGoneFromStarredList(page: Page, name: string) {
  await page.goto('/marketplace?starred=1');
  await expect(page.getByText('你还没有星标任何插件')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(name, { exact: true })).not.toBeVisible();
}

test.describe('插件市场：星标点按端到端', () => {
  test.describe.configure({ retries: 1 });

  let adminRequest: APIRequestContext;
  let adminContext: BrowserContext | undefined;
  test.beforeAll(async ({ browser }, testInfo) => {
    adminContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    await loginViaAdmin(await adminContext.newPage());
    adminRequest = adminContext.request;
  });
  test.afterAll(async () => {
    await adminContext?.close().catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER ${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.log(`[PAGE ERROR]`, err));
    page.on('response', async res => {
      if (!res.ok() && res.url().includes('/api/')) {
        let body = '';
        try { body = await res.text(); } catch {}
        console.log(`[API ERROR ${res.status()}] ${res.url()} => ${body.slice(0, 200)}`);
      }
    });
  });

  test('卡片点星 → 星标态与计数变化 → ?starred=1 可见 → 取消星标 → 列表里消失', async ({ page }) => {
    test.setTimeout(180_000);
    const stamp = Date.now().toString(36);
    const name = `E2E 星标包 ${stamp}`;
    const slug = `e2e-star-${stamp}`;

    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(name, stamp), slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 列表页：搜索定位到刚导入的插件，卡片初始未星标（计数 0）
    await page.goto(`/marketplace?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    const card = pluginCard(page, name);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole('button', { name: '点亮星标', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(card.getByRole('button', { name: '点亮星标', exact: true })).toContainText('0');

    // 卡片点星：按钮翻为「取消星标」、aria-pressed=true、计数 1
    await toggleStar(page, card, slug, 'POST');

    // 星标列表里看到它
    await expectInStarredList(page, name);

    // 星标列表里取消星标：按钮翻回「点亮星标」、aria-pressed=false、计数 0
    const starredCard = pluginCard(page, name);
    await expect(starredCard).toBeVisible({ timeout: 30_000 });
    await toggleStar(page, starredCard, slug, 'DELETE');

    // 重新加载星标列表：插件消失、星标空态出现
    await expectGoneFromStarredList(page, name);
  });

  test('详情页点星 → 星标态与计数变化 → ?starred=1 可见 → 详情页取消星标 → 列表里消失', async ({ page }) => {
    test.setTimeout(180_000);
    const stamp = Date.now().toString(36);
    const name = `E2E 星标详情包 ${stamp}`;
    const slug = `e2e-star-detail-${stamp}`;

    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(name, stamp), slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 详情页：初始未星标（按钮文案「星标」、计数 0）
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
    await expect(page.getByRole('button', { name: '点亮星标', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: '点亮星标', exact: true })).toContainText('0');

    // 详情页点星：按钮翻为「已星标」、aria-pressed=true、计数 1
    await toggleStar(page, page, slug, 'POST');
    await expect(page.getByRole('button', { name: '取消星标', exact: true })).toContainText('已星标');

    // 星标列表里看到它
    await expectInStarredList(page, name);

    // 回详情页取消星标：按钮翻回「星标」、aria-pressed=false、计数 0
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
    await toggleStar(page, page, slug, 'DELETE');
    await expect(page.getByRole('button', { name: '点亮星标', exact: true })).toContainText('星标');

    // 重新加载星标列表：插件消失、星标空态出现
    await expectGoneFromStarredList(page, name);
  });
});
