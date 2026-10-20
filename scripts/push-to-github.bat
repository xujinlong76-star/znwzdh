@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM 自动推送到 GitHub 脚本 (Windows)
REM 默认只提交已跟踪文件的修改；新增文件需设 NAVHUB_PUSH_ALL=1 或传 --all。

set "DEFAULT_REPO=xujinlong76-star/znwzdh"
set "REPO=%~1"
if "%REPO%"=="" set "REPO=%DEFAULT_REPO%"
if "%REPO%"=="--all" (
  set "NAVHUB_PUSH_ALL=1"
  set "REPO=%DEFAULT_REPO%"
)

set "TOKEN=%GITHUB_PAT%"
if "%TOKEN%"=="" (
  echo [git] 未设置 GITHUB_PAT；将使用本机已有 Git 凭据，或请先设置环境变量。
)

if not exist ".git" (
  echo [git] 初始化本地仓库...
  git init -b main
)

if not "%REPO%"=="" (
  set "TARGET_URL=https://github.com/%REPO%.git"
  if /I "%REPO:~0,4%"=="http" set "TARGET_URL=%REPO%"
  if /I "%REPO:~0,4%"=="git@" set "TARGET_URL=%REPO%"

  set "EXISTING_URL="
  for /f "usebackq delims=" %%U in (`git remote get-url origin 2^>nul`) do set "EXISTING_URL=%%U"
  if defined EXISTING_URL (
    if /I not "!EXISTING_URL!"=="!TARGET_URL!" (
      if not "%NAVHUB_PUSH_REPO_FORCE%"=="1" (
        echo [git] origin 已指向 !EXISTING_URL!，与目标 !TARGET_URL! 不同。
        echo       为避免误改远端，已停止；如确需改绑，设 NAVHUB_PUSH_REPO_FORCE=1 后重试。
        exit /b 1
      )
      git remote set-url origin "!TARGET_URL!"
    )
  ) else (
    git remote add origin "!TARGET_URL!"
  )
)

if "%NAVHUB_PUSH_ALL%"=="1" (
  echo [git] 暂存全部改动（含未跟踪文件；NAVHUB_PUSH_ALL=1）...
  git add -A
) else (
  echo [git] 只暂存已跟踪文件的修改；新增文件请设 NAVHUB_PUSH_ALL=1 或传 --all。
  git add -u
)

git diff --cached --quiet
if errorlevel 1 (
  git commit -m "feat: complete codebase defect repair, architecture wiring, and parity sync"
  if errorlevel 1 exit /b 1
) else (
  echo [git] 没有可提交的变更，直接推送当前 HEAD。
)

set "BRANCH="
for /f "usebackq delims=" %%B in (`git branch --show-current`) do set "BRANCH=%%B"
if "%BRANCH%"=="" (
  echo [git] 当前处于 detached HEAD，拒绝推送。
  exit /b 1
)

echo [git] 推送至 origin/%BRANCH%...
if not "%TOKEN%"=="" (
  REM 通过临时环境变量经 PowerShell 生成一次性 Basic Auth 头，避免将明文 PAT 持久化到 .git/config
  for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('x-access-token:' + $env:TOKEN))"`) do set "AUTH_B64=%%A"
  git -c "http.https://github.com/.extraHeader=Authorization: Basic !AUTH_B64!" push -u origin "%BRANCH%"
  if errorlevel 1 exit /b 1
  set "AUTH_B64="
) else (
  git push -u origin "%BRANCH%"
  if errorlevel 1 exit /b 1
)
echo [git] 推送成功！
endlocal
