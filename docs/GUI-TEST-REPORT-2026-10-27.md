# GUI 真人模式全站测试报告（2026-10-26 ~ 2026-10-27）

> 五轮「真人模式黑盒测试 → 发现问题 → 修复 → 复验」的完整记录。
> 测试对象：`http://localhost:3001`（apps/web 生产构建 + apps/api 中枢 :8787）。
> 证据：`gui-test-screenshots/`（38 张截图，已 gitignore）。

## 一、方法论

- 纯 GUI 黑盒：只点真实可见的控件（点击 / 键入 / 滚轮 / 键盘），不注入 JS 改状态。
- 双通道验证：只读 DOM 交叉验证 + 截图目检，二者缺一不可（三轮中两次靠 DOM 反证了截图管线的假象）。
- 发现问题立即修复，修复后必须经「界面回归 + 自动化测试」双重确认。

## 二、五轮执行总账

| 轮次 | 内容 | 结果 |
|---|---|---|
| 全功能测试 | 10 组测试点、10 个页面 | 全通过，23 张截图 |
| 修复轮 | 3 个缺陷修复（见下 BUG-1~3 前身） | GUI 回归 + 2045 单测 |
| 重度回归 | 19 组测试面（新增 /sites、/category、/algorithms、/custom、/import、/submit、/me 全标签、/collections、市场、微工具箱等） | 全通过，2015 单测 |
| 继续轮 | 同品重复卡数据修复 + overlay 架构盘点 | API/GUI 双验证 + 936 单测 |
| 按钮轮 | 约 80 个按钮逐个点测 | 揪出 BUG-4 并修复 |

最终自动化口径：**apps/web 2045 / apps/api 936 / 全仓 verify 门禁 7 项 / Playwright E2E 75 用例全绿**。

## 三、发现并修复的缺陷（6 个）

### BUG-1 主题切换首击无效（P1）
`mode-toggle.tsx` 用存储值 `theme`（`defaultTheme="system"` 时为 `'system'`）判断切换方向，系统深色下首击 `setTheme('dark')` 等于没切。改用 `resolvedTheme`。
文件：`apps/web/src/components/mode-toggle.tsx`（overlay 差量层同步补入该文件）。

### BUG-2 密度三档两套文案（P2）
首页菜单「极客密排/舒适平衡/画廊沉浸」vs 设置页「紧凑密排/舒适/宽松沉浸」。改为全部从 `user-settings.ts` 的 `CARD_DENSITY_OPTIONS` 派生（`canonicalDensityLabel`），键盘 D 循环的 toast 同源化。
文件：`density-provider.tsx`、`density-toggle.tsx`（双应用镜像）。

### BUG-3 搜索 Enter 无响应（P2）
联想面板 Enter 仅在方向键高亮后生效（`activeIndex >= 0`），默认态 -1 直接忽略。补：无高亮时 Enter 激活第一条结果。
文件：`search-palette.tsx`（双应用镜像）。

### BUG-4 匿名通知页必然降级报错（P1）
BFF 对匿名返回 401，通知页把非 2xx 一律当「云端暂时不可用」，与页面自注释「匿名无通知」矛盾。401 改落「还没有通知」空态。
文件：`apps/web/src/app/me/notifications/page.tsx`（overlay 镜像）。

### BUG-5 T 快捷键从未实现（P2）
快捷键指南明示「T = 打开开发者微工具箱」，但处理器只有 1/2/3/E/D/B/?。补 `T` 分支并经 `onOpenTools` prop 接线到 NavigationContent；顺带把 D 循环 toast 文案同源化。
文件：`keyboard-shortcuts-dialog.tsx`、`navigation-content.tsx`（双应用镜像）。

### BUG-6「多选模式」点击整页崩溃（P1，环境性破坏）
懒加载 chunk 500：一个孤儿 `next dev` 以主 `.next` 为 distDir 运行（E2E 包装层超时后 Windows 子进程树残留），把 `next start` 正在服务的生产 `static/` 清空。处置：击杀孤儿树 → 重建（220 chunks）→ 重启。**教训**：`next dev` 与 `next start` 共用 distDir 会互相破坏；E2E 务必走 `scripts/e2e-local.mjs`（独立 dist + 可放宽的 `NAVHUB_E2E_SERVER_TIMEOUT`）。

## 四、数据质量修复

首页同产品双卡（`windsurf.ai`/`windsurf.com`、`chatgpt.com`/`chat.openai.com`）：权威快照与 site-pack 两条来源对同一产品写入不同域名，URL 去重无法命中。修复：种子源 4 处 URL 折叠（`ai-tools-arsenal.ts`、`seed-dev-efficiency.ts`、`ai-agentic-coding.ts`）+ 库内 2 行冗余软删（走 `repo.deleteSite` 统一回收）+ 重播种（3 插件升级）。LangGraph（仓库 vs 官网）属不同资源，保留。

## 五、验证手段覆盖

- 单测：apps/web 2045、apps/api 936（vitest）
- 静态门禁：`verify` 7 项（语法/覆盖层同步/CI 门禁/镜像/扩展/lint/5 包类型检查）
- E2E：Playwright 75 用例（本机入口 `scripts/e2e-local.mjs` + `NAVHUB_E2E_SERVER_TIMEOUT` 放宽；5 个超时假红经隔离复跑证实为并行满载）
- HTTP 端到端：`/api/hub/search-history/batch-delete`（removed=1）与清空（200）以真实匿名身份验证

## 六、运维教训（写给下一个人）

1. `next dev` 与 `next start` 不可共用 distDir——dev 会清掉生产 static，正在服务的页面懒加载 chunk 即 500。
2. 本机跑 E2E 用 `node scripts/e2e-local.mjs`；webServer 超时用 `NAVHUB_E2E_SERVER_TIMEOUT` 放宽（Windows 慢盘冷编译实测 >120s）。
3. Playwright 超时只杀包装层，Windows 下子进程树会残留成孤儿——发现端口被不明 dev 占用时先查 `.next/dev/lock` 的 pid。
4. `fill("")` 清空受控输入在 Playwright 下可能不生效，用 `fill(" ")`（后端 trim 归 null）。
5. 全量测试勿与其它任务并行（verify.mjs 头部注释的墙钟假红在本轮 E2E 再次应验）。

## 七、遗留（不阻断）

- 收藏页「批量导出 / 固定工作台」两钮未实际执行（对全量选择是重写入，超出测试安全边界；单选路径的导出三选项已验证）。
- `/offline` 仅离线可达，无 GUI 入口，未覆盖。
- 自动化滚轮命令在本站（`scroll-behavior` 平滑 + 万节点长页）收敛超 30s，真人滚轮无影响，属自动化手势合成差异。
