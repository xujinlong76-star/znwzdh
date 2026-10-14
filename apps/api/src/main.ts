/**
 * 服务入口。
 *
 * 为什么不直接在 server.ts 里判断 import.meta.url 来启动：
 *   Windows 上 process.argv[1] 的盘符大小写与斜杠形式与 import.meta.url 不一定一致，
 *   这种"是否作为主模块运行"的判断在跨平台时很脆，曾经导致直接运行 server.ts 时
 *   **静默退出且没有任何输出**（比报错更难排查）。
 *   因此把启动逻辑放在独立入口，导入即启动，不依赖任何主模块判断。
 */
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { buildServer } from "./server.ts";
import { JobRunner, MAX_JOB_ATTEMPTS } from "./jobs.ts";

const config = loadConfig();
const ctx = await createContext(config);
const app = await buildServer(ctx);

// 任务 Runner：定时健康巡检 / 元数据刷新 / 热度重算 / 索引重建。
// 默认开启（单实例锁保证多副本只有一个在跑）；NAVHUB_JOBS_ENABLED=0 关闭。
const jobsEnabled = process.env.NAVHUB_JOBS_ENABLED !== "0" && process.env.NAVHUB_JOBS_ENABLED !== "false";
const runner = jobsEnabled ? new JobRunner(ctx) : null;
if (runner) runner.start();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "正在关闭");
  try { runner?.stop(); } catch { /* 尽力而为 */ }
  try { await app.close(); await ctx.close(); } catch { /* 尽力而为 */ }
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: config.host });

// 启动横幅：把"能不能用 AI"这类关键信息直接打出来，便于排障
console.log("=".repeat(64));
console.log("NavHub 已启动");
console.log("  监听    http://" + config.host + ":" + config.port);
console.log("  模式    " + config.mode);
console.log("  语义检索 " + (ctx.capabilities.semantic ? "可用" : "不可用"));
console.log("  全文检索 " + (ctx.capabilities.fts ? "可用" : "不可用"));
console.log("  LLM 富化 " + (ctx.capabilities.llm ? "可用" : "不可用（降级为启发式）"));
console.log("  任务队列 " + (runner ? "已启动（" + Math.round(runner.interval / 1000) + "s 轮询，单实例锁；失败指数退避重试 " + MAX_JOB_ATTEMPTS + " 次）" : "已关闭（NAVHUB_JOBS_ENABLED=0）"));
for (const n of ctx.capabilities.notes) console.log("  · " + n);
console.log("=".repeat(64));
