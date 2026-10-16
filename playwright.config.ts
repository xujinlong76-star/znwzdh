import { defineConfig, devices } from '@playwright/test';

/**
 * NavHub Playwright 端到端 (E2E) 自动化测试配置。
 *
 * 覆盖三大核心用户主干旅程：
 * 1. 首页混合检索与 0-RTT 意图微部件召回 (e2e/search.spec.ts)
 * 2. 模块化工作台快捷启动坞与看板持久化 (e2e/workbench.spec.ts)
 * 3. 管理后台 API Token 签发、明文保护与生命周期管理 (e2e/admin-token.spec.ts)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
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
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
