import { test, expect, type Page } from '@playwright/test';

/**
 * 360px 工具栏横向溢出回归（2026-11-19 02:22 轮）。
 *
 * 既有问题（01:22 轮诊断）：360px 下工具栏按钮行 scrollWidth 366 > clientWidth 336，
 * 菜单按钮 334–378，18px 出视口。根因：<md 时按钮行 basis-full 独占一行，
 * 8 个可见按钮 × 44px + 7×2px 间隙 = 366px > 360−24px 可用宽。
 * 修复（02:22 轮）：<390px 隐藏次要入口「外观排版」（同一小窗仍可由首页微胶囊行
 * 「新手向导」打开），行宽 366→320；390px（366=366 恰好占满）与 1280px 布局不变。
 * 阈值取 390 而非 380：366+24=390 是行恰好占满的边界，<390 一律隐藏才全覆盖。
 */

async function measureToolbarRow(page: Page) {
  return await page.evaluate(() => {
    const menuBtn = document.querySelector('button[aria-label="打开菜单"]');
    if (!menuBtn) return { found: false as const };
    const row = menuBtn.closest('div.overflow-hidden');
    if (!row) return { found: false as const };
    const boxes = [...row.querySelectorAll('button, a')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 12) || 'button',
          left: Math.round(r.left),
          right: Math.round(r.right),
        };
      });
    return {
      found: true as const,
      rowScrollWidth: row.scrollWidth,
      rowClientWidth: row.clientWidth,
      innerWidth: window.innerWidth,
      boxes,
    };
  });
}

test.describe('工具栏 360px 无横向溢出（2026-11-19 02:22 轮）', () => {
  for (const width of [360, 390]) {
    test(`${width}px：工具栏行不溢出、全部可见按钮在视口内`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
      await expect(todayBtn).toBeVisible({ timeout: 60_000 });
      const m = await measureToolbarRow(page);
      expect(m.found).toBe(true);
      if (!m.found) return;
      // 实测数进日志：改前 360px 为 scrollWidth=366 > clientWidth=336；
      // 改后应为 320 ≤ 336（隐藏外观入口省 46px）。
      console.log(
        `[toolbar360] ${width}px: rowScrollWidth=${m.rowScrollWidth} rowClientWidth=${m.rowClientWidth} buttons=${m.boxes.length} menuRight=${m.boxes.find((b) => b.label === '打开菜单')?.right}`,
      );
      expect(
        m.rowScrollWidth,
        `工具栏行溢出：scrollWidth=${m.rowScrollWidth} > clientWidth=${m.rowClientWidth}`,
      ).toBeLessThanOrEqual(m.rowClientWidth);
      for (const b of m.boxes) {
        expect(b.left, `${b.label} 左缘出视口（left=${b.left}）`).toBeGreaterThanOrEqual(0);
        expect(
          b.right,
          `${b.label} 右缘出视口（right=${b.right} > innerWidth=${m.innerWidth}）`,
        ).toBeLessThanOrEqual(m.innerWidth);
      }
    });
  }

  test('1280px：「今日」标签仍可见', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    const label = todayBtn.locator('span:not([aria-hidden])');
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/^今日( \d+ 项)?$/);
  });

  test('360px：外观入口仍可达——首页微胶囊行「向导与设首页」开同一小窗', async ({ page }) => {
    // 修复把工具栏外观按钮在 <390px 隐藏，它的替代入口必须还在：
    // 首页微胶囊行「向导与设首页」开的是同一 appearance-guide-dialog，
    // 默认新手向导 tab，tab 可切到「外观与排版」，皮肤/DIY 不丢。
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    const toolbarAppearance = page.getByRole('button', {
      name: '打开外观排版与新手向导小窗',
      exact: true,
    });
    await expect(toolbarAppearance).toBeHidden();
    const capsule = page.getByRole('button', { name: '向导与设首页', exact: true });
    // 胶囊由客户端水合后据 localStorage 决定是否渲染（guidePending 默认 false，
    // useEffect 读存储后才置 true），冷启动水合长尾下 15 秒默认超时不够；
    // 与本仓库 U-155 用例同例，用 60 秒预算只防冷启动，不代表常规耗时。
    await expect(capsule).toBeVisible({ timeout: 60_000 });
    await capsule.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: '外观与排版' })).toBeVisible();
    await page.getByRole('tab', { name: '外观与排版' }).click();
    await expect(page.getByRole('tab', { name: '外观与排版' })).toHaveAttribute(
      'data-state',
      'active',
    );
  });
});
