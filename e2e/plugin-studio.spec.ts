import { expect, test } from '@playwright/test';
import { awaitContentReady, loginViaAdmin } from './helpers';

/**
 * AI 插件工坊向导级测试（第五批 A3.2 安全网）。
 *
 * 覆盖此前零行为锁的两个 tab（声明式 JSON / 自动化体检）+ 元数据微调 +
 * 启发式预检（无 LLM 配置时走启发式评分，确定性）。AI 生成路径（sandbox）
 * 由发布页全链路用例与中枢 LLM 依赖隔离，不在本 spec 范围。
 *
 * 前置链路：登录管理员 → 发布表单提交 site-pack（归属 = 管理员）→
 * 审核上架 → 详情页「AI 工坊升级」打开工坊（initialManifest 注入，
 * 免 AI 生成）。
 */

function payloadJson(stamp: string): string {
  return JSON.stringify({
    sites: [
      {
        // 刻意不可达域名（DNS 失败，确定性）：健康体检必须如实报告失败而不是谎报全绿
        url: `https://e2e-dead-${stamp}.example.com`,
        title: `E2E 死链站 ${stamp}`,
        category: `E2E 分类 ${stamp}`,
        tags: ['e2e'],
      },
    ],
  });
}

test.describe.configure({ retries: 1 });

test('AI 工坊：JSON 清单 / 元数据微调与 Diff / 自动化体检 / 启发式预检', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const name = `E2E 工坊包 ${stamp}`;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginViaAdmin(page);

  // 1) 发布表单提交 site-pack（登录态发布 → ownerIdentity = 管理员）
  await page.goto('/marketplace/publish', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '投稿发布新插件' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /网址包 \(site-pack\)/ }).click();
  await page.getByLabel('插件名称').fill(name);
  await page.getByLabel('版本号').fill('1.0.0');
  await page.getByLabel('详细描述').fill('AI 工坊向导级测试用网址包（可安全清理）');
  await page.getByLabel('作者称谓').fill('E2E 工坊助手');
  await page.getByLabel('内容载荷 JSON').fill(payloadJson(stamp));
  await page.getByRole('button', { name: '预检校验' }).click();
  await expect(page.getByText('预检校验通过！该清单完全符合山羊胡规范')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '立即提交审核' }).click();
  await expect(page.getByRole('heading', { name: '投稿发布成功！' })).toBeVisible({ timeout: 30_000 });

  // 2) 管理员审核上架（与全链路用例同一通道）
  await page.goto('/admin/plugins', { waitUntil: 'domcontentloaded' });
  /**
   * 先等列表页标题，再等卡片。
   *
   * 这条用例在 CI 上红的时候，pendingCard 的 45s 超时把两种完全不同的故障
   * 说成同一种：next dev 冷编译没出来 / 列表 GET 被上游 30s 静默打断后降级成空数组。
   * 标题是纯本地渲染，卡片依赖那次 GET —— 把前者单独断言出来，
   * 红灯至少能指明断链在哪一段（本轮不改后台列表的降级逻辑，它正被并行会话修改）。
   */
  await expect(page.getByRole('heading', { level: 1, name: '插件市场审核管理' })).toBeVisible({
    timeout: 60_000,
  });
  const pendingCard = page.locator('div.rounded-2xl').filter({ hasText: name }).first();
  await expect(pendingCard).toBeVisible({ timeout: 45_000 });
  await pendingCard.getByRole('button', { name: '通过并上架' }).click();
  // 瞬态 toast 在重载机器上可能晚于断言窗口出现/消失：改等持久效果——
  // 审核成功后 SWR 刷新，插件离开待审列表（与 plugin-market.spec 同口径）
  await expect(page.locator('div.rounded-2xl').filter({ hasText: name })).not.toBeVisible({ timeout: 30_000 });

  // 3) 详情页 → 打开工坊（isOwner 门控的入口，归属校验顺带被此断言覆盖）
  await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '插件市场' })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('搜索插件').fill(name);
  // 热门标签「搜索增强」也是 button，子串匹配会命中两个；与 plugin-market.spec 同口径精确匹配
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await awaitContentReady(page, page.getByRole('heading', { level: 1 }).filter({ hasText: name }));
  const studioBtn = page.getByRole('button', { name: /AI 工坊升级/ });
  await expect(studioBtn).toBeVisible({ timeout: 30_000 });
  await studioBtn.click();

  // 4) 声明式 JSON tab：源视图渲染清单本体
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('tab', { name: /声明式 JSON/ }).click();
  await expect(dialog.getByText(name).first()).toBeVisible({ timeout: 15_000 });

  // 5) 元数据微调：版本 1.0.0 → 1.1.0 → Diff Inspector 如实报告
  await dialog.getByRole('button', { name: /清单元数据微调/ }).click();
  await dialog.getByLabel('版本号').fill('1.1.0');
  await dialog.getByRole('button', { name: '应用元数据修改' }).click();
  await expect(page.getByText('元数据已更新')).toBeVisible({ timeout: 15_000 });
  // 切到「变更对比」子标签：版本递增卡片必须出现（manifestDiff.hasChanges 的 UI 兑现）
  await dialog.getByRole('button', { name: /版本演进对比/ }).click();
  await expect(dialog.getByText('版本递增')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(/v1\.0\.0.*v1\.1\.0/).first()).toBeVisible({ timeout: 15_000 });

  // 6) 自动化体检：死链必须被如实报告（不允许谎报全绿）
  await dialog.getByRole('tab', { name: /自动化体检/ }).click();
  const checkBtn = dialog.getByRole('button', { name: /一键开始检测 \(\d+个链接\)/ });
  await expect(checkBtn).toBeVisible({ timeout: 15_000 });
  await checkBtn.click();
  // 常驻结果面板（不依赖瞬态 toast）：死链探测等 DNS 超时，放宽预算
  await expect(dialog.getByText('异常或超时')).toBeVisible({ timeout: 60_000 });
  // 死链必须如实体现在详细日志里（诚实申报，不允许谎报全绿）
  await expect(dialog.getByText(/e2e-dead-|失败|超时/).first()).toBeVisible({ timeout: 15_000 });

  // 7) 启发式预检（无 LLM 时走启发式评分，确定性）：报告面板出现
  await dialog.getByRole('button', { name: /AI 提交前预检/ }).click();
  await expect(dialog.getByText('AI 智能预检多维严审评分')).toBeVisible({ timeout: 60_000 });
});
