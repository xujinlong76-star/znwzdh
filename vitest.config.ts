import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 注意：排除 apps/web —— 那是 vendored 的上游底座，不是我们的测试目标
    include: ["packages/**/test/**/*.test.ts", "apps/api/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
});
