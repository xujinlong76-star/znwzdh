#!/bin/sh
# NavHub API 容器入口。
#
# 职责：可选地导入内置种子数据，然后启动中枢。
#
# 为什么用 entrypoint 而不是在应用代码里判断：
#   首次启动的"是否为空库"判断属于部署编排问题，放在这里更清晰，
#   也让 `docker run` 与 compose 行为一致。
set -e

# ---- Session Secret 自举（升级改造方案 P0-1；密钥分离见 A14）----
# 生产环境拒绝公开可查的默认密钥：Web 侧 auth.config.ts 无 secret 直接抛错，
# API 侧 config.ts 拒绝已知占位值。未显式提供 NAVHUB_SESSION_SECRET 时：
#   1. 复用密钥文件（卷内持久，容器重启不失效）；
#   2. 首次启动生成 48 字符随机值落盘，api 与 web 两个容器共享同一份
#      （web 入口读同一路径，见 entrypoint-web.sh）。
# 密钥文件路径由 NAVHUB_SESSION_SECRET_FILE 决定（默认 /data/.session-secret
# 与历史行为一致）。compose 部署把它指向独立的 navhub-secrets 卷
# （/secrets/.session-secret）：密钥不再与数据库同卷——备份数据库外流时
# 不会连 session 签名密钥一起丢，轮换/销毁密钥也不必动数据卷。
# 密钥文件所在目录不存在（未挂卷的裸跑）时跳过——此时生产无 secret 会由
# 应用层 fail-closed 拒绝启动，正是预期行为。
SECRET_FILE="${NAVHUB_SESSION_SECRET_FILE:-/data/.session-secret}"
if [ -z "$NAVHUB_SESSION_SECRET" ] && [ -d "$(dirname "$SECRET_FILE")" ]; then
  if [ -f "$SECRET_FILE" ]; then
    NAVHUB_SESSION_SECRET="$(cat "$SECRET_FILE")"
  else
    NAVHUB_SESSION_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
    printf '%s' "$NAVHUB_SESSION_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE" 2>/dev/null || true
    echo "[navhub] 已生成随机 NAVHUB_SESSION_SECRET 并持久化到 $SECRET_FILE（重启不失效；显式设置环境变量可覆盖）"
  fi
  export NAVHUB_SESSION_SECRET
fi

if [ "${NAVHUB_SEED_ON_START:-1}" = "1" ] && [ "$#" -eq 0 ]; then
  # 带自定义命令时不种子：那是另一个进程（如 MCP 传输），它连的是同一个 /data 卷，
  # 由它再写一遍种子只会和中枢同时抢 SQLite 的写锁，且幂等去重救不了并发。
  echo "[navhub] 检查种子数据..."
  # runSeed 按 url 幂等去重，重复执行不会产生副本；
  # embedding 失败不会让启动失败（会降级为关键词+拼音检索）
  node apps/api/src/seed-main.ts || \
    echo "[navhub] 种子导入失败，继续启动（搜索仍可用）"
fi

# `docker compose ... run` / `docker run <image> <cmd>` 传进来的命令必须尊重。
# 原来这里无条件 exec 中枢：docker-compose.yml 的 mcp 服务写着
#   command: ["node", "packages/mcp/src/http.ts"]
# 却被 entrypoint 整个丢掉，容器实际起的是**第二个 lite 中枢**（还挂着同一个 /data 卷，
# 与真正的 api 抢同一个 SQLite），而 8790 上什么都没有 —— compose 显示"已启动"，
# 端口连不上，排查时看不出任何异常。
if [ "$#" -gt 0 ]; then
  echo "[navhub] 使用外部命令: $*"
  exec "$@"
fi
echo "[navhub] 启动中枢..."
exec node apps/api/src/main.ts
