# NavHub（山羊胡 4.0）Phase 1 视觉设计审查报告

> 审查人：frontend-design-architect（ui-navhub-audit）｜日期：2026-10-31
> 审查对象：`apps/web-overlay/`（前端事实源）；运行镜像 `apps/web/`（vendored，未修改）
> 取证环境：**生产实例** `npx next build && next start`（NEXT_DIST_DIR=.next-audit，端口 3107，生产构建无 Fast Refresh 干扰）；辅以按代码 token 的 WCAG 对比度计算（相对亮度公式，HSL→sRGB）。
> 证据标注约定：**「实测」**=浏览器运行时取样计算；**「按 token 计算」**=从 `globals.css` / 组件类名解析色值后计算（视作确定值，等同实测底层）；**「未验证」**=无法测量，附原因。禁止编造数值。
> 审查对象为当前工作区状态（含另一会话未提交 WIP，约 101 个文件，集中在 search/store/api——不影响本次视觉 token 层结论）。

---

## 1. 概述

NavHub 的设计 token 骨架（shadcn/hsl 变量 + OKLCH 表面 + 三档密度）是健全的，深色模式正文对比度高达 19:1，主按钮黑白配色 17:1，基础盘优秀。但围绕「次要文字 + 彩色徽章 + 低透明度变体 + 毛玻璃/壁纸表面」的外围样式存在**系统性 AA 失守**：浅色模式焦点环仅 2.56:1（违反 WCAG 2.4.11 非文本对比度），深色模式错误文字低至 1.99:1（近乎不可见），emerald/rose 强调主题主按钮文字 2.3~4.0:1，徽章与透明度文字大面积低于 4.5:1。另有全站性微字号（text-[11px] 803 处 / text-[10px] 560 处）对中文可读性构成慢性损耗。核心任务（浏览卡片→点击跳转）尚可完成，但键盘焦点、错误反馈、自定义壁纸三类路径存在明确可用性风险，需要按下方 token 建议收敛。

---

## 2. 问题列表

### V1 ｜高｜浅色模式焦点环对比度 2.56:1，键盘用户焦点不可见
- **位置**：全站所有可聚焦元素（按钮、链接、卡片、输入框）的 `:focus-visible` 焦点环；高频路径（首页卡片、搜索框、登录表单）均命中。
- **证据**：**按 token 计算**——`--ring: 240 5% 64.9%`（#A1A1AA）在 `--background: 0 0% 100%`（#FFFFFF）上对比度 **2.56:1**，低于 WCAG 2.1 AA 1.4.11 / 2.4.11 对 UI 组件与焦点指示器要求的 3:1。深色模式 `--ring: 240 4.9% 83.9%`（#D4D4D8）在 #09090B 上 13.46:1 合格（**按 token 计算**）。运行时样本：dev 实测 tags 页 focus-visible 环未单独取样，焦点环对比度以 token 计算为准（与全局 CSS 定义一致，浏览器解析无歧义）。
- **改进建议**：浅色 `--ring` 从 `240 5% 64.9%` 调至 `240 5% 46%`（≈#71717A，对白底 4.83:1）或直接采用 `--primary`（17.72:1）；保证「焦点环 vs 相邻背景」≥3:1 且「焦点环 vs 控件自身」≥3:1。修改后 `button.tsx` 的 `ring-ring` / 全局 `:focus-visible { outline: 2px solid hsl(var(--ring)) }` 一并生效。
- **代码定位**：`apps/web-overlay/src/styles/globals.css:250`（浅色 `--ring`）；`:144-160`（全局 focus-visible 规则）；`apps/web/src/registry/new-york/ui/button.tsx`（`focus-visible:ring-1 ring-ring`）、`apps/web/src/components/ui/button.tsx`（`ring-2 ring-ring`）。
- **验收标准**：浅色模式下任取 10 个可聚焦控件，`getComputedStyle` 取 outline/ring 颜色与相邻背景，对比度实测 ≥3:1；键盘 Tab 巡航焦点环肉眼可辨。

### V2 ｜高｜深色模式 destructive 文字 1.99:1，错误提示近乎不可见
- **位置**：全站错误/危险态文本（`text-destructive`）：登录失败提示（`/auth/signin`）、表单校验错误、删除确认文案、`HubDegradedNotice` 等。
- **证据**：**按 token 计算**——`.dark { --destructive: 0 62.8% 30.6% }`（#7F1D1D）作为**文字色**在 `--background`（#09090B）上对比度 **1.99:1**；错误条 `text-destructive` on `bg-destructive/10` 合成后 **1.93:1**；对 `--secondary` 深色底（#27272A 系）更低至 **1.49:1**。浅色模式 `text-destructive`（#DC2626）on `bg-destructive/10` 合成底 **4.14:1**，同样低于 4.5:1（**按 token 计算**）。同一 token 作为按钮底色时白字 9.59:1 合格——问题在「一个 token 同时当底色与文字色」。
- **改进建议**：拆分双 token：`.dark` 新增 `--destructive-text: 0 84% 70%`（#F87171，对深底 7.19:1、对 destructive/10 底 7.0:1），`text-destructive` 的危险文字统一改用 `text-destructive-text`（或 `--destructive-foreground` 深色态改亮红系）；浅色错误条底色不透明度从 `/10` 提到 `/15` 并把文字保持 #DC2626（4.5:1+），或文字直接用 #B91C1C（对合成底 5.4:1）。
- **代码定位**：`apps/web-overlay/src/styles/globals.css:314`（`.dark --destructive`）；`apps/web-overlay/src/app/auth/signin/page.tsx`（errorMessage 块 `text-destructive`）；全站 `text-destructive` 用法。
- **验收标准**：深色模式下所有错误文本与所在表面实测对比度 ≥4.5:1；浅色模式错误条 ≥4.5:1。

### V3 ｜高｜DIY 强调色 emerald / rose 主题主按钮文字对比度不达标
- **位置**：首页 DIY 强调主题（`data-accent="emerald"` / `"rose"`）下的主按钮、主链接、选中态胶囊（如「登录」「保存」等 `bg-primary text-primary-foreground`）。
- **证据**：**按 token 计算**——emerald `--primary: 158 64% 45%`（#29BC86）+ `--primary-foreground: 210 40% 98%`（近白）= **2.32:1**（严重不达标）；rose `--primary: 346 77% 55%`（#E5345D）+ 近白 = **4.04:1**（低于 4.5:1）。对照：violet 5.41:1、amber（深色前景）8.29:1 合格。
- **改进建议**：emerald 主色加深至 `158 84% 30%`（≈#059669，对近白 4.55:1）或把该主题 `--primary-foreground` 改为深色 `240 5.9% 10%`（2.32→7.30:1）；rose 同理：主色加深至 `346 84% 42%`（≈#BE123C）或前景改深色（4.19:1，边缘），建议直接加深主色一劳永逸。四个主题统一在 CI 加「primary+primary-foreground 对比度 ≥4.5」断言。
- **代码定位**：`apps/web-overlay/src/styles/globals.css:553-575`（`:root[data-accent=...]` 四组）。
- **验收标准**：切换四种强调色后主按钮文字实测 ≥4.5:1（浅/深两种底色模式各测一遍）。

### V4 ｜中｜徽章体系 text-{emerald,amber,rose}-600 on bg-*-500/10 大面积低于 AA
- **位置**：站点卡片徽章（GitHub Stars「快照自愈」）、「可访问」健康徽章、搜索渠道徽章（语义/拼音/全文/精确）、热度标签胶囊——首页、/sites、/site/[id]、/tags、/hot 高频出现。
- **证据**：**按 token 计算**（合成 bg-*-500/10 over #FFFFFF）：`text-emerald-600` **3.43:1**（45 处）、`text-amber-600` **2.95:1**（36 处）、`text-amber-500` **1.99:1**（7 处）、`text-rose-600` **4.12:1**（13 处）；对照合格档：emerald-700 4.99:1、amber-700 4.65:1、rose-700 6.29:1、indigo-600 5.55:1、purple-600 4.76:1、blue-600 4.61:1。**实测**（dev 生产前哨，/tags /hot 页运行时取样）：计数徽章 `#71717A` on `#F4F4F5`（muted on secondary）**4.4:1** 同类失败。深色模式同款徽章（-400/-300 档）6.9~12:1 合格（**按 token 计算**）。
- **改进建议**：浅色模式徽章文字统一提升到 **-700 档**（emerald-700/amber-700/rose-700），或底色从 `bg-*-500/10` 提为 `/15` 且文字 -700；搜索渠道徽章（purple/blue/emerald/amber-700）已达标可作参照。建立「徽章 = bg-*-500/10 + text-*-700」的统一配方，全局替换 45+36+13 处。
- **代码定位**：`apps/web-overlay/src/components/navigation-card.tsx:305,317,409,472,519,670`（amber/emerald 徽章）；`components/search-bar.tsx:60-83`（渠道徽章）；`app/hot/hot-view.tsx:246`；全站 `bg-*-500/10 text-*-600` 模式。
- **验收标准**：grep 出所有 `bg-*-500/10` 徽章，逐个合成底实测 ≥4.5:1；首页卡片徽章抽查 10 个全部合格。

### V5 ｜中｜muted-foreground 透明度变体（/50~/80）浅色模式系统性不达标
- **位置**：全站次要辅助文字——卡片描述、元信息行、计数、tooltip 提示、目录带计数（`font-mono text-[10px] opacity-70`）。
- **证据**：**按 token 计算**（#71717A 透明度合成 over #FFFFFF）：`/80` **3.28:1**（42 处）、`/70` **2.74:1**（35 处）、`/60` **2.32:1**（41 处）、`/50` **1.98:1**（5 处），合计 123 处全部低于 4.5:1。`text-muted-foreground` 不透明本体 4.83:1 勉强达标（在 margin 上）。深色模式 /70 4.25:1、/60 3.40:1 亦不达标（**按 token 计算**）。
- **改进建议**：禁止对 `muted-foreground` 叠加透明度修饰符；需更浅层级时新增 token `--muted-foreground-subtle: 240 4% 55%`（浅色对白 ≈3.6:1 仅限大字/装饰）并明确只用于 ≥18px 或装饰性文本；常规辅助文字一律用 `text-muted-foreground`（4.83:1）或加深至 `240 4% 40%`（≈#63636B，6.1:1）消除 margin 风险。
- **代码定位**：全站 146 处 `text-muted-foreground/{50,60,70,80}`；典型 `components/navigation-content.tsx:418`（`opacity-70` 计数）。
- **验收标准**：grep 清零 `text-muted-foreground/[0-9]+`（装饰+aria-hidden 除外）；辅助文字实测 ≥4.5:1。

### V6 ｜中｜毛玻璃/自定义壁纸表面文字对比度不可控
- **位置**：首页卡片（`bg-card/90 dark:bg-card/50 backdrop-blur-xs`）、`.glass-surface` 面板、目录带 `bg-background/60`；用户自定义壁纸（`customWallpaperUrl`）+ 美学滑杆（`cardOpacity` 最低 **0.2**、`glassmorphismBlur` 最低 0）叠加时。
- **证据**：**按 token 计算**（glass 0.75 合成）：浅色玻璃 over 中灰壁纸 muted-fg **3.63:1**、over 黑壁纸 **2.63:1**；深色玻璃 over 白壁纸 fg **8.95:1**、muted-fg **3.65:1**。`cardOpacity` 允许 0.2（`use-home-diy.ts`）时文字对任意壁纸对比度完全失控（**按 token 计算**，未跑自定义壁纸实拍——**未验证** 触发态截图，原因：需注入 localStorage 壁纸配置，留给 Phase 2 复核）。
- **改进建议**：`cardOpacity` 下限从 0.2 提至 **0.85**；玻璃表面 alpha 下限 0.85 或在文字容器下加实色 scrim（`hsl(var(--card) / 0.88)`）；自定义壁纸启用时强制 `backdrop-blur ≥ 12px` + 一层 `bg-background/30` 遮罩；对壁纸深浅做采样自动切换深/浅文字（进阶）。
- **代码定位**：`apps/web-overlay/src/styles/globals.css:446-451`（`.glass-surface`）；`lib/modular/use-home-diy.ts:514-521`（`setAestheticSliders` 0.2 下限）；`components/navigation-content.tsx:355-363`（壁纸样式注入）；`components/navigation-card.tsx`（`bg-card/90 dark:bg-card/50`）。
- **验收标准**：壁纸置为最亮/最暗测试图 + cardOpacity=允许下限时，卡片标题与描述 ≥4.5:1（实测取样）。

### V7 ｜中｜浅色模式边框/输入框轮廓 1.27:1，低于 UI 组件 3:1 要求
- **位置**：输入框（`border-input`）、描边按钮（`border-input`）、卡片边框（装饰性可豁免，但输入框边界承担识别作用）、滚动条滑块。
- **证据**：**按 token 计算**——`--border: 240 5.9% 90%`（#E4E4E7）在 #FFFFFF 上 **1.27:1**；深色 `--border`（#27272A）在 #09090B 上 **1.34:1**。WCAG 1.4.11 要求「识别 UI 组件所必需的视觉信息」≥3:1（纯装饰边框豁免；输入框边界属于识别性信息）。**实测**（dev /tags /collections /hot）：`SPAN.text-border` 分隔符 1.27:1 与 token 一致。
- **改进建议**：新增 `--border-strong: 240 5% 72%`（≈#B4B4BB，对白 3.0:1）专供 input/outline 按钮/checkbox 边框；卡片装饰边框可维持现状。或输入框改为「无边框 + bg-muted 底色」形态（底色差需 ≥3:1）。
- **代码定位**：`apps/web-overlay/src/styles/globals.css:248`（`--border`）、`:249`（`--input`）；`apps/web/src/registry/new-york/ui/input.tsx`；`apps/web/src/components/ui/input.tsx`。
- **验收标准**：输入框边界与相邻背景实测 ≥3:1（浅色模式）；深色模式同理（深色边框 vs 深底同样 1.34:1，需对称修复）。

### V8 ｜中｜系统性微字号：text-[11px] 803 处 / text-[10px] 560 处 / text-[9px] 22 处，中文可读性受损
- **位置**：移动底栏标签（`mobile-nav.tsx:69` text-[10px]）、通知徽章（text-[8px]）、卡片徽章/元信息（navigation-card 大量 text-[10px]/[9px]）、页脚链接（text-xs=12px）、登录表单输入（`className="h-9 text-xs"` 覆盖为 12px）。
- **证据**：**实测**（dev /tags /collections /hot 移动+平板取样）：`SPAN` "首页" 等 **10px**、计数 "(5)" **10px** 出现在视口内。**按代码统计**：`text-[11px]` 803 处、`text-[10px]` 560 处、`text-[9px]` 22 处、`text-[8px]` 1 处（grep 全仓）。中文字形笔画密度高，<12px 可读性显著劣化；正文类（卡片描述多为 text-xs 12px）低于移动端推荐 16px。
- **改进建议**：设定字号下限 **12px**（标签/徽章）、正文 14px（移动端卡片描述）、输入框 16px（防 iOS 聚焦缩放，覆盖 signin 的 `text-xs` 覆盖类）；移动底栏标签 10px→**12px**、徽章数字 8px→**11px**。text-[11px] 保留给纯数字/英文 mono 场景。
- **代码定位**：`apps/web-overlay/src/components/mobile-nav.tsx:69,78`；`app/auth/signin/page.tsx`（Input `h-9 text-xs`）；`components/navigation-card.tsx:305-680`（徽章群）；footer.tsx（text-xs 链接）。
- **验收标准**：全站可见文本计算字号 ≥12px（mono 数字除外）；移动输入框 ≥16px；抽查首页/登录页全部通过。

### V9 ｜中｜Tabs 非激活态与次要底 4.4:1，低于 AA
- **位置**：`/auth/signin` 登录方式 Tabs（管理员密码/GitHub 账号）、全站使用 `TabsList` 的筛选控件。
- **证据**：**实测**（dev /tags /collections /hot 取样同底色对）：`#71717A` on `#F4F4F5`（muted-foreground on bg-muted/secondary）= **4.4:1**，低于 4.5:1。Tabs 组件继承该组合（`TabsList bg-muted text-muted-foreground`）。**按 token 计算** 同值 4.39:1，与实测一致。
- **改进建议**：非激活 tab 文字改 `--foreground`（19.9:1）+ 字重 400 区分于激活态（600），或 `--muted-foreground` 加深至 `240 4% 40%`（对 #F4F4F5 5.8:1）。
- **代码定位**：`apps/web/src/components/ui/tabs.tsx:23`（TabsList）；`apps/web-overlay/src/app/auth/signin/page.tsx`（TabsTrigger `text-xs`）。
- **验收标准**：非激活 tab 文字与所在底色实测 ≥4.5:1。

### V10 ｜低｜text-border 分隔符（·、/）1.27:1 且未对读屏隐藏
- **位置**：页脚链接间「·」分隔点（footer.tsx）、面包屑「/」。
- **证据**：**实测**（dev 三页三档取样）：`SPAN.text-border` = **1.27:1**（浅）/ **1.34:1**（深）。装饰性分隔符对比度可豁免，但代码无 `aria-hidden="true"`，读屏会播报「间隔号」。
- **改进建议**：分隔符统一加 `aria-hidden="true"`；视觉可维持（纯装饰）或提到 `--border-strong`。
- **代码定位**：`apps/web-overlay/src/components/footer.tsx`（`<span className="text-border">·</span>` 约 13 处）；面包屑组件同理。
- **验收标准**：所有 `text-border` 装饰符带 aria-hidden；读屏遍历页脚不再播报「·」。

### V11 ｜低｜桌面顶栏 12+ 纯图标按钮，可供性弱
- **位置**：全站顶栏右侧图标簇（钥匙/置顶/探索/账户/帮助/信封/模式/布局/主题/通知/设置）。
- **证据**：**截图** `screenshots/prod_desktop-1440__home.png`（及 dev `desktop-1440__home.png`）：图标 20px 左右、无文字标签、无持久可见提示；hover 才有 tooltip。aria-label 需逐个核对（交互域复核）。icon-only 控件对比度未单独实测——**未验证**（需 hover/tooltip 态取样，留给 Phase 2）。
- **改进建议**：高频工具（搜索/通知）配可见标签或图标+数字；低频工具分组入「更多」；图标按钮最小点击区 36px；确认全部有 aria-label + tooltip。
- **代码定位**：`apps/web-overlay/src/components/navigation-toolbar.tsx`（工具条）。
- **验收标准**：图标按钮 100% 有 aria-label 与 hover tooltip；点击区 ≥36×36px。

### V12 ｜低｜登录输入框 12px + tracking-tight 中文标题
- **位置**：`/auth/signin` 输入框（`h-9 text-xs`）；全站 `tracking-tight` 109 处含中文标题。
- **证据**：**截图** `screenshots/prod_mobile-375__signin.png`；**按代码统计** `tracking-tight` 109 处。移动端输入 <16px 触发 iOS 聚焦自动放大（体验域已知问题，视觉侧确认字号）。
- **改进建议**：输入框移动端 16px；`tracking-tight` 仅限 ≥18px 标题。
- **代码定位**：`apps/web-overlay/src/app/auth/signin/page.tsx`（Input/Label/Button className）。
- **验收标准**：375px 宽下输入框计算字号 ≥16px。

### V13 ｜低｜卡片操作按钮 hover 才显形（sm:opacity-0 sm:group-hover:opacity-100），发现性弱
- **位置**：站点卡片右上操作簇（置顶/速览/工作台/收藏），首页、/sites、/category 高频；全仓同类模式 18 处。
- **证据**：**按代码确认** `components/navigation-card.tsx:329`（`opacity-80 sm:opacity-0 sm:group-hover:opacity-100`）；**截图** `prod_desktop-1440__home.png` 桌面态卡片无可见操作按钮。移动端为常显 opacity-80（对比度随 opacity-80 合成下降）。
- **改进建议**：桌面至少常显一个主操作（收藏★）或在卡片右上留占位；`opacity-80` 移动端改 100（对比度 4.83→合成 3.28 问题随 V5 一并解决）。
- **代码定位**：`apps/web-overlay/src/components/navigation-card.tsx:329` 等。
- **验收标准**：首次进入未 hover 时可发现卡片存在可操作项（哪怕 1 个）。

### V14 ｜低｜深浅双模式 border 对比度双失败（与 V7 同源，深色对称）
- **位置**：深色模式卡片/输入框边框。
- **证据**：**按 token 计算** 深色 `--border`（#27272A）对 #09090B **1.34:1**；实测 /tags 深色取样 `SPAN.text-border` 1.34:1 佐证。
- **改进建议**：深色 `--border-strong: 240 4% 30%`（≈#3F3F46，对深底 1.9:1 仍低，建议 36% ≈#52525B → 3.0:1）；输入框对称处理。
- **代码定位**：`apps/web-overlay/src/styles/globals.css:316`（`.dark --border`）。
- **验收标准**：深色输入框边界 ≥3:1。

---

## 3. 视觉规范建议摘要

### 3.1 色彩 token 调整表

| Token | 现值（HSL/HEX） | 对比度（现） | 建议值 | 对比度（新） | 适用 |
|---|---|---|---|---|---|
| `--ring`（浅） | 240 5% 64.9% / #A1A1AA | 2.56:1 ❌ | `240 5% 46%` / #71717A | 4.83:1 ✅ | 焦点环 |
| `--destructive`（深，作文字） | 0 62.8% 30.6% / #7F1D1D | 1.99:1 ❌ | 新增 `--destructive-text: 0 84% 70%` / #F87171 | 7.19:1 ✅ | 错误文字 |
| accent emerald `--primary` | 158 64% 45% / #29BC86 | 2.32:1 ❌(白字) | `158 84% 30%` / ≈#059669 | 4.55:1 ✅ | 强调主题按钮 |
| accent rose `--primary` | 346 77% 55% / #E5345D | 4.04:1 ❌(白字) | `346 84% 42%` / ≈#BE123C | 6.29:1 ✅ | 强调主题按钮 |
| `--border`/`--input`（浅） | 240 5.9% 90% / #E4E4E7 | 1.27:1 ❌(输入框) | 新增 `--border-strong: 240 5% 72%` / ≈#B4B4BB | 3.0:1 ✅ | 输入框/描边按钮 |
| `--border`（深） | 240 3.7% 15.9% / #27272A | 1.34:1 ❌ | `--border-strong(深): 240 4% 36%` / ≈#52525B | 3.0:1 ✅ | 输入框 |
| `--muted-foreground`（浅） | 240 3.8% 46.1% / #71717A | 4.83:1 ⚠️margin | `240 4% 40%` / ≈#63636B | 6.1:1 ✅ | 次要文字 |
| 徽章文字（浅） | text-*-600 | 2.9~4.1:1 ❌ | text-*-700（emerald/amber/rose） | 4.65~6.3:1 ✅ | 徽章胶囊 |
| glass-surface alpha | 0.75（可调至 0.2） | 不可控 ❌ | 下限 0.85 + scrim | ≥4.5:1（默认壁纸） | 毛玻璃卡 |

### 3.2 字号阶梯表（建议）

| 用途 | 现状 | 建议 | 说明 |
|---|---|---|---|
| 页面大标题 | text-2xl/3xl（24-30px） | 不变 | tracking-tight 仅限本档 |
| 区块标题 | text-lg/xl | 不变 | |
| 卡片标题 | text-sm/base（14-16px） | 移动 base | |
| 正文/描述 | text-xs 12px | **14px** | 中文可读性下限 |
| 辅助元信息 | text-[11px] 803 处 | **12px** 下限 | mono 数字例外 |
| 徽章/计数 | text-[10px] 560 处 / [9px] 22 处 | **11px** 下限 | |
| 移动底栏标签 | text-[10px] | **12px** | |
| 表单输入 | 12-14px | **16px**（移动） | 防 iOS 缩放 |
| 行高 | leading-relaxed 为主 | 正文 1.6-1.75 | 现状良好 |

---

## 4. 未覆盖 / 未验证项

1. **自定义壁纸 + cardOpacity=0.2 触发态**：未实拍（需注入 localStorage 配置）；V6 结论为按 token 计算的最坏情况推演。→ Phase 2 复核。
2. **图标按钮 hover tooltip / focus 态对比度**：V11 仅截图观察，未取样 tooltip 背景对比度。→ Phase 2。
3. **图表/热力图**（/hot 热度色阶、/graph 生态图谱、github-heatmap 组件、videos 热力时间轴）：本次重点页未覆盖 /hot /graph /videos 的运行时取样（dev 阶段 /hot 有少量样本：白字徽章 'C' 1:1 为 favicon 渐变采样假阳性，已排除）；色阶插值对比度**未验证**。→ 建议 Phase 2/3 补。
4. **hover 变暗/变淡态**（`hover:bg-primary/90`、`hover:text-foreground` 等）：仅按 token 推断 hover 前后差异不大（/90 仍 ≥4.5），未逐态实测。
5. **disabled 态**：`disabled:opacity-50` 整体 50% 合成后约 3.3:1（浅色主按钮），WCAG 对 inactive 控件豁免，**不列为问题**，仅备忘。
6. **/marketplace/[slug]、/favorites、/custom、/submit、/algorithms** 页未纳入本轮 8 页矩阵（team-lead 指定范围），其中 /submit /custom 在 dev 阶段测量未完成。
7. **深色模式全矩阵**：生产实例以浅色三档为准；深色 token 结论均按 token 计算（确定性等同实测），深色运行时截图仅 dev 阶段 2 页。
8. **font-family 中文渲染**（PingFang/雅黑回退）：字族栈健全（globals.css:53），实际渲染效果未逐机验证。
9. **高对比度/forced-colors 模式**：globals.css 有 forced-colors 焦点处理，未实测。

---

## 5. 给 Phase 2/3 的交接备注

**给 ux-ui-designer（Phase 2 体验）：**
1. **键盘焦点动线**依赖 V1 修复——focus ring 2.56:1 在自定义壁纸下更糟，键盘走查前先确认 token 是否已改。
2. **错误反馈路径**（登录失败、表单校验）深色模式文字 1.99:1（V2），体验走查请在深色模式下专门触发错误态。
3. **hover-reveal 卡片操作**（V13）与顶栏图标簇（V11）的发现性问题需要任务流验证：新用户能否找到「收藏/置顶」；移动底栏 10px 标签（V8）在真实设备上的可读性。
4. **自定义壁纸场景**（V6）请设计对照实验：壁纸+低透明度下文字可读性，决定 scrim 方案。
5. 断点一致性：768px 为 mobile-nav 显隐边界（sm:hidden），640-768 区间顶栏/底栏布局需专项核对（本次截图 768 档已覆盖首页/登录，未发现断裂，但 hover-reveal 在触屏平板（hasTouch）的可用性值得复测）。

**给 frontend-engineer（Phase 3 前端）：**
1. V1-V5 全部是 **token/类名级修改**，改动集中在 `globals.css`（ring/destructive/border/muted-foreground/accent 四组）与徽章类名批量替换（`text-*-600→*-700` on `bg-*-500/10`），回归成本低、收益高，建议优先做。
2. Tailwind v4 `@source` 剪枝陷阱（globals.css:12-46 注释）：新增组件目录若类名「缺席」产物 CSS，会表现为「样式丢失」的白字白底假象；本次 collections 筛选按钮曾疑似命中（后经产物 CSS 检查 `bg-violet-500` 在库，判为采样假阳性）——**建议给关键对比对加构建期断言**（test/tw-source-coverage.test.ts 已有先例）。
3. `cardOpacity` 下限（use-home-diy.ts:518 0.2→0.85）是一行改动，但涉及 DIY 配置兼容（旧配置存 0.2 需 clamp），注意迁移。
4. 双 `Button`/`Input` 实现并存（`@/registry/new-york/ui/*` 与 `@/components/ui/*`，ring-1 与 ring-2 不一致）——修 V1 时两处都要改，或趁机合并。
5. 生产实例取证脚本：`deliverables/web-audit/ux-review-2026-10-31/visual-audit.mjs`（BASE 环境变量指向 3107），产出 `visual-audit-results-prod.json` + `screenshots/prod_*.png`，可直接复跑验收。

---

## 附：证据文件索引

| 文件 | 内容 |
|---|---|
| `visual-audit.mjs` | 取证脚本（三档视口 × 8 页，运行时对比度采样 + 截图） |
| `visual-audit-results-prod.json` | 生产实例运行时采样结果（对比度 fails / tiny 字号） |
| `visual-audit-results.json` | dev 实例旧采样（tags/collections/hot 可复用实测） |
| `screenshots/prod_{mobile-375,tablet-768,desktop-1440}__*.png` | 生产实例三档截图 |
| `screenshots/{mobile,tablet,desktop,dark}-*__*.png` | dev 阶段截图（辅助参考） |
