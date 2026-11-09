@echo off
chcp 65001 >nul
cd /d "C:\Users\88\Desktop\web\源码镜像"
git add -A
git commit -m "feat(v5): complete P0-P3 deep refactoring, a11y navigation, and governance ratchet cleanup"
git push origin main
pause
