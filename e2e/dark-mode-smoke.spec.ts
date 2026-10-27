import { expect, test, type Page } from '@playwright/test';
import { loginViaAdmin } from './helpers';

/**
 * 暗色模式冒烟守卫（第六批 C3）。
 *
 * 第五批把用户中心全部页面统一为「玻璃 + 彩色芯片」语言并明暗双主题实拍验收，
 * 但当时没有自动化锁定——后续改动可能悄悄破坏暗色而不自知。本守卫用计算样式
 * 做真断言（背景亮度），比截图对比稳健：暗色下页面背景必须是暗色（亮度 < 0.5），
 * 亮色下必须是亮色（> 0.5），主题切换（next-themes, attribute=class）真实生效。
 */

/** sRGB hex → 相对亮度（WCAG 定义） */
function luminance(rgb: string): number {
  const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 1;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function bodyLuminance(page: Page): Promise<number> {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  return luminance(bg);
}

test('暗色模式真实生效：概览与插件页背景均为暗色', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginViaAdmin(page);
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));

  // CI 慢机 hydration 窗口曾短暂出现第二份同 label 的 section（其中一份 hidden），
  // 宽泛选择器会先撞上隐藏副本、再因两份命中被 strict 模式判红（run 27e95d8 偶发）。
  // 锚到主内容区且只认可见节点：若真有两份「可见」地标，strict 违规仍会如实报红。
  const statsGrid = page.locator('main#main-content section[aria-label="用户数据概览"]:visible');

  // 概览页
  await page.goto('/me', { waitUntil: 'domcontentloaded' });
  await expect(statsGrid).toBeVisible({ timeout: 60_000 });
  expect(await bodyLuminance(page), '暗色下 /me 背景亮度必须 < 0.5').toBeLessThan(0.5);

  // 插件中心页（次主题路由抽查：彩色芯片在暗色下的可读性依赖背景正确）
  await page.goto('/me/plugins', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('已安装插件').first()).toBeVisible({ timeout: 60_000 });
  expect(await bodyLuminance(page), '暗色下 /me/plugins 背景亮度必须 < 0.5').toBeLessThan(0.5);

  // 切回亮色（同一条守卫反向锁定：亮色模式没有被暗色修复改坏）
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.goto('/me', { waitUntil: 'domcontentloaded' });
  await expect(statsGrid).toBeVisible({ timeout: 60_000 });
  expect(await bodyLuminance(page), '亮色下 /me 背景亮度必须 > 0.5').toBeGreaterThan(0.5);
});
