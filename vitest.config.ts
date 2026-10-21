import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // apps/web 的库代码用 @/* 别名（见 apps/web/tsconfig.json 的 paths）。
    // 用正则精确匹配 "@/" 前缀，避免误伤 "@scope/pkg" 形式的依赖导入。
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./apps/web/src", import.meta.url)).replace(/\\/g, "/") + "/",
      },
    ],
  },
  test: {
    // 注意：apps/web 整体是 vendored 的上游底座，默认排除。
    // 测试从 apps/web/test 运行（它是 vendor 从 apps/web-overlay/test 生成的镜像）：
    // overlay 目录没有自己的 node_modules（pnpm workspace 显式排除了它），
    // 直接跑 overlay/test 会因 react/next/lucide 等裸包解析失败而整套报错。
    // 代价：只改 overlay 测试时本地不会立刻生效——verify/pre-commit 的
    // check-web-overlay 会强制 overlay -> apps/web 同步，同步后再跑即生效。
    // apps/web/scripts/*.test.ts 是上游遗留、无人运行，继续排除。
    include: [
      "packages/**/test/**/*.test.ts",
      "apps/api/test/**/*.test.ts",
      "apps/web/test/**/*.test.ts",
      "apps/web-overlay/scripts/**/*.test.ts",
      // 仓库根 scripts/ 下的本地脚手架（vendor-web 的搬运逻辑等）也要有回归测试
      "scripts/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    maxWorkers: 3,
    execArgv: ["--max-old-space-size=4096"],
  },
});
