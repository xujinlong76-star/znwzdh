import { test, expect } from '@playwright/test';

/**
 * 视频链路 E2E 冒烟（升级方案五.4——测试金字塔最大空洞的第一块砖）。
 *
 * 为什么先补这里：apps/web-overlay/src/lib 下 70+ 个 video-* 模块此前只有
 * 单元测试与 typecheck-video 类型门禁，没有任何「跑起来之后」的验证。
 * 本 spec 覆盖三条最小主干：
 *   1. /videos 列表页：壳 + 种子数据的卡片真实渲染；
 *   2. /videos/v/:id 详情落地页：h1 + 官方内嵌播放 iframe（SEO 页的播放面板）；
 *   3. /videos/player?id= 播放工作台：面板骨架 + 快捷键指南 + 返回导航。
 *
 * 数据供给：beforeAll 用 PUT /api/storage 匿名写入一份最小视频库
 * （E2E 环境是开放模式；空库基线 0 < 100，缩水守卫不触发）。
 * ISR/数据缓存都是冷启动，种子后的首访就是新数据。
 */

const VIDEOS_PATH = 'src/navsphere/content/videos.json';

const seedDoc = {
  navigationItems: [
    {
      id: 'cat-e2e-video',
      title: 'E2E 视频分类',
      enabled: true,
      items: [
        {
          id: 'e2e-video-1',
          title: 'MCP 实战第一课',
          href: 'https://www.bilibili.com/video/BV1MmUSB5Efw',
          description: 'E2E 冒烟种子视频一',
          enabled: true,
          videoConfig: {
            type: 'bilibili',
            bvid: 'BV1MmUSB5Efw',
            author: 'E2E 种子 UP',
            durationSec: 600,
            harvestedAt: Date.now(),
            sourceType: 'manual',
            pinned: true,
            healthStatus: 'healthy',
          },
        },
        {
          id: 'e2e-video-2',
          title: 'Cursor 全套实战',
          href: 'https://www.bilibili.com/video/BV1xx411c7mD',
          description: 'E2E 冒烟种子视频二',
          enabled: true,
          videoConfig: {
            type: 'bilibili',
            bvid: 'BV1xx411c7mD',
            author: 'E2E 种子 UP',
            durationSec: 900,
            harvestedAt: Date.now(),
            sourceType: 'manual',
            pinned: false,
            healthStatus: 'healthy',
          },
        },
      ],
      subCategories: [],
    },
  ],
};

test.beforeAll(async ({ playwright }) => {
  // 种子写进**中枢**的 /api/storage：/api/storage 是中枢路由，Web 侧没有
  // （此前打到 Web 的 404 HTML 页）。端口与 playwright.config 的 API_PORT 同源。
  const apiPort = Number(process.env.NAVHUB_API_PORT || 8787);
  const req = await playwright.request.newContext();
  try {
    const res = await req.put(`http://localhost:${apiPort}/api/storage`, {
      data: { path: VIDEOS_PATH, content: JSON.stringify(seedDoc) },
    });
    expect(res.status(), `种子写入失败: ${await res.text()}`).toBe(200);
  } finally {
    await req.dispose();
  }
});

test.describe('视频链路冒烟', () => {
  test('/videos 列表页：壳与种子卡片真实渲染，卡片弹窗带详情/演播室入口', async ({ page }) => {
    await page.goto('/videos', { waitUntil: 'domcontentloaded' });
    // 冷编译预热：宽预算等 load，失败不致命（可能已编译过）
    await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
    await expect(page.locator('main#main-content h1').first()).toBeVisible({ timeout: 60_000 });

    // 数据到达才有的元素：分类统计。数字是独立 span（空格来自布局而非文本节点），
    // 断言只能锚「门精选视频」这个不受拆分影响的子串
    await expect(page.getByText('门精选视频').first()).toBeVisible({ timeout: 30_000 });
    const cardButton = page.getByRole('button', { name: /MCP 实战第一课/ }).first();
    await expect(cardButton).toBeVisible({ timeout: 30_000 });

    // 列表卡片的入口在预览弹窗里（点击卡片 → VideoPlayerModal）：详情 + 演播室
    await cardButton.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByText('MCP 实战第一课').first()).toBeVisible({ timeout: 15_000 });
    await expect(dialog.locator('a[href="/videos/v/e2e-video-1"]')).toBeVisible();
    await expect(dialog.locator('a[href="/videos/player?id=e2e-video-1"]')).toBeVisible();
  });

  test('/videos/v/:id 详情落地页：h1 与点击后加载的官方内嵌播放 iframe', async ({ page }) => {
    await page.goto(`/videos/v/${encodeURIComponent('e2e-video-1')}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
    await expect(page.locator('main#main-content h1').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('MCP 实战第一课', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    /**
     * 2026-11-08 隐私面整改：详情页默认不再直出 B 站 iframe（那会让访客一打开
     * 页面就与 11 个第三方域名建连，含播放器行为埋点）。改为 click-to-load 门面。
     *
     * 断言覆盖两层语义，而不是简单删掉 iframe 检查：
     *   1. 首屏只有门面、没有 iframe（隐私默认值）；
     *   2. 用户主动点击后，官方内嵌播放器才出现且 src 仍指向 player.bilibili.com。
     * 服务端直出的 VideoObject JSON-LD 不受影响（SEO 契约另行保证）。
     */
    const embed = page.locator('iframe[title="MCP 实战第一课"]');
    await expect(embed).toHaveCount(0);

    const facade = page.getByRole('button', { name: /播放「MCP 实战第一课」/ });
    await expect(facade).toBeVisible({ timeout: 30_000 });
    await facade.click();

    await expect(embed).toBeVisible({ timeout: 30_000 });
    await expect(embed).toHaveAttribute('src', /player\.bilibili\.com/);
  });

  test('/videos/player?id= 播放工作台：面板就绪且选中种子视频', async ({ page }) => {
    await page.goto(`/videos/player?id=${encodeURIComponent('e2e-video-1')}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});

    // 面板骨架：返回导航 + 快捷键指南按钮（真实 UI 文案是「快捷键指南 (?)」）
    await expect(page.getByRole('link', { name: '返回视频中心' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /快捷键指南/ })).toBeVisible({ timeout: 30_000 });
    // 种子视频被选中：面包屑出现标题，播放通道换源档位可读。
    // 注意：原断言等 /官方 WBI 直连/，该文案由解析接口返回的 source 决定
    // （activeEngineSource = parseResult?.source || 'auto'），本地/CI 无外网时
    // 必然回落到「自动优选 直连」，属不稳定断言。改为断言始终存在的换源档位按钮。
    await expect(page.getByText('MCP 实战第一课', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /B站换源:/ })).toBeVisible({ timeout: 30_000 });
  });
});
