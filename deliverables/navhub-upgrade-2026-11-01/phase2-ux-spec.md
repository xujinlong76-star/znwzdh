# NavHub（山羊胡 4.0）Phase 2：真实用户痛点 / 商用级差距扫描 + 核心功能选型

> 产出人：ux-designer（体验设计专家，ui-navhub-audit）｜日期：2026-11-01
> 输入：Phase 1 视觉审查（`deliverables/web-audit/ux-review-2026-10-31/phase1-visual.md`，必读摘要已中转）、`deliverables/web-audit/检测报告.md`（2026-10-26 全流程真实浏览器检测）、`deliverables/deep-scan-report-2026-10-31.md`、`wiki.md`、`REPAIR_REPORT.md`、`docs/`（70 篇）、crawl/mobile/interactions 实测 JSON、git log 近 20 条 + 工作区 353 个 WIP 文件碰撞面扫描。
> 证据标注约定：**「实测」**=既有审计脚本/浏览器运行时数据（注明文件）；**「按 token/代码计算」**=源码解析或计数（注明 文件:行号）；**「未验证」**=无法在本轮测量，附原因。禁止编造。
> 纪律：本轮**只读产品代码**；仅写本目录文档。热区/WIP 文件只报告不改。

---

## 0. 结论速览

| 项 | 结果 |
|---|---|
| 痛点 | **P1–P11**（高 4 / 中 6 / 低 1） |
| 商用级差距 | **G1–G8**（高 2 / 中 4 / 低 2） |
| 核心功能选型 | **4 个**：F1 可访问性 Token 收敛与对比度门禁（P0）、F2 路由加载骨架与局部错误边界补全（P0）、F3 移动触控可读性与触达基线（P1）、F4 自定义壁纸文字可读性兜底（P1） |
| 不做什么 | 7 项（含 3 项因并行会话热区占用而显式推迟） |
| 碰撞面总评 | 4 个功能全部以**冷区修改 + 新增文件**为主；唯一热区接触点（navigation-card / signin）已降级为「只报告 + 给出一行改法」 |

---

## 1. 痛点清单（真实用户场景，证据优先）

### P1 ｜高｜键盘用户看不到焦点在哪
- **场景**：键盘/辅助技术用户 Tab 巡航首页卡片、搜索框、登录表单时，无法判断当前焦点位置。
- **频率/影响面**：每次键盘导航；全站所有可聚焦元素（按钮/链接/卡片/输入框）。
- **证据**：**按 token 计算**（Phase 1 V1）——浅色 `--ring: 240 5% 64.9%`（#A1A1AA）对白底 **2.56:1**，低于 WCAG 1.4.11/2.4.11 要求 3:1；`globals.css:250`。深色 13.46:1 合格。
- **严重度**：高（核心任务「找到并打开目标站点」对键盘用户直接不可用）。

### P2 ｜高｜深色模式错误提示近乎不可见
- **场景**：用户登录失败、表单校验出错、中枢降级时看到的红色错误文字几乎读不出。
- **频率/影响面**：所有错误反馈路径（`/auth/signin`、表单校验、删除确认、HubDegradedNotice）；深色模式用户。
- **证据**：**按 token 计算**（Phase 1 V2）——`.dark --destructive: 0 62.8% 30.6%`（#7F1D1D）作**文字**在深底上 **1.99:1**，`bg-destructive/10` 合成底 **1.93:1**；`globals.css:314`。浅色错误条 4.14:1 亦不达标。
- **严重度**：高（错误反馈是「状态可见性」原则的核心路径，深色模式下等于没有反馈）。

### P3 ｜高｜DIY 强调主题主按钮文字不达标
- **场景**：用户选择 emerald/rose 强调主题后，「登录」「保存」等主按钮白字看不清。
- **频率/影响面**：使用 DIY 主题的用户全站主操作按钮。
- **证据**：**按 token 计算**（Phase 1 V3）——emerald `--primary: 158 64% 45%` + 近白前景 = **2.32:1**；rose = **4.04:1**；`globals.css:553-575`（`:root[data-accent=...]` 四组）。对照 violet 5.41:1、amber 8.29:1 合格。
- **严重度**：高（主 CTA 不可读；且 4 主题 2 个失败=系统性配方缺失）。

### P4 ｜中｜徽章与次要文字大面积 AA 失守
- **场景**：用户扫读卡片徽章（Stars/健康/检索渠道）、描述、计数时文字发虚。
- **频率/影响面**：首页、/sites、/site/[id]、/tags、/hot 高频出现。**按代码统计**（本轮 grep，工作区含 WIP）：`bg-*-500/10 text-*-600` 徽章配方 **170 处**；`text-muted-foreground/{50,60,70,80}` **164 处**（Phase 1 口径 146 处，已增长）。
- **证据**：**按 token 计算**（Phase 1 V4/V5）——`text-emerald-600` 3.43:1、`text-amber-600` 2.95:1、`text-amber-500` 1.99:1、`text-rose-600` 4.12:1；muted-foreground /80 3.28:1、/70 2.74:1、/60 2.32:1、/50 1.98:1，全部 <4.5:1。合格参照档：`*-700` 系 4.65~6.29:1。
- **严重度**：中（慢性损耗，不挡核心任务但直接损害「专业感/信任」）。

### P5 ｜中｜微字号伤害中文可读性（移动底栏尤甚）
- **场景**：移动用户读底栏标签、徽章数字、卡片元信息；中文字形笔画密，<12px 显著劣化。
- **频率/影响面**：全站。**按代码统计**（本轮 grep）：`text-[11px]` **869 处**、`text-[10px]` **576 处**、`text-[9px]` 22 处、`text-[8px]` 1 处（Phase 1 口径 803/560，已增长）。
- **证据**：`apps/web-overlay/src/components/mobile-nav.tsx:69`（底栏标签 `text-[10px]`）、`:78`（通知徽章 `text-[8px]`）；**实测**（Phase 1 dev 三页取样）：「首页」等 10px、计数「(5)」10px 在 375px 视口内。
- **严重度**：中（移动主路径常驻底栏；新用户第一眼就撞上）。

### P6 ｜高｜10+ 条路由加载白屏、崩溃即「踢出外壳」
- **场景**：慢网/首次访问/服务端渲染期，用户面对白屏无反馈；页面局部抛错时全局 error.tsx 会把导航外壳一起替换掉，用户只能回首页重来。
- **频率/影响面**：**按路由扫描**（本轮 find 统计）——`loading.tsx` 缺失：`/category`、`/collections`、`/tags`、`/site/[id]`、`/marketplace*`、`/search`、`/sites`、`/import`、`/submit`、`/custom`、`/offline`；`error.tsx` 缺失：`/category`、`/marketplace*`、`/search`、`/sites`、`/import`、`/submit`、`/custom`、`/offline`、`/me/*`（除 favorites/hot/videos 等已有）、`/graph`、`/algorithms`、`/preferences`。其中 `/site/[id]` 与 `/hot` 是 force-dynamic（慢渲染，白屏时间最长）。
- **证据**：`apps/web-overlay/src/components/route-skeleton.tsx:1-15` 注释自证「`app/loading.tsx` 只有全局一份，其余 10 条路由在服务端渲染期间是**白屏**」；`route-error.tsx:1-13` 自证「`/hot`、`/site/[id]` 一旦抛错，用户会被踢出整个外壳」。两组件已存在且带 3 种形态骨架（grid/detail/list），只是**没接进缺失路由**。
- **严重度**：高（商用可靠性感知的最短板；基础设施已备好，纯接线缺口）。

### P7 ｜中｜触屏下卡片操作「不存在」（hover-reveal）
- **场景**：触屏平板/大屏触控用户想收藏/置顶卡片，但操作簇 `sm:opacity-0 sm:group-hover:opacity-100` 在无 hover 的设备上永远不可见。
- **频率/影响面**：全站站点卡片（首页、/sites、/category）；全仓同类 hover-reveal 模式 18 处（Phase 1 V13）。
- **证据**：**按代码确认** `apps/web-overlay/src/components/navigation-card.tsx:329`（`opacity-80 sm:opacity-0 sm:group-hover:opacity-100`）；**截图**（Phase 1 `screenshots/prod_desktop-1440__home.png`）桌面未 hover 时无可见操作。注：该文件现为**并行会话热区 WIP**，本轮只报告。
- **严重度**：中（触屏用户找不到「收藏」，直接影响高频任务）。

### P8 ｜中｜顶栏纯图标按钮可供性弱、触达面积不足
- **场景**：新用户面对顶栏 12+ 个无文字图标（钥匙/置顶/探索/账户/帮助/信封/模式/布局/主题/通知/设置）猜不出用途；触屏点按 32px 小目标易误触。
- **频率/影响面**：全站顶栏常驻。
- **证据**：`apps/web-overlay/src/components/navigation-toolbar.tsx`——`size="icon"` 按钮 **8 处**，尺寸类 `h-8 w-8` / `h-8.5 w-8.5`（32–34px）**8 处**，低于 44px 触达建议（WCAG 2.5.5 AAA / 平台 HIG 44pt）；Phase 1 V11 截图证据 + 「aria-label 需逐个核对」留给体验域。本轮按代码确认主要按钮已带 `aria-label` + `title`（如 `:91-92` 微工具箱），但无持久可见标签、点击区偏小。
- **严重度**：中（发现性差 + 触屏误触；功能本身可达，属效率/包容性损耗）。

### P9 ｜中｜自定义壁纸 + 低透明度下文字对比度失控
- **场景**：DIY 用户设自定义壁纸并把卡片透明度拉到底（0.2）时，卡片标题/描述对任意壁纸底色对比度完全不可控。
- **频率/影响面**：使用壁纸+美学滑杆的 DIY 用户；一旦触发全屏可读性崩坏。
- **证据**：**按 token 计算**（Phase 1 V6）——glass 0.75 合成下浅色 muted-fg 对中灰壁纸 3.63:1、对黑壁纸 2.63:1；`cardOpacity` 允许低至 **0.2**（`apps/web-overlay/src/lib/modular/use-home-diy.ts:518` `Math.min(1.0, Math.max(0.2, opacity))`）时对比度任意。触发态实拍**未验证**（需注入 localStorage 壁纸配置）。
- **严重度**：中（边界场景，但商用产品不能有「可配置出不可读界面」的自由度）。

### P10 ｜低｜登录输入框 12px 触发 iOS 聚焦自动放大
- **场景**：iPhone 用户点登录输入框，页面被浏览器强制放大，布局移位。
- **频率/影响面**：iOS Safari 全部输入场景（登录页最显眼）。
- **证据**：Phase 1 V12（`/auth/signin` Input `h-9 text-xs`，截图 `prod_mobile-375__signin.png`）。注：`apps/web-overlay/src/app/auth/signin/page.tsx` 现为**并行会话热区 WIP**（signup/forgot-password 等新页面在建），本轮只报告。
- **严重度**：低（一次性跳动，不丢数据；但商用移动端体验评分项）。

### P11 ｜中｜五路混合检索的能力对用户不可见（查询语法无可发现入口）
- **场景**：用户不知道可以 `-词` 排除关键词、不知道拼音/语义/全文/精确四渠道徽章含义、不知道 ⌘K 与首页内联框的能力边界（内联=本地导航树过滤，⌘K=全站五路检索——检测报告「误报澄清」实证两者不同）。
- **频率/影响面**：所有搜索用户；搜索是本产品第一入口。
- **证据**：**按代码 grep**——全仓无「搜索语法/搜索帮助/search syntax」组件或文案（`grep -rn "搜索帮助|搜索语法|searchHelp|query-syntax"` 零命中）；而 git log `5352017d` 刚新增「负向过滤 `-词` 用法与『已排除关键词』留痕」、`fc33b333` 新增召回回归账——能力在长，可发现性没跟上。渠道徽章有视觉呈现（`search-bar.tsx:60-83`）但无解释。
- **严重度**：中（能力浪费 + 学习成本；**但 search 相关文件全部处于并行会话热区**，本轮不选型落地，见「不做什么」第 1 条）。

### 附：低优先观察（不单列编号）
- V10 装饰分隔符（·、/）未 `aria-hidden`（footer.tsx 约 13 处）——读屏播报噪音，修复成本极低，可搭 F3 顺风车。
- 640–768px 区间（mobile-nav `sm:hidden` 与侧栏 `md:` 交接带）Phase 1 截图未见断裂，但 hover-reveal 在触屏平板的可用性值得复测（已并入 F3 验收走查）。

---

## 2. 商用级差距清单（对标「可对外商用」）

### G1 ｜高｜WCAG 2.1 AA 系统性失守 → 信任与合规风险
- **差距**：对比度失败不是个别像素而是**配方级**（焦点环、错误文字、强调主题、徽章、透明度变体、边框六类），P1–P4/P9 的总和。对外商用时：无障碍不达标=部分市场准入与口碑风险；「错误提示读不清」直接打击专业感。
- **证据**：Phase 1 14 项问题全量计算/实测数据；本轮计数复核（170 徽章 / 164 透明度变体 / 869+576 微字号）确认规模仍在。
- **现状差距**：已有 `apps/web-overlay/test/a11y-contrast.test.ts`（仅锁 2 处个案，2026-10-23 Lighthouse 0 分事件驱动），**无 token 级/主题级回归门禁**。

### G2 ｜高｜加载/错误态覆盖有洞 → 可靠性感知短板
- **差距**：骨架屏与局部错误边界的基础设施是完备的（route-skeleton / route-error / failure-surface.test.ts / empty-vs-failure-honesty.test.ts / HubDegradedNotice），但 10+ 条路由没接线（P6）。商用产品的底线是「任何时刻都有状态可见性」，当前慢网白屏、局部崩溃踢出外壳两条路径不达标。
- **证据**：路由扫描（本文 P6）+ 组件自述注释。

### G3 ｜中｜触屏/移动端可读性与触达基线不足 → 多端一致性
- **差距**：移动底栏 10px 标签/8px 徽章（P5）、32px 图标触达（P8）、hover-reveal 触屏盲区（P7）、iOS 输入缩放（P10）。桌面体验与触屏体验的落差不符合「跨端一致」的商用要求。
- **证据**：mobile-nav.tsx:69,78；navigation-toolbar.tsx 触达统计；navigation-card.tsx:329。

### G4 ｜中｜美学配置无对比度护栏 → 边界处理缺失
- **差距**：产品允许用户「合法配置出不可读界面」（cardOpacity 0.2 + 自定义壁纸，P9）。商用级要求：自由度的边界是可用性下限（防错原则）。
- **证据**：use-home-diy.ts:518；Phase 1 V6 推演。

### G5 ｜中｜测试与质量门禁存在抖动治理缺口（**并行会话进行中，勿重复造轮**）
- **差距**：红灯台账/ai-heal/抖动归因等治理正在由并行会话落地（git log：`8cf8aa7c`…`687203ab` 连续 6 条 CI 抖动治理提交；WIP 含 `.github/workflows/ci.yml`、`apps/api/test/*`、precommit 归因）。
- **处置**：本清单只立账不排期；Phase 3 的功能验收**沿用现有 `pnpm test` 门禁**即可，不要新建平行门禁体系。

### G6 ｜低-中｜首页 HTML 预算余量收窄、守护面单一
- **差距**：渐进披露后 3556/4096 KB（实测，检测报告 4.6），余量 13%；预算哨兵挂在 `seo-audit-prod`（手动触发），不在 PR 阻塞链（团队已决策，理由充分：PR 种子库必然绿灯）。任何新增首页 DOM 的功能都可能顶爆预算。
- **处置**：F1–F4 均不增加首页 DOM；每个功能验收附 `html-budget.mjs` 零回归断言。

### G7 ｜低｜forced-colors / 高对比度模式未验证
- **差距**：globals.css 有 forced-colors 焦点处理，但从未实测（Phase 1 未验证项 9）。商用包容性加分项，非阻塞。

### G8 ｜低｜640–768px 断点交接带未专项核对
- **差距**：mobile-nav 见于 `<sm`、桌面侧栏见于 `≥md`，中间带的顶栏/底栏协作仅被 768px 档截图粗扫。归入 F3 走查项即可。

---

## 3. 核心功能选型（2–4 个，完整展开）

> 选型原则（按用户总任务）：克制（4 个上限）、每个都能完整落地并验证、聚焦真实痛点、拒绝虚浮、优先冷区与新增文件。4 个功能**均不新增后端逻辑**——这是证据结论而非偷懒：本轮痛点全部位于展示层（token/接线/触控），而后端相关痛点（搜索语法、备份、健康度）全部撞上并行会话热区（见第 4 节）。四件套中的「后端逻辑」一项如实标注「无/不涉及」，不为凑数发明接口。

---

### F1 ｜P0｜可访问性 Token 收敛与对比度回归门禁

**① 解决的真实痛点（用户场景 + 证据）**
P1 键盘焦点不可见、P2 深色错误不可见、P3 强调主题主按钮不可读、P4 徽章/次要文字大面积 AA 失守、P9（对比度半边）。典型场景：深色模式用户登录失败看不清错误原因；键盘用户 Tab 到卡片不知身在何处；emerald 主题用户找不到「保存」。

**② 价值判断（为什么不是虚浮）**
- 修的是**每天都在发生的可读性故障**，不是视觉润色。
- 修复面高度集中（token/类名配方），一次收敛全站生效，回归成本极低（Phase 1 交接语：「V1-V5 全部是 token/类名级修改…建议优先做」）。
- 对外商用的信任底座：错误提示可读、焦点可见是 WCAG AA 硬指标。
- 顺手建立**构建期对比度断言**（Phase 1 明确建议），防止回潮——把一次性修复升级为长期门禁。

**③ 完整范围（四件套）**
| 层 | 内容 |
|---|---|
| 后端逻辑 | **无/不涉及**（纯前端 token 与样式层） |
| 前端交互 | 1) `globals.css` token 修正：浅 `--ring`→`240 5% 46%`（4.83:1）；`.dark` 新增 `--destructive-text: 0 84% 70%` 并把危险文字统一切换；emerald `--primary`→`158 84% 30%`、rose→`346 84% 42%`（或前景改深，推荐加深主色一劳永逸）；新增 `--border-strong`（浅 `240 5% 72%` / 深 `240 4% 36%`）专供 input/描边按钮；`--muted-foreground` 加深至 `240 4% 40%` 并**全局禁止** `text-muted-foreground/[0-9]+` 透明度变体（装饰+aria-hidden 例外）。2) 徽章配方统一为 `bg-*-500/10 + text-*-700`（emerald/amber/rose 三系，浅色档）。3) 四个 `data-accent` 主题逐一对齐。4) 旧 DIY 配置/主题选择无需迁移（只改色值不改结构） |
| 自动化测试 | 新增 `apps/web-overlay/test/a11y-token-contrast.test.ts`（镜像 `apps/web/test/`）：解析 `globals.css` HSL token → 计算相对亮度与对比度，断言：浅/深两种底 × 四种 accent 的 `primary+primary-foreground` ≥4.5:1；`--ring` 对背景 ≥3:1；`.dark --destructive-text` 对背景 ≥4.5:1；`--border-strong` 对背景 ≥3:1；grep 断言 `text-muted-foreground/[0-9]+` 计数=0（白名单外）；grep 断言 `bg-*-500/10 text-*-600` 配方=0。复用 `a11y-contrast.test.ts` 的「锁源码意图」风格与 overlay 文件定位惯例 |
| 必要文档 | 本规格 3.1 色彩 token 调整表直接可施工；在 `docs/DESIGN-SYSTEM.md` 增补「对比度配方」一节（徽章= /10+700、错误文字=destructive-text、输入框=border-strong）；Phase 1 的 `visual-audit.mjs` 作为人工验收工具写进验收标准 |

**④ 涉及文件（新增 vs 修改；碰撞风险）**
| 文件 | 动作 | 热区？ | 说明 |
|---|---|---|---|
| `apps/web-overlay/src/styles/globals.css` | 修改（token 层） | **冷**（git status 干净） | 主战场；`:243-250` 浅色、`:311-318` 深色、`:553-575` accent 四组、`:446-451` glass |
| `apps/web-overlay/test/a11y-token-contrast.test.ts` | **新增** | — | 门禁 |
| `apps/web/test/a11y-token-contrast.test.ts` | **新增**（镜像） | — | vitest 执行面（vitest.config.ts:41-52 注释：overlay test 不直接跑，必须同步镜像） |
| `apps/web-overlay/src/components/mobile-nav.tsx` 等徽章/文字类名 | 修改（仅冷区文件内的 `text-*-600`） | **冷** | 例：footer.tsx 已有 `text-emerald-700` 先例 |
| `navigation-card.tsx` 等 170 处徽章 | **只列清单不改** | **热**（WIP） | 产出「待替换类名清单」交给 Phase 3 在热区释放后批量执行；token 层修复已让大部分徽章自动达标（若用 currentColor 系）——**未验证**自动生效范围，Phase 3 逐个复测 |
| `apps/web-overlay/src/app/auth/signin/page.tsx` | **不改** | **热**（WIP auth 系列） | V12/V2 登录错误文字随 token 修复自动受益；字号问题归 F3 延迟项 |

**⑤ 验收标准（可验证判定 + 测试命令）**
1. `npx vitest run apps/web/test/a11y-token-contrast.test.ts` 全绿（含四主题 × 两模式断言）。
2. `pnpm test` 无回归（重点盯 `a11y-contrast.test.ts`、`design-system.test.ts`）。
3. 浅色模式任取 10 个可聚焦控件，`getComputedStyle` 取 outline/ring 与相邻背景对比度 ≥3:1（可用 `deliverables/web-audit/ux-review-2026-10-31/visual-audit.mjs`，`BASE` 指向本地实例复跑）。
4. 深色模式触发一次登录失败：错误文字实测 ≥4.5:1。
5. 切换四种强调主题：主按钮文字浅/深两模式各 ≥4.5:1。
6. `node scripts/html-budget.mjs --url=http://localhost:3000/ --max-kb=4096` 仍 `ok:true`（零回归）。
7. `pnpm mirror:web && node scripts/check-web-overlay.mjs` 0 漂移。

**⑥ 风险与依赖**
- **风险**：徽章批量替换若在热区文件上做会撞车 → 已规避（只做 token + 冷区，热区出清单）。`--muted-foreground` 加深会影响全站灰度观感（更实一点），需视觉 owner 知会（属可接受变化，非破坏）。Tailwind v4 `@source` 剪枝陷阱（Phase 1 交接 2）：新增 token 类名若被剪，断言测试应同时查产物 CSS——门禁测试里加一条「产物含 border-strong 类」。
- **依赖**：无外部依赖。与并行 WIP 无文件交集（globals.css 已核验干净）。

**任务流程图（键盘走查动线，验收用）**
```
[Tab 进入页面] → [跳过链接 → main] → [顶栏搜索框] → [卡片网格（单 Tab 停留点，→ 展开操作区）]
      ↓ 焦点环全程 ≥3:1 可辨
[触发错误（登录失败/断网请求）] → [错误文字 ≥4.5:1 可读] → [重试/返回出口] → [焦点回到安全位置]
```

**无障碍清单（F1 交付物）**
- [ ] `:focus-visible` 环浅色 ≥3:1、深色维持 ≥3:1
- [ ] 所有错误/危险文字 ≥4.5:1（深浅两模式）
- [ ] 四主题主按钮文字 ≥4.5:1
- [ ] 徽章文字（浅色）≥4.5:1（配方：`bg-*-500/10` + `text-*-700`）
- [ ] 无 `muted-foreground` 透明度变体（装饰 + aria-hidden 除外）
- [ ] 输入框边界 ≥3:1（border-strong）
- [ ] 构建期对比度断言进 CI（vitest，随 `pnpm test` 门禁走）

---

### F2 ｜P0｜路由级加载骨架与局部错误边界补全

**① 解决的真实痛点（用户场景 + 证据）**
P6：慢网/首访用户在 `/category`、`/sites`、`/site/[id]`、`/marketplace` 等页白屏等待无反馈；页面局部抛错时被踢出导航外壳只能回首页重来。证据见 P6 的路由扫描与 `route-skeleton.tsx` / `route-error.tsx` 组件自述（它们就是为此而生，但 10+ 路由没接线）。

**② 价值判断**
- 「状态可见性」是 Nielsen 启发式第 1 条；白屏=用户不知道系统死没死，商用产品不可接受。
- **零发明**：复用已存在、已带 a11y 属性（`aria-busy`/`aria-live`/`role="alert"`/焦点回落 main）的两个组件；本功能是**接线工程**，交付确定性极高。
- 顺手把「失败 ≠ 空态」的既有口径（empty-vs-failure-honesty.test.ts）覆盖面扩到全部路由，直接服务商用「错误与边界处理」差距 G2。

**③ 完整范围（四件套）**
| 层 | 内容 |
|---|---|
| 后端逻辑 | **无/不涉及**（加载/错误态是纯前端壳层；中枢失败场景已有 HubDegradedNotice/lib/degrade 判定层） |
| 前端交互 | 1) 为缺失路由补 `loading.tsx`（复用 `RouteSkeleton` 三形态：`grid`→/category /sites /marketplace /search /tags /collections；`detail`→/site/[id]；`list`→/import /submit /custom /offline）；2) 为缺失路由补 `error.tsx`（复用 `RouteError`，传 `scope` 中文名，如「分类总览」「站点详情」）；3) 校验错误态文案与重试出口符合 `describeCrash` 口径（不新增第二套文案体系）；4) 加载骨架与真实布局形状对齐（route-skeleton 已内建三形态，只调 count/variant） |
| 自动化测试 | 新增 `apps/web-overlay/test/route-state-coverage.test.ts`（镜像 `apps/web/test/`）：扫描 `apps/web-overlay/src/app/**/page.tsx`，断言每个可导航路由目录存在 `loading.tsx` 或显式豁免清单（如 `auth/*` 静态表单、`api/*`）；断言存在 `error.tsx` 或继承父级边界且豁免清单一致；断言所有 `loading.tsx` 引用 `RouteSkeleton`（不许手写第二套骨架）；断言所有 `error.tsx` 引用 `RouteError` 或 `describeCrash`（口径统一）。豁免清单写死在测试里并注释理由（防漂移） |
| 必要文档 | `docs/` 新增短文《路由状态规范：何时 loading / 何时 error / 豁免规则》（或并入 TESTING-CONVENTIONS.md）；在 route-skeleton.tsx 头注释更新「接入路由清单」 |

**④ 涉及文件**
| 文件 | 动作 | 热区？ |
|---|---|---|
| `apps/web-overlay/src/app/{category,collections,tags,site/[id],marketplace,search,sites,import,submit,custom,offline}/loading.tsx` | **新增**（约 11 个） | — （目录内 page.tsx 有零星 WIP：`search/page.tsx`、`favorites/page.tsx` 是热区，但**新增 loading.tsx/error.tsx 文件不碰它们**） |
| 同上目录的 `error.tsx` | **新增**（约 11 个） | — |
| `apps/web-overlay/src/app/marketplace/{author,import,mine,publish}/loading.tsx` | **新增**（可选，二级路由） | — |
| `apps/web-overlay/test/route-state-coverage.test.ts` + `apps/web/test/` 镜像 | **新增** | — |
| `route-skeleton.tsx` / `route-error.tsx` | 原则上**不改**（若需 variant 微调才动） | **冷** |
| `apps/web-overlay/src/app/error.tsx`（全局） | 不改 | 冷 |

**⑤ 验收标准**
1. `npx vitest run apps/web/test/route-state-coverage.test.ts` 全绿。
2. 手工（`node scripts/dev-all.mjs` 或生产构建实例）：Chrome DevTools 网络限速 Slow 3G 打开 `/category`、`/sites`、`/site/[id]`、`/marketplace` → 看到骨架屏（非白屏）且 `aria-busy="true"`。
3. 人为在 `RouteError` 挂载路径抛错（或临时改组件 throw）→ 局部错误卡出现、顶栏/导航外壳保留、「重试/返回」可用；对照 `deliverables/web-audit/interactions.mjs` 14 步不回退。
4. `pnpm test` 全绿；`pnpm mirror:web && node scripts/check-web-overlay.mjs` 0 漂移。
5. `node scripts/html-budget.mjs --max-kb=4096` 仍 ok（骨架是 loading 态不进首屏 HTML 预算，但防意外）。

**⑥ 风险与依赖**
- **风险**：豁免清单设计不当会变成「测试永绿」→ 要求豁免必须显式列举+注释理由（照 failure-surface.test.ts 的严格风格）。`/search` 目录是热区，其 loading.tsx 新增虽不冲突，但 Phase 3 动手前应 `git status` 复核；若届时仍热，`/search` 可暂缓到热区释放。
- **依赖**：无。与 F1 无耦合（但 F1 修复错误文字颜色后 F2 的错误卡更可读——协同收益）。

**关键界面线框要点（F2 错误态，复用现有 RouteError 结构）**
```
┌───────────────────────────────────┐
│  [顶栏/侧栏外壳保持可见，不替换]      │
│  ┌─────────────────────────────┐  │
│  │   ⚠  (destructive/10 底)     │  │
│  │   「站点详情加载失败」          │  │
│  │   人类可读原因（describeCrash） │  │
│  │   处置提示 hint               │  │
│  │   诊断编号 digest（mono 11px） │  │
│  │   [重试]  [返回首页]          │  │  ← 按钮 ≥36px 高，焦点可落
│  └─────────────────────────────┘  │
│   main#main-content tabIndex=-1   │
└───────────────────────────────────┘
```

**响应式策略（F2）**：骨架三形态自带 `grid-cols-1 sm:2 md:3 lg:4` 与 `lg:[2fr,1fr]` 断点，375/768/1440 三档直接继承；错误卡 `max-w-xl` 居中，375px 不溢出。

---

### F3 ｜P1｜移动触控可读性与触达基线

**① 解决的真实痛点**
P5（底栏 10px/徽章 8px 中文不可读）、P8（32px 图标触达 + 纯图标发现性）、P7 触屏部分（hover-reveal 触屏盲区——本轮只给改法）、P10（iOS 输入缩放——延后到 auth 热区释放）。场景：通勤单手刷手机的开发者读不清「收藏」标签、点不中通知图标、找不到卡片上的收藏按钮。

**② 价值判断**
- 移动流量占导航类产品的多数；底栏是移动第一入口，10px 中文标签是**每天每次**的损耗。
- 触达面积是防错设计（Fitts's Law）的基本盘；32px→36px+ 是一行类名的事。
- 全部改动落在冷区文件，见效快、风险低。
- 不做「悬浮胶囊/快捷托盘」（并行会话已在做），聚焦基线而非新玩具。

**③ 完整范围（四件套）**
| 层 | 内容 |
|---|---|
| 后端逻辑 | **无/不涉及** |
| 前端交互 | 1) `mobile-nav.tsx`：标签 `text-[10px]`→`text-[12px]`、徽章 `text-[8px]`→`text-[11px]`（保持 `leading-[14px]`/`min-w` 需同步微调防溢出）；2) `navigation-toolbar.tsx`：8 个 `size="icon"` 按钮触达 `h-8/8.5`→`h-9 w-9`（36px）起步，`title`/`aria-label` 全量核对补缺；3) `footer.tsx` 装饰分隔符「·」补 `aria-hidden="true"`（V10 顺风车，约 13 处）；4) 产出 hover-reveal 一行改法（`navigation-card.tsx:329`：桌面至少常显一个主操作或 `@media (hover:none)` 下强制可见）——**只写进交接，不改热区文件**；5) 输入框字号 16px：优先在 `globals.css` 加 `input { font-size: 16px }` 移动端断点规则（冷区），signin 专有 `text-xs` 覆盖类待热区释放后再删 |
| 自动化测试 | 新增 `apps/web-overlay/test/touch-target-baseline.test.ts`（镜像）：grep 断言 `mobile-nav.tsx` 无 `text-[8px]`/`text-[9px]`/`text-[10px]`；断言 `navigation-toolbar.tsx` 无 `h-8 w-8`（icon 按钮）；断言每个 `size="icon"` 按钮行附近存在 `aria-label`；断言 footer 分隔符带 `aria-hidden` |
| 必要文档 | 本节「响应式策略」+「触达清单」写入 `docs/DESIGN-SYSTEM.md` 或移交视觉 owner；640–768 交接带核对结论补进 Phase 2 本文档（§6） |

**④ 涉及文件**
| 文件 | 动作 | 热区？ |
|---|---|---|
| `apps/web-overlay/src/components/mobile-nav.tsx` | 修改（2 处字号） | **冷**（已核验） |
| `apps/web-overlay/src/components/navigation-toolbar.tsx` | 修改（尺寸/aria） | **冷** |
| `apps/web-overlay/src/components/footer.tsx` | 修改（aria-hidden） | **冷** |
| `apps/web-overlay/src/styles/globals.css` | 修改（input 字号断点） | **冷**（与 F1 共文件，注意分 commit 或串行） |
| `apps/web-overlay/test/touch-target-baseline.test.ts` + 镜像 | **新增** | — |
| `navigation-card.tsx` | **不改**（给一行改法） | **热** |
| `auth/signin/page.tsx` | **不改** | **热** |

**⑤ 验收标准**
1. `npx vitest run apps/web/test/touch-target-baseline.test.ts` 全绿。
2. 375px 视口实测：底栏标签计算字号 ≥12px、徽章 ≥11px（DevTools 取样）。
3. 顶栏图标按钮 `getBoundingClientRect` ≥36×36px；Tab 巡航每个按钮有可访问名。
4. iOS 真机或 Xcode Simulator：375px 下输入框 ≥16px、聚焦不再整页缩放（若 input 规则生效；signin 专有类未删前以全局规则覆盖判定——**未验证**覆盖优先级，Phase 3 实测）。
5. 触屏平板（或 DevTools 设备仿真 hasTouch）：卡片操作可见性问题**记录现状**，若热区已释放则按改法修复并复测（V13 验收：「首次进入未 hover 时可发现至少 1 个卡片操作」）。
6. `pnpm test` 无回归；`html-budget` ok；`check-web-overlay` 0 漂移。

**⑥ 风险与依赖**
- **风险**：底栏字号变大可能挤占 4 项均分布局（`flex-1` 已有，风险低）；toolbar 按钮变大可能在 768px 档挤爆一行（需 768 档截图核对，Phase 1 V11 交接点名）；`globals.css` input 规则若与 registry Input 的 `text-xs` 冲突需实测层叠优先级。
- **依赖**：与 F1 共享 globals.css——**建议 F1 先合入，F3 再动**，避免同文件双改。

**响应式策略（F3）**
| 断点 | 现状 | F3 动作 |
|---|---|---|
| <640（sm 以下） | mobile-nav 常驻（h-14 + safe-area）；footer 预留 5.5rem | 标签/徽章字号提升；触达由整列 `flex-1` 保证（已是全宽，仅字号问题） |
| 640–768 | mobile-nav 隐藏（sm:hidden），侧栏未现（md:），顶栏图标簇横排 | toolbar 按钮 36px 后横排压力最大区间——**核对点**；hover-reveal 在触屏本区间完全失效（V13 延迟修复） |
| ≥768 | 侧栏 + 顶栏完整态 | 触达 36px + tooltip；V11 的「低频工具入更多」本轮不做（结构改动大），只做基线 |

**无障碍清单（F3 交付物）**
- [ ] 可见文本计算字号 ≥12px（mono 数字例外，写明白名单）
- [ ] 移动输入框 ≥16px
- [ ] 图标按钮 100% 有 aria-label + tooltip，触达 ≥36px
- [ ] 装饰分隔符 aria-hidden
- [ ] 底栏通知徽章计数有可访问名（已有 `aria-label`「N 条未读通知」，保持）

---

### F4 ｜P1｜自定义壁纸文字可读性兜底（对比度护栏）

**① 解决的真实痛点**
P9：DIY 用户把卡片透明度拉到底 + 自定义壁纸后，卡片文字对任意底图不可控地不可读。场景：用户精心换了壁纸，结果导航内容读不清，又不知道为什么。

**② 价值判断**
- 「可配置出不可读」是防错原则（Nielsen #5）的反面教材；商用产品必须给自由度设下限。
- 修复极小（clamp + scrim），但包含一个**数据完整性**细节：旧配置里存的 0.2 需要读时 clamp（不能只改写入端），这正好呼应用户总任务的「保障数据完整性」。
- 独立成包的理由：它有「配置迁移」语义，混在 F1 里会让 F1 的 token 验收变得不纯粹；且 use-home-diy.ts 是冷区，可独立验证。

**③ 完整范围（四件套）**
| 层 | 内容 |
|---|---|
| 后端逻辑 | **无**（DIY 配置存 localStorage/URL-Hash/金库，皆为前端域；若中枢金库同步了旧配置，读取端 clamp 即可覆盖） |
| 前端交互 | 1) `use-home-diy.ts:518` 写入 clamp `0.2`→`0.85`；**读取端**（config 初始化 `:563` `config.cardOpacity ?? 0.9` 路径）同样 clamp，保证旧配置（存 0.2）打开即被抬到 0.85；2) 自定义壁纸启用时给文字容器强制 scrim：`hsl(var(--card) / 0.88)` 底或 `backdrop-blur ≥ 12px` + `bg-background/30` 遮罩（globals.css `.glass-surface` 下限与 wallpaper 注入点，`navigation-content.tsx:355-363` 壁纸样式注入——**该文件是热区！** → scrim 优先做进 globals.css 的 `.glass-surface` 与卡片类，壁纸注入点的改动给一行改法）；3) 滑杆 UI 的 min 提示（滑杆到底就是 0.85，刻度语义更新） |
| 自动化测试 | 新增 `apps/web-overlay/test/wallpaper-contrast-guard.test.ts`（镜像）：断言 `use-home-diy.ts` 读写两处 clamp ≥0.85；断言 `.glass-surface` 背景 alpha ≥0.85 或含 scrim 类；断言旧值迁移（用函数级单测：`normalizeAesthetic({cardOpacity:0.2})` → ≥0.85） |
| 必要文档 | DIY 帮助文案/README 壁纸一节补「透明度下限 0.85 保可读性」；REPAIR 风格短记（若需） |

**④ 涉及文件**
| 文件 | 动作 | 热区？ |
|---|---|---|
| `apps/web-overlay/src/lib/modular/use-home-diy.ts` | 修改（读写 clamp） | **冷**（已核验） |
| `apps/web-overlay/src/styles/globals.css` | 修改（glass-surface/scrim） | **冷**（与 F1/F3 共文件） |
| `apps/web-overlay/test/wallpaper-contrast-guard.test.ts` + 镜像 | **新增** | — |
| `navigation-content.tsx:355-363` 壁纸注入 | **不改**（给改法） | **热** |
| `home-diy-toolbar.tsx` 滑杆 UI | 若需改 min 提示才动 | 需 git status 复核（本轮未列入 WIP，**初步判冷**） |

**⑤ 验收标准**
1. `npx vitest run apps/web/test/wallpaper-contrast-guard.test.ts` 全绿。
2. 手工：localStorage 注入 `{cardOpacity:0.2, customWallpaperUrl:<黑白测试图>}` → 打开首页，卡片文字实测对比度 ≥4.5:1（用 visual-audit.mjs 或手动取样）；透明度滑杆最小值=0.85。
3. 旧配置兼容：先在旧版本存 0.2，升级后打开不崩溃、显示按 0.85 渲染（读时 clamp 证据）。
4. `pnpm test` 无回归（`diy-share-link.test.ts`、`diy-import-honesty.test.ts` 重点）；`html-budget` ok；`check-web-overlay` 0 漂移。

**⑥ 风险与依赖**
- **风险**：0.85 下限会让「超透美学」用户不满——产品决策上用「可读性下限」立场，滑杆刻度注释说明；URL-Hash 分享的旧链接里带 0.2，读时 clamp 后分享方与接收方观感一致（都是 0.85），无分叉。`.glass-surface` alpha 全局提升会影响其他玻璃面板观感（更实一点），与 F1 的 muted 加深同向，可接受。
- **依赖**：与 F1/F3 共 globals.css，建议串行合入（F1→F3→F4 或 F1→F4→F3）。

**关键界面线框要点（F4）**
```
卡片（自定义壁纸场景）:
┌──────────────────────────────┐ ← .glass-surface / bg-card(≥0.85) + scrim
│  [图标]  站点标题（≥4.5:1）     │
│          描述文字（≥4.5:1）     │
│  [徽章×N]                     │
└──────────────────────────────┘
美学滑杆: [模糊]━━━━○  [透明度]━━○━━━  ← 右端 1.0，左端 0.85（原 0.2）
```

---

## 4. 不做什么清单（明确拒绝 + 理由）

| # | 拒绝项 | 理由 |
|---|---|---|
| 1 | **搜索语法帮助面板 / 搜索结果组织重构 / 查询建议**（P11） | search 全链路为并行会话热区（`search.ts`、`spotlight-modal.tsx`、`search-page.ts`、`/app/search/*`、`packages/store/src/search.ts` 全部 WIP，且刚落地负向过滤与召回回归账）。现在动=撞车+重复造轮。**推迟到热区释放后单独立项**，届时以「语法 cheatsheet 悬浮层 + 零结果引导」为最小切口 |
| 2 | **移动端悬浮快捷胶囊 / 快速托盘 / 分类吸顶滑轨**（deep-scan P2 建议） | 并行会话正在实现：`floating-quick-nav.tsx`、`quick-access-tray.tsx`、`category-quick-jump-bar.tsx`（均新文件）+ `navigation-efficiency-enhancements.test.ts` 已立守卫。重复做=浪费且冲突 |
| 3 | **站点健康度历史 Sparkline / 死链平替推荐**（deep-scan P1 建议） | `lib/site-health.ts`、`routes/health.ts`、`health-audit.ts` 均为热区 WIP；数据侧治理在途。等其稳定后再做可视化层 |
| 4 | **WebDAV / GitHub Gist 远端备份**（deep-scan P3 建议） | `routes/backup.ts`、backup 测试为热区 WIP（异步恢复任务在建）；且 `/me/data` 已具备导出/导入/分域清理/隔离区（数据完整性可见面已相当完整）。再加远端通道属于「特性堆积」而非痛点 |
| 5 | **注册/找回密码/邮箱验证 UI 打磨** | 并行会话正在建 `auth/signup|forgot-password|reset-password|verify-email` 全套新页面。Phase 1 V12（signin 字号）也押后 |
| 6 | **收藏导出导入（浏览器书签互通）** | 并行会话在建 `favorites-export-import.ts`（新文件）+ 测试；`/favorites`、`bookmark-importer.tsx` 均 WIP |
| 7 | **新微件 / 新主题皮肤 / AI 陪聊式助手 / 动效升级** | 无痛点证据；与「拒绝虚浮无用功能」直接冲突。Bento-Flow 已有 12+ 微件，先保既有能力可读可达 |

> 另：卡片 hover-reveal（V13）与 signin 输入字号（V12）**不作为独立功能**——改动点在热区单文件，已给出一行改法并入 F3 交接，热区释放后 5 分钟工作量，不值得占选型名额。

---

## 5. 给 Phase 3（frontend-engineer）的交接备注

### 5.1 实现顺序建议
```
F1（token 收敛 + 门禁）──先合──┬── F3（触控基线）── F4（壁纸护栏）
                              └── F2（骨架/错误边界）可与 F3 并行（文件无交集）
```
理由：F1 动 globals.css 最多、收益最大、且 F3/F4 都共享该文件——先合 F1 减少同文件冲突；F2 纯新增文件，任何时候插入都安全。

### 5.2 冷区 / 热区纪律（动手前必 `git status` 复核，WIP 可能已变化）
- **可改（冷，本轮已核验干净）**：`src/styles/globals.css`、`components/mobile-nav.tsx`、`components/navigation-toolbar.tsx`、`components/footer.tsx`、`components/route-skeleton.tsx`、`components/route-error.tsx`、`components/hub-degraded-notice.tsx`、`lib/modular/use-home-diy.ts`、`components/ui/*` 与 `registry/new-york/ui/*`（button/input 双实现，V1 修复时两处都要看）。
- **只报告不改（热）**：`navigation-card.tsx`、`navigation-content.tsx`、`navigation-category-section.tsx`、`search-palette.tsx`、`search/spotlight-modal.tsx`、`/app/search/*`、`/app/favorites/*`、`bookmark-importer.tsx`、`app/auth/*`、`routes/{search,backup,health,rank,...}.ts`、`packages/store/src/search.ts`、`.github/workflows/ci.yml`。
- **新增文件（零冲突）**：4 个测试文件 + 镜像、约 22 个 `loading.tsx`/`error.tsx`。
- **镜像纪律**：overlay 测试不被 vitest 直接收集（`vitest.config.ts:41-52` 注释），执行面是 `apps/web/test/**`——新增测试**必须** `pnpm mirror:web` 同步，否则 `check-web-overlay` 拦截。
- **热区里的单行改法**（热区释放后执行）：
  - `navigation-card.tsx:329`：`sm:opacity-0 sm:group-hover:opacity-100` → 桌面常显主操作，或加 `@media (hover:none)` 强制可见（V13）。
  - `app/auth/signin/page.tsx` Input `text-xs` 覆盖类删除（V12，配合 F3 的全局 input 16px 规则）。
  - 徽章 `text-*-600` → `text-*-700`（170 处配方，按 F1 门禁 grep 清单批量做）。

### 5.3 每功能验证命令
```bash
# 通用前置（每次动手前）
git status --porcelain | wc -l   # 知悉并行 WIP 规模；只动冷区

# F1
npx vitest run apps/web/test/a11y-token-contrast.test.ts
npx vitest run apps/web/test/a11y-contrast.test.ts   # 旧门禁不许红
node scripts/html-budget.mjs --url=http://localhost:3000/ --max-kb=4096

# F2
npx vitest run apps/web/test/route-state-coverage.test.ts
node scripts/dev-all.mjs    # 起 :3000/:8787 后 Slow 3G 走查骨架；再人工抛错验 RouteError

# F3
npx vitest run apps/web/test/touch-target-baseline.test.ts
# 375/768/1440 三档 DevTools 取样字号与触达；768 档重点看顶栏是否挤爆

# F4
npx vitest run apps/web/test/wallpaper-contrast-guard.test.ts
# localStorage 注入壁纸+0.2 旧配置 → 实测对比度 ≥4.5:1

# 收尾（每个功能合入前）
pnpm test
pnpm mirror:web && node scripts/check-web-overlay.mjs
node scripts/check-syntax.mjs   # 若新增文件较多
```
辅助取证：`deliverables/web-audit/ux-review-2026-10-31/visual-audit.mjs`（BASE 环境变量指向被测实例）可复跑三档对比度采样。

### 5.4 与并行会话的协作提醒
- 对方在做 CI 抖动治理（G5）——你的测试**沿用 `pnpm test` 即可**，红了先看是不是抖动台账里的已知项，不要绕过门禁。
- 对方若已合入 `navigation-card.tsx`/search 系改动，V13/P11 的延迟项可以顺手做（工作量小），但**不挤占 F1–F4 的验收**。

---

## 6. 未覆盖 / 未验证项

1. **自定义壁纸 + cardOpacity=0.2 触发态实拍**：Phase 1 与本轮均未注入 localStorage 实测（F4 验收第 2 条补上）。V6/P9 结论为按 token 计算的最坏推演。
2. **hover-reveal 触屏真机行为**（V13/P7）：代码证据充分，真机/触屏仿真未走查（F3 验收第 5 条补）。
3. **640–768px 交接带**（G8）：仅间接证据（mobile-nav 注释自述断点契约），未专项截图走查（F3 响应式策略标注核对点）。
4. **forced-colors / 高对比度模式**（G7）：未实测，本轮不排期。
5. **图表/热力图色阶对比度**（/hot、/graph、github-heatmap、videos 热力）：Phase 1 遗留，本轮未取样——与 F1 的 token 配方可能不同源，建议热区释放后补测。
6. **徽章 token 修复的「自动达标」范围**：`text-*-600`→700 之前，部分徽章是否已被 F1 的 muted/foreground 加深带达标——**未验证**，Phase 3 按门禁 grep 清单逐个复测为准。
7. **搜索语法可发现性（P11）**：只做了痛点定性，未出线框（等热区）。
8. **iOS 输入缩放真机**（P10）：Simulator/真机未测；全局 input 规则与 `text-xs` 覆盖类的层叠优先级**未验证**。
9. **并行 WIP 的最终形态**：本规格的热区判断基于 2026-11-01 工作区快照（353 个文件）；对方随时可能合入/释放，Phase 3 动手前需重扫 `git status`。
10. **多语言/RTL、打印样式**：不在本轮范围。

---

## 附：证据文件索引

| 文件 | 用途 |
|---|---|
| `deliverables/web-audit/ux-review-2026-10-31/phase1-visual.md` | V1–V14 全量对比度/字号证据 + token 调整表（F1 直接施工输入） |
| `deliverables/web-audit/ux-review-2026-10-31/visual-audit.mjs` + `visual-audit-results-prod.json` | 三档视口对比度采样脚本（F1/F4 验收工具） |
| `deliverables/web-audit/检测报告.md` | 140 页生产爬取 0 误报基线、14/14 交互、首页预算 3556KB、空态清单 |
| `deliverables/web-audit/{crawl,mobile,interactions}-results.json` | 本轮引用的 statusDist/overflow/failedRequests 实测 |
| `deliverables/deep-scan-report-2026-10-31.md` | 既有优化台账（确认 P1–P3 建议中 2 项已在并行会话在建） |
| `apps/web-overlay/src/components/route-skeleton.tsx` / `route-error.tsx` | F2 复用组件 + 自述缺口注释 |
| `apps/web-overlay/test/{a11y-contrast,failure-surface,empty-vs-failure-honesty}.test.ts` | 门禁风格先例（F1/F2 测试照此写） |
| `vitest.config.ts:41-52` | overlay 测试必须镜像到 apps/web/test 的约定 |
| git log 近 20 条 + `git status` 353 WIP | 热区地图（§5.2） |
