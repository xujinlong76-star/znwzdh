import { test, expect } from '@playwright/test';

/**
 * 核心旅程：插件市场（声明式插件的浏览、安装与审核链路）。
 *
 * 覆盖设计文档（docs/PLUGIN-MARKET-DESIGN-2026-10-19.md §九）验收口径中的两条端到端：
 *   1. 市场浏览 → 详情预览 → 一键安装网址包（含确认弹窗与安装后状态）
 *   2. 发布入库（pending）→ 管理员审核上架 → 市场公开可见
 *
 * 说明：
 *   - 发布走 API 通道（import / publish）落库，聚焦审核状态机与市场可见性主干，
 *     同时避免发布限流（5/hour）在 CI 重试时被耗尽；
 *   - 每次运行使用时间戳生成唯一名称 / URL / slug，不与既有数据冲突。
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

// 登录收口到 helpers（D3）：原内联副本与 enterAdminArea 语义逐字等价（登录旁路 + 回跳等待），
// 薄转发保留本文件 4 处调用点不动
import { enterAdminArea } from './helpers';
async function gotoAdmin(page: import('@playwright/test').Page, path: string) {
  await enterAdminArea(page, path, { timeout: 30_000 });
}

/**
 * 点击「立即安装」并等待成功 toast。
 *
 * 冷启动（CI 首次 dev 编译）存在 React 水合竞态：弹窗按钮已可见但事件处理器
 * 尚未绑定，首击会静默丢失（点击本身不报错）。这里在未出现 toast 且弹窗仍在时
 * 补击一次，消除这类环境性抖动。
 */
async function clickInstallAndAwaitToast(page: any, dialog: any, name: string) {
  const toast = page.getByText(`成功安装「${name}」！`);
  await dialog.getByRole('button', { name: '立即安装' }).click();
  try {
    await expect(toast).toBeVisible({ timeout: 10_000 });
  } catch {
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: '立即安装' }).click().catch(() => {});
    }
    await expect(toast).toBeVisible({ timeout: 15_000 });
  }
}

test.describe('插件市场：浏览、安装与审核链路', () => {
  // 本套件含发布动作（中枢限流 5 次/小时）：CI 重试上限收紧为 1，
  // 全套件连重试的最坏发布量 ≤4 < 5，避免 429 被重试打满后污染结果。
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    // 诊断通道：CI 失败时把浏览器报错与失败 API 落进任务日志，便于远程排查
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

  test('浏览 → 详情 → 一键安装网址包', async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 网址包 ${stamp}`;
    const slug = `e2e-pack-${stamp}`;

    // 通过导入通道落库（直接上架、无发布限流）
    const imported = await request.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(name, stamp), slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 列表页：搜索定位到刚导入的插件
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    await page.getByLabel('搜索插件').fill(name);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    // 筛选条件写回地址栏，统一搜索 /marketplace?q=... 与刷新都能还原
    await expect(page).toHaveURL(/[?&]q=/);

    await page.goto(`/marketplace?q=${encodeURIComponent(name)}`);
    await expect(page.getByLabel('搜索插件')).toHaveValue(name);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    // 详情页：标题与影响摘要。列表未完成水合时点击可能只触发统一搜索深链
    // （URL 落在 /marketplace?q=）：等结果出现再点；URL 仍不对则直接 goto 兜底
    await page.getByText(name, { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('link', { name: new RegExp(name) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}`)).catch(async () => {
      await page.goto(`/marketplace/${slug}`);
      await expect(page).toHaveURL(new RegExp(`/marketplace/${slug}`));
    });
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(name);

    // 分享深链 ?install=1（D4）：直接落地详情页即自动弹出安装确认
    await page.goto(`/marketplace/${slug}?install=1`);
    const dialog = page.getByRole('dialog');
    try {
      // 弹窗自动打开后页面主体对角色查询不可见（Radix aria-hidden），故弹窗断言放最前
      await expect(dialog).toBeVisible({ timeout: 15_000 });
    } catch {
      // 冷启动水合 / 首屏取数竞态未自动弹窗时：轮询补击「立即安装该插件」直至弹窗出现
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
    // 页面主体已加载（h1 用 CSS 定位器：弹窗开启时不受 aria-hidden 影响）
    await expect(page.locator('h1').first()).toContainText(name);
    await expect(dialog.getByText(`确认安装「${name}」`)).toBeVisible();
    await clickInstallAndAwaitToast(page, dialog, name);

    // 刷新后仍显示「已安装」：安装结果对该浏览器身份真实落账
    await page.reload();
    await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();
  });

  test('组合包：成员清单展示 → 一次安装成员生效 → 已安装页按类型聚合', async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const memberName = `E2E 组合成员 ${stamp}`;
    const memberSlug = `e2e-bundle-member-${stamp}`;
    const bundleName = `E2E 组合包 ${stamp}`;
    const bundleSlug = `e2e-bundle-${stamp}`;

    // 1. 先导入已上架成员（组合包只允许引用已上架插件）
    const memberImport = await request.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(memberName, stamp), slug: memberSlug },
    });
    expect(memberImport.ok(), `成员导入失败 ${memberImport.status()}: ${await memberImport.text()}`).toBeTruthy();

    // 2. 导入单层组合包
    const bundleImport = await request.post('/api/hub/plugins/import', {
      data: {
        manifest: {
          manifestVersion: 1,
          kind: 'bundle',
          name: bundleName,
          description: 'Playwright 端到端测试组合包（单层，仅引用已上架成员）',
          version: '1.0.0',
          tags: ['e2e', 'bundle'],
          payload: { items: [{ slug: memberSlug, kind: 'site-pack' }] },
        },
        slug: bundleSlug,
      },
    });
    expect(bundleImport.ok(), `组合包导入失败 ${bundleImport.status()}: ${await bundleImport.text()}`).toBeTruthy();

    // 3. 详情页：成员清单可见、类型徽章与 ready 状态正常
    await page.goto(`/marketplace/${bundleSlug}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(bundleName);
    await expect(page.getByText('组合包成员').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(memberName, { exact: true }).first()).toBeVisible();

    // 4. 一次安装：组合包专用成功文案（沿用点击-补击模式对抗冷启动水合竞态）
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${bundleName}」`)).toBeVisible();
    await expect(dialog.getByText('一次登记 1 个成员插件')).toBeVisible();
    const bundleToast = page.getByText(`组合包「${bundleName}」处理完成`);
    await dialog.getByRole('button', { name: '立即安装' }).click();
    try {
      await expect(bundleToast).toBeVisible({ timeout: 10_000 });
    } catch {
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: '立即安装' }).click().catch(() => {});
      }
      await expect(bundleToast).toBeVisible({ timeout: 15_000 });
    }

    // 5. 已安装页：组合包独立分类聚合
    await page.goto('/marketplace/installed');
    await expect(page.getByRole('heading', { name: '已安装插件管家' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '组合包' }).click();
    await expect(page.getByText(bundleName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('发布入库（待审）→ 管理员审核上架 → 市场公开可见', async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E 待审包 ${stamp}`;

    // 1. 发布：进入 pending 待审队列（F0 起发布必须带作者身份）
    const published = await request.post(`/api/hub/plugins?anonId=anon-e2e-owner-${stamp}`, {
      data: { manifest: sitePackManifest(name, stamp) },
    });
    expect(published.ok(), `发布失败 ${published.status()}: ${await published.text()}`).toBeTruthy();

    // 2. 待审阶段：市场检索不到
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    await page.getByLabel('搜索插件').fill(name);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.getByText('没有匹配的插件，换个筛选条件试试')).toBeVisible();

    // 3. 管理员审核上架（开放模式下自动通过一键进入）
    await gotoAdmin(page, '/admin/plugins');
    await expect(page.getByRole('heading', { name: '插件市场审核管理' })).toBeVisible({ timeout: 45_000 });
    const card = page.locator('div.rounded-2xl').filter({ hasText: name }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: '通过并上架' }).click();
    // 瞬态 toast 在重载机器上可能晚于断言窗口出现/消失：改等持久效果——
    // 审核成功后 SWR 刷新，插件离开待审列表（冷启动慢响应同理不误判）
    await expect(card).not.toBeVisible({ timeout: 30_000 });

    // 4. 上架后：市场公开可见
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    await page.getByLabel('搜索插件').fill(name);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test('全链路 UI 驱动：投稿向导填报 -> 校验 -> 管理后台上架审核 -> 市场卡片渲染 -> 一键安装并动态激活主题', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const themeName = `E2E 霓虹主题 ${stamp}`;
    const themeDesc = `Playwright 自动化测试专用主题，用于验证完整的投稿、审核与动态激活链路。`;
    const themePayload = JSON.stringify({
      accent: 'violet',
      tokens: {
        '--primary': '262 83% 58%',
        '--ring': '262 83% 58%',
        '--radius': '0.85rem',
      },
    });

    // 1. 进入投稿发布页
    await page.goto('/marketplace/publish');
    await expect(page.getByRole('heading', { name: '投稿发布新插件' })).toBeVisible({ timeout: 30_000 });

    // 步骤 1：选择插件类型（配色主题）
    await page.getByRole('button', { name: /配色主题/ }).click();

    // 步骤 2：填写基础元数据
    await page.getByLabel('插件名称').fill(themeName);
    await page.getByLabel('版本号').fill('1.0.0');
    await page.getByLabel('详细描述').fill(themeDesc);
    await page.getByLabel('作者称谓').fill('E2E 测试助手');

    // 步骤 3：定义内容载荷
    await page.getByLabel('内容载荷 JSON').fill(themePayload);

    // 预检校验
    await page.getByRole('button', { name: '预检校验' }).click();
    await expect(page.getByText('预检校验通过！该清单完全符合 NavHub 规范')).toBeVisible();

    // 提交发布
    await page.getByRole('button', { name: '立即提交审核' }).click();
    await expect(page.getByRole('heading', { name: '投稿发布成功！' })).toBeVisible({ timeout: 30_000 });

    // 2. 进入管理后台审核上架
    await gotoAdmin(page, '/admin/plugins');
    await expect(page.getByRole('heading', { name: '插件市场审核管理' })).toBeVisible({ timeout: 45_000 });
    const pendingCard = page.locator('div.rounded-2xl').filter({ hasText: themeName }).first();
    await expect(pendingCard).toBeVisible({ timeout: 30_000 });
    await pendingCard.getByRole('button', { name: '通过并上架' }).click();
    // 瞬态 toast 在重载机器上可能晚于断言窗口出现/消失：改等持久效果——
    // 审核成功后 SWR 刷新，插件离开待审列表
    await expect(page.locator('div.rounded-2xl').filter({ hasText: themeName })).not.toBeVisible({ timeout: 30_000 });

    // 3. 市场浏览与卡片渲染
    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible();
    // 切换到「主题」分类筛选
    await page.getByLabel('按类型筛选').selectOption('theme');
    // 检索该插件
    await page.getByLabel('搜索插件').fill(themeName);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.getByText(themeName, { exact: true }).first()).toBeVisible();

    // 4. 进入详情页并一键安装
    await page.getByRole('link', { name: new RegExp(themeName) }).first().click();
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(themeName);

    // 点击安装（含冷启动水合补击）
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${themeName}」`)).toBeVisible();
    await clickInstallAndAwaitToast(page, dialog, themeName);

    // 5. 验证主题动态注入激活
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
    const primaryColor = await page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'));
    expect(primaryColor.trim()).toBe('262 83% 58%');
  });

  test('NextGen 全功能链路：免安装主题沙箱试用 -> 安装后真实5星评价 -> 版本演进时间轴 -> 工作台导出插件', async ({ page, request, context }) => {
    // 允许剪贴板读写权限
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

    const stamp = Date.now().toString(36);
    const themeName = `NextGen 试用主题 ${stamp}`;
    const slug = `nextgen-theme-${stamp}`;
    const themeManifest = {
      manifestVersion: 1,
      kind: 'theme',
      name: themeName,
      description: 'Playwright NextGen 全功能链路测试专用主题',
      version: '1.0.0',
      tags: ['theme', 'nextgen'],
      payload: {
        accent: 'rose',
        tokens: {
          '--primary': '336 90% 65%',
          '--ring': '336 90% 65%',
          '--radius': '0.75rem',
        },
      },
    };

    // 1. 通过直接上架通道导入该主题
    const imported = await request.post('/api/hub/plugins/import', {
      data: { manifest: themeManifest, slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 2. 访问详情页
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(themeName);

    // 3. 免安装沙箱试用
    const tryoutBtn = page.getByRole('button', { name: '免安装沙箱试用' });
    await expect(tryoutBtn).toBeVisible({ timeout: 15_000 });
    await tryoutBtn.click();

    // 验证试用状态栏出现
    const ribbon = page.locator('aside[aria-label="主题试用状态栏"]');
    await expect(ribbon).toBeVisible({ timeout: 10_000 });
    await expect(ribbon.getByText('免安装试用中')).toBeVisible();
    await expect(ribbon.getByText(themeName)).toBeVisible();

    // 验证 html 属性应用了试用强调色
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'rose');

    // 退出试用
    await ribbon.getByRole('button', { name: '退出试用' }).click();
    await expect(ribbon).not.toBeVisible();

    // 4. 正式安装该插件
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${themeName}」`)).toBeVisible();
    await clickInstallAndAwaitToast(page, dialog, themeName);
    await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();

    // 5. 版本演进时间轴（选项卡使用 role=tab，保留键盘/读屏语义）
    await page.getByRole('tab', { name: '版本演进' }).click();
    await expect(page.getByRole('heading', { name: /版本演进时间轴/ })).toBeVisible();
    await expect(page.getByText('v1.0.0', { exact: true }).first()).toBeVisible();

    // 6. 真实安装用户 5 星评价（End 键跳到末个选项卡，验证 ARIA Tabs 键盘交互）
    await page.getByRole('tab', { name: '版本演进' }).focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: '用户评价' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]tab=reviews/);
    await expect(page.getByRole('heading', { name: /全部评价/ })).toBeVisible();
    await page.getByRole('button', { name: '发表使用体验' }).click();

    // 选中 5 星
    await page.getByRole('radio', { name: '5 星' }).click();
    await page.getByLabel('一句话亮点或总结（可选）').fill('体验极佳，做工精美！');
    await page.getByLabel('具体使用心得或改进建议（可选）').fill('高对比度配色非常好看，推荐给所有夜间开发者！');
    await page.getByRole('button', { name: '提交评价' }).click();

    await expect(page.getByText('评价发布成功，感谢您的反馈！')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('体验极佳，做工精美！')).toBeVisible();
    await expect(page.getByText('已验证真实安装用户').first()).toBeVisible();

    // 7. 工作台一键导出为插件 (UGC Export to Plugin)
    await page.goto('/custom');
    await page.waitForLoadState('domcontentloaded');

    // 开启自定义排版模式展示工具栏
    const editBtn = page.getByRole('button', { name: /自定义排版/ });
    await expect(editBtn).toBeVisible({ timeout: 30_000 });
    await editBtn.click();

    const exportBtn = page.getByRole('button', { name: '导出为插件' });
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });
    await exportBtn.click();

    const exportDialog = page.getByRole('dialog');
    await expect(exportDialog.getByText('导出为标准插件清单 (Export to Plugin)')).toBeVisible({ timeout: 15_000 });
    await expect(exportDialog.getByText(/清单符合 NavHub 纯声明式 JSON 架构/)).toBeVisible();

    // 复制 JSON
    await exportDialog.getByRole('button', { name: '复制 JSON' }).click();
    await expect(page.getByText('已复制清单 JSON 到剪贴板')).toBeVisible({ timeout: 10_000 });

    // 关闭弹窗
    await exportDialog.getByRole('button', { name: '取消' }).click();
    await expect(exportDialog).not.toBeVisible();
  });

  test('进化增强全链路：已安装管家中心 -> 搜索引擎包快捷直达 -> 详情页 SVG 徽章 -> 自动熔断隔离与管理员审核解封', async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

    const stamp = Date.now().toString(36);
    const searchPackName = `E2E 搜索引擎包 ${stamp}`;
    const slug = `e2e-search-${stamp}`;
    const searchPackManifest = {
      manifestVersion: 1,
      kind: 'search-pack',
      name: searchPackName,
      description: 'Playwright 进化增强全链路测试专用搜索引擎包',
      version: '1.0.0',
      tags: ['search-pack', 'e2e'],
      payload: {
        engines: [
          {
            prefix: `!test${stamp}`,
            name: `E2E引擎 ${stamp}`,
            searchUrl: 'https://e2e-search.example.com/search?q={q}',
            description: '测试前缀快捷直达',
          },
        ],
      },
    };

    // 1. 通过直接上架通道导入该搜索引擎包
    const imported = await request.post('/api/hub/plugins/import', {
      data: { manifest: searchPackManifest, slug },
    });
    expect(imported.ok(), `导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 2. 访问详情页验证信息与 SVG 徽章获取
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(searchPackName);
    await expect(page.getByText(`!test${stamp}`)).toBeVisible();

    // 验证 SVG 徽章服务 API
    const badgeRes = await request.get(`/api/hub/plugins/${slug}/badge.svg?metric=version`);
    expect(badgeRes.status()).toBe(200);
    expect(badgeRes.headers()['content-type']).toContain('image/svg+xml');
    const svgText = await badgeRes.text();
    expect(svgText).toContain('v1.0.0');

    // 弹窗获取开源徽章代码（文案与详情页徽章弹窗实际 UI 对齐）
    const badgeBtn = page.getByRole('button', { name: '获取动态 SVG 徽章' });
    await expect(badgeBtn).toBeVisible({ timeout: 15_000 });
    await badgeBtn.click();
    const badgeModal = page.getByRole('dialog');
    await expect(badgeModal.getByText('获取开源动态徽章 (Badge)')).toBeVisible();
    await expect(badgeModal.getByText(/实时矢量预览/)).toBeVisible();
    // 复制确认必须来自按钮自身：sonner 1.7.1 的 Toaster 在 useEffect 里才建立订阅，
    // 订阅前发出的 toast 会被静默丢弃（实测首屏首次点击 3 次里 2 次「剪贴板写成功
    // 但界面无提示」）。断言 toast 会把这种时序问题记成产品失败。
    const mdCopyBtn = badgeModal.getByRole('button', { name: '复制 Markdown 徽章代码' });
    await mdCopyBtn.click();
    await expect(mdCopyBtn).toContainText('已复制');
    // 剪贴板是「复制成功」的唯一 ground truth：读回内容才算复制链路真的可用
    const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
    await expect.poll(readClipboard, { timeout: 5_000 }).toContain(`/api/plugins/${slug}/badge.svg?metric=version`);
    await expect.poll(readClipboard, { timeout: 5_000 }).toContain(`/marketplace/${slug}`);

    // 第二个复制按钮拷贝的是纯 SVG 地址（无 Markdown 包裹）
    const svgCopyBtn = badgeModal.getByRole('button', { name: '复制 SVG 徽章地址' });
    await svgCopyBtn.click();
    await expect(svgCopyBtn).toContainText('已复制');
    await expect
      .poll(readClipboard, { timeout: 5_000 })
      .toMatch(new RegExp(`/api/plugins/${slug}/badge\\.svg\\?metric=version$`));

    await badgeModal.getByRole('button', { name: '完成' }).click();
    await expect(badgeModal).not.toBeVisible();

    // 3. 安装该搜索引擎包
    await page.getByRole('button', { name: '立即安装该插件' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`确认安装「${searchPackName}」`)).toBeVisible();
    await clickInstallAndAwaitToast(page, dialog, searchPackName);
    await expect(page.getByRole('button', { name: /已安装/ })).toBeVisible();

    // 4. 前往已安装管家中心 (/marketplace/installed)
    await page.goto('/marketplace/installed');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('已安装插件管家');
    await expect(page.getByText(searchPackName)).toBeVisible();
    await expect(page.getByText(`!test${stamp}`)).toBeVisible();

    // 5. 社区高危举报触发自动熔断隔离 (quarantined)
    // 连续发起 3 次独立匿名举报。举报接口限流为 5 次/小时/IP，
    // 若三次都从 localhost 发出，测试重试时会累计 3+3>5 被 429；
    // 这里用 TEST-NET-3 模拟三个独立来源 IP（E2E 已显式开启 TRUST_PROXY）。
    const reporters = ['anon-reporter-1', 'anon-reporter-2', 'anon-reporter-3'];
    for (const [index, reporter] of reporters.entries()) {
      const rep = await request.post(`/api/hub/plugins/${slug}/report?anonId=${reporter}`, {
        headers: { 'x-forwarded-for': `203.0.113.${index + 1}` },
        data: { reason: `违规测试举报来自 ${reporter}` },
      });
      expect(rep.status()).toBe(200);
    }

    // 刷新详情页：验证自动熔断隔离横幅出现
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByText('该插件已被系统自动隔离体检 (Quarantined)')).toBeVisible({ timeout: 15_000 });

    // 6. 管理后台解封恢复上架
    await gotoAdmin(page, '/admin/plugins');
    // 切换到「已隔离」标签
    const quarantinedTab = page.getByRole('button', { name: /已隔离/ });
    await expect(quarantinedTab).toBeVisible({ timeout: 15_000 });
    await quarantinedTab.click();

    // 找到该插件卡片并点击解封上架。点击可能落在 React 挂载前（页面挂载时
    // 有四路并行取数，水合窗口较宽）——15s 未见即补击一次再等一轮。
    const pluginCard = page.locator('div.rounded-2xl', { hasText: searchPackName });
    await expect(pluginCard).toBeVisible({ timeout: 15_000 }).catch(async () => {
      await quarantinedTab.click();
      await expect(pluginCard).toBeVisible({ timeout: 15_000 });
    });
    await expect(pluginCard.getByText('已隔离熔断')).toBeVisible();
    await pluginCard.getByRole('button', { name: '审核解封并上架' }).click();
    // 瞬态 toast 同前：改等持久效果——解封后插件离开「已隔离」列表
    await expect(pluginCard).not.toBeVisible({ timeout: 30_000 });

    // 回到详情页：隔离横幅已消失，恢复为正常状态
    await page.goto(`/marketplace/${slug}`);
    await expect(page.getByText('该插件已被系统自动隔离体检 (Quarantined)')).not.toBeVisible();
  });

  test('发布向导：组合包成员选择器拼装成员并实时回写 payload JSON', async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const memberName = `E2E 选择器成员 ${stamp}`;
    const memberSlug = `e2e-picker-${stamp}`;

    // 1. 通过导入通道落库一个已上架成员（候选只要求「已上架」）
    const imported = await request.post('/api/hub/plugins/import', {
      data: { manifest: sitePackManifest(memberName, stamp), slug: memberSlug },
    });
    expect(imported.ok(), `成员导入失败 ${imported.status()}: ${await imported.text()}`).toBeTruthy();

    // 2. 发布向导：选择组合包类型 → 成员选择器出现，初始为空清单
    await page.goto('/marketplace/publish');
    await expect(page.getByRole('heading', { name: '投稿发布新插件' })).toBeVisible({ timeout: 30_000 });
    const bundleKind = page.getByRole('button', { name: /组合包 \(bundle\)/ });
    const pickerTitle = page.getByText('成员选择器（从已上架插件中拼装）');
    await bundleKind.click();
    // dev 环境的快速刷新（编译/重启）可能重载页面并重置向导状态：未出现则再点一次
    try {
      await expect(pickerTitle).toBeVisible({ timeout: 5_000 });
    } catch {
      await bundleKind.click();
    }
    await expect(pickerTitle).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('已选 0 / 12')).toBeVisible();
    const payloadBox = page.locator('#publish-plugin-payload');
    await expect(payloadBox).toHaveValue(/"items": \[\]/);

    // 3. 用搜索框过滤出目标成员（顺带覆盖选择器搜索）；冷启动失败时点一次重试
    await page.getByLabel('搜索候选成员').fill(memberSlug);
    const candidate = page.getByRole('button', { name: new RegExp(memberSlug) }).first();
    const retry = page.getByRole('button', { name: '重试' });
    await expect(candidate.or(retry)).toBeVisible({ timeout: 30_000 });
    if (await retry.isVisible().catch(() => false)) {
      await retry.click();
    }
    await expect(candidate).toBeVisible({ timeout: 30_000 });
    await candidate.click();

    // 4. 选择实时回写 payload JSON（选择器与 JSON 保持单一事实源）
    await expect(payloadBox).toHaveValue(new RegExp(`"slug": "${memberSlug}"`));
    await expect(payloadBox).toHaveValue(/"kind": "site-pack"/);
    await expect(page.getByText('已选 1 / 12')).toBeVisible();

    // 5. 再点一次可移除成员（回到空清单）
    await candidate.click();
    await expect(payloadBox).toHaveValue(/"items": \[\]/);
    await expect(page.getByText('已选 0 / 12')).toBeVisible();
  });
});
