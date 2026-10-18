#!/bin/sh
# NavHub API 容器入口。
#
# 职责：可选地导入内置种子数据，然后启动中枢。
#
# 为什么用 entrypoint 而不是在应用代码里判断：
#   首次启动的"是否为空库"判断属于部署编排问题，放在这里更清晰，
#   也让 `docker run` 与 compose 行为一致。
set -e

# ---- Session Secret 自举（升级改造方案 P0-1）----
# 生产环境拒绝公开可查的默认密钥：Web 侧 auth.config.ts 无 secret 直接抛错，
# API 侧 config.ts 拒绝已知占位值。未显式提供 NAVHUB_SESSION_SECRET 时：
#   1. 复用 /data/.session-secret（卷内持久，容器重启不失效）；
#   2. 首次启动生成 48 字符随机值落盘，api 与 web 两个容器共享同一份
#      （web 入口读同一路径，见 entrypoint-web.sh）。
# /data 不存在（未挂卷的裸跑）时跳过——此时生产无 secret 会由应用层
# fail-closed 拒绝启动，正是预期行为。
if [ -z "$NAVHUB_SESSION_SECRET" ] && [ -d /data ]; then
  if [ -f /data/.session-secret ]; then
    NAVHUB_SESSION_SECRET="$(cat /data/.session-secret)"
  else
    NAVHUB_SESSION_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
    printf '%s' "$NAVHUB_SESSION_SECRET" > /data/.session-secret
    chmod 600 /data/.session-secret 2>/dev/null || true
    echo "[navhub] 已生成随机 NAVHUB_SESSION_SECRET 并持久化到 /data/.session-secret（重启不失效；显式设置环境变量可覆盖）"
  fi
  export NAVHUB_SESSION_SECRET
fi

if [ "${NAVHUB_SEED_ON_START:-1}" = "1" ]; then
  echo "[navhub] 检查种子数据..."
  # runSeed 按 url 幂等去重，重复执行不会产生副本；
  # embedding 失败不会让启动失败（会降级为关键词+拼音检索）
  node apps/api/src/seed-main.ts || \
    echo "[navhub] 种子导入失败，继续启动（搜索仍可用）"
fi

echo "[navhub] 启动中枢..."
exec node apps/api/src/main.ts
