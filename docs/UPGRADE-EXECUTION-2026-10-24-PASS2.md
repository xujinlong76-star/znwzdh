# NavHub 升级执行报告（2026-10-24 · 第二轮）

> 基线：`1c37044 style(user-center): 用户中心视觉升级——玻璃导航/渐变页头/彩色统计芯片/时间线`
> 范围：全仓审计（后端安全/正确性 + 前端体验/性能）后确认的**可验证缺陷**，以及三项体感升级。
> 纪律：不修改 vendored `apps/web` 自有文件；所有前端改动落在 `apps/web-overlay` 后经 `check-web-overlay --fix` 同步。

---

## 0. 结论

| 编号 | 改动 | 类型 | 验证 |
|---|---|---|---|
| S1 | 个人令牌可冒充任意用户（导出/注销/LLM 密钥） | **安全 P0** | 新增 2 例回归，旧代码实测 2/2 失败 |
| S2 | 投稿审核接口可改写任意非投稿站点状态 | 安全 P1 | 新增 1 例回归 |
| S3 | 冷备恢复丢失 `enabled`，停用站点被复活 | 数据正确性 P1 | 新增 1 例回归 |
| S4 | 畸形 URL 编码（`%25`）抛 URIError → 500 | 健壮性 P1 | 新增 2 例回归 |
| S5 | 回收站恢复非事务 + 对 null 强解引用 | 正确性 P2 | 事务包裹 + 判空 |
| S6 | `check-urls` 单请求 30 路并发出网 | 安全加固 P2 | 并发降到 5 |
| U1 | 搜索面板键盘完全不可用（能打字不能选） | **体验 P0** | 新增 4 例源码守卫 + 浏览器实测 |
| U2 | 分类页提示「用页内搜索」，页面却没有搜索 | 体验 P1 | 挂载全站搜索 + 文案修正 |
| U3 | 首屏展板水合后整页下移约 200px | 体验 P1 | 同高骨架 + 1 例守卫 |
| U4 | 离线提示条压住移动底栏并拦截点击 | 体验 P1 | 抬到底栏之上 + 1 例守卫 |
| U5 | 收录站点写盘失败/重复仍提示「成功」 | 体验 P1 | 三态返回 + 3 例守卫 |
| U6 | 收藏筛选/榜单页签不落 URL，返回即丢 | 体验 P1 | 纯函数 5 例 + 浏览器实测 |
| P1 | 首页 1000+ 卡片全量参与首帧布局/绘制 | 性能 | Layout −13%~−24%，Style recalc 约减半 |

**质量门禁**

- `vitest run`：**3828 通过 / 0 失败**（基线 3803 通过 + 1 失败；新增 24 例守卫）
- `scripts/typecheck.mjs`：5 个包通过（TS 7.0.2 native）
- `tsc --noEmit`（navsphere）：通过
- `eslint .`：0 error（553 warning 为存量测试代码的 `any`/未使用变量）
- `playwright test`：54 例，53 首轮通过 + 1 例冷编译超时；单独复跑该 spec 4/4 通过（净结果 54/54）
- `check-web-overlay`：627 个覆盖层文件一致

---

## 1. 安全与正确性

### S1 个人令牌身份旁路（P0）

**问题**

用户级令牌在 `server.ts` 的签名 hook 里被整段放行（owner 本身就是凭据）。但用户域路由仍用 `identityOf`（裸读 `x-navhub-user-id` / query / body），于是：

```
Authorization: Bearer nh_xxx
x-navhub-user-id: github:受害者
```

持任一自建只读令牌即可 `GET /api/me/export` 导出受害者全部个人数据、`DELETE /api/me` 注销受害者、读写其 LLM 密钥。

**改法**

11 个用户域路由文件的 51 处 `identityOf` 统一改为 `requestIdentityOf`（有 token owner 只认 owner，无 owner 才回退自称头）。覆盖 `me / ai-config / workspaces / crdt / telemetry / plugin-presentation / plugins / enrich / sites / health-audit / copilot`。

**验证**

`apps/api/test/token-identity-isolation.test.ts`：令牌 + 伪造头导出只含 owner 数据；注销只清 owner。把导出接口临时改回 `identityOf` 后实测 2/2 失败，证明守卫不是空跑。

### S2 投稿审核越权（P1）

`getSite(number)` 命中非投稿站点后，原代码只在「纯数字」分支里重新赋值，UUID 形态的普通站点会原样留在 `site` 里，随后被 `updateSite({status})` 改写。任何 `write` 令牌都能把任意站点下架/强行上架。现在命中非 `source=submission` 时显式置空。

回归：`api.test.ts`「审核接口不能改写非投稿站点（UUID 直传）」。

### S3 冷备恢复丢失停用态（P1）

恢复只透传 7 个字段，`insertSitesBulk` 缺省 `enabled=true / status=active`。含停用站点的备份恢复后全部变成公开可见。现在透传 `enabled`，并把 `enabled=false` 映射为 `archived`。

回归：`backup-restore-enabled.test.ts`。

### S4 畸形编码 500（P1）

Fastify 已解码一次，路由再 `decodeURIComponent`；`GET /api/plugins/%25` 的参数是 `%`，抛 `URIError` → 500。新增 `safeDecodeParam`（失败回退原文，后续查库自然 404），替换 10 处调用。

回归：`plugins-api.test.ts`「畸形 URL 编码不得变成 500」。

### S5 / S6

- 回收站恢复：`restoreSite` + 类目回退包进 `withTransaction`；`site` 为 null 返回 404 而不是 `site!.id` 抛 TypeError；冲突返回 409。
- `check-urls`：30 路 `Promise.all` 改为每批 5 个，单 IP 每分钟出网连接上限从约 900 降到 150。

---

## 2. 体验升级

### U1 搜索面板键盘导航（P0）

输入框在 `<Command>` 之外，cmdk 的 keydown 监听挂在 Command 根节点，事件冒泡不到——↑↓/Enter 全无反应，Tab 只落到每行收藏星标。

实现：扁平导航列表（插件在前、站点在后，与 DOM 一致）+ `activeIndex` + `aria-activedescendant` + `scrollIntoView({block:'nearest'})` + Enter 触发真实元素点击 + Esc 关闭 + 桌面端快捷键提示。

浏览器实测：输入 `github` 后按 ↓，`aria-activedescendant="navhub-search-opt-0"`，高亮项为第一条结果；无 console 错误。

### U2 分类页搜索

分类翻页有深度上限，提示文案让用户「用页内搜索」，但页面没有任何搜索控件。现在在 header 之后挂载 `<SearchPalette>`（全站检索），文案改为「用下面的搜索」。

### U6 筛选条件写入地址栏

收藏页的搜索词 / 收藏夹 / 排序、榜单页的页签原本只是组件 state：点开一个站点再按返回，三个条件全部复位。

- 新增 `lib/favorites-url.ts`（`parseFavoritesFilters` / `buildFavoritesSearch`），默认值不落参数、超长截断、非法排序回退。
- 页面挂载后读一次 URL（避免首帧不一致），变化时 `replaceState`，并监听 `popstate`。
- 榜单页 `Tabs` 改为受控，`?tab=new` 可刷新/分享还原。

浏览器实测：`/favorites?q=react&sort=title` 打开后输入框为 `react`、排序为「按标题」、显示「匹配 1 / 2 个收藏」；清空关键词后 URL 变为 `?sort=title`，再改回默认排序后参数全部清除。

### U3 / U4 / U5

- 展板 `dynamic(..., {ssr:false})` 补同高骨架（4×`min-h-[160px]`），消除水合位移。
- 离线提示条移动端 `bottom` 从 `1rem` 抬到 `4.5rem`（底栏 h-14 + 余量），桌面端保持贴底。
- `addSiteToCustomCategory` 返回 `added | duplicate | failed`；单条、批量、拖拽三条路径分别按真实结果提示，写盘失败时不关闭弹窗、不清输入。

---

## 3. 性能

首页默认视图一次性挂载全库卡片（当前 1010 张，约 12.5 万 DOM 节点）。DOM 与内链必须保留（SEO），因此不删节点，改为 `content-visibility: auto` + `contain-intrinsic-size: auto 92px`，让视口外卡片跳过首帧样式计算/布局/绘制。

Chromium 1280×900、dev server、交替顺序对照：

| 指标 | 基线 | 延迟渲染 |
|---|---|---|
| LayoutDuration | 497 / 536 ms | 454 / 407 ms |
| RecalcStyleDuration | 204 / 221 ms | 103 / 92 ms |

Script/Task 在噪声范围内（dev 模式 HMR 波动大），未计入收益。

---

## 4. 未处理项（明确取舍）

1. **`/api/sites` 在鉴权模式下允许 read 令牌读取 pending/archived**：开放模式（默认个人/NAS）下这是管理端行为；收紧会破坏本地后台，暂留。
2. **卡片每张 5 个 Tab 停留点**：需要把次要操作收进菜单，属交互重构，本轮不做。
3. **`site_relations` 的 `LIKE '%q%'`**：当前表规模下开销可接受，且已有 `catch` 降级；待关系图增长后再改 FTS。
4. **E2E 冷编译偶发超时**：全量首轮 `/admin/tokens` 首次编译可能超过 45s；单独复跑稳定通过，属测试环境抖动，未改断言掩盖。

---

## 5. 复现命令

```bash
node scripts/typecheck.mjs
pnpm --filter navsphere exec tsc --noEmit
npx vitest run
pnpm --filter navsphere exec eslint .
NAVHUB_WEB_PORT=3101 NAVHUB_API_PORT=8791 npx playwright test
node scripts/check-web-overlay.mjs
```
