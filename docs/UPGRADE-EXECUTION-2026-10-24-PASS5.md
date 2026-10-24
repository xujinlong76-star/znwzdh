# NavHub 升级执行报告（2026-10-24 · 第五轮：审计遗留项与提交协作）

> 本轮处理三件事：审计中唯一被搁置的 P1（只读令牌可见性）、E2E 登录偶发、
> 以及「提交全部」过程中暴露出的多会话协作问题。

---

## 1. 站点列表数据面最小化（P1，前四轮唯一未做的审计项）

**问题**

`GET /api/sites` 是 `scope:"read"`。鉴权模式下任何 read 令牌都能调，原实现不区分身份，
于是最低权限的集成方也能拉到全部 `pending`（待审）与 `archived`（已归档）站点。
那是编辑工作面的中间态：可能还没上线，或已下架。

**改法**

- `apps/api/src/routes/shared.ts` 新增 `canSeeUnpublishedSites(ctx, req)`：
  - 开放模式（`authRequired=false`，个人/NAS 默认）→ 可见（本机即管理面，行为不变）；
  - 路由自身 `scope:"admin"` → 可见；
  - `kind:"static"`（管理令牌 / 会话特权）→ 可见；
  - 用户级 `token` → 仅 scope 含 `admin` 可见；
  - 匿名 / 会话 → 不可见。
- `packages/store` 的 `listSites` 新增 `excludeStatuses`（`s.status <> ?` 逐条排除，
  最多两个状态，不引入 NOT IN 分片复杂度）。
- 路由层：非特权调用方默认排除 `pending`/`archived`；**显式**查这两种状态返回空集
  而不是 403——404/403 会反过来泄露「存在或不存在」。

**回归**：`apps/api/test/site-visibility-scope.test.ts`，6 例，覆盖三套配置：

| 配置 | 行为 |
|---|---|
| A 鉴权 + read 令牌 | 默认列表无 pending/archived；显式查返回 `[]`；`active`/`broken` 仍可查 |
| B 鉴权 + 管理/bootstrap | 三种状态全量可见；后台 `?status=pending` 筛选不被破坏 |
| C 开放模式 | 与历史版本逐字节一致 |

**非空性验证**：把 `canSeeUnpublishedSites` 临时改成恒真，A 组 2 例立刻失败（已还原）。

---

## 2. E2E 登录偶发（冷编译）

`loginViaAdmin` 此前「点旁路 → 等标题 45s」。全量套件里偶发失败：截图显示仍停在登录页，
根因是 Next dev + turbopack 冷编译时服务端 action 排队，点了没动静，而断言无法区分
「还在编译」与「点了没反应」。

改为：先等 URL 离开 `/auth/signin`（60s），确实没动再点一次，然后等标题。
`e2e/user-center-authed.spec.ts` 复跑 4/4 通过。

---

## 3. 提交协作：一次真实的误操作与还原

`git commit` 三次尝试，两次被 pre-commit 全量测试拦截。失败用例**单独跑全部通过**，
根因是并行会话在钩子运行的 5~11 分钟里仍在改 `me-view.tsx`、`quarantine-zone.tsx`、
新增 `algorithm-lab/*`——源码守卫读到对方的在途中间态。

随后我执行 `git commit --amend` 想补全提交信息，**改写的是并行会话刚提交的
`refactor(algorithms): 2216 行巨石拆成 12 实验区面板`**（它在两次尝试之间又提交了两个 commit）。
立即用 reflog 取回原文完整还原：当前 HEAD 的 tree 与原始提交逐字节一致
（`9032ec397effd4e9101f6ee5dbb3065fcf9cc16e`），历史未丢失。

**沉淀的纪律**（已写入工作区记忆）：本仓 pre-commit 会跑全量 vitest（5~11 分钟）；
多会话并行时不要 `--amend`/`rebase`，改写前必须立刻 `git log` 确认 HEAD 仍是你要改的那个提交。

---

## 4. 质量门禁

| 门禁 | 结果 |
|---|---|
| `vitest run`（全量） | 见本次运行 |
| 新增 `site-visibility-scope` | 6/6，含非空性反向验证 |
| `e2e/user-center-authed.spec.ts` | 4/4 |
| `typecheck.mjs` | 5 包通过 |
| `check:overlay` / `check:ci-gate` | 一致 / 通过 |

---

## 5. 仍未完成（需要人决策）

1. **GitHub 分支保护勾选**：`docs/CI-BRANCH-PROTECTION.md` 的验收第 3 步需网页操作。
2. **提交信息**：`1f34cc1`（含本轮之前的全部升级）的消息由并行会话撰写，
   未逐条列出安全修复清单。改写它需要 interactive rebase，而当前工作区有并行会话的
   未提交改动，**不建议现在做**。建议等树安静后：
   `git rebase -i 1f34cc1^` → reword。
3. **push**：本地领先 `origin/main` 若干提交，尚未推送。
