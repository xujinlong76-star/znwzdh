/**
 * Schema 迁移 CLI 入口。
 *
 * package.json 里早已声明 `migrate` 脚本，但此前文件缺失，`pnpm migrate` 会直接失败。
 * 本文件补上这个入口：打开数据库 -> 执行幂等列迁移 -> 报告结果。
 *
 * 注意：正常启动路径（main.ts -> createContext -> openDb）会自动执行同样的迁移，
 * 本入口的价值是「不启动服务也能升级 schema」，例如部署前预热、CI 校验。
 *
 * 与 seed-main.ts 同理：导入即执行，不做 import.meta.url 主模块判断
 * （Windows 上路径形式不一致曾导致脚本静默退出）。
 */
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { migrateColumns } from "@navhub/store";

const t0 = Date.now();
const config = loadConfig();
const ctx = await createContext(config);

// createContext -> openDb 已经跑过一次迁移；这里显式再执行并汇报，
// 返回值是「本次实际补齐的列」（空 = 已是最新）。
const added = await migrateColumns(ctx.db);

console.log("[migrate] 模式 " + config.mode + "，数据库 " + (config.mode === "lite" ? config.sqlitePath : "(postgresql)"));
if (added.length === 0) {
  console.log("[migrate] schema 已是最新，无需迁移");
} else {
  for (const a of added) console.log("[migrate] 已添加列: " + a);
}
console.log("[migrate] 完成，耗时 " + (Date.now() - t0) + " ms");

await ctx.close();
