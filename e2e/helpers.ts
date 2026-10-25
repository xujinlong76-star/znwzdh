import { expect, type Locator, type Page } from '@playwright/test';

/**
 * E2E 共用等待/登录助手。
 *
 * 两个从多轮视觉验收里沉淀的模式（2026-10-24，NEXT-STEPS D3）：
 *
 * 1. 冷编译预热登录：Next dev + turbopack 首访路由要编译数秒到数十秒，
 *    45s 断言预算在本机常不够（表现为「按钮/标题超时」，报错完全不指因）。
 *    解法是先无断言地等首访加载完（waitForLoadState 宽预算 + 吞错），再走断言。
 *
 * 2. 内容就绪等待：h1 是 SSR 出来的壳，客户端数据到达前页面是骨架。
 *    固定 waitForTimeout 毫秒在冷/热服务器之间必然顾此失彼——要么拍到骨架
 *    （假阴性），要么白等。一律等「只有数据到达才会出现的元素」。
 */

export async function loginViaAdmin(page: Page): Promise<void> {
  await page.goto('/admin/tokens', { waitUntil: 'domcontentloaded' });
  // 首访冷编译预热：宽预算、失败不致命（可能已编译过）
  await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
  if (page.url().includes('/auth/signin')) {
    const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
    await expect(bypassBtn).toBeVisible({ timeout: 30_000 });
    await bypassBtn.click();
    /**
     * 冷编译时服务端 action 会排队：点下去之后 URL 可能几十秒不动，
     * 只等标题会把「点了没反应」和「还在编译」混为一谈。先等 URL 离开
     * signin，确实没动再点一次——避免全量套件里那一两次偶发失败。
     */
    const navigated = await page
      .waitForURL((url) => !url.pathname.startsWith('/auth/signin'), { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (!navigated && (await bypassBtn.isVisible().catch(() => false))) {
      await bypassBtn.click();
    }
    await expect(
      page.locator('main#main-content h1').filter({ hasText: 'API Token 访问凭据管理' }),
    ).toBeVisible({ timeout: 120_000 });
  }
}

/**
 * 等待页面「壳 + 真实内容」都就绪：h1 可见后继续等 content（数据到达才有的元素）。
 * content 传 null 表示该页内容即壳本身（纯静态页）。
 */
export async function awaitContentReady(
  page: Page,
  content: Locator | null,
  { settleMs = 400, timeout = 60_000 }: { settleMs?: number; timeout?: number } = {},
): Promise<void> {
  await expect(page.locator('main#main-content h1').first()).toBeVisible({ timeout });
  if (content) {
    await expect(content.first()).toBeVisible({ timeout });
  }
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

/**
 * 进入管理区（登录旁路 + 回跳等待），不等待任何页面内容。
 * admin-token / admin-dashboard / admin-jobs / plugin-market 四个 spec 此前
 * 各写一份内联副本，D3 收口统一到这里。
 *
 * 与 loginViaAdmin 同源的强化：bypass 按钮给足冷编译预算——
 * 10s/15s 在本机 dev 首编译时不够，报错完全不指因。
 */
export async function enterAdminArea(
  page: Page,
  path: string,
  { timeout = 120_000 }: { timeout?: number } = {},
): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/auth/signin') || page.url().includes('/login')) {
    const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进入/ });
    await expect(bypassBtn).toBeVisible({ timeout: 30_000 });
    await bypassBtn.click();
    // 跳转确认用 commit 而非默认 load：重载机器上 signin→callback 的完整 load
    // 等待会吞掉测试预算（实测 90s 级超时）；到达断言交给调用方的标题等待。
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/auth/signin') && !url.pathname.startsWith('/login'),
      { timeout, waitUntil: 'commit' },
    );
  }
}

/**
 * 进入管理页并等待其专属主标题（enterAdminArea 的组合便捷封装）。
 * 标题定位收窄到 main#main-content：Next 16 流式水合会在 body 级暂存容器
 * （#S:*）里短暂保留同一份内容，裸 h1 会撞 Playwright 严格模式双元素竞态。
 */
export async function gotoAdminPage(
  page: Page,
  path: string,
  heading: string | RegExp,
  { timeout = 120_000 }: { timeout?: number } = {},
): Promise<void> {
  await enterAdminArea(page, path, { timeout });
  const h1 = page.locator('main#main-content h1');
  await expect(typeof heading === 'string' ? h1.filter({ hasText: heading }) : h1.filter(heading)).toBeVisible({ timeout });
}
