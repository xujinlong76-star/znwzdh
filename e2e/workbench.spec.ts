import { test, expect } from '@playwright/test';

test.describe('核心旅程 2：模块化自定义工作台与看板持久化', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/custom');
  });

  test('工作台画布正常装载并呈现默认看板与栅格卡片', async ({ page }) => {
    // 验证页面主标题
    await expect(page.getByText('模块化自定义工作台', { exact: true })).toBeVisible();

    // 验证多看板切换标签与 12 栅格自适应指示
    await expect(page.getByText('12 栅格自适应', { exact: true })).toBeVisible();

    // 默认应包含工作台模块卡片与操作按钮
    await expect(page.getByRole('button', { name: /自定义排版/ })).toBeVisible();
  });

  test('支持开启自定义排版模式并展示模块编辑工具栏', async ({ page }) => {
    const editBtn = page.getByRole('button', { name: /自定义排版/ });
    await editBtn.click();

    // 开启后按钮变为「完成排版」
    await expect(page.getByRole('button', { name: /完成排版/ })).toBeVisible();

    // 编辑工具栏应出现「添加模块」、「套用模版」、「智能紧凑」
    await expect(page.getByRole('button', { name: /添加模块/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /套用模版/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /智能紧凑/ })).toBeVisible();

    // 点击完成排版退出编辑
    await page.getByRole('button', { name: /完成排版/ }).click();
    await expect(page.getByRole('button', { name: /自定义排版/ })).toBeVisible();
  });

  test('工作台背景风格切换并即时应用样式', async ({ page }) => {
    const gridBtn = page.getByRole('button', { name: '网格' });
    await gridBtn.click();

    // 验证背景切换类名或激活状态
    await expect(gridBtn).toHaveClass(/bg-primary/);

    const auroraBtn = page.getByRole('button', { name: '极光' });
    await auroraBtn.click();
    await expect(auroraBtn).toHaveClass(/bg-primary/);
  });
});
