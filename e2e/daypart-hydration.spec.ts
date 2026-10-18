import { test, expect } from '@playwright/test';

/**
 * 时区无关的水合安全守卫（WorkspaceFilter 的时段提示）。
 *
 * 缺陷：提示文案原来在渲染体里用 `new Date().getHours()` 算出来。首页是服务端
 * 渲染的，服务器时区（CI / 容器基本都是 UTC）和浏览器时区不是一回事 ——
 * 首屏 HTML 里写着服务器那一侧算出的时段，客户端首帧算出自己时区的时段，
 * React 判定水合不匹配，丢掉服务端 HTML 重渲染，用户还会看到文字闪一下。
 *
 * 这里不去赌「测试跑在几点」：
 *   1. 直接查第一次响应的 HTML —— 里面只允许有占位提示，三个时段文案一个都不能有
 *      （任何时刻都成立，所以不会偶发）；
 *   2. 再把浏览器时区拨到与 UTC 差最远的 UTC+14，确认挂载后确实换成了
 *      客户端算出来的真实时段，并且控制台没有水合报错。
 */
test.describe('时段提示不写进服务端 HTML（水合安全）', () => {
  // UTC+14，全年无夏令时：与 CI 服务器（UTC）的差异最大化
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  test('第一次响应里只有占位提示，三个时段文案一个都不能出现', async ({ request }) => {
    const res = await request.get('/');
    expect(res.ok()).toBe(true);
    const html = await res.text();

    expect(html).toContain('识别时段');
    expect(html).not.toContain('早间专注');
    expect(html).not.toContain('敏捷高效');
    expect(html).not.toContain('深度探索');
  });

  test('挂载后换成客户端算出的真实时段，且没有水合报错', async ({ page }) => {
    const hydrationErrors: string[] = [];
    const looksLikeHydration = (text: string) =>
      /hydrat/i.test(text) || /Minified React error #(418|423|425)/.test(text);

    page.on('console', (msg) => {
      const text = msg.text();
      if (looksLikeHydration(text)) hydrationErrors.push(text);
    });
    page.on('pageerror', (err) => {
      if (looksLikeHydration(err.message)) hydrationErrors.push(err.message);
    });

    await page.goto('/');

    // 挂载后必须是三句真实文案之一（auto-wait 到水合完成）
    const hint = page.getByText(/^(☀️ 早间专注|⚡ 敏捷高效|🌙 深度探索)$/);
    await expect(hint).toBeVisible();
    // 占位提示随之消失，说明确实是客户端算完替换掉的
    await expect(page.getByText('识别时段')).toHaveCount(0);

    expect(hydrationErrors).toEqual([]);
  });
});
