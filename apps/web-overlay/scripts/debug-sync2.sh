#!/bin/bash
# 调试第二轮：setItem 探针 + SW 控制状态 + 多标签
AB="agent-browser"
BASE="http://localhost:3010"

$AB open "$BASE/custom" > /dev/null 2>&1
$AB wait 3000

echo "--- tab 列表 ---"
$AB tab list 2>&1 | head -6

echo "--- SW 是否控制页面 ---"
$AB eval "navigator.serviceWorker && navigator.serviceWorker.controller ? 'SW-controlled: ' + navigator.serviceWorker.controller.scriptURL : 'no-sw'"

echo "--- setItem 探针：包裹写操作记录调用栈 ---"
$AB eval "(() => { window.__writes = []; const orig = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { window.__writes.push({ key: k, len: String(v).length, stack: new Error().stack.split('\n').slice(1,4).join(' <- '), at: Date.now() }); return orig.call(this, k, v); }; return 'hooked'; })()"

echo "--- 写入 weather 并立即读回 ---"
$AB eval "(() => { const KEY='navhub_modular_multi_boards_v2'; const raw = JSON.parse(localStorage.getItem(KEY)); raw.boards[0].widgets.push({id:'ext1',type:'weather',colSpan:4,rowSpan:1,config:{city:'beijing'},createdAt:Date.now()}); localStorage.setItem(KEY, JSON.stringify(raw)); const back = JSON.parse(localStorage.getItem(KEY)); window.__immediate = back.boards[0].widgets.length; window.dispatchEvent(new Event('navhub_workbench_updated')); return 'immediate=' + window.__immediate; })()"
$AB wait 1200

echo "--- 1.2s 后 localStorage widgets 数 ---"
$AB eval "JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')).boards[0].widgets.length"

echo "--- cards 数 ---"
$AB eval "document.querySelectorAll('.grid.grid-cols-12 > div').length"

echo "--- 谁写了 localStorage（调用栈）---"
$AB eval "JSON.stringify(window.__writes)"

$AB close > /dev/null 2>&1
exit 0
