import { defineConfig, devices } from '@playwright/test';
import { E2E_DB_PATH } from './e2e/global-setup';

/**
 * 端口可覆盖（与本机常驻的开发服务器错开）：
 *   NAVHUB_WEB_PORT=3100 NAVHUB_API_PORT=8790 pnpm test:e2e
 * 默认仍是 3000 / 8787，与 CI 和日常开发一致。
 * `PLAYWRIGHT_TEST_BASE_URL` 仍可整体覆盖被测地址（webServer 也随之使用它）。
 */
const WEB_PORT = Number(process.env.NAVHUB_WEB_PORT || 3000);
const API_PORT = Number(process.env.NAVHUB_API_PORT || 8787);
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://localhost:${WEB_PORT}`;

/**
 * NavHub Playwright 端到端 (E2E) 自动化测试配置。
 *
 * 覆盖三大核心用户主干旅程：
 * 1. 首页混合检索与 0-RTT 意图微部件召回 (e2e/search.spec.ts)
 * 2. 模块化工作台快捷启动坞与看板持久化 (e2e/workbench.spec.ts)
 * 3. 管理后台 API Token 签发、明文保护与生命周期管理 (e2e/admin-token.spec.ts)
 *
 * 数据隔离：webServer 用独立数据库（data/e2e/navhub-e2e.db），每轮 globalSetup 清空重建。
 * 此前 E2E 直接写开发库 data/navhub.db，污染了 48 条 e2e-* 测试插件。
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // 单 Worker 避免本地 SQLite 发生并发写入锁争用
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.CI ? undefined : 'chrome',
      },
    },
  ],
  webServer: {
    // 包装层先重置 E2E 库再启动 dev-all：Playwright 先起 webServer 后跑 globalSetup，
    // 重置放在 globalSetup 会在 Windows 上因 API 已打开 SQLite 文件而 EBUSY。
    command: 'node scripts/e2e-web-server.mjs',
    url: BASE_URL,
    // 必须独占启动：复用端口上已存在的开发服务器会让用例重新写回开发库。
    // 因此本地跑 E2E 前请先停掉 pnpm dev:all（端口冲突会以明确报错终止，而不是静默污染）。
    // 若本机确实有常驻开发服务器，改用 NAVHUB_WEB_PORT / NAVHUB_API_PORT 换一套端口。
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NAVHUB_WEB_PORT: String(WEB_PORT),
      NAVHUB_API_PORT: String(API_PORT),
      NAVHUB_SQLITE_PATH: E2E_DB_PATH,
      // Next 16 的 dev server 按「输出目录」加单实例锁：本机已有 pnpm dev:all 在跑时，
      // 换端口也会被判定为「另一个 next dev 已运行」。E2E 用独立输出目录避开这把锁，
      // 同时不会读到/污染开发服务器的 .next 产物。
      // 并行会话各自跑 E2E 时这把锁同样会撞（两个进程共用 .next-e2e），
      // 所以留一个 `NAVHUB_E2E_DIST_DIR` 覆写口子；默认值不变。
      NEXT_DIST_DIR: process.env.NAVHUB_E2E_DIST_DIR || '.next-e2e',
      // 举报接口按 IP 限流 5 次/小时；E2E 用不同 XFF 模拟独立举报人，
      // 避免测试重试累计超过配额（仅测试进程生效，生产默认不信任 XFF）。
      NAVHUB_TRUST_PROXY: '1',
      // 审核上架/安装会同步重建向量索引。CI 冷启动没有模型缓存，首次
      // embedding 要从 hf-mirror 下载 ~24MB 模型（本地实测 9s，CI 更慢），
      // 足以把 15s/30s 的 UI 断言拖成超时且随网络抖动时绿时红。
      // E2E 不验证语义排序（search.spec 只测意图微部件），关掉后走关键词
      // 检索，安装/审核路径与状态机完全一致。
      NAVHUB_EMBEDDING_ENABLED: '0',
    },
  },
});
