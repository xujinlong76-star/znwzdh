import { test, expect, devices } from '@playwright/test';

/**
 * 移动端回归冒烟（2026-11-10）。
 *
 * ## 为什么单独加这一层
 *
 * 现有的 23 个 spec / 80 个用例**全部只在 desktop-chrome 下跑**。
 * 这个仓库做过大量响应式修复（安全区、触摸拖拽、移动导航），
 * 但**没有任何自动化测试防止它被改回去**——这正是"今天没问题、明天悄悄坏掉"的典型。
 *
 * ## 为什么不加一个 Playwright project
 *
 * 加 project 会让现有 80 个桌面用例**全部在移动视口再跑一遍**，
 * E2E 墙钟从 6.9 分钟翻倍，而其中大部分用例（管理后台、Token 管理、恢复任务）
 * 与视口无关。这里只挑**真正受布局影响的 8 个前台页面**跑冒烟。
 *
 * ## 断言的取舍
 *
 * 只断言两件**确定会坏、且坏了用户立刻能感知**的事：
 *   1. 没有横向溢出（scrollWidth > innerWidth）；
 *   2. 首屏有可见的主标题、且没有 JS 报错。
 *
 * 不断言具体像素与元素位置——那会把测试变成"改样式就红"的拖累，
 * 而这类断言在响应式重构时几乎全是噪声。
 */

/** 用 Pixel 7 做代表：390×915，属于当前安卓主流尺寸 */
test.use({ ...devices['Pixel 7'] });

const MOBILE_ROUTES: Array<{ path: string; heading?: RegExp }> = [
  // 首页品牌标识不是主内容区标题；这里只要求 main 区域存在可见标题。
  { path: '/' },
  { path: '/category', heading: /分类总览/ },
  { path: '/sites', heading: /全部站点目录/ },
  { path: '/hot', heading: /精选风向标|趋势榜/ },
  { path: '/tags', heading: /技术标签/ },
  { path: '/marketplace', heading: /插件市场/ },
  { path: '/me', heading: /用户中心/ },
  { path: '/graph', heading: /关系图谱|平替雷达/ },
];

test.describe('移动端布局冒烟（Pixel 7）', () => {
  for (const { path, heading } of MOBILE_ROUTES) {
    test(`${path} 无横向溢出且主标题可见`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(path);

      // 主内容区必须有可见标题；仅非首页继续校验页面特征文案。
      const mainHeading = page.locator('main h1, main h2, main h3').first()
      await expect(mainHeading).toBeVisible({ timeout: 20_000 })
      if (heading) {
        await expect(mainHeading).toContainText(heading, { timeout: 20_000 })
      }

      // 横向溢出：这是移动端最常见、用户最难受的布局问题
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      // 允许 2px 容差：亚像素舍入会带来 1px 误差，不是真溢出
      expect(
        overflow.scrollWidth,
        `${path} 横向溢出：scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}`,
      ).toBeLessThanOrEqual(overflow.innerWidth + 2);

      expect(errors, `${path} 出现 JS 报错`).toEqual([]);
    });
  }
});
