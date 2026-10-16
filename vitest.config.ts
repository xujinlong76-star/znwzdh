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
    // 唯一例外是 apps/web/test —— 只放我们针对存储接缝自己写的测试
    // （src/lib/github.ts 与 src/lib/storage-adapter.ts 受 .gitignore
    // 白名单保护、由本仓库维护，是 NavHub 改造的核心接缝）。
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
