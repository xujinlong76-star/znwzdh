import { test, expect } from '@playwright/test';

/**
 * 考试直达顶栏入口（2026-11-28 23:22 轮 · 方案 A）。
 *
 * 22:22 轮 w-ux 发现：首页首屏 SSR 里 /exam 出现 0 次，到 /exam 最少 2 步
 * （探索菜单或今日中心弹窗）。本轮在顶栏「热榜」旁加「考试」直达按钮
 * （href="/exam"，图标 + 可见文字，全宽度可见），国考窗口期内挂琥珀
 * 倒计时徽章（仅 ≥lg 显示）。
 *
 * 本文件只验真实点击与溢出量测（单元侧源码守卫见
 * apps/web-overlay/test/exam-topbar-link.test.ts）：
 *   - 桌面 1280px：按钮可见、带「考试」文字，1 次点击到 /exam；
 *   - 390px：按钮可见、可点，1 次点击到 /exam，且工具栏行不溢出
 *     （390px 行 8×44 + 7×2 = 366px = 366px 可用宽，恰好占满；
 *     外观聚合浮层 <390px 隐藏腾位，见 toolbar-360-overflow.spec.ts）。
 */
test.describe('顶栏「考试」直达入口（2026-11-28 23:22 轮）', () => {
  for (const width of [1280, 390]) {
    test(`${width}px：1 次点击由首页到 /exam`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
      await expect(todayBtn).toBeVisible({ timeout: 60_000 });
      const examLink = page
        .getByTestId('toolbar-button-row')
        .getByRole('link', { name: '考试', exact: true });
      await expect(examLink).toBeVisible({ timeout: 60_000 });
      await expect(examLink).toHaveAttribute('href', '/exam');
      // 可见「考试」文字（非仅 title/aria-label）
      await expect(examLink.locator('span', { hasText: '考试' }).first()).toBeVisible();
      await examLink.click();
      await expect(page).toHaveURL(/\/exam/, { timeout: 30_000 });
      await expect(page.locator('h1')).toBeVisible({ timeout: 30_000 });
    });
  }

  test('390px：工具栏行不溢出、考试按钮右缘在视口内', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    const m = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="toolbar-button-row"]');
      if (!row) return { found: false as const };
      const exam = row.querySelector('a[aria-label="考试"]');
      const r = exam?.getBoundingClientRect();
      return {
        found: true as const,
        rowScrollWidth: row.scrollWidth,
        rowClientWidth: row.clientWidth,
        innerWidth: window.innerWidth,
        examRight: r ? Math.round(r.right) : -1,
      };
    });
    expect(m.found).toBe(true);
    if (!m.found) return;
    console.log(
      `[exam-topbar] 390px: rowScrollWidth=${m.rowScrollWidth} rowClientWidth=${m.rowClientWidth} examRight=${m.examRight}`,
    );
    expect(
      m.rowScrollWidth,
      `工具栏行溢出：scrollWidth=${m.rowScrollWidth} > clientWidth=${m.rowClientWidth}`,
    ).toBeLessThanOrEqual(m.rowClientWidth);
    expect(m.examRight, `考试按钮右缘出视口（right=${m.examRight}）`).toBeLessThanOrEqual(
      m.innerWidth,
    );
    expect(m.examRight).toBeGreaterThan(0);
  });

  test('1280px：国考窗口期内倒计时徽章可见（有 countdownLabel 时）', async ({ page }) => {
    // 徽章只在服务端 todayBadge.countdownLabel 非空时渲染（国考窗口期）；
    // 非窗口期不渲染是正确行为，不断言必现，只记录实测状态。
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    const badge = page.getByTestId('exam-countdown-badge');
    const count = await badge.count();
    console.log(`[exam-topbar] 1280px: exam-countdown-badge count=${count}`);
    if (count > 0) {
      await expect(badge).toBeVisible();
      await expect(badge).not.toBeEmpty();
    }
  });
});
