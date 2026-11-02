/**
 * 恢复 staging 目录的唯一解析点。
 *
 * 请求侧（`POST /api/backup/restore/async`）把规范化计划落盘，任务侧
 * （`runBackupRestore`）再读回来。两侧必须解析到**同一个目录**，否则白名单
 * 校验会在合法路径上误伤；读写各自 `resolve(process.env...)` 就迟早漂移。
 *
 * 为什么任务侧也要校验而不只在端点校验：`POST /api/jobs` 能直接入队
 * `backup_restore` 并自带 `stagingPath`，端点生成路径不代表所有路径都可信。
 * 任务侧是唯一消费者，把「只读 staging 目录内的文件」放在这里，等于给这条
 * 契约一个不可绕过的边界——任何入队来源（端点、运维脚本、将来的调度器）
 * 都受同一条约束。
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

/** staging 目录；每次调用时读 env，测试可以在启动后改写 */
export function restoreStagingDir(): string {
  return resolve(process.env.NAVHUB_RESTORE_STAGING_DIR || "data/restore-staging");
}

/**
 * 校验并归一化 staging 路径，返回可直接 `readFile` 的绝对路径。
 *
 * 拒绝：目录本身、目录之外的路径、跨盘符路径（`relative` 会返回绝对路径）。
 * 目录内的符号链接不在防护范围（能在 staging 目录里造链接的主体，已经能直接
 * 改库）；这里挡的是「把任意 JSON 文件当恢复计划读」这一类越界。
 */
export function assertRestoreStagingPath(raw: string, dir = restoreStagingDir()): string {
  const base = resolve(dir);
  const path = resolve(raw);
  const rel = relative(base, path);
  const escapes = !rel || isAbsolute(rel) || rel.split(/[\\/]/)[0] === "..";
  if (escapes) {
    throw new Error(`backup_restore 的 stagingPath 必须位于 staging 目录内：${base}${sep}`);
  }
  return path;
}
