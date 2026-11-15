import { test, expect } from '@playwright/test';

/**
 * 视频链路 E2E 冒烟（升级方案五.4——测试金字塔最大空洞的第一块砖）。
 *
 * 为什么先补这里：apps/web-overlay/src/lib 下 70+ 个 video-* 模块此前只有
 * 单元测试与 typecheck-video 类型门禁，没有任何「跑起来之后」的验证。
 * 本 spec 覆盖三条最小主干：
 *   1. /videos 列表页：壳 + 种子数据的卡片真实渲染，点卡片进路由版播放器；
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
  test('/videos 列表页：壳与种子卡片真实渲染，点卡片进路由版播放工作台', async ({ page }) => {
    await page.goto('/videos', { waitUntil: 'domcontentloaded' });
    // 冷编译预热：宽预算等 load，失败不致命（可能已编译过）
    await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
    await expect(page.locator('main#main-content h1').first()).toBeVisible({ timeout: 60_000 });

    // 数据到达才有的元素：分类统计。数字是独立 span（空格来自布局而非文本节点），
    // 断言只能锚「门精选视频」这个不受拆分影响的子串
    await expect(page.getByText('门精选视频').first()).toBeVisible({ timeout: 30_000 });
    const cardButton = page.getByRole('button', { name: /MCP 实战第一课/ }).first();
    await expect(cardButton).toBeVisible({ timeout: 30_000 });

    // 水合等待（进化第 81 轮 I 线，G 线冷启动闪红的根因加固）：
    // 卡片按钮由 SSR 直出可见，但点按处理函数在异步 chunk 里——
    // VideoContentLazy（next/dynamic）→ VideoContent → VideoCard
    // （video-card.tsx:120 router.push）。冷编译首跑 chunk 下载 + 水合
    // 尚未完成时点按静默丢失：G 线首跑 30s 内 URL 仍停在 /videos，
    // 暖缓存重跑 3/3 全绿。先等 networkidle（宽预算、失败不致命）让
    // 异步 chunk 下完，缩小窗口；但 networkidle 证明不了水合已接管
    // （card-keyboard.spec.ts 前例：与网络无关的重渲染它挡不住），
    // 所以下面再按仓库既有惯例补一次“短窗探测 + 二次点击兜底”。
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

    // 点卡片直接进路由版播放器（/videos/player?id=…）：弹窗版已删除
    // （video-card.tsx:117；video-player-modal.tsx 全仓 0 个 import 方）。
    // 旧断言链「弹窗内标题 + 详情/演播室入口」随旧流程作废，改为断言工作台本身：
    // 详情入口（控制栏「SEO 收录页」→ /videos/v/:id）与演播室控件
    // （B站换源档位、返回视频中心）都在工作台内。注意：/videos/player?id=… 自身
    // 的链接不在工作台内出现——已在工作台里，无需再断言一次“演播室入口”，
    // 落到本页 URL + 工作台控件即等价覆盖。
    //
    // 短窗探测 + 二次点击兜底（复用 e2e/helpers.ts enterAdminArea 与
    // plugin-market.spec.ts clickInstallAndAwaitToast 的既有模式）：
    // 首击若撞上水合未接管会静默丢失——15s 内没离开 /videos 且卡片仍
    // 可见就补点一次；最终 URL 断言（30s）与工作台断言不动，
    // 不放宽断言、不加重试。
    let navigated = false;
    for (let attempt = 0; attempt < 2 && !navigated; attempt++) {
      await cardButton.click();
      navigated = await page
        .waitForURL(/\/videos\/player\?id=e2e-video-1/, { timeout: 15_000, waitUntil: 'commit' })
        .then(() => true)
        .catch(() => false);
      if (!navigated && !(await cardButton.isVisible().catch(() => false))) break;
    }
    await expect(page).toHaveURL(/\/videos\/player\?id=e2e-video-1/, { timeout: 30_000 });
    await expect(page.getByText('MCP 实战第一课', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('a[href="/videos/v/e2e-video-1"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /B站换源:/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: '返回视频中心' })).toBeVisible({ timeout: 30_000 });
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
