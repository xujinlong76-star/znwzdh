#!/bin/sh
# Web standalone 镜像入口（Dockerfile.web.slim 专用）。
# 与 docker/entrypoint-web.sh 的差别只有最后一行：standalone 用 node server.js，不是 pnpm start。
set -e
if [ -z "$NAVHUB_SESSION_SECRET" ]; then
  if [ -f /data/.session-secret ]; then
    NAVHUB_SESSION_SECRET="$(cat /data/.session-secret)"
  else
    NAVHUB_SESSION_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
    echo "[navhub-web-slim] 未发现 /data/.session-secret（api 尚未启动？），已生成临时 secret——本容器重启后所有 session 将失效"
  fi
  export NAVHUB_SESSION_SECRET
fi
# standalone 产物把 server.js 放在 workspace 根（未设 outputFileTracingRoot）
exec node /app/server.js
