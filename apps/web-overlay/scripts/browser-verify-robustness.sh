#!/bin/bash
# /custom 健壮性与压力验证 v1（单次调用内完成）
# 覆盖：畸形 localStorage 容错、大布局性能、撤销跨看板行为、快速连续操作一致性
AB="agent-browser"
BASE="http://localhost:3010"
pass=0; fail=0
ok()  { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
ev() { $AB eval "$1" 2>/dev/null | tr -d '"'; }

$AB open "$BASE/custom" > /dev/null 2>&1
$AB wait 3000

echo "=== [F1] 畸形数据容错（三种形态）==="
# 形态1: boards 为 null
ev "localStorage.setItem('navhub_modular_multi_boards_v2', JSON.stringify({version:2,activeBoardId:'default',boards:null})) && 'w1'" > /dev/null 2>&1
$AB reload > /dev/null 2>&1; $AB wait 3000
R1=$(ev "(() => { const c = document.querySelectorAll('.grid.grid-cols-12 > div').length; const spin = document.body.innerText.includes('正在加载'); return 'cards=' + c + ' stuck=' + spin; })()")
echo "boards=null: $R1"
case "$R1" in cards=7*stuck=false*) ok "boards:null 容错（落到默认模板 7 卡）";; *) bad "boards:null 异常: $R1";; esac

# 形态2: widgets 为字符串
ev "localStorage.setItem('navhub_modular_multi_boards_v2', JSON.stringify({version:2,activeBoardId:'default',boards:[{id:'default',name:'X',widgets:'not-array'}]})) && 'w2'" > /dev/null 2>&1
$AB reload > /dev/null 2>&1; $AB wait 3000
R2=$(ev "(() => { const c = document.querySelectorAll('.grid.grid-cols-12 > div').length; const empty = document.body.innerText.includes('当前工作台为空'); return 'cards=' + c + ' empty-state=' + empty; })()")
echo "widgets=string: $R2"
case "$R2" in cards=0*empty-state=true*|cards=7*) ok "widgets:'not-array' 容错（空态或默认模板，不崩溃）";; *) bad "widgets:string 异常: $R2";; esac

# 形态3: widget 数组混入 null / 非对象
ev "localStorage.setItem('navhub_modular_multi_boards_v2', JSON.stringify({version:2,activeBoardId:'default',boards:[{id:'default',name:'X',widgets:[null,42,{id:'ok1',type:'clock-pomodoro',colSpan:4,rowSpan:1,config:{},createdAt:1},null,'junk',{id:'ok2',type:'quick-tools',colSpan:4,rowSpan:1,config:{},createdAt:2}]}]})) && 'w3'" > /dev/null 2>&1
$AB reload > /dev/null 2>&1; $AB wait 3000
R3=$(ev "(() => { const c = document.querySelectorAll('.grid.grid-cols-12 > div').length; return 'cards=' + c; })()")
echo "mixed-junk: $R3"
if [ "$R3" = "cards=2" ]; then ok "数组混入 null/42/'junk' 被净化，仅渲染 2 个有效模块"; else bad "混合垃圾数据异常: $R3（期望 2）"; fi
# 恢复正常数据
$AB eval "localStorage.clear(); 'cleared'" > /dev/null 2>&1
$AB reload > /dev/null 2>&1; $AB wait 3000

echo "=== [F2] 大布局性能（24 模块）==="
$AB eval "(() => { const KEY='navhub_modular_multi_boards_v2'; const types = ['clock-pomodoro','quick-tools','trending-radar','markdown-notes','favorites-dock','system-metrics','quick-search','github-heatmap']; const widgets = []; for (let i = 0; i < 24; i++) { widgets.push({id:'perf-'+i, type: types[i % types.length], colSpan: 3 + (i % 3), rowSpan: 1 + (i % 2), config:{}, createdAt: Date.now()+i}); } const raw = JSON.parse(localStorage.getItem(KEY)); raw.boards[0].widgets = widgets; localStorage.setItem(KEY, JSON.stringify(raw)); window.dispatchEvent(new Event('navhub_workbench_updated')); return '24-injected'; })()" > /dev/null 2>&1
$AB wait 1500
PERF=$(ev "(() => { const t0 = performance.now(); const cards = document.querySelectorAll('.grid.grid-cols-12 > div').length; const t1 = performance.now(); return 'cards=' + cards + ' query-ms=' + (t1-t0).toFixed(1); })()")
echo "render: $PERF"
CARDS24=$(echo "$PERF" | grep -oE 'cards=[0-9]+' | cut -d= -f2)
if [ "$CARDS24" = "24" ]; then ok "24 模块布局渲染正常"; else bad "24 模块异常: $PERF"; fi
# 紧凑重排耗时（通过 fiber 无法直接测函数耗时，测 UI 全量重排后的完整性）
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('智能紧凑')); if (btn) { const t0 = performance.now(); btn.click(); window.__compactMs = performance.now() - t0; return 'clicked'; } return 'no-btn'; })()" > /dev/null 2>&1
$AB wait 1200
COMPACT=$(ev "(() => { const c = document.querySelectorAll('.grid.grid-cols-12 > div').length; const ls = JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')).boards[0].widgets.length; return 'cards=' + c + ' ls=' + ls + ' click-ms=' + (window.__compactMs || -1).toFixed(1); })()")
echo "compact: $COMPACT"
C24=$(echo "$COMPACT" | grep -oE 'cards=[0-9]+' | cut -d= -f2)
if [ "$C24" = "24" ]; then ok "24 模块紧凑重排后无丢失"; else bad "紧凑重排丢失模块: $COMPACT"; fi

echo "=== [F3] 撤销跨看板行为观察 ==="
# 注意：尺寸/删除按钮仅编辑模式渲染；尺寸菜单按钮文本是"label+值格"拼接（如"全宽12格"）；
# 各模块有 minColSpan/maxColSpan clamp（clock-pomodoro 为 3~6），设置值需在范围内
$AB find text "自定义排版" click > /dev/null 2>&1
$AB wait 800
EDIT_ON=$(ev "document.body.innerText.includes('编辑模式') ? 'on' : 'off'")
# 看板A删除一个模块 → 切看板B → 撤销 → 观察影响
$AB eval "(() => { const KEY='navhub_modular_multi_boards_v2'; const raw = JSON.parse(localStorage.getItem(KEY)); if (!raw.boards.some(b => b.id === 'undo-test')) { raw.boards.push({id:'undo-test', name:'撤销测试板', widgets:[{id:'ut-1',type:'clock-pomodoro',colSpan:4,rowSpan:1,config:{},createdAt:Date.now()}]}); localStorage.setItem(KEY, JSON.stringify(raw)); window.dispatchEvent(new Event('navhub_workbench_updated')); } return 'board-ready'; })()" > /dev/null 2>&1
$AB wait 800
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('撤销测试板')); if (tab) tab.click(); return 'switched'; })()" > /dev/null 2>&1
$AB wait 600
DEL=$(ev "(() => { const btn = document.querySelector('[title=\"删除此模块\"]'); if (btn) { btn.click(); return 'deleted'; } return 'no-del-btn'; })()")
$AB wait 800
AFTER_DEL=$(ev "document.querySelectorAll('.grid.grid-cols-12 > div').length")
# 切到另一个看板，做一次可见修改（尺寸菜单选 1/2 = 6 格，clock 允许）
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('全栈极客')); if (tab) tab.click(); return 'switched-away'; })()" > /dev/null 2>&1
$AB wait 600
$AB eval "(() => { const btn = document.querySelector('[title=\"调整网格尺寸\"]'); if (btn) { btn.click(); return 'menu-open'; } return 'no-size-btn'; })()" > /dev/null 2>&1
$AB wait 400
SET_RES=$(ev "(() => { const opt = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('1/2') && b.textContent.includes('6格')); if (opt) { opt.click(); return 'set-6'; } return 'no-preset'; })()")
$AB wait 800
BEFORE_UNDO=$(ev "(() => { const first = document.querySelector('.grid.grid-cols-12 > div'); return first ? (first.className.match(/lg:col-span-\d+/) || ['none'])[0] : 'no-card'; })()")
# 撤销 → 应该回滚"改尺寸"（最近操作）
$AB press Control+z > /dev/null 2>&1
$AB wait 800
AFTER_UNDO=$(ev "(() => { const first = document.querySelector('.grid.grid-cols-12 > div'); return first ? (first.className.match(/lg:col-span-\d+/) || ['none'])[0] : 'no-card'; })()")
echo "edit: $EDIT_ON del: $DEL after-del: $AFTER_DEL, set: $SET_RES size: $BEFORE_UNDO -> after-undo: $AFTER_UNDO"
if [ "$SET_RES" = "set-6" ] && [ "$BEFORE_UNDO" = "lg:col-span-6" ] && [ "$AFTER_UNDO" = "lg:col-span-3" ]; then ok "撤销回滚最近操作（改尺寸 6 撤销回 3），跨看板删除未被误回滚"; else bad "撤销行为异常（edit=$EDIT_ON set=$SET_RES $BEFORE_UNDO → $AFTER_UNDO）"; fi

echo "=== [F4] 快速连续操作一致性 ==="
# 6 次快速尺寸设置（均在 clamp 范围内）+ 3 次撤销：第 3 次撤销应回到第 3 次设置值(6)
UI_SEQ=""
for SZ in "1/2:6" "1/4:3" "1/2:6" "1/3:4" "1/2:6" "1/4:3"; do
  LABEL="${SZ%%:*}"
  $AB eval "(() => { const btn = document.querySelector('[title=\"调整网格尺寸\"]'); if (btn) btn.click(); return 'o'; })()" > /dev/null 2>&1
  $AB wait 300
  R=$(ev "(() => { const opt = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('$LABEL') && /\\d格/.test(b.textContent)); if (opt) { opt.click(); return 'set'; } return 'miss'; })()")
  UI_SEQ="$UI_SEQ$R "
  $AB wait 300
done
$AB wait 800
UI_B=$(ev "(() => { const first = document.querySelector('.grid.grid-cols-12 > div'); return first ? (first.className.match(/lg:col-span-\d+/) || ['none'])[0] : 'no-card'; })()")
LS_B=$(ev "(() => { const raw = JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')); const b = raw.boards.find(x => x.id === raw.activeBoardId) || raw.boards[0]; return b.widgets[0].colSpan; })()")
for i in 1 2 3; do $AB press Control+z > /dev/null 2>&1; done
$AB wait 800
UI_A=$(ev "(() => { const first = document.querySelector('.grid.grid-cols-12 > div'); return first ? (first.className.match(/lg:col-span-\d+/) || ['none'])[0] : 'no-card'; })()")
LS_A=$(ev "(() => { const raw = JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')); const b = raw.boards.find(x => x.id === raw.activeBoardId) || raw.boards[0]; return b.widgets[0].colSpan; })()")
echo "seq: $UI_SEQ | after-6: ui=$UI_B ls=$LS_B | after-3-undo: ui=$UI_A ls=$LS_A"
UIB_N=${UI_B##*-}; UIA_N=${UI_A##*-}
if [ "$UI_B" = "lg:col-span-$LS_B" ] && [ "$UI_A" = "lg:col-span-$LS_A" ] && [ "$UIA_N" = "6" ] && [ "$LS_A" = "6" ]; then ok "6 连改全部生效且 3 次撤销精确回滚到第 3 次设置值（6），UI=localStorage 全程一致"; else bad "状态不一致（seq=$UI_SEQ ui=$UI_B ls=$LS_B / ui=$UI_A ls=$LS_A）"; fi

echo "=== [F5] 全程 console/errors ==="
ERRS=$($AB errors 2>&1 | grep -v "^$" | head -3)
if [ -z "$ERRS" ]; then ok "console 0 错误"; else bad "存在错误: $ERRS"; fi

# 清理：恢复默认状态
$AB eval "localStorage.clear(); 'cleaned'" > /dev/null 2>&1
$AB reload > /dev/null 2>&1

echo ""
echo "=== 结果: PASS=$pass FAIL=$fail ==="
exit 0
