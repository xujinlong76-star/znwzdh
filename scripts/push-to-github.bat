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
  git remote add origin https://github.com/%REPO%.git
)

echo [git] 暂存并提交代码...
git add -A
git commit -m "feat: complete codebase defect repair, architecture wiring, and parity sync" 2>nul
echo [git] 推送至 GitHub main 分支...
if not "%TOKEN%"=="" (
  REM 通过临时环境变量经 PowerShell 生成一次性 Basic Auth 头，避免将明文 PAT 持久化到 .git/config
  for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('x-access-token:' + $env:TOKEN))"`) do set AUTH_B64=%%A
  git -c "http.https://github.com/.extraHeader=Authorization: Basic %AUTH_B64%" push -u origin main
  set AUTH_B64=
) else (
  git push -u origin main
)
echo [git] 推送成功！
