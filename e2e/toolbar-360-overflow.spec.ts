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

async function measureToolbarRow(page: Page) {
  return await page.evaluate(() => {
    // 2026-11-21：改用稳定的 data-testid 而非 closest('div.overflow-hidden')。
    // 后者与 DOM 结构耦合，改一次布局就会静默失效（返回 found:false 让用例假绿）。
    const row = document.querySelector('[data-testid="nav-toolbar-actions"]');
    if (!row) return { found: false as const };
    // 「打开菜单」只在 <md 存在；桌面端测量不依赖它
    const menuBtn = row.querySelector('button[aria-label="打开菜单"]');
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
      // 2026-11-21：顶栏收敛后「今日中心」按钮已下沉进聚合菜单，
      // 不再是行内常驻元素。改为等「打开菜单」这个必然存在的锚点。
      const menuBtn = page.getByRole('button', { name: '打开菜单', exact: true });
      await expect(menuBtn).toBeVisible({ timeout: 60_000 });
      const m = await measureToolbarRow(page);
      expect(m.found).toBe(true);
      if (!m.found) return;
      // 实测数进日志：改前 360px 为 scrollWidth=366 > clientWidth=336；
      // 改后应为 320 ≤ 336（U-155：小组件盒 <390px 收进菜单省 46px，外观按钮保留）。
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
  test('1280px：工具栏行不溢出、菜单按钮在视口内', async ({ page }) => {
    // 2026-11-21 改写：原用例断言「今日标签按 2xl 断点隐藏」，
    // 但顶栏收敛后今日中心已下沉进聚合菜单，「打开菜单」按钮内部没有
    // 文字 span，标签断点断言失去对象（会恒失败）。
    // 改为与本文件主用例同口径的溢出断言——这才是这个横宽档位真正要守的。
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    // 「打开菜单」是 md:hidden（移动端专用），1280px 下不渲染。
    // 改用桌面端必然可见的聚合入口作锚点。
    const anchor = page.getByRole('button', { name: '个人菜单', exact: true });
    await expect(anchor).toBeVisible({ timeout: 60_000 });
    const m = await measureToolbarRow(page);
    expect(m.found).toBe(true);
    if (!m.found) return;
    expect(m.rowScrollWidth).toBeLessThanOrEqual(m.rowClientWidth);
    for (const b of m.boxes) {
      expect(b.right, `${b.label} 右缘出视口`).toBeLessThanOrEqual(m.innerWidth);
    }
  });

  // 2026-11-21：原「1600px 今日标签可见」用例已删除。
  // 顶栏收敛把「今日中心」从行内按钮下沉进聚合菜单（11 图标 → 4 核心 + 2 聚合），
  // 该按钮在任何宽度都不再是行内元素，断点断言失去对象。
  // 对应守卫改由 test/u155-diy-entry-guard.test.ts 覆盖「入口保留在聚合菜单内」。

  test('360px：工具栏外观按钮可见，点开同一小窗「外观与排版」tab 可切', async ({ page }) => {
    // 意图变更（U-155 方案 A，88fce3f2）：02:22 轮修复曾把工具栏外观按钮在 <390px
    // 隐藏、只留微胶囊行作替代入口；U-155 把该按钮改回全宽度可见（图标 +「DIY 排版」
    // 文字叠排），360px 不溢出改由小组件盒按钮 <390px 收进探索菜单保证。
    // 因此本用例改断言按钮可见、点开即同一 appearance-guide-dialog，
    // 默认新手向导 tab，tab 可切到「外观与排版」，皮肤/DIY 不丢；
    // 微胶囊行「向导与设首页」仍作为第二入口保留覆盖。
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    // 2026-11-21：锚点改为必然存在的聚合菜单按钮（「今日中心」已下沉）
    const menuBtn = page.getByRole('button', { name: '打开菜单', exact: true });
    await expect(menuBtn).toBeVisible({ timeout: 60_000 });
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
    // 2026-11-21：移除「微胶囊第二入口」断言。
    // 该胶囊由客户端水合后据 localStorage(guidePending) 决定是否渲染，
    // 冷启动时可能长时间不出现——断言依赖水合时序，与本用例的核心目的
    //（360px 下外观按钮可见且能打开同一小窗）无关，属脆弱断言。
    // 第二入口的存在性由 test/u155-diy-entry-guard.test.ts 的源码级守卫覆盖。
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
