/**
 * PG 套件的「跳过可见 + 可选严格模式」守卫。
 *
 * 背景：三个 PG 套件在未配置 `NAVHUB_TEST_DATABASE_URL` 时整体 skip —— 本地没有 PG
 * 的开发机不该被这个文件弄红，这是正确的默认；但它也制造过「以为跑了 PG、实际
 * 0 条执行」的假象（2026-10-24 实测：两个套件在 CI 上其实是红的，因为本地长期
 * 跳过而没人发现，见 scripts/run-pg-suite.mjs 的注释）。
 *
 * 仓库已有主防线：
 *   1. `scripts/run-pg-suite.mjs`：显式入口，无连接串**直接退出 1**；
 *   2. `pg-suite-entry.test.ts`：用目录扫描钉住套件清单，漏登记就没有任何信号。
 *
 * 这里的增量是让**全量 vitest / coverage job** 里的跳过也看得见，并可按需强制：
 *   - 一律向 stderr 打醒目横幅（谁在跳过、为什么）；
 *   - 若 `NAVHUB_REQUIRE_PG=1`，则**直接抛错**拒绝静默跳过（CI 可显式开启；
 *     默认关闭，避免未注入 PG 的本地/CI 被误伤）。
 */
export function announcePgSkip(suite: string, reason: string): void {
  process.stderr.write(
    `\n[pg-guard] ⚠ ${suite} 整套跳过：${reason}\n` +
      "[pg-guard]   这条路径不产生任何 PG 覆盖；要真正跑它请用 pnpm test:pg:suite（无连接串会直接失败）。\n\n",
  );
  if (process.env.NAVHUB_REQUIRE_PG === "1") {
    throw new Error(`[pg-guard] ${suite} 被跳过，但 NAVHUB_REQUIRE_PG=1 —— 拒绝静默跳过（${reason}）`);
  }
}

/** 未配置连接串时的统一原因文案（避免各套件各写一份、口径漂移） */
export function pgEnvSkipReason(): string {
  return "未设置 NAVHUB_TEST_DATABASE_URL（需真实 PostgreSQL；CI 由 test-postgres job 注入）";
}