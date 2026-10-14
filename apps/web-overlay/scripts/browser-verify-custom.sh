#!/bin/bash
# /custom 模块化系统最终复验 v2（单次调用内完成）
# 修正：eval 输出引号剥离；375px 断言改为 <=；僵尸卡测试改为验证"加载时净化"（降级卡为防御性兜底）
AB="agent-browser"
BASE="http://localhost:3010"
pass=0; fail=0
ok()   { echo "PASS: $1"; pass=$((pass+1)); }
bad()  { echo "FAIL: $1"; fail=$((fail+1)); }
# eval 输出形如 "xxx"（JSON 字符串），统一剥引号
ev() { $AB eval "$1" 2>/dev/null | tr -d '"'; }

$AB open "$BASE/custom" > /dev/null 2>&1
$AB wait 3000

echo "=== [1] 加载后 console/errors（基线）==="
$AB errors 2>&1 | head -10
$AB console 2>&1 | grep -iE "error|warning" | head -8

echo "=== [2] 默认模块渲染 ==="
ev "document.querySelectorAll('.grid.grid-cols-12 > div').length + ' cards'"

echo "=== [3] 进入编辑模式 ==="
$AB find text "自定义排版" click > /dev/null 2>&1
$AB wait 800
ev "document.body.innerText.includes('编辑模式') ? 'edit-mode-ON' : 'edit-mode-OFF'"

echo "=== [4] 拖拽劫持修复复验（真实鼠标拖缩放手柄）==="
$AB scrollintoview '[title*="当前尺寸"]' > /dev/null 2>&1
$AB wait 400
COORDS=$(ev "(() => { const hs = document.querySelectorAll('[title*=\"当前尺寸\"]'); if (!hs.length) return 'NOHANDLE'; const r = hs[0].getBoundingClientRect(); return Math.round(r.x + r.width/2) + ',' + Math.round(r.y + r.height/2); })()")
echo "首张卡片缩放手柄坐标: $COORDS"
X=$(echo "$COORDS" | cut -d, -f1); Y=$(echo "$COORDS" | cut -d, -f2)
BEFORE=$(ev "document.querySelector('[title*=\"当前尺寸\"]').parentElement.className" | grep -oE 'lg:col-span-[0-9]+' | head -1)
echo "拖拽前: $BEFORE"
if [ -n "$X" ] && [ "$X" != "NOHANDLE" ]; then
  $AB mouse move "$X" "$Y" > /dev/null 2>&1
  $AB mouse down > /dev/null 2>&1
  $AB wait 150
  $AB mouse move $((X+40)) "$Y" > /dev/null 2>&1
  $AB mouse move $((X+90)) "$Y" > /dev/null 2>&1
  $AB mouse move $((X+130)) "$Y" > /dev/null 2>&1
  $AB wait 250
  $AB mouse up > /dev/null 2>&1
  $AB wait 600
  AFTER=$(ev "document.querySelector('[title*=\"当前尺寸\"]').parentElement.className" | grep -oE 'lg:col-span-[0-9]+' | head -1)
  echo "拖拽后: $AFTER"
  if [ -n "$AFTER" ] && [ "$BEFORE" != "$AFTER" ]; then ok "缩放手柄真实鼠标拖拽生效（$BEFORE → $AFTER，未被原生拖拽劫持）"; else bad "缩放未生效（$BEFORE → $AFTER）"; fi
else
  bad "找不到缩放手柄"
fi

echo "=== [5] Ctrl+Z 撤销缩放 ==="
$AB press Control+z > /dev/null 2>&1
$AB wait 600
UNDONE=$(ev "document.querySelector('[title*=\"当前尺寸\"]').parentElement.className" | grep -oE 'lg:col-span-[0-9]+' | head -1)
if [ "$UNDONE" = "$BEFORE" ]; then ok "撤销恢复到拖拽前尺寸（$UNDONE）"; else bad "撤销异常（期望 $BEFORE，实际 $UNDONE）"; fi

echo "=== [6] 失效模块类型：加载时净化（防僵尸卡片）==="
ev "localStorage.setItem('navhub_modular_multi_boards_v2', JSON.stringify({version:2,activeBoardId:'default',boards:[{id:'default',name:'回归测试看板',widgets:[{id:'z1',type:'ghost-widget',colSpan:6,rowSpan:1,config:{},createdAt:1},{id:'z2',type:'clock-pomodoro',colSpan:3,rowSpan:1,config:{},createdAt:2}]}]})) && 'injected'"
$AB reload > /dev/null 2>&1
$AB wait 3000
SANITIZED=$(ev "(() => { const cards = document.querySelectorAll('.grid.grid-cols-12 > div').length; const hasGhost = document.body.innerText.includes('模块已失效'); return 'cards=' + cards + ' ghostCard=' + hasGhost; })()")
echo "净化结果: $SANITIZED"
case "$SANITIZED" in
  cards=1*) ok "失效模块类型在加载时被净化，仅渲染有效模块（$SANITIZED）" ;;
  *) bad "净化异常: $SANITIZED" ;;
esac
CLOCK_OK=$(ev "document.body.innerText.includes('本地精准时钟') ? 'clock-ok' : 'clock-missing'")
if [ "$CLOCK_OK" = "clock-ok" ]; then ok "有效模块（时钟）正常渲染"; else bad "有效模块未渲染"; fi

echo "=== [7] 外部写入同步（固定站点事件，无需刷新）==="
# 注意：type 必须是注册表中的有效类型（weather-clock）；无效类型会被 sanitize 净化过滤（属预期防僵尸行为）
ev "(() => { const KEY='navhub_modular_multi_boards_v2'; const raw = JSON.parse(localStorage.getItem(KEY)); raw.boards[0].widgets.push({id:'ext1',type:'weather-clock',colSpan:4,rowSpan:1,config:{},createdAt:Date.now()}); localStorage.setItem(KEY, JSON.stringify(raw)); window.dispatchEvent(new Event('navhub_workbench_updated')); return 'dispatched'; })()"
$AB wait 1500
SYNC=$(ev "(() => { const KEY='navhub_modular_multi_boards_v2'; const cards = document.querySelectorAll('.grid.grid-cols-12 > div').length; const ls = JSON.parse(localStorage.getItem(KEY)).boards[0].widgets.length; return 'cards=' + cards + ' ls=' + ls; })()")
echo "同步结果: $SYNC"
case "$SYNC" in
  cards=2\ ls=2*) ok "navhub_workbench_updated 事件驱动 UI 热更新（无需手动刷新）" ;;
  *) bad "外部同步事件未生效: $SYNC" ;;
esac

echo "=== [8] 375px 响应式 ==="
$AB set viewport 375 812 > /dev/null 2>&1
$AB wait 1000
OVF=$(ev "(() => { const de = document.documentElement; let over = 0; document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && (r.right > 377 || r.left < -2)) over++; }); return de.scrollWidth + '|' + over; })()")
SW=$(echo "$OVF" | cut -d'|' -f1); OVER=$(echo "$OVF" | cut -d'|' -f2)
echo "scrollWidth=$SW 溢出元素=$OVER"
if [ "$SW" -le 375 ] && [ "$OVER" -eq 0 ]; then ok "375px 无横向溢出"; else bad "375px 存在横向溢出: scrollWidth=$SW over=$OVER"; fi

echo "=== [9] 截图存档 ==="
$AB screenshot "/tmp/navhub-custom-375.png" > /dev/null 2>&1 && echo "saved 375"
$AB set viewport 1440 900 > /dev/null 2>&1
$AB wait 500
$AB screenshot "/tmp/navhub-custom-1440.png" > /dev/null 2>&1 && echo "saved 1440"

echo "=== [10] 最终 console/errors ==="
$AB errors 2>&1 | head -10
$AB console 2>&1 | grep -iE "error" | head -8

echo ""
echo "=== 结果: PASS=$pass FAIL=$fail ==="
# 注意：connect 模式下不 close（否则会杀掉手动启动的 Chromium）
exit 0
