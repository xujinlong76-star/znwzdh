import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { loginViaAdmin } from './helpers';

/**
 * P3-11：Taps / 短链 / AI 生成 / 预览路由 / 防抖零 E2E —— 按风险补端到端。
 *
 * 风险顺序（范围审计 W5）：
 *   ① 短链跳转最高（分享链路用户外发）：详情页/列表卡片「复制短链」→ /s/<code> 302
 *      → 落详情（install=1 弹安装确认）→ 点击数累计；失效码 → /marketplace?shortlink=invalid 提示。
 *   ② 预览路由次高：作者 pending 态进 /preview 看刚提交版本、匿名被 API 门禁挡下、
 *      管理员可见、?preview=1 旧链 302 到 /preview。
 *   ③ Taps：市场 hero「Taps 订阅源」入口开弹窗，添加 / 两步删除 / 同步失败全链路。
 *   ④ 防抖提交：只输不按回车 → 150ms 后列表过滤 + 地址栏写 ?q=；连续输入只提交最后一次。
 *   ⑤ AI 生成：只走 page.route 桩（一次性 fulfill canned manifest），覆盖 prompt → 清单
 *      → sandbox 渲染 → Diff → 体检；不真调 LLM（E2E 环境无 key，服务端必回 400 config，
 *      另有 10 次/分钟限流与 60s 超时）。桩只隔离模型调用，桩后的点击/渲染/断言全是真实链路。
 *   ⑥ q+kind：并入④——框内打字 q（走防抖）+ 再选 kind，kind 切换后 q 保留在地址栏。
 *
 * 造数口径（基建核查 W7）：每轮 E2E 从空库开始，global-setup 只建目录、不 seed、不登录；
 * 本文件所有数据都自己造——已上架插件走管理员 POST /api/hub/plugins/import，
 * 待审插件走匿名 POST /api/hub/plugins（anon- 前缀身份），每次运行时间戳唯一命名。
 *
 * 未覆盖（写明原因）：
 *   - Taps 同步成功进目录：同步要服务端 guardedFetch 拉取远端清单，SSRF 守卫拦 127.0.0.1/
 *     内网（tap-sync-import.test.ts:13），E2E 里没有可达的公开清单宿主；导入逻辑本身由
 *     API 层单测 tap-sync-import.test.ts 覆盖。本文件只覆盖同步失败分支（example.com 回
 *     HTML → JSON 解析失败 → toast 报「获取订阅源失败」；无外网时 DNS 失败同样走该分支）。
 *   - 精选推荐源（Featured Taps）：2026-11-10 审计实测三条外链全 404 后已摘除，
 *     FEATURED_TAPS 现为空数组，UI 上无该区块可点。
 *   - 真 LLM 生成：见⑤，不确定 + 耗 quota，E2E 不做。
 *
 * 本地无系统 Chrome，真跑只走 CI；不要裸跑 playwright test。
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
          url: `https://e2e-${stamp}.example.com`,
          title: `E2E 示例站 ${stamp}`,
          category: `E2E 分类 ${stamp}`,
          tags: ['e2e'],
        },
      ],
    },
  };
}

function themeManifest(name: string, stamp: string) {
  return {
    manifestVersion: 1,
    kind: 'theme',
    name,
    description: 'Playwright 端到端测试专用主题',
    version: '1.0.0',
    tags: ['theme', 'e2e'],
    payload: {
      accent: 'violet',
      tokens: {
        '--primary': '262 83% 58%',
        '--ring': '262 83% 58%',
        '--radius': '0.85rem',
      },
    },
  };
}

const ANON_ID_KEY = 'navhub.anonId';

test.describe('P3-11：短链 / 预览路由 / Taps / 防抖 / AI 生成', () => {
  // 含发布动作（/api/hub/plugins 30 次/小时）与短链创建（30 次/小时）：
  // 重试上限收紧为 1，避免重试打满限流后污染结果。
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

  async function importPublished(manifest: Record<string, unknown>, slug: string) {
    const imported = await adminRequest.post('/api/hub/plugins/import', {
      data: { manifest, slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();
  }

  const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

  /**
   * ?install=1 落地即弹安装确认（D4）。冷启动水合竞态下弹窗可能未自动出现，
   * 未出现时轮询补击「立即安装该插件」直至弹窗出现（与 plugin-market.spec.ts 同口径）。
   */
  async function expectInstallDialog(page: Page, name: string) {
    const dialog = page.getByRole('dialog');
    try {
      await expect(dialog).toBeVisible({ timeout: 15_000 });
    } catch {
      await expect
        .poll(
          async () => {
            if (await dialog.isVisible().catch(() => false)) return true;
            await page
              .getByRole('button', { name: '立即安装该插件' })
              .click({ timeout: 3_000 })
              .catch(() => {});
            return dialog.isVisible().catch(() => false);
          },
          { timeout: 30_000, intervals: [1_000] },
        )
        .toBe(true);
    }
    await expect(dialog.getByText(`确认安装「${name}」`)).toBeVisible();
  }

  test('短链①：详情页分享复制短链 → /s/<code> 302 落详情并弹安装确认 → 点击数累计', async ({
    page,
    request,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const stamp = Date.now().toString(36);
    const name = `E2E 短链包 ${stamp}`;
    const slug = `e2e-shortlink-${stamp}`;
    await importPublished(sitePackManifest(name, stamp), slug);

    // 详情页点「分享」：优先建站内短链，剪贴板拿到的是 /s/<code> 而非长链
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);
    await page.getByRole('button', { name: '复制带安装引导的分享链接' }).click();
    await expect(page.getByRole('button', { name: '分享链接已复制' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => readClipboard(page), { timeout: 10_000 }).toContain('/s/');
    const copied = await readClipboard(page);
    const code = copied.match(/\/s\/([A-Za-z0-9]+)/)?.[1];
    expect(code, `剪贴板未含短链码：${copied}`).toBeTruthy();

    // 创建时点击数为 0（解析才累计）；访问一次短链后 +1
    const before = await request.get(`/api/shortlinks/${code}`);
    expect(before.ok(), `短链解析失败 ${before.status()}`).toBeTruthy();
    expect((await before.json()).clicks).toBe(0);

    // 302 跳转：落到带 install=1 的详情页并自动弹出安装确认
    await page.goto(copied);
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}\\?install=1`));
    await expectInstallDialog(page, name);

    const after = await request.get(`/api/shortlinks/${code}`);
    expect(after.ok()).toBeTruthy();
    expect((await after.json()).clicks).toBeGreaterThanOrEqual(1);
  });

  test('短链②：列表卡片复制短链 → /s/<code> 落详情', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const stamp = Date.now().toString(36);
    const name = `E2E 卡片短链包 ${stamp}`;
    const slug = `e2e-card-shortlink-${stamp}`;
    await importPublished(sitePackManifest(name, stamp), slug);

    // q 深链只留这一张卡片，卡片分享按钮不再需要按卡片定位
    await page.goto(`/marketplace?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '复制安装分享链接' }).first().click();
    // 卡片按钮无复制态切换（只有 toast 反馈），剪贴板读回才是 ground truth
    await expect(page.getByText('分享链接已复制')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => readClipboard(page), { timeout: 10_000 }).toContain('/s/');
    const copied = await readClipboard(page);
    expect(copied).toMatch(/\/s\/[A-Za-z0-9]+$/);

    await page.goto(copied);
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}`));
    await expect(page.locator('h1').first()).toContainText(name);
  });

  test('短链③：失效码 → /marketplace?shortlink=invalid 提示', async ({ page }) => {
    // 查无此码（走中枢解析 404 分支，不是码格式非法分支）
    await page.goto('/s/e2eNoSuch000');
    await expect(page).toHaveURL(/\/marketplace\?shortlink=invalid/);
    const notice = page.getByTestId('shortlink-invalid-notice');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText('这个短链接打不开了');
    await expect(notice).toContainText('它可能已失效或过期');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
  });

  test('预览路由：作者 pending 可见、匿名被挡、管理员可见、?preview=1 302 到 /preview', async ({
    page,
    request,
    browser,
  }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 预览包 ${stamp}`;
    const ownerId = `anon-e2e-owner-${stamp}`;

    // 匿名投稿进 pending 待审队列（F0：发布必须带作者身份）
    const published = await request.post(`/api/hub/plugins?anonId=${ownerId}`, {
      data: { manifest: sitePackManifest(name, stamp) },
    });
    expect(published.ok(), `发布失败 ${published.status()}: ${await published.text()}`).toBeTruthy();
    const slug = (await published.json()).slug as string;
    expect(slug, '发布回包无 slug').toBeTruthy();

    // 1) 匿名：裸详情与 /preview 都被 API 门禁挡下（404 文案，不是故障态）
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByText('插件未上架或不存在')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/marketplace/${slug}/preview`);
    await expect(page.getByText('插件未上架或不存在')).toBeVisible({ timeout: 30_000 });

    // 2) 旧 ?preview=1 链：服务端 302 到 /preview（匿名仍看 404，只验路由去向）
    await page.goto(`/marketplace/${slug}?preview=1`);
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}/preview$`));
    await expect(page.getByText('插件未上架或不存在')).toBeVisible();

    // 3) 作者（localStorage  anonId 与投稿身份一致）：/preview 看到刚提交的版本，
    //    裸详情同样可见——门禁认身份不认路由
    const ownerContext = await browser.newContext();
    try {
      await ownerContext.addInitScript((anonId: string) => {
        try {
          window.localStorage.setItem('navhub.anonId', anonId);
        } catch {
          // about:blank 等不透明源写存储会抛，不影响后续同源页面
        }
      }, ownerId);
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`/marketplace/${slug}/preview`);
      await expect(ownerPage.getByRole('heading', { level: 1 }).first()).toContainText(name, {
        timeout: 30_000,
      });
      await ownerPage.goto(`/marketplace/${slug}`);
      await expect(ownerPage.getByRole('heading', { level: 1 }).first()).toContainText(name, {
        timeout: 30_000,
      });
    } finally {
      await ownerContext.close().catch(() => {});
    }

    // 4) 管理员：/preview 可见
    await loginViaAdmin(page);
    await page.goto(`/marketplace/${slug}/preview`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name, {
      timeout: 30_000,
    });
  });

  test('Taps：弹窗添加 / 同步失败 / 两步删除全链路', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const tapName = `E2E Taps 源 ${stamp}`;
    const tapUrl = `https://example.com/e2e-taps-${stamp}.json`;

    await loginViaAdmin(page);
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Taps 订阅源' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('远程插件市场订阅源 (Remote Taps)')).toBeVisible({ timeout: 15_000 });

    // 非法 URL：行内错误留痕（不只靠瞬态 toast），且源不进列表
    await dialog.getByLabel('订阅源名称').fill(tapName);
    await dialog.getByLabel('订阅源 JSON 链接').fill('not-a-url');
    await dialog.getByRole('button', { name: '添加源' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('添加失败', { timeout: 15_000 });
    await expect(alert).toContainText('参数无效');

    // 回环地址：SSRF 守卫拒收，同样行内留痕
    await dialog.getByLabel('订阅源 JSON 链接').fill('http://127.0.0.1:9/e2e-taps.json');
    await dialog.getByRole('button', { name: '添加源' }).click();
    await expect(alert).toContainText('私有网络', { timeout: 15_000 });

    // 有效公网 URL：只做形状 + SSRF 校验就入库（添加时不拉取远端），列表出现
    await dialog.getByLabel('订阅源 JSON 链接').fill(tapUrl);
    await dialog.getByRole('button', { name: '添加源' }).click();
    await expect(page.getByText(/成功添加订阅源/).first()).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(tapName, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('市场内 0 个插件')).toBeVisible();

    // 同步：example.com 回 200 HTML，服务端 JSON 解析失败 → toast 如实报失败；
    // 无外网时 DNS 失败同样走「获取订阅源失败」分支（见文件头未覆盖说明）
    await dialog.getByRole('button', { name: '同步' }).click();
    await expect(page.getByText(/获取订阅源失败/).first()).toBeVisible({ timeout: 30_000 });
    // 失败不同步出插件：源仍在、计数仍为 0
    await expect(dialog.getByText(tapName, { exact: true })).toBeVisible();
    await expect(dialog.getByText('市场内 0 个插件')).toBeVisible();

    // 两步删除：先点垃圾桶出「确认移除」，再点才真删（防误删）
    await dialog.locator('button[title="移除此订阅源"]').click();
    await dialog.getByRole('button', { name: '确认移除' }).click();
    await expect(page.getByText(/已移除订阅源/).first()).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(tapName, { exact: true })).not.toBeVisible({ timeout: 15_000 });
  });

  test('防抖提交：不按回车过滤 + 只提交最后一次，q+kind 组合保留 q', async ({ page }) => {
    const themeStamp = Date.now().toString(36);
    const packStamp = `${themeStamp}x`;
    const themeName = `E2E 防抖主题 ${themeStamp}`;
    const packName = `E2E 防抖网址包 ${packStamp}`;
    await importPublished(themeManifest(themeName, themeStamp), `e2e-debounce-theme-${themeStamp}`);
    await importPublished(sitePackManifest(packName, packStamp), `e2e-debounce-pack-${packStamp}`);

    // 收集所有带 q 的取数请求：中间态 q 一次都不能发出
    const seenQ: string[] = [];
    page.on('request', (req) => {
      try {
        const q = new URL(req.url()).searchParams.get('q');
        if (q !== null) seenQ.push(q);
      } catch {
        // 非 http(s) URL（如 about:blank）无查询串，忽略
      }
    });

    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible({ timeout: 60_000 });
    const search = page.getByLabel('搜索插件');

    // 只输不按回车：先敲中间态、紧接着填满全名（两次输入间隔 < 150ms 防抖窗）
    await search.fill('E2E 防抖');
    await search.fill(themeName);
    // 150ms 防抖后：地址栏写回最终 q、列表按最终 q 过滤
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'), { timeout: 15_000 })
      .toBe(themeName);
    await expect(page.getByText(themeName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(packName, { exact: true })).toHaveCount(0);
    // 中间态 q 从未离开客户端（防抖合并），最终 q 确实发过一次取数
    expect(seenQ, `发出的 q 序列：${JSON.stringify(seenQ)}`).not.toContain('E2E 防抖');
    expect(seenQ).toContain(themeName);

    // q+kind 组合：选 kind=theme，q 保留在地址栏且结果仍是该主题
    await page.getByLabel('按类型筛选').selectOption('theme');
    await expect
      .poll(
        () => {
          const sp = new URL(page.url()).searchParams;
          return `${sp.get('q')}|${sp.get('kind')}`;
        },
        { timeout: 15_000 },
      )
      .toBe(`${themeName}|theme`);
    await expect(page.getByText(themeName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // kind 切到不匹配的类型：空态出现，但 q 仍保留在地址栏（筛选不丢条件）
    await page.getByLabel('按类型筛选').selectOption('search-pack');
    await expect(page.getByText('没有匹配的插件，换个筛选条件试试')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        () => {
          const sp = new URL(page.url()).searchParams;
          return `${sp.get('q')}|${sp.get('kind')}`;
        },
        { timeout: 15_000 },
      )
      .toBe(`${themeName}|search-pack`);

    // 切回 theme：同一组条件恢复出结果
    await page.getByLabel('按类型筛选').selectOption('theme');
    await expect(page.getByText(themeName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('AI 生成（桩 LLM）：prompt → 清单 → 沙箱渲染 → Diff → 体检', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const siteA = `E2E 生成站 A ${stamp}`;
    const siteB = `E2E 生成站 B ${stamp}`;
    const packName = `E2E 生成包 ${stamp}`;
    // 两次生成走同一桩：首次 v1.0.0 单站，增量 v1.1.0 双站（供 Diff 验版本递增与新增站点）
    const manifestA = {
      manifestVersion: 1,
      kind: 'site-pack',
      name: packName,
      description: 'E2E 桩响应生成的网址包（首次）',
      version: '1.0.0',
      tags: ['e2e'],
      payload: {
        categories: [{ title: 'E2E 分类' }],
        sites: [
          {
            url: `https://e2e-dead-a-${stamp}.example.com`,
            title: siteA,
            category: 'E2E 分类',
            tags: ['e2e'],
          },
        ],
      },
    };
    const manifestB = {
      ...manifestA,
      description: 'E2E 桩响应生成的网址包（增量）',
      version: '1.1.0',
      payload: {
        categories: [{ title: 'E2E 分类' }],
        sites: [
          {
            url: `https://e2e-dead-a-${stamp}.example.com`,
            title: siteA,
            category: 'E2E 分类',
            tags: ['e2e'],
          },
          {
            url: `https://e2e-dead-b-${stamp}.example.com`,
            title: siteB,
            category: 'E2E 分类',
            tags: ['e2e'],
          },
        ],
      },
    };
    let generateCalls = 0;
    // 桩只隔离模型调用：prompt 进、清单出，之后沙箱渲染/Diff/体检全是真实 UI 链路。
    // 仓库先例：admin-restore.spec.ts 等同样用 page.route 桩掉服务端长耗时/外部依赖。
    await page.route('**/plugin/generate', async (route) => {
      generateCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          manifest: generateCalls === 1 ? manifestA : manifestB,
          rationale: 'E2E 桩响应：确定性清单',
        }),
      });
    });

    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /AI 生成插件/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // 首次生成：prompt → 沙箱出现清单站点
    await dialog.getByLabel('插件需求或增量微调描述').fill('生成一套 E2E 测试用的开发者网址包');
    await dialog.getByRole('button', { name: 'AI 开始规划' }).click();
    await expect(page.getByText('AI 插件清单规划生成完成！')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('包含站点清单 (1 个)')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(siteA, { exact: true })).toBeVisible();

    // 声明式 JSON tab：源视图渲染清单本体
    await dialog.getByRole('tab', { name: /声明式 JSON/ }).click();
    await expect(dialog.getByText(packName).first()).toBeVisible({ timeout: 15_000 });

    // 增量生成：再加一站、版本 1.0.0 → 1.1.0
    await dialog.getByLabel('插件需求或增量微调描述').fill('再加一个站点，版本升到 1.1.0');
    await dialog.getByRole('button', { name: '发送增量指令' }).click();
    await expect(page.getByText('插件清单增量修改完成！')).toBeVisible({ timeout: 15_000 });
    expect(generateCalls).toBe(2);

    // 沙箱回到双站
    await dialog.getByRole('tab', { name: /实时沙箱预览/ }).click();
    await expect(dialog.getByText('包含站点清单 (2 个)')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(siteB, { exact: true })).toBeVisible();

    // Diff：版本递增卡片如实报告 v1.0.0 → v1.1.0
    await dialog.getByRole('tab', { name: /声明式 JSON/ }).click();
    await dialog.getByRole('button', { name: /版本演进对比/ }).click();
    await expect(dialog.getByText('版本递增')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/v1\.0\.0.*v1\.1\.0/).first()).toBeVisible({ timeout: 15_000 });

    // 自动化体检：死链必须被如实报告（不允许谎报全绿，与 plugin-studio.spec.ts 同口径）
    await dialog.getByRole('tab', { name: /自动化体检/ }).click();
    const checkBtn = dialog.getByRole('button', { name: /一键开始检测 \(\d+个链接\)/ });
    await expect(checkBtn).toBeVisible({ timeout: 15_000 });
    await checkBtn.click();
    await expect(dialog.getByText('异常或超时')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText(/e2e-dead-|失败|超时/).first()).toBeVisible({ timeout: 15_000 });

    await page.unroute('**/plugin/generate').catch(() => {});
  });
});
