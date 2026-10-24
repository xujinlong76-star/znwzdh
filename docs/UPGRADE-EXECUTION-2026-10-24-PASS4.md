# NavHub 升级执行报告（2026-10-24 · 第四轮：执行上一轮的全部建议）

> 承接 PASS3 的三项建议。本轮 P0 给出**可离线执行的合并门禁校验**；P1 给出运行级回归；
> P2 把「单一 Tab 入口」补成对读屏用户完整的方案。

---

## 0. 结论

| 项 | 内容 | 结果 |
|---|---|---|
| P0 | CI 合并门禁可验证化 | `scripts/check-ci-gate.mjs` + `pnpm check:ci-gate`，接入 `verify`；3 例测试（含反向用例） |
| P0 | PG 反假绿 | `pnpm test:pg:suite` 已在 PASS3 落地，本轮确认 CI 使用该入口 |
| P1 | 卡片键盘 E2E | `e2e/card-keyboard.spec.ts` 2 例；首跑暴露真实缺口（焦点未归还）→ 修复后 **62/62** |
| P2 | 速览等价入口 + 焦点归还 | 弹窗补置顶/收藏、`aria-keyshortcuts`、页面级唯一键盘说明、关闭后焦点还原 |
| — | 顺带修掉 | 速览关闭后焦点被丢到 `body`（键盘用户回到页面顶部） |

---

## 1. P0：CI 合并门禁从「声明」变成「可校验」

**问题**：`ci-passed` 是分支保护的唯一必经项，但分支保护配置在 GitHub 仓库外，本机无 `gh` CLI，无法验证。2026-10-24 已实测 PG 套件确实是红的——「聚合了 PG 作业」≠「PG 在保护合并」。

**做法**

1. `scripts/check-ci-gate.mjs` 解析 `.github/workflows/ci.yml`，断言：
   - `ci-passed.needs` 覆盖全部 8 个关键作业；
   - 评估脚本逐个读取 `needs.<job>.result`（漏读 = 该作业失败不阻塞）；
   - `if: always()` 存在；
   - `test-postgres` 使用 `pnpm test:pg:suite`（拒绝静默跳过）。
   - 支持 `NAVHUB_CI_PATH` 注入替代文件，供测试做反向验证。
2. 接入 `scripts/verify.mjs`（本地 `pnpm verify` 也会跑）与 `package.json` 的 `check:ci-gate`。
3. `apps/web/test/ci-gate.test.ts` 3 例：正向通过、**删掉 `test-postgres` 必须退出 1**、verify/package 接线。
4. `docs/CI-BRANCH-PROTECTION.md`：GitHub 分支保护的手动清单 + 验收步骤（故意让 PG 红 → 确认合并被挡）。

**未能自动完成的部分**：GitHub 端的分支保护勾选（需要网页操作与管理员权限）。文档给出了逐步骤清单与验收方式，没有用「已配置」这样的不可验证陈述。

---

## 2. P1：卡片键盘 E2E（首跑 2 红，红得有道理）

`e2e/card-keyboard.spec.ts`：

- 从「第一张卡的上一个可聚焦元素」按一次 Tab，必须落在卡片主链接；
- 卡片内 `tabIndex>=0` 的元素只能有 1 个；
- `aria-describedby` 必须指向页面里真实存在的说明元素；
- `→` 进入操作区、`←` 与 `Esc` 回到主链接；
- 从主链接 Tab 一次到**下一张卡**（不会陷进 4 个操作按钮）；
- `Space` 打开速览、`Esc` 关闭后焦点回到卡片。

**首跑暴露的两个真实问题**

1. 初始版本用「从文档开头连按 100 次 Tab」触发，不可达——首页头部有大量分类按钮。
   改为「聚焦前一个可聚焦元素后按一次 Tab」，既证明 Tab 序列会停在主链接，又不依赖头部按钮数量。
2. **全量套件里第二次 `→` 偶发不生效**：单独运行 8/8、部分组合运行均通过，
   全量（59 例）下出现过一次。原因是用例把「ArrowLeft 已还原焦点」与
   「再次按 → 」耦合成一条时序断言，而焦点归还是异步（`requestAnimationFrame`）。
   已把第二步改为显式重新聚焦主链接：断言的是「从主链接按 → 能进操作区」，
   而不是「上一步的还原必须已完成」。这不是产品缺陷，是用例时序过强。
3. **速览关闭后焦点没有归还**：Radix 的 `onCloseAutoFocus` 默认还给 `DialogTrigger`，
   而本仓库的速览由卡片键盘触发、没有 Trigger，焦点被丢到 `body`——键盘用户被弹回页面顶部。
   这是 P2 顺带修掉的真实缺陷。

---

## 3. P2：单一 Tab 入口对读屏用户是否完整

单一 Tab 入口的代价是：置顶、收藏等操作退出了 Tab 序列。若只做到「方向键能进操作区」，
对只用读屏浏览模式的用户仍是断头路。本轮补齐三件事：

1. **等价入口**：`SitePeekDialog` 新增 `categoryId` / `onTogglePinInCategory` / `isPinnedInCategory`
   与 `onCloseAutoFocus`，头部渲染「置顶/取消置顶」与「收藏」两个动作；
   首页记录打开前的焦点，关闭后还原。
2. **可发现性**：主链接加 `aria-keyshortcuts="Space ArrowRight"`。
3. **说明文本**：页面级渲染唯一一条 sr-only 说明（`#navhub-card-keyboard-hint`），
   卡片通过 `aria-describedby` 引用——1000 张卡不会各渲染一份。

守卫：`peek-action-parity.test.ts`（4 例）+ `card-single-tab-stop.test.ts` 新增 2 例。

---

## 4. 质量门禁

| 门禁 | 结果 |
|---|---|
| `vitest run`（全量） | **3859 通过 / 0 失败** |
| `pnpm test:pg:suite`（真实 PG 18.4） | 29/29（PASS3 已连续两轮验证） |
| `tsc --noEmit` / `typecheck.mjs` | 通过 |
| `check-web-overlay` | 634 个文件一致 |
| Playwright E2E | **62/62 通过**（含新增 2 例卡片键盘） |
| `pnpm check:ci-gate` | 通过（含反向用例） |

---

## 5. 复现

```bash
pnpm check:ci-gate                 # CI 合并门禁的离线断言
pnpm test:pg:suite                 # 缺 NAVHUB_TEST_DATABASE_URL 直接失败
NAVHUB_WEB_PORT=3106 NAVHUB_API_PORT=8796 npx playwright test
npx vitest run
```
