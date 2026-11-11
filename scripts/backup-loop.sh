#!/bin/sh
# NavHub 自动备份旁路（DEV_BACKLOG A14）。
#
# 在 api 镜像里定时执行 scripts/backup.mjs（在线热备 + integrity_check +
# sha256 清单 + 轮换保留），与宿主机 cron 等价，但跟着 compose 一起部署，
# 不需要登上服务器单独配 crontab。由 docker-compose.yml 的 backup 服务
# （--profile backup）以本脚本为 entrypoint 运行。
#
# 环境变量：
#   NAVHUB_SQLITE_PATH                 源库（默认 /data/navhub.db）
#   NAVHUB_BACKUP_DIR                  备份输出目录（默认 /backups，独立卷）
#   NAVHUB_BACKUP_KEEP                 保留份数（默认 35，与 RUNBOOK 口径一致）
#   NAVHUB_BACKUP_INTERVAL_SECONDS     周期（默认 86400 = 每天一份）
#   NAVHUB_BACKUP_INITIAL_DELAY_SECONDS 首次备份前等待（默认 120：等 api 建库/迁移完成）
#
# 失败口径：单次失败把 backup.mjs 的退出码与输出原样留在容器日志里并继续
# 下一周期（不 crash-loop，免得 compose restart 策略把日志刷爆）；连续失败
# 请按 docs/BACKUP-RUNBOOK.md 的告警建议接监控，不要指望这里自愈。
set -u

DB="${NAVHUB_SQLITE_PATH:-/data/navhub.db}"
OUT="${NAVHUB_BACKUP_DIR:-/backups}"
KEEP="${NAVHUB_BACKUP_KEEP:-35}"
INTERVAL="${NAVHUB_BACKUP_INTERVAL_SECONDS:-86400}"
INITIAL_DELAY="${NAVHUB_BACKUP_INITIAL_DELAY_SECONDS:-120}"

echo "[backup-loop] 自动备份已启动：源库 $DB → $OUT（保留 $KEEP 份，周期 ${INTERVAL}s，首次延后 ${INITIAL_DELAY}s）"
sleep "$INITIAL_DELAY"

while true; do
  if node /app/scripts/backup.mjs --db "$DB" --out "$OUT" --keep "$KEEP"; then
    echo "[backup-loop] 本轮备份成功，${INTERVAL}s 后下一轮"
  else
    echo "[backup-loop] 错误：本轮备份失败（退出码见上），${INTERVAL}s 后重试" >&2
  fi
  sleep "$INTERVAL"
done
