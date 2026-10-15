#!/usr/bin/env bash
set -e

# 默认仓库配置
DEFAULT_REPO="xujinlong76-star/znwzdh"
REPO="${1:-$DEFAULT_REPO}"
TOKEN="${GITHUB_PAT:-$2}"

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
  echo "[git] 绑定远端仓库: $REPO"
  git remote remove origin 2>/dev/null || true
  git remote add origin "$TARGET_URL"
fi

echo "[git] 暂存并提交代码..."
git add -A
git commit -m "feat: complete codebase defect repair, architecture wiring, and parity sync" 2>/dev/null || echo "[git] 工作区干净，无新改动需提交"

echo "[git] 推送至 GitHub main 分支..."
if [ -n "$TOKEN" ]; then
  # 使用一次性 HTTP Basic Header 传递 PAT，避免把明文 Token 写入 .git/config
  AUTH_B64=$(printf "x-access-token:%s" "$TOKEN" | base64 | tr -d '\n')
  git -c "http.https://github.com/.extraHeader=Authorization: Basic ${AUTH_B64}" push -u origin main
else
  git push -u origin main
fi
echo "[git] 推送成功！"
