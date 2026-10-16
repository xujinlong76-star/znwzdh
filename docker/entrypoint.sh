#!/bin/sh
# NavHub API 容器入口。
#
# 职责：可选地导入内置种子数据，然后启动中枢。
#
# 为什么用 entrypoint 而不是在应用代码里判断：
#   首次启动的"是否为空库"判断属于部署编排问题，放在这里更清晰，
#   也让 `docker run` 与 compose 行为一致。
set -e

if [ "${NAVHUB_SESSION_SECRET:-}" = "change-me-in-production-min-32-chars-secret-key" ]; then
  echo "[navhub] 警告：正在使用默认占位 NAVHUB_SESSION_SECRET，仅适合本地试用；" >&2
  echo "[navhub] 警告：生产部署请务必通过环境变量设置一个随机长 secret。" >&2
fi

if [ "${NAVHUB_SEED_ON_START:-1}" = "1" ]; then
  echo "[navhub] 检查种子数据..."
  # runSeed 按 url 幂等去重，重复执行不会产生副本；
  # embedding 失败不会让启动失败（会降级为关键词+拼音检索）
  node --experimental-strip-types apps/api/src/seed-main.ts || \
    echo "[navhub] 种子导入失败，继续启动（搜索仍可用）"
fi

echo "[navhub] 启动中枢..."
exec node --experimental-strip-types apps/api/src/main.ts
