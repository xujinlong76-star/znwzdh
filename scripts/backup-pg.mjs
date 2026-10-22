#!/usr/bin/env node
/**
 * NavHub PostgreSQL 备份脚本（standard 模式）。
 *
 * 为什么需要它：scripts/backup.mjs 只覆盖 lite（SQLite）。standard 模式跑在
 * PG + pgvector 上，没有备份脚本等于生产数据裸奔（运维手册 wiki/11 §5.2）。
 *
 * 用法：
 *   node scripts/backup-pg.mjs [--url <postgres://...>] [--out <dir>] [--keep <n>] [--no-rotate] [--docker <container>]
 *
 * 两种执行方式：
 *   - 宿主有 pg_dump：直接本地执行（默认）
 *   - --docker <container>：在容器内执行 `docker exec <container> pg_dump ...`，
 *     dump 内容走 stdout 落盘（适合宿主机没装 PostgreSQL 客户端的部署）
 *
 * 产物：<out>/navhub-pg-<时间戳>.dump（pg_dump -Fc 自定义格式，需用 pg_restore 恢复）。
 * 退出码：0 成功；1 失败（含产物为空 / 不可读）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  // 与 backup.mjs 对齐：35 份覆盖 purge_trash 的 30 天回收站窗口
  const args = { url: null, out: null, keep: 35, rotate: true, docker: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--keep") args.keep = Math.max(1, Number(argv[++i]) || 35);
    else if (a === "--docker") args.docker = argv[++i];
    else if (a === "--no-rotate") args.rotate = false;
    else if (a === "--help" || a === "-h") {
      console.log("用法: node scripts/backup-pg.mjs [--url <postgres://...>] [--out <dir>] [--keep <n>] [--no-rotate] [--docker <container>]  （默认保留 35 份）");
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}（--help 查看用法）`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const url = args.url ?? process.env.NAVHUB_DATABASE_URL;
if (!url) {
  console.error("缺少数据库连接：用 --url 或设置 NAVHUB_DATABASE_URL");
  process.exit(1);
}
const outDir = path.resolve(ROOT, args.out ?? "data/backups");
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const dest = path.join(outDir, `navhub-pg-${stamp}.dump`);

console.log(`目标:   ${dest}`);
console.log(`方式:   ${args.docker ? `docker exec ${args.docker}` : "本地 pg_dump"}`);

const t0 = Date.now();
let res;
if (args.docker) {
  // 容器内执行：dump 走 stdout，宿主机落盘（不依赖容器内的挂载路径）
  res = spawnSync("docker", ["exec", args.docker, "pg_dump", url, "-Fc"], {
    encoding: "buffer",
    maxBuffer: 1 << 30,
  });
  if (res.error) {
    console.error("执行 docker exec 失败:", res.error.message);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error("pg_dump 失败:", String(res.stderr || "").trim());
    process.exit(1);
  }
  writeFileSync(dest, res.stdout);
} else {
  res = spawnSync("pg_dump", [url, "-Fc", "-f", dest], { encoding: "utf8" });
  if (res.error) {
    console.error("执行 pg_dump 失败:", res.error.message);
    console.error("（宿主机没装 PostgreSQL 客户端时，改用 --docker <postgres 容器名>）");
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error("pg_dump 失败:", String(res.stderr || "").trim());
    process.exit(1);
  }
}

// 产物校验：空文件 / 读不出来等于没备份
if (!existsSync(dest) || statSync(dest).size === 0) {
  console.error("备份产物为空，备份失败");
  process.exit(1);
}
if (!args.docker) {
  // 能列出目录说明是合法的自定义格式归档
  const list = spawnSync("pg_restore", ["-l", dest], { encoding: "utf8" });
  if (list.status !== 0) {
    console.error("备份产物不是合法的自定义格式归档:", String(list.stderr || "").trim());
    process.exit(1);
  }
}

const size = statSync(dest).size;
console.log(`完成:   ${(size / 1024 / 1024).toFixed(2)} MB，耗时 ${Date.now() - t0} ms`);
console.log("恢复:   createdb <新库> && pg_restore -d <新库> --no-owner " + dest);

if (args.rotate) {
  const backups = readdirSync(outDir)
    .filter((f) => /^navhub-pg-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.dump$/.test(f))
    .map((f) => ({ f, mtime: statSync(path.join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of backups.slice(args.keep)) {
    unlinkSync(path.join(outDir, stale.f));
    console.log(`轮换删除: ${stale.f}`);
  }
  console.log(`保留最近 ${Math.min(args.keep, backups.length)} 份备份`);
}
