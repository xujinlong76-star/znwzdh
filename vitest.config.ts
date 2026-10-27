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
      // overlay 的纯逻辑模块（面板状态机等）测试：overlay 是自有代码事实源，
      // 逻辑测试放 test/ 而不是 scripts/，两者都要被收集，否则写好的测试不会被执行。
      "apps/web-overlay/test/**/*.test.ts",
      // 仓库根 scripts/ 下的本地脚手架（vendor-web 的搬运逻辑等）也要有回归测试
      "scripts/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    maxWorkers: 3,
    // isolate:false 经两轮深研后维持关闭（2026-10-25）：
    //  - 收益实测 457s→149s，但跨文件污染源不止两处——vi.mock 的模块缓存与
    //    process.env 改动按 worker 持久，失败组合随 worker 调度随机，无法稳定收敛；
    //  - 已对全部 vi.mock 使用文件补 afterAll(vi.resetModules) 卫生（11 文件），
    //    两处显式 env 改动补复位——这些修复无论隔离与否都正确，予以保留；
    //  - 若未来要重启此优化：先建「vi.mock/env 改动必须 afterAll 清理」的
    //    lint 规则，再按 worker 分组灰度。详见 docs/NEXT-STEPS-PLAN D2。
    execArgv: ["--max-old-space-size=4096"],
    coverage: {
      // 覆盖率只统计本仓库自己维护的后端与核心包源码：
      // apps/web 是 vendored 的上游底座（apps/web/src 由 overlay 生成），
      // 把它算进来只会稀释数字且无意义，故不纳入。
      provider: "v8",
      include: ["apps/api/src/**", "packages/*/src/**"],
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/node_modules/**"],
      // reporter 组合：
      // - text          : 终端可读摘要（跑完立刻能看）
      // - json-summary  : coverage-summary.json，只有 total + 每文件汇总（脚本读取它）
      // - json          : coverage-final.json，逐行明细，供后续做「零覆盖文件」下钻
      reporter: ["text", "json-summary", "json"],
      // 产物统一落在仓库根 coverage/（已 gitignore）。
      // scripts/check-coverage.mjs 里的 COVERAGE_DIR 常量必须与此保持一致。
      reportsDirectory: "./coverage",
      // 关掉 vitest 自带的产物清理：它会在收尾时整体删除 coverage/.tmp（几百个文件），
      // 被本机的批量删除护栏拦下 → 抛错 → `reportsDirectory` 里只剩半成品，
      // coverage-summary.json 根本没写出来，脚本读到的就是空。
      // 不清理只是留下 .tmp 与上一轮的残留，两者都在被 gitignore 的 coverage/ 内，无副作用。
      clean: false,
      cleanAfterRun: false,
    },
  },
});
