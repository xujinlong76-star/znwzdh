# NavHub 升级执行报告（2026-10-24 · 第三轮：执行全部后续方案）

> 承接 `UPGRADE-EXECUTION-2026-10-24-PASS2.md` 末尾的三项建议，本轮全部落地。
> 与上一轮不同，本轮 **P0 使用真实 PostgreSQL 18.4 实例验证**，不是「CI 会跑」的推测。

---

## 0. 结论

| 项 | 内容 | 结果 |
|---|---|---|
| P0 | PostgreSQL 跨方言回归 | 修复 3 类套件缺陷 + 新增停用态覆盖；**29/29 连续两轮通过** |
| P0 | 「静默跳过」防线 | 新增 `pnpm test:pg:suite`，缺连接串直接退出 1；CI 改用该入口 |
| P1 | 卡片键盘焦点收敛 | 每卡 6 个 Tab 停留点 → **1 个**；→ 进操作区、← 返回、Space 速览 |
| P2 | overlay 漂移门禁 | 三处接线（pre-commit / verify / CI）已存在，新增守卫测试锁死；修掉 tsconfig 漂移源 |

---

## 1. P0：PostgreSQL 回归

### 1.1 环境

本机无 Docker、无 PostgreSQL 服务。使用 `embedded-postgres`（真实 PostgreSQL 18.4 二进制，
非 pg-mem 模拟）在 `127.0.0.1:55432` 启动独立实例，`pg_trgm` 扩展可用；
pgvector 不可用（嵌入式包不带），因此 `pnpm test:pg`（标准模式基准）仍需 CI 的
`pgvector/pgvector:pg17`，本轮未覆盖。

### 1.2 修掉的套件缺陷（均为真实红灯，不是环境问题）

**D1 `catId is not defined`（作用域错误）**

`describe("跨方言：用户域（T9）")` 里三条用例引用了只在**上一个 describe** 声明的
`catId`。CI 的 `test-postgres` 作业会加载整个文件，因此必红。补上本 describe 的
`const catId` 与 `beforeAll` ensure（不再依赖 describe 执行顺序）。

**D2 套件非幂等（本地第二次运行必红）**

第一个 describe 的清理列表只删站点/类目/审计，没删 `favorites`、`identity_aliases`、
`user_settings`、`user_vault_sync`、`search_history`。后果：

- `addFavorite` 期望 `existed=false`，上一轮残留让它是 `true`；
- 金库 CAS 期望从 v1 开始，残留让它是 v2；
- LWW 墓碑计数 `listFavoritesSince` 多出一条旧墓碑。

CI 每次是全新 PG 服务，所以一直绿——**测试只在本地红，等于把幂等缺陷藏起来了**。
清理列表补齐用户域 7 张表后，连续两轮 25/25。

**D3 金库 CAS 用例的调用方式与语义都错**

```ts
// 旧：把对象当成 userId 传入（TS 不检查测试文件，运行期 PG 把对象序列化成 JSON）
await repo.saveUserVault({ userId: user, payload: "v1-payload" });
// 实际签名：(userId, payload)
```
PG 报 `null value in column "payload"`。同时「冲突」用的是 `expectedVersion: 1`，
而保存后云端正是 v1——这是合法覆盖，不会冲突。改为 `expectedVersion: 0`
（客户端以为云端没有金库）才真正模拟旧快照。

**D4 `rollup-pg` 在共享实例上必红**

`SET search_path TO rollup_e2e` 排除了 `public`。若 `pg_trgm` 已由 DBA 装在
`public`，DDL 的 `CREATE EXTENSION IF NOT EXISTS` 是 no-op，`gin_trgm_ops`
在 `rollup_e2e` 下不可见 → `operator class "gin_trgm_ops" does not exist`。
CI 的一次性库因为扩展恰好建在 `rollup_e2e` 才侥幸绿。改为 `search_path TO rollup_e2e, public`。

### 1.3 新增覆盖

`insertSitesBulk` 用例增加「停用态透传」断言：`enabled=false + status=archived`
写入后读回必须是布尔 `false` / `"archived"`，锁住上一轮备份恢复修复的 PG 侧行为
（PG 的 BOOLEAN 绑定与 SQLite 的 0/1 不同）。

### 1.4 防「静默跳过」

两个套件在缺少 `NAVHUB_TEST_DATABASE_URL` 时整体 skip。新增
`scripts/run-pg-suite.mjs`：缺连接串直接退出 1，并打印可复制的 docker 启动命令。
`package.json` 注册 `test:pg:suite`，CI 的 PG 作业改用该入口。
新增 `pg-suite-entry.test.ts` 锁住退出码与 CI 接线。

---

## 2. P1：卡片键盘焦点收敛

### 2.1 问题

`NavigationCard` 根节点 `tabIndex=0`，内部还有主链接、置顶、速览、工作台、收藏
五个可聚焦元素。一张卡 6 个停留点，首页 1010 张卡 ≈ 6000 次 Tab。

### 2.2 改法（WAI-ARIA 复合控件模型）

- 主链接成为**唯一 Tab 停留点**：Enter 打开、Space 速览、→ 进入操作区；
- 操作按钮 `tabIndex={-1}` + `data-card-action`，由操作区统一处理 ←/→ 循环与 Esc 返回；
- `FavoriteButton` 新增 `tabIndex` / `cardAction` 可选参数，独立使用时行为不变；
- 三个显示模式（紧凑 / 标准 / 丰富）一致；丰富模式的标签内链保持可聚焦（它们是真实内容链接）。

### 2.3 验证

浏览器（Chromium 1280×900，真实首页）：

```
卡片内 tabIndex>=0 的元素：["A: ..."]        // 仅主链接
聚焦主链接 → ArrowRight → BUTTON(置顶)      // 进入操作区
ArrowLeft → A[data-prefetch-target]        // 回到主链接
Space → role=dialog 打开                    // 速览仍可用
```

新增 `card-single-tab-stop.test.ts`（5 例）锁住：根节点不再 `tabIndex=0`、
链接承载 Space/→、操作区 ←/→/Esc、9 个按钮全部退出 Tab 序列、收藏组件参数。

---

## 3. P2：overlay 漂移门禁

核查结论：三处接线**已经存在**，本轮不再重复添加，而是补守卫与修漂移源：

1. `scripts/install-git-hooks.mjs` → `check-web-overlay.mjs --staged`；
2. `scripts/verify.mjs` → 全仓库 `check-web-overlay.mjs`；
3. `.github/workflows/ci.yml` → 独立 `check-web-overlay` 作业，且 `ci-passed.needs` 依赖它。

新增 `overlay-drift-gate.test.ts`（3 例）锁住这三处，任何一处被删都会红。

**漂移源修复**：Next dev 与 Playwright 的 `.next-e2e` 输出目录会把
`.next-e2e/types/**/*.ts` 写进 `apps/web/tsconfig.json`，导致每次跑 E2E 后
`check:overlay` 报 tsconfig 漂移。把两条 include 合并进 overlay 的 tsconfig，
使生成结果与事实源一致，不再反复漂移。

---

## 4. 质量门禁

| 门禁 | 结果 |
|---|---|
| `vitest run`（全量） | **3844 通过 / 0 失败**（新增 16 例守卫） |
| `typecheck.mjs` | 5 个包通过 |
| `tsc --noEmit`（navsphere） | 通过 |
| `eslint`（改动文件） | 0 error（10 warning 为存量 effect 依赖提示） |
| `check-web-overlay` | 632 个文件一致 |
| PG 套件（真实 PG 18.4） | `pg-dialect` 25/25 ×2；`rollup-pg` 4/4；合计 **29/29** |
| Playwright E2E | **57/57 通过**（含新增 admin-sitelist 用例） |

---

## 5. 复现

```bash
# 真实 PostgreSQL（需 pgvector；本机无 Docker 时可用 embedded-postgres）
docker run --rm -d --name navhub-pg -p 5432:5432 \
  -e POSTGRES_USER=navhub -e POSTGRES_PASSWORD=navhub \
  -e POSTGRES_DB=navhub_test pgvector/pgvector:pg17
export NAVHUB_TEST_DATABASE_URL=postgres://navhub:navhub@127.0.0.1:5432/navhub_test
pnpm test:pg:suite     # 缺连接串会直接失败，不会静默 skip
pnpm test:pg           # 标准模式 12 项基准（需 pgvector）

node scripts/typecheck.mjs
pnpm --filter navsphere exec tsc --noEmit
npx vitest run
node scripts/check-web-overlay.mjs
```
