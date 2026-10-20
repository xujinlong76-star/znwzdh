#!/usr/bin/env bash
set -euo pipefail

# 默认仓库配置
DEFAULT_REPO="xujinlong76-star/znwzdh"
REPO="${1:-$DEFAULT_REPO}"
TOKEN="${GITHUB_PAT:-}"

# 默认只提交已跟踪文件的修改；新增文件必须显式开启，避免把其他会话的
# WIP/临时文件一起卷进提交。
if [ "$REPO" = "--all" ]; then
  REPO="$DEFAULT_REPO"
  export NAVHUB_PUSH_ALL=1
fi
ALL="${NAVHUB_PUSH_ALL:-0}"

if [ ! -d ".git" ]; then
  echo "[git] 初始化本地仓库..."
  git init -b main
fi

if [ -n "$REPO" ]; then
  if [[ "$REPO" != http* ]] && [[ "$REPO" != git@* ]]; then
    TARGET_URL="https://github.com/${REPO}.git"
  else
    TARGET_URL="$REPO"
  fi

  EXISTING_URL="$(git remote get-url origin 2>/dev/null || true)"
  if [ -n "$EXISTING_URL" ] && [ "$EXISTING_URL" != "$TARGET_URL" ]; then
    if [ "${NAVHUB_PUSH_REPO_FORCE:-0}" != "1" ]; then
      echo "[git] origin 已指向 ${EXISTING_URL}，与目标 ${TARGET_URL} 不同。"
      echo "      为避免误改远端，已停止；如确需改绑，设 NAVHUB_PUSH_REPO_FORCE=1 后重试。"
      exit 1
    fi
    git remote set-url origin "$TARGET_URL"
  elif [ -z "$EXISTING_URL" ]; then
    git remote add origin "$TARGET_URL"
  fi
fi

if [ "$ALL" = "1" ]; then
  echo "[git] 暂存全部改动（含未跟踪文件；NAVHUB_PUSH_ALL=1）..."
  git add -A
else
  echo "[git] 只暂存已跟踪文件的修改；新增文件请设 NAVHUB_PUSH_ALL=1 或传 --all。"
  git add -u
fi

if git diff --cached --quiet; then
  echo "[git] 没有可提交的变更，直接推送当前 HEAD。"
else
  git commit -m "feat: complete codebase defect repair, architecture wiring, and parity sync"
fi

BRANCH="$(git branch --show-current)"
if [ -z "$BRANCH" ]; then
  echo "[git] 当前处于 detached HEAD，拒绝推送。"
  exit 1
fi

echo "[git] 推送至 origin/${BRANCH}..."
if [ -n "$TOKEN" ]; then
  # 使用一次性 HTTP Basic Header 传递 PAT，避免把明文 Token 写入 .git/config
  AUTH_B64=$(printf "x-access-token:%s" "$TOKEN" | base64 | tr -d '\n')
  git -c "http.https://github.com/.extraHeader=Authorization: Basic ${AUTH_B64}" push -u origin "$BRANCH"
else
  git push -u origin "$BRANCH"
fi
echo "[git] 推送成功！"
