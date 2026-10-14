@echo off
REM 自动推送到 GitHub 脚本 (Windows)

set DEFAULT_REPO=xujinlong76-star/znwzdh
set REPO=%1
if "%REPO%"=="" set REPO=%DEFAULT_REPO%

set TOKEN=%GITHUB_PAT%
if "%TOKEN%"=="" set TOKEN=%2

if not exist ".git" (
  echo [git] 初始化本地仓库...
  git init -b main
)

if not "%REPO%"=="" (
  echo [git] 绑定远端仓库: %REPO%
  git remote remove origin 2>nul
  if not "%TOKEN%"=="" (
    git remote add origin https://%TOKEN%@github.com/%REPO%.git
  ) else (
    git remote add origin https://github.com/%REPO%.git
  )
)

echo [git] 暂存并提交代码...
git add -A
git commit -m "feat: complete codebase defect repair, architecture wiring, and parity sync" 2>nul
echo [git] 推送至 GitHub main 分支...
git push -u origin main
echo [git] 推送成功！
