#!/bin/bash
# 聚焦调试：navhub_workbench_updated 外部同步为何不生效
AB="agent-browser"
BASE="http://localhost:3010"

$AB open "$BASE/custom" > /dev/null 2>&1
$AB wait 3000

echo "--- 初始 cards ---"
$AB eval "document.querySelectorAll('.grid.grid-cols-12 > div').length"

echo "--- 监听器是否注册（探针：手动派发后看 cards）---"
$AB eval "(() => { const raw = JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')); return 'boards=' + raw.boards.length + ' widgets=' + raw.boards[0].widgets.length + ' types=' + raw.boards[0].widgets.map(w=>w.type).join(','); })()"

echo "--- 写入 weather 并派发事件 ---"
$AB eval "(() => { const raw = JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')); raw.boards[0].widgets.push({id:'ext1',type:'weather',colSpan:4,rowSpan:1,config:{city:'beijing'},createdAt:Date.now()}); localStorage.setItem('navhub_modular_multi_boards_v2', JSON.stringify(raw)); window.dispatchEvent(new Event('navhub_workbench_updated')); return 'dispatched'; })()"
$AB wait 1000

echo "--- 派发后 cards（期望 +1）---"
$AB eval "document.querySelectorAll('.grid.grid-cols-12 > div').length"

echo "--- body 是否含 北京 ---"
$AB eval "document.body.innerText.includes('北京') ? 'has-beijing' : 'no-beijing'"

echo "--- localStorage 现状 ---"
$AB eval "JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')).boards[0].widgets.map(w=>w.type).join(',')"

echo "--- 再试：直接检查 React 是否重渲染（便签内容探针不可用，改用 cards 增量）---"
$AB eval "(() => { const before = document.querySelectorAll('.grid.grid-cols-12 > div').length; const raw = JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')); if (!raw.boards[0].widgets.some(w=>w.id==='ext2')) { raw.boards[0].widgets.push({id:'ext2',type:'notes',colSpan:4,rowSpan:1,config:{},createdAt:Date.now()}); localStorage.setItem('navhub_modular_multi_boards_v2', JSON.stringify(raw)); } window.dispatchEvent(new Event('navhub_workbench_updated')); return 'before=' + before; })()"
$AB wait 1000
$AB eval "document.querySelectorAll('.grid.grid-cols-12 > div').length"

$AB close > /dev/null 2>&1
exit 0
