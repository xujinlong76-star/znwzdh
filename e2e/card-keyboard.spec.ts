import { expect, test, type Page } from '@playwright/test';

/**
 * 站点卡片的键盘模型（2026-10-24 改造后的运行级回归）。
 *
 * 模型：整卡只有一个 Tab 停留点（主链接）。
 *   - Space 打开速览；
 *   - → 进入卡片操作区，←/→ 切换，Esc 回到主链接；
 *   - Tab 从主链接直接到下一张卡（不会陷进 4 个操作按钮）。
 *
 * 源码守卫（apps/web/test/card-single-tab-stop.test.ts）只能证明代码长这样，
 * 这里证明浏览器里真的这样跑。
 */

/** 当前焦点是否在某张卡片的主链接上 */
async function focusedCardLink(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !el.hasAttribute('data-prefetch-target')) return null;
    const card = el.closest('[data-navhub-site-id]');
    return card ? card.getAttribute('data-navhub-site-id') : null;
  });
}

test.describe('站点卡片：单一 Tab 入口与方向键操作区', () => {
  test('Tab 到卡片 → 方向键进操作区 → Esc 返回 → Tab 到下一张卡', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-navhub-site-id] a[data-prefetch-target]', { timeout: 60_000 });

    /**
     * 从「第一张卡的上一个可聚焦元素」按一次 Tab 到达卡片主链接。
     * 不从文档开头一路 Tab：首页头部有大量分类按钮，逐个 Tab 既慢又脆弱，
     * 而这里要证明的是「Tab 序列会停在卡片主链接上」，而不是「要按多少次」。
     */
    const link = page.locator('[data-navhub-site-id] a[data-prefetch-target]').first();
    const prepared = await page.evaluate(() => {
      const first = document.querySelector('[data-navhub-site-id] a[data-prefetch-target]') as HTMLElement | null;
      if (!first) return false;
      const focusables = Array.from(
        document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'),
      ).filter((el) => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
      const prev = focusables[focusables.indexOf(first) - 1] as HTMLElement | undefined;
      if (prev) prev.focus();
      else first.focus();
      return true;
    });
    expect(prepared).toBe(true);
    await page.keyboard.press('Tab');
    const firstId = await focusedCardLink(page);
    expect(firstId, '按一次 Tab 应到达卡片主链接').toBeTruthy();

    // 卡片内仍可 Tab 到达的元素只能有 1 个（主链接）
    const tabbableCount = await page.evaluate(() => {
      const card = (document.activeElement as HTMLElement).closest('[data-navhub-site-id]')!;
      return Array.from(card.querySelectorAll('a, button')).filter((el) => (el as HTMLElement).tabIndex >= 0)
        .length;
    });
    expect(tabbableCount).toBe(1);

    // 键盘说明必须指向页面里真实存在的元素（否则 aria-describedby 是空头支票）
    const hintOk = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const id = el.getAttribute('aria-describedby');
      return Boolean(id && document.getElementById(id)?.textContent?.includes('右方向键'));
    });
    expect(hintOk).toBe(true);

    // → 进入操作区
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.hasAttribute('data-card-action')))
      .toBe(true);

    // ← 回到主链接
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => focusedCardLink(page)).toBe(firstId);

    /**
     * Esc 同样回到主链接。这里显式重新聚焦主链接，而不是依赖上一步的
     * ArrowLeft 已把焦点交还——焦点归还是产品行为（由页面代码负责），
     * 本用例要验证的是「从主链接按 → 能进操作区、Esc 能回主链接」，
     * 不该因为上一步的还原时序把两步耦合成一个时序断言。
     */
    await link.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.hasAttribute('data-card-action')))
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => focusedCardLink(page)).toBe(firstId);

    // Tab 直接到下一张卡（不会停在被 tabIndex=-1 的操作按钮上）
    await page.keyboard.press('Tab');
    const nextId = await focusedCardLink(page);
    expect(nextId).toBeTruthy();
    expect(nextId).not.toBe(firstId);
  });

  test('Space 打开速览，Esc 关闭后焦点回到卡片', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-navhub-site-id] a[data-prefetch-target]', { timeout: 60_000 });

    const link = page.locator('[data-navhub-site-id] a[data-prefetch-target]').first();
    await link.focus();
    await page.keyboard.press(' ');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => focusedCardLink(page)).toBeTruthy();
  });
});
