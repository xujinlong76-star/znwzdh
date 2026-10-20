import { defineConfig, devices } from '@playwright/test';
import { E2E_DB_PATH } from './e2e/global-setup';

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
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
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
    command: 'node scripts/dev-all.mjs',
    url: 'http://localhost:3000',
    // 必须独占启动：复用端口上已存在的开发服务器会让用例重新写回开发库。
    // 因此本地跑 E2E 前请先停掉 pnpm dev:all（端口冲突会以明确报错终止，而不是静默污染）。
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NAVHUB_SQLITE_PATH: E2E_DB_PATH,
    },
  },
});
