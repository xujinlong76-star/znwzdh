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
 * 意图变更（U-155 方案 A，88fce3f2，2026-11-19）：外观按钮改回全宽度可见
 * （图标 +「DIY 排版」文字，<sm 上下叠排仍占 44px），360px 不溢出改由小组件盒
 * 按钮 <390px 收进探索菜单保证（行内 7×44px + 6×2px 间隙 = 320px ≤ 336px 可用宽）；
 * 本文件「外观按钮 <390px 隐藏」的旧断言随之改为「可见、可点开同一小窗」，
 * 溢出断言（行不溢出、按钮在视口内）与 390px 用例不变；1280px「今日」标签用例
 * 于 2026-11-20 按 87b95e27 的 2xl 新断点改写（1280px 标签隐藏、1600px 可见），
 * 原因见该用例上方注释。
 */

// C-W7-5（2026-11-21，待雷达落号）修正：右组实际 gap-1.5 = 6px，
// 上文「7×2px 间隙 = 320px」「390px 366=366 恰好占满」与当前 HEAD 代码不符；
// 修正后预算：360px 行 344px（超 8px）、390px 行 394px（超 28px），
// Part 1 后：360px 行 294px ≤ 336px、390px 行 344px ≤ 366px，
// 详见 evolution-round-2026-11-21-0522-w5.md §2（吸顶约 184px，见 W8 修正）。

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
      // 实测数进日志：C-W7-5 修正前 360px 行 scrollWidth=344 > clientWidth=336；
      // 改后应为 294 ≤ 336（C-W7-5：多选按钮 <640px 收进菜单省 50px）。
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

  // 意图变更（87b95e27，2026-11-20）：「今日」文字标签与 kbd 徽章的显示断点由
  // xl 延后到 2xl——1280px 档两处共约 140px 会把搜索容器压到 298px、输入框
  // 只剩 18px，核心搜索近乎不可用；<1536px 只留图标 + title Tooltip + 红点徽章。
  // 本用例随新行为改写（旧断言「1280px 标签仍可见」与该修复直接冲突；单元侧
  // header-layout-guard / touch-keyboard-hints 守卫已在同一提交改写）；断言未删，
  // 只改断言方向，并补 1600px（2xl）档的标签可见用例。
  test('1280px：「今日」标签按 2xl 断点隐藏、按钮仍可见', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    const label = todayBtn.locator('span:not([aria-hidden])');
    await expect(label).toBeHidden();
  });

  test('1600px（2xl）：「今日」标签仍可见', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    const label = todayBtn.locator('span:not([aria-hidden])');
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/^今日( \d+ 项)?$/);
  });

  test('360px：工具栏外观按钮可见，点开同一小窗「外观与排版」tab 可切', async ({ page }) => {
    // 意图变更（U-155 方案 A，88fce3f2）：02:22 轮修复曾把工具栏外观按钮在 <390px
    // 隐藏、只留微胶囊行作替代入口；U-155 把该按钮改回全宽度可见（图标 +「DIY 排版」
    // 文字叠排），360px 不溢出改由小组件盒按钮 <390px 收进探索菜单保证。
    // 因此本用例改断言按钮可见、点开即同一 appearance-guide-dialog，
    // 默认新手向导 tab，tab 可切到「外观与排版」，皮肤/DIY 不丢；
    // 微胶囊行「向导与设首页」仍作为第二入口保留覆盖。
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    const toolbarAppearance = page.getByRole('button', {
      name: '打开外观排版与新手向导小窗',
      exact: true,
    });
    await expect(toolbarAppearance).toBeVisible({ timeout: 60_000 });
    await toolbarAppearance.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: '外观与排版' })).toBeVisible();
    await page.getByRole('tab', { name: '外观与排版' }).click();
    await expect(page.getByRole('tab', { name: '外观与排版' })).toHaveAttribute(
      'data-state',
      'active',
    );
    // 第二入口仍在：关窗后微胶囊行「向导与设首页」开同一小窗。
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const capsule = page.getByRole('button', { name: '向导与设首页', exact: true });
    // 胶囊由客户端水合后据 localStorage 决定是否渲染（guidePending 默认 false，
    // useEffect 读存储后才置 true），冷启动水合长尾下 15 秒默认超时不够；
    // 与本仓库 U-155 用例同例，用 60 秒预算只防冷启动，不代表常规耗时。
    await expect(capsule).toBeVisible({ timeout: 60_000 });
    await capsule.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: '外观与排版' })).toBeVisible();
  });

  test('360px/390px：按钮行实测不超宽（C-W7-5，待雷达落号）', async ({ page }) => {
    // 直接量工具栏 flex 行（菜单按钮 → 右组 → flex-wrap 行容器），
    // 不经过 closest('div.overflow-hidden')——旧 helper 的目标祖先
    // 在当前壳里定位不明（navigation-content.tsx / app/page.tsx /
    // app/layout.tsx 内 grep overflow-hidden 0 命中），实施轮须以
    // 本用例的 console.log 核对旧 helper 实际量的是哪一层。
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
      await expect(todayBtn).toBeVisible({ timeout: 60_000 });
      const m = await page.evaluate(() => {
        const menuBtn = document.querySelector('button[aria-label="打开菜单"]');
        const row = menuBtn?.parentElement?.parentElement; // 右组 → flex-wrap 行
        if (!menuBtn || !row) return { found: false as const };
        return {
          found: true as const,
          rowScrollWidth: row.scrollWidth,
          rowClientWidth: row.clientWidth,
        };
      });
      expect(m.found).toBe(true);
      if (!m.found) return;
      console.log(
        `[toolbar360-cw75] ${width}px: rowScrollWidth=${m.rowScrollWidth} rowClientWidth=${m.rowClientWidth}`,
      );
      expect(
        m.rowScrollWidth,
        `按钮行溢出：scrollWidth=${m.rowScrollWidth} > clientWidth=${m.rowClientWidth}`,
      ).toBeLessThanOrEqual(m.rowClientWidth);
    }
  });

  test('360px：多选按钮收进探索菜单，菜单内可点开多选态（C-W7-5，待雷达落号）', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const todayBtn = page.getByRole('button', { name: '打开今日中心小窗', exact: true });
    await expect(todayBtn).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('button[aria-label="多选模式"]')).toBeHidden();
    await page
      .getByRole('button', { name: '探索矩阵与导航工具箱', exact: true })
      .click();
    const menuItem = page.getByRole('menuitem', { name: /多选模式/ });
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await expect(
      page.locator('button[aria-label="多选模式"][aria-pressed="true"]'),
    ).toHaveCount(1);
  });
});
