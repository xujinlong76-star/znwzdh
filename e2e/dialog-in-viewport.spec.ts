import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

/**
 * 核心旅程 6：对话框必须出现在视口里（Tailwind v4 源扫描的真实回归）。
 *
 * 缺陷：根 .gitignore 把 vendored 底座（`apps/web/*` + 白名单）排除在版本管理外，
 * 而 Tailwind v4 的自动源检测同样遵守 .gitignore —— `apps/web/src/registry/**`
 * （上游 shadcn 组件的副本）整个目录不扫。shadcn 弹窗的定位类
 * `fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]`
 * 一个都没生成，`position: fixed` 反而把弹窗钉在自己的 static 位置上：
 * 实测 1280×720 视口、页面高 9116px 时，弹窗 rect.y = 9116、translate = none，
 * 整个在视口外；Playwright 点「确认创建」直接报 "element is outside of the viewport"。
 *
 * 修法见 apps/web-overlay/src/styles/globals.css 的 `@source '../registry/...'`。
 * 字符串守则（test/tailwind-source.test.ts）只能钉住那行声明，
 * 「类真的生成了、弹窗真的在视口里、真的点得动」只有浏览器里量一遍才算数。
 */

/** 等弹窗入场动画收尾再量几何：zoom/slide 过渡帧里量到的 y 可以是负的（不是真实落位） */
async function waitDialogSettled(dialog: Locator) {
  await dialog.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
  });
}

test.describe('核心旅程 6：对话框出现在视口内且可交互', () => {
  test('虚拟弹窗：新建专属分类的对话框在视口里，确认按钮真的点得动', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /DIY 排版工坊/ }).click();
    await expect(page.getByRole('button', { name: /完成编排/ })).toBeVisible();
    await page.getByTitle('新建专属分类').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // 入场动画（zoom + slide）收尾前量到的是过渡帧（实测 y≈-26.7），不是真实落位
    await waitDialogSettled(dialog);

    // 关键断言：弹窗整块落在视口内（修复前 y≈9000，远超 720 的视口高）
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);

    // 而且真的能用：填名字 → 确认创建 → 弹窗关闭
    await page.locator('#diy-new-category-title').fill('E2E 对话框可用性');
    await page.getByRole('button', { name: '确认创建' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 创建结果落到界面上了（导航区多出一个可编排的分类）
    await expect
      .poll(() => page.getByTitle('按住拖拽调整此分类在页面上的排列位置').count())
      .toBeGreaterThan(0);
  });

  test('备份弹窗：同样在视口里，Esc 能关掉', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /DIY 排版工坊/ }).click();
    await expect(page.getByRole('button', { name: /完成编排/ })).toBeVisible();
    await page.getByTitle('导出 / 导入配置 JSON').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await waitDialogSettled(dialog);

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(viewport!.height);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
