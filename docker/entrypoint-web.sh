#!/bin/sh
# NavHub Web 容器入口（升级改造方案 P0-1）。
#
# 职责：与 api 容器共享同一份 session secret。api 入口（entrypoint.sh）
# 在首次启动时把随机密钥持久化到共享卷 /data/.session-secret，这里复用它，
# 保证「同一次 compose 部署里 api 与 web 的 session 签名密钥一致」且
# 「容器重启后已登录用户的 session 不失效」。
#
# api 尚未启动（/data/.session-secret 不存在）时生成临时值自举——
# web 单独运行的场景仍可启动；此路径下重启 web 会使 session 全部失效，
# 启动日志有明确提示。
set -e

if [ -z "$NAVHUB_SESSION_SECRET" ]; then
  if [ -f /data/.session-secret ]; then
    NAVHUB_SESSION_SECRET="$(cat /data/.session-secret)"
  else
    NAVHUB_SESSION_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
    echo "[navhub-web] 未发现 /data/.session-secret（api 尚未启动？），已生成临时 secret——本容器重启后所有 session 将失效"
  fi
  export NAVHUB_SESSION_SECRET
fi

exec pnpm start
