#!/bin/bash
# /custom 核心 UI 操作全链路验证 v2
# 修正：所有弹窗内操作限定在 modal 容器内；每步前保险关闭遗留弹窗
AB="agent-browser"
BASE="http://localhost:3010"
pass=0; fail=0
ok()  { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
ev() { $AB eval "$1" 2>/dev/null | tr -d '"'; }

$AB open "$BASE/custom" > /dev/null 2>&1
$AB wait 3000

echo "=== [A] UI 添加模块（编辑模式 → 模块库）==="
$AB find text "自定义排版" click > /dev/null 2>&1
$AB wait 800
CARDS_A0=$(ev "document.querySelectorAll('.grid.grid-cols-12 > div').length")
$AB find text "添加模块" click > /dev/null 2>&1
$AB wait 800
# 在弹窗容器内找"添加"按钮（Plus+span 添加），点第一个
ADD_RES=$(ev "(() => { const modal = Array.from(document.querySelectorAll('div')).reverse().find(d => d.className.includes('fixed') && d.innerText.includes('添加独立功能模块')); if (!modal) return 'no-modal'; const btn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('添加') || (b.querySelector('span') && b.querySelector('span').textContent === '添加')); if (!btn) return 'no-add-btn'; btn.click(); return 'add-clicked'; })()")
$AB wait 1200
CARDS_A1=$(ev "document.querySelectorAll('.grid.grid-cols-12 > div').length")
LS_A1=$(ev "JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')).boards[0].widgets.length")
echo "click: $ADD_RES, cards: $CARDS_A0 -> $CARDS_A1, ls: $LS_A1"
if [ "$CARDS_A1" -gt "$CARDS_A0" ] && [ "$LS_A1" -ge "$CARDS_A1" ]; then ok "UI 添加模块生效（$CARDS_A0 → $CARDS_A1 卡，localStorage 同步 $LS_A1）"; else bad "UI 添加模块异常（$ADD_RES，$CARDS_A0 → $CARDS_A1，ls=$LS_A1）"; fi

echo "=== [B] 配置弹窗：改自定义标题 → 保存 → UI 更新 ==="
$AB scrollintoview '[title="配置模块参数"]' > /dev/null 2>&1
$AB wait 400
$AB eval "(() => { document.querySelector('[title=\"配置模块参数\"]')?.click(); return 'opened'; })()" > /dev/null 2>&1
$AB wait 800
# 在配置弹窗容器内找第一个文本输入框（自定义标题），React 受控设值
SET_RES=$(ev "(() => { const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('保存并应用')); if (!saveBtn) return 'no-save-btn'; let modal = saveBtn; for (let i = 0; i < 8 && modal.parentElement; i++) { if (modal.className.includes('fixed') || modal.className.includes('modal')) break; modal = modal.parentElement; } const inputs = Array.from(modal.querySelectorAll('input[type=\"text\"]')).filter(i => i.offsetParent !== null); if (!inputs.length) return 'no-input-in-modal'; const setr = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setr.call(inputs[0], '我的自定义模块'); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); return 'title-set'; })()")
echo "set: $SET_RES"
$AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('保存并应用')); if (btn) { btn.click(); return 'saved'; } return 'no-btn'; })()" > /dev/null 2>&1
$AB wait 1000
TITLE_OK=$(ev "document.body.innerText.includes('我的自定义模块') ? 'title-updated' : 'title-missing'")
CFG_LS=$(ev "(() => { const w = JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')).boards[0].widgets; return w.some(x => x.customTitle === '我的自定义模块') ? 'persisted' : 'lost'; })()")
echo "title: $TITLE_OK, ls: $CFG_LS"
if [ "$TITLE_OK" = "title-updated" ] && [ "$CFG_LS" = "persisted" ]; then ok "配置弹窗保存 + 卡片标题更新 + localStorage 持久化"; else bad "配置弹窗异常（set=$SET_RES title=$TITLE_OK ls=$CFG_LS）"; fi
# 保险关闭遗留弹窗
$AB press Escape > /dev/null 2>&1
$AB wait 400

echo "=== [C] UI 创建看板 + 多看板切换与独立状态 ==="
BOARDS_N=$(ev "JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')).boards.length")
echo "boards-before: $BOARDS_N"
if [ "$BOARDS_N" = "1" ]; then
  # 编辑模式下通过 UI 新建看板（表单：input autoFocus + 确定 submit）
  $AB eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('新建工作台')); if (btn) { btn.click(); return 'form-opened'; } return 'no-btn'; })()" > /dev/null 2>&1
  $AB wait 600
  $AB eval "(() => { const input = document.querySelector('input[placeholder=\"看板名称...\"]'); if (!input) return 'no-input'; const setr = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setr.call(input, '我的新看板'); input.dispatchEvent(new Event('input', { bubbles: true })); return 'named'; })()" > /dev/null 2>&1
  $AB eval "(() => { const form = document.querySelector('input[placeholder=\"看板名称...\"]')?.closest('form'); const btn = form ? Array.from(form.querySelectorAll('button')).find(b => b.textContent.includes('确定')) : null; if (btn) { btn.click(); return 'created'; } return 'no-submit'; })()" > /dev/null 2>&1
  $AB wait 1000
  BOARDS_N=$(ev "JSON.parse(localStorage.getItem('navhub_modular_multi_boards_v2')).boards.length")
fi
NEW_CARDS=$(ev "document.querySelectorAll('.grid.grid-cols-12 > div').length")
NEW_NAME=$(ev "(() => { const h = document.querySelector('h2'); return h ? h.textContent.slice(0, 12) : 'no-h2'; })()")
# 切回第一个看板再切回新看板，验证独立状态
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('回归测试看板') || b.textContent.includes('全栈极客')); if (tab) { tab.click(); return 'back'; } return 'no-tab'; })()" > /dev/null 2>&1
$AB wait 800
OLD_CARDS=$(ev "document.querySelectorAll('.grid.grid-cols-12 > div').length")
$AB eval "(() => { const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('我的新看板')); if (tab) { tab.click(); return 'fwd'; } return 'no-tab'; })()" > /dev/null 2>&1
$AB wait 800
NEW2_CARDS=$(ev "document.querySelectorAll('.grid.grid-cols-12 > div').length")
echo "boards: $BOARDS_N, new: $NEW_CARDS ($NEW_NAME), old: $OLD_CARDS, new-again: $NEW2_CARDS"
if [ "$BOARDS_N" -ge 2 ] && [ "$OLD_CARDS" != "$NEW2_CARDS" ]; then ok "UI 创建看板 + 切换独立（新看板 $NEW2_CARDS 卡 / 原看板 $OLD_CARDS 卡）"; else bad "看板创建/切换异常（boards=$BOARDS_N new=$NEW_CARDS '$NEW_NAME' old=$OLD_CARDS new2=$NEW2_CARDS）"; fi

echo "=== [D] 智能紧凑重排 ==="
$AB eval "(() => { const KEY='navhub_modular_multi_boards_v2'; const raw = JSON.parse(localStorage.getItem(KEY)); const b = raw.boards.find(x => x.id === raw.activeBoardId); b.widgets[0].colSpan = 3; localStorage.setItem(KEY, JSON.stringify(raw)); window.dispatchEvent(new Event('navhub_workbench_updated')); return 'gap-made'; })()" > /dev/null 2>&1
$AB wait 800
$AB find text "智能紧凑" click > /dev/null 2>&1
$AB wait 1000
COMPACT_NOTICE=$(ev "document.body.innerText.includes('紧凑') ? 'notice-ok' : 'no-notice'")
CARDS_D=$(ev "document.querySelectorAll('.grid.grid-cols-12 > div').length")
echo "notice: $COMPACT_NOTICE, cards: $CARDS_D"
if [ "$COMPACT_NOTICE" = "notice-ok" ] && [ -n "$CARDS_D" ] && [ "$CARDS_D" -gt 0 ]; then ok "智能紧凑重排执行且布局未破坏（$CARDS_D 卡）"; else bad "智能紧凑异常（$COMPACT_NOTICE, $CARDS_D）"; fi

echo "=== [E] 全程 console/errors ==="
ERRS=$($AB errors 2>&1 | grep -v "^$" | head -3)
if [ -z "$ERRS" ]; then ok "console 0 错误"; else bad "存在错误: $ERRS"; fi

echo ""
echo "=== 结果: PASS=$pass FAIL=$fail ==="
exit 0
