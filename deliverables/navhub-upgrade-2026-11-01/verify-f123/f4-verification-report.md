# F4 独立复核报告（verify-f4，2026-11-02）

对象：NavHub F4「自定义壁纸文字可读性兜底」
方法：独立测试运行 + 源码/产物证伪 + Node 独立重算 + 真实浏览器计算样式（headless Chrome + dev 服务器实际下发 CSS 字节）

## ① F4 裁定

**PASS-with-notes** — 五条主张全部证实，四组合对比度独立重算与浏览器实测均与主张完全一致（±0.01），最坏 4.60 ≥ 4.5；备忘：cardOpacity 全链路无渲染消费者（可读性实际由 CSS 0.88 兜底独立承担）、emerald 注释 4.74 低报（实为 5.12）、DIY 工坊胶囊交互链路未点检。

## ② 独立重算表（alpha 合成 + WCAG 公式，脚本 f4-contrast-recalc.mjs）

| 组合 | 卡片合成色 | 标题(foreground) | 描述(muted) | 主张值(描述) | 我的值(描述) | 差异 |
|---|---|---|---|---|---|---|
| 浅色+黑壁纸 | #E0E0E0 | 15.13 | **4.60** | 4.60 | 4.60 | 0.00 |
| 浅色+白壁纸 | #FFFFFF | 19.90 | 6.05 | 6.04 | 6.05 | +0.01 |
| 深色+黑壁纸 | #08080A | 19.17 | 7.82 | 7.81 | 7.82 | +0.01 |
| 深色+白壁纸 | #262628 | 14.37 | 5.86 | 5.86 | 5.86 | 0.00 |

全部差异 ≤0.01（容差 ±0.15 内）；四组合 min=4.60 ≥ 4.5 → AA 达标。

反证锚点（muted/90 未归一时，验证方法正确性）：浅色+黑壁纸 3.81:1、浅色+白壁纸 4.80:1 —— 与 globals.css 注释的 3.81/4.8 逐位吻合，方法交叉验证通过。

**真实浏览器实测**（headless Chrome getComputedStyle，served-f4.css 为 localhost:3000 实际下发字节，三种卡片精确类名复刻，浅/深两页静态类名，重试过滤 headless 虚拟时钟陈旧读数）：

| 组合 | card computed | desc computed | 实测 D | 重算 D | 主张 |
|---|---|---|---|---|---|
| 浅色+黑 | rgba(255,255,255,0.88) | rgb(98,98,106) 不透明 | 4.60 | 4.60 | 4.60 |
| 浅色+白 | rgba(255,255,255,0.88) | rgb(98,98,106) 不透明 | 6.04 | 6.05 | 6.04 |
| 深色+黑 | rgba(9,9,11,0.88) | rgb(161,161,170) 不透明 | 7.81 | 7.82 | 7.81 |
| 深色+白 | rgba(9,9,11,0.88) | rgb(161,161,170) 不透明 | 5.86 | 5.86 | 5.86 |

浏览器实测四组合与主张值**逐位一致**。关键级联问题（未分层 0.88 是否压过 dark:bg-card/45）：深色卡片 computed = rgba(9,9,11,**0.88**) 而非 0.45/0.50 → 压过，证实。desc computed 为不透明（非 rgba …,0.9）→ text-muted-foreground/90 归一规则生效，证实。

## ③ 证伪尝试结果

1. **三处 clamp**（grep + 精读）：use-home-diy.ts:519 写入端 `Math.min(1.0, Math.max(0.85, opacity))`、:566 读取端 `Math.min(1.0, Math.max(0.85, config.cardOpacity ?? 0.9))`；diy-presets.ts:814-818 validateAndCleanDIYConfig 内 `Number.isFinite(n) ? Math.min(1, Math.max(0.85, n)) : 0.9`（NaN 防御在）；home-diy-storage.ts:565-567 URL-Hash 解析自带 clamp + Number.isFinite，且经 validateAndCleanDIYConfig 二次归一。`Math.max(0.2` 全目录零残留。**主张 1 证实。**
2. **globals.css**：.glass-surface alpha 0.88（L471，@layer utilities 内）；未分层 `.nav-card-deferred { background-color: hsl(var(--card) / 0.88) }`（L661-663）+ `.nav-card-deferred .text-muted-foreground\/90` 归一（L669-671），均在一切块外（测试的花括号深度检查为真检查，人工复核一致）。产物/下发 CSS 中同样位于 @layer utilities 关闭之后的顶层，Tailwind v4 原生 @layer（theme/base/components/utilities）下未分层必胜分层工具类。**主张 2 证实。**
3. **滑杆**：home-diy-toolbar.tsx:405-411 `min={0.85}` `step={0.01}` `aria-label="卡片不透明度（可读性下限 0.85）"` `value={Math.min(1, Math.max(0.85, …))}`。**主张 3 证实**（形态与验收口径一致）。
4. **测试质量**（找空断言/恒真分支/过宽豁免）：8 个 it() 与主张数一致；无空断言、无恒真分支；未分层检查用花括号深度真实计算（改回 @layer 内会变红）；负向断言（旧 0.2 下限不得残留、裸读取路径不得复活）到位。轻微宽松点（不影响结论）：home-diy-storage 的 `Math.max(0.85` 为子串锁（任意出现即过，但有函数单测补强）；`toContain("min={0.85}")` 为子串锁（实码 L407 直读确认非注释）；alphaOf 的 500 字符窗口在当前文件无歧义（首现即规则本体）。**主张 4 证实。**
5. **主张 5**：见②表，独立重算与浏览器实测双重证实。
6. **顺带复核（任务 f）**：emerald `--primary: 158 84% 26%`（#0B7A51）对 `--primary-foreground: 210 40% 98%`（#F8FAFC）= **5.120:1**。**5.12 正确，4.74 为低报**（源码注释同段的初稿 158 84% 30% = 4.03:1 反而是对的）。方法已用 3.81/4.80/4.60/5.86/7.81 多锚点交叉验证，可信。
7. **整页/级联实测（任务 e）**：机器仅 1 个 Next 实例（:3000，≤6 限额内），未新起实例；直接取 dev 服务器**实际下发** CSS 字节（405KB chunk，grep 确认含 F4 三规则，watcher 新鲜）+ headless Chrome 真实计算样式完成实测（见②）。DIY 工坊胶囊交互链路（开面板/传壁纸/拖滑杆）未点检——标未验证。
8. **中间态**：20:07 首次 grep globals.css 曾读到「字节分家」中间态（F4 尾部规则暂缺），按任务口径复读，稳态（671 行）规则齐全，结论以稳态为准。
9. **附加发现（非主张矛盾）**：`cardOpacity` 全仓唯一消费方是 clamp/序列化/滑杆 UI 自身（apps/ 全量 grep 无渲染路径），卡片底色实际恒为 CSS 硬编码 0.88；滑杆数值不改变任何元素样式。可读性保证因此**更稳**（不依赖 clamp），但滑杆是视觉空转控件，建议后续接线或移除。

## ④ 测试运行结果（原文）

- `node node_modules/vitest/vitest.mjs run apps/web/test/wallpaper-contrast-guard.test.ts` → **Test Files 1 passed (1) / Tests 8 passed (8)**
- `node node_modules/vitest/vitest.mjs run apps/web/test/diy-share-link.test.ts` → **Test Files 1 passed (1) / Tests 18 passed (18)**
- `node node_modules/vitest/vitest.mjs run apps/web/test/diy-import-honesty.test.ts` → **Test Files 1 passed (1) / Tests 26 passed (26)**（stderr 仅预期的 4KB 超限警告日志）

## ⑤ 与主张不符清单

无实质性不符。两处注释级偏差：
- globals.css emerald 注释「对近白 4.74:1」实为 5.12:1（低报，不破任何门禁）。
- 主张 5 的浅白 6.04 vs 重算 6.05（舍入级，0.01）。

## ⑥ 风险/未验证项

1. **DIY 工坊胶囊交互链路未实测**（开面板→传壁纸→拖滑杆→实时重绘）；壁纸渲染路径仅代码复核（navigation-content.tsx:362-367 backgroundImage + isSafeWallpaperUrl，data:image/(png|jpeg|webp) 放行）。
2. **滑杆无渲染消费者**（见③-9）：用户拖动后卡片透明度不变，可能被体验验收视为缺口；当前 F4 可读性不因此受损（CSS 0.88 硬兜底）。
3. headless 虚拟时钟下 getComputedStyle 首读偶发 UA 默认值陈旧（自实现探针，非产品问题）；已用重试过滤，但自动化复跑需注意。
4. `.glass-surface`（@layer utilities 内）理论上可被同层调用点工具类按源码序覆盖；卡片路径（AA 关键）已用未分层规则兜死，玻璃面板路径未逐调用点排查。
5. 共享 dev :3000 的 CSS watcher 本次抓取为新鲜（含 F4 规则）；其他时段复测需重新验新鲜度。

## 附件（deliverables/navhub-upgrade-2026-11-01/verify-f123/）

- `f4-contrast-recalc.mjs` — 独立对比度重算脚本（含四组合、muted/90 反证锚点、emerald 裁决）
- `f4-live-harness.html` — 真实浏览器计算样式实测 harness（served CSS + 三种卡片精确类名）
- `served-f4.css` — localhost:3000 实际下发 CSS 字节快照（405,475 B）
- `f4-verification-report.md` — 本报告
