# 设计系统一页纸（Design System v1）

> P1-4 交付物。本文件是**契约**：新增页面 90% 样式应来自本文定义的 token 与样板组件；
> 不在契约内的写法请在改动前先补充本文，而不是让例外静默堆积。
>
> 范围声明：本次**不一次性替换全部类名**。先立 token 与样板组件（Button / Card / EmptyState
> 已在仓），再逐页迁移；迁移期「两套并存」的边界见 §5。

---

## 1. Token 三层结构

站点现有 133+ 个 CSS 变量（`src/styles/globals.css`），历史上是平铺的。按职责分三层：

### L1 原始值（primitive）

不带语义的原材料，只被 L2 引用，**不要在组件里直接用**。

| 前缀 | 示例 | 说明 |
| :--- | :--- | :--- |
| `--surface-*` | `--surface-base: oklch(0.985 0.002 247)` | 表面基色（亮/暗两套值） |
| `--brand-*` | `--brand-primary`, `--brand-accent` | 品牌色 |
| `--depth-*` | `--depth-card` | 深度阴影盒 |
| `--density-*` | `--density-card-padding` | 内容密度矩阵（comfortable/compact 三档） |

### L2 语义（semantic）

「这个颜色/尺寸在这里扮演什么角色」，**组件样式只允许引用这一层**。

| 前缀 | 示例 | 用途 |
| :--- | :--- | :--- |
| `--background` / `--foreground` | 页面底 / 主文字 | 全局底色与主文本 |
| `--card` / `--card-foreground` | 卡片容器 | 卡片、弹层 |
| `--popover*` | 浮层 | 下拉、气泡 |
| `--primary*` / `--secondary*` / `--accent*` | 主次强调 | 主按钮、悬停态 |
| `--muted*` | 弱化 | 次要文字、弱底 |
| `--destructive*` | 危险 | 删除、错误 |
| `--border` / `--input` / `--ring` | 边框 / 输入框 / 焦点环 | 描边与焦点 |

Tailwind 侧已通过 `--color-*` 映射（`--color-primary: hsl(var(--primary))` 等），
组件里写 `text-muted-foreground`、`border-border`、`bg-card` 即到达本层。

### L3 组件（component）

把 L2 组装成具体组件的稳定外观，本次新增/收敛的部分：

| Token | 值 | 用途 |
| :--- | :--- | :--- |
| `--duration-instant` | `0.01ms` | 状态瞬切（保留 transitionend 事件） |
| `--duration-fast` | `120ms` | hover / pressed 微小反馈 |
| `--duration-base` | `200ms` | 面板、抽屉滑入 |
| `--duration-slow` | `320ms` | 整页切换、模态 |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 标准缓出 |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 轻微回弹（点选、徽标弹出） |

所有时长/缓动**优先用 token 而不是字面量**；`prefers-reduced-motion` 由
`reduced-motion.css` 统一压到 0.01ms（见该文件注释：为什么不是 0）。

---

## 2. 组件状态矩阵

新组件必须显式处理以下状态；标 ✅ 的由 shadcn 样板（`registry/new-york/ui`）自动覆盖，
自建组件需自查。

| 状态 | Button | Card | Input | EmptyState | 判定标准 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| default | ✅ | ✅ | ✅ | ✅ | 基线外观 |
| hover | ✅ | 自定 | ✅ | — | 微反馈，≤120ms |
| active/pressed | ✅ | — | ✅ | — | 有可感知的按下态 |
| focus-visible | ✅ 全局焦点环 | ✅ | ✅ | ✅ | `skip-link.css` + `:focus-visible` 统一实现，禁止用 outline-none 裸奔 |
| disabled | ✅ | — | ✅ | — | 降透明度 + `cursor-not-allowed`，**必须同时给解释**（tooltip/aria-describedby） |
| loading | 自定 | — | — | — | 按钮内 spinner + `aria-busy`，期间禁用防重复提交 |
| empty | — | — | — | ✅ | 见 §3 |
| error | — | — | ✅ | — | 红描边 + 文案说明 + 恢复动作 |
| 暗色 | ✅ | ✅ | ✅ | ✅ | 全部走 L2 token，**零硬编码色值** |

**暗色红线**：`text-emerald-500` / `bg-blue-600` 这类裸 palette 色值不允许出现在
组件里（`text-emerald-600 dark:text-emerald-400` 成对出现或改用 L2 token 才可）。
搜索命令：`rg "text-(red|blue|green|emerald|amber|indigo|violet)-[0-9]" src/`。

---

## 3. 空态样板 `<EmptyState>`

位置：`components/ui/empty-state.tsx`（overlay 与 apps/web 双份，同步维护）。

铁律——**图标 + 一句解释 + 一个主行动**：

```tsx
<EmptyState
  icon={Shield}
  iconTone="success"          // primary | muted | success | warning
  title="还没有收藏任何站点"
  description="在主页站点卡片或搜索结果里点击星标即可一键收藏。"
  action={<Button asChild size="sm"><Link href="/">去主页探索发现</Link></Button>}
/>
```

- 解释句要说清「数据去哪了」，不是「你操作错了」（收藏页范例：共 N 个都还在本机）；
- `action` 可选但强烈建议给：空态是路口不是墙；
- **迁移进度（2026-10-18 第五轮完成）**：`/favorites` 两个 + admin 主要列表页
  （audit / categories / collections / jobs / navigation / resources / sitelist / stats）
  共 10 处页面级空态已全部迁移；`admin-load-failure.ts` 的「失败 vs 真的没有」
  区分原样保留（失败态走标题文案，不回退成空态误导）。同轮把 admin 的裸
  `gray-*` 色值全部替换为语义 token（`text-muted-foreground` / `bg-muted` /
  `border-border` 等），并修掉导航页一处历史乱码（`开???创建`）。
  守卫测试 `apps/web/test/design-system.test.ts` 逐页锁定迁移结果。

---

## 4. 密度与圆角

- 内容密度由 `--density-*` 矩阵驱动（comfortable / compact 两档，`DensityProvider` 切换），
  组件间距优先用密度变量而非固定 `p-4`；
- 圆角：容器 `rounded-2xl`、控件 `rounded-lg`、图标框 `rounded-xl`，与现有视觉保持一致，
  暂无独立 token（如需系统化，下轮加 L1 `--radius-*`）。

---

## 5. 迁移边界（两套并存期怎么不打架）

1. **新页面**：100% 按本文件执行，不允许新增第四种空态写法；
2. **老页面**：只允许「就地替换为样板组件」（如空态 → `<EmptyState>`），
   禁止顺手重排样式——重排会制造无意义 diff，把回归风险掺进设计迁移；
3. **registry 上游文件**（`registry/new-york/ui/*`）：shadcn 原样 vendored，
   本仓库不改其内部实现；需要定制时在 `components/ui/` 包一层。
   **唯一例外（F1，2026-11-02）**：为满足 WCAG 1.4.11 控件边界 3:1，button / input / checkbox
   的边界类已收编进 overlay 并改用 `border-border-strong`（见 §7）；除对比度合规行外不改；
4. 判断「是否自研文件」以 git 为准：apps/web 是被 gitignore 的 vendored 底座，
   `git add -f` 进去的就是自研，必须同步回 `apps/web-overlay`（`check-web-overlay.mjs` 把关）。

---

## 7. 对比度配方（WCAG AA，F1 收敛）

四条配方是**硬约束**，由 `apps/web/test/a11y-token-contrast.test.ts`（token 实测 + 类名回潮门禁）把关：

| 场景 | 配方 | 实测对比度 |
| --- | --- | --- |
| 徽章（状态芯片） | `bg-*-500/10` + **`text-*-700`**（emerald/amber/rose/… 任意色系） | -600 在 /10 底上不足 AA，-700 达标 |
| 错误文字 | **`text-destructive-text`**；错误条底 `bg-destructive/15` | 浅 #BC1C1C 对白 6.41:1、对 /15 条底 5.12:1；深 #F37272 对深底 7.07:1 |
| 输入框 / 描边按钮 / checkbox 边界 | **`border-border-strong`**（`--border-strong`） | 浅 #8F8F99 对白 3.22:1；深 #66666E 对深底 3.17:1 |
| 次要文本 | `text-muted-foreground`，**禁止任何透明度变体** | 浅 #62626A 对白 6.05:1 |

补充语义：

- `--destructive` 仍只作**按钮底色**（白字对它 4.62:1）；深色模式下它是暗红按钮底，
  拿来当文字只有 1.98:1 —— 危险**文字**一律 `text-destructive-text`，类名禁止回退到 `text-destructive`；
- 装饰性卡片边框继续 `--border`（`border-border`），不要为「看得见」一律加重；
- `text-muted-foreground/50/60/70/80` 这类透明度变体全站禁用（叠加后必跌破 AA），
  需要更弱层级时改用更小字号/更粗字重，或换 `text-muted-foreground` 本色；
- 徽章同理禁止 `text-*-600`（在 /10 彩底上实测不足）。

自定义壁纸可读性兜底（F4）：

- **卡片不透明度下限 0.85**：DIY 滑杆最小刻度 0.85，读写两端 clamp（旧配置/旧分享链接
  存的 0.2 读到即抬升），保分享方/接收方观感一致；
- **卡片/玻璃面板底色 alpha ≥0.88**（globals.css 未分层 `.nav-card-deferred` / `.glass-surface`），
  自定义壁纸最亮/最暗时卡片标题/描述实测对比度 4.60~19.90:1（wallpaper-contrast-guard 锁定）；
- 热区残留的 `text-muted-foreground/90` 透明度变体由未分层规则在卡片内归一（热区释放后删除该条）。

关键 token 实测（WCAG 相对亮度公式，2026-11-02）：

| token | 浅色值 | 浅实测 | 深色值 | 深实测 |
| --- | --- | --- | --- | --- |
| `--ring` | `240 5% 46%` #6F6F7B | 4.93:1（对白） | `240 4.9% 83.9%` | 13.46:1（对深底） |
| `--muted-foreground` | `240 4% 40%` #62626A | 6.05:1（对白） | `240 5% 64.9%` | — |
| `--destructive-text` | `0 74% 42%` #BC1C1C | 6.41:1（对白） | `0 84% 70%` #F37272 | 7.07:1（对深底） |
| `--border-strong` | `240 5% 58%` #8F8F99 | 3.22:1（对白） | `240 4% 39%` | 3.17:1（对深底） |
| accent emerald `--primary` | `158 84% 26%` | 4.74:1（对近白前景） | 同左 | — |
| accent rose `--primary` | `346 84% 42%` | 5.70:1（对近白前景） | 同左 | — |


## 6. 待办（下轮）

- [x] `admin/*` 8 个列表页空态迁移到 `<EmptyState>`（第五轮完成）
- [ ] `facets` 面板内嵌的分面站点样例空态（子面板，允许内联，按需再升级）
- [ ] Button loading 态样板（spinner + `aria-busy`）
- [ ] `--radius-*` / `--z-*` token 化
- [ ] 暗色视觉走查（重点：glow 阴影、毛玻璃壁纸在暗下的对比度）
