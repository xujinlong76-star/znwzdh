# P3 前端现代化改造完成报告（2026-10-16）

> 对应方案：`docs/UPGRADE-PLAN-2026-10-16.md` P3 阶段（P3-1 / P3-2 / P3-3 + 终验）
> 执行方式：多会话并行工作区，全部改动按「单文件隔离提交」入库

## 一、提交清单

| 提交 | 内容 |
| --- | --- |
| `94d34a0` | **P3-1**：React 18.2 → 19（react/react-dom 19.3.1、@types 19.3.0、dnd ^18.0.1、recharts ^3.10.1）+ chart.tsx recharts 3 适配 |
| `c5343ec` | **伴随修复**：pnpm `packageExtensions` 声明 @types/react peer，修复 monorepo 类型解析（跨会话协作提交） |
| `29af508` | **P3-2**：apps/web TypeScript 5.1.6 → 5.9.3（与根仓库对齐，消除同仓双 TS 大版本） |
| `e807b5d` | **P3-2 伴随修复**：vault.ts 适配 TS 5.7+ TypedArray 泛型化 |

P3-3（DX 三件套）经核实已在 `13fc4a2` 落地，本轮无新增改动（见第四节）。

## 二、P3-1：React 19 升级

**依赖面（apps/web，6 处）**：react / react-dom `18.2.0 → 19.3.1`；@types/react / @types/react-dom `→ 19.3.0`；@hello-pangea/dnd `^17 → ^18.0.1`（v18 peer 声明支持 React 19，是解除升级阻塞的钥匙）；recharts `^2.14.1 → ^3.10.1`（v2 peer 不支持 React 19）。

**chart.tsx 适配 recharts 3 破坏性变更**（唯一引用方，无消费方）：
1. Tooltip 自定义 content 入参：`ComponentProps<typeof Tooltip>` → 根导出 `TooltipContentProps`（v3 起 payload/label/active 改由 context 注入）
2. Legend 自定义 content 入参：`LegendProps` → `DefaultLegendContentProps`（v3 起 `LegendProps` 已 Omit payload/verticalAlign）
3. `key={String(item.dataKey)}`（v3 起 `DataKey` 联合类型含访问器函数，React key 不接受）

## 三、伴随修复：monorepo 类型解析缺陷（`c5343ec`）

**症状**：冷缓存 `tsc --noEmit` 报 9 处存量错误 —— next/script 的 `ScriptProps` 丢 `src`、cmdk 的 `CommandItem.onSelect` 参数丢类型、input-otp 的 context 变 `unknown`、ResourceCard/navigation-content 回调参数隐式 any。

**根因（traceResolution 实证）**：pnpm 隔离布局下，`.pnpm` 实例目录内包的 `.d.ts` 里 `import from 'react'` 在 classic node10 解析中落至**无类型运行时包**（react 包本身不带 types）；TypeScript 的 `@types/*` 包级回退只在「主包被找到但无类型」的同一层级生效，不会向上回溯到根 `node_modules/@types`。recharts / radix 因在 `peerDependencies` 中声明了 @types/react（实例哈希含 `@types+reac`）而天然幸免。

**关键澄清（与 React 版本无关）**：react@18.2.0 同样只有 `main` 无 `types` 字段，该缺陷在 React 18 下同样存在，只是长期被 `apps/web/tsconfig.tsbuildinfo` 增量缓存掩盖（文件未变即跳过复查），冷缓存下才暴露。**非本次升级引入**。

**修复**：`pnpm-workspace.yaml` 增加 `packageExtensions`，为 `next` / `cmdk` / `input-otp` 声明 `@types/react`（next 另含 `@types/react-dom`）peer 依赖，由 pnpm 在各自实例目录内自动建立类型链接；纯类型依赖，零运行时影响，安装期自愈，CI 全新检出同样生效。

## 四、P3-2：TypeScript 5.9.3

- `apps/web/devDependencies.typescript` `5.1.6 → 5.9.3`（根仓库已是 5.9.3，消除同仓两个 TS 大版本并存导致的严格度差异）
- **vault.ts 适配**：TS 5.7+ 起 TypedArray 泛型化，裸注解 `Uint8Array` 退化为 `Uint8Array<ArrayBufferLike>`，不再满足 WebCrypto 的 `BufferSource`；已将 `hexToBytes` / `base64ToBytes` 返回类型与 `deriveVaultKey` 的 `salt` 参数显式标注为 `Uint8Array<ArrayBuffer>`（由 `new Uint8Array` 构造者天然满足），overlay 镜像同步

## 五、P3-3：DX 三件套（核实已在位）

| 项 | 落地方式 |
| --- | --- |
| Git 钩子 | `package.json` 的 `prepare` → `scripts/install-git-hooks.mjs` 自动写入 `.git/hooks/pre-commit`（跑 `check-web-overlay` + `check-extensions`），每次 install 自动挂载 |
| 根脚本 | `lint`、`check:overlay`、`check:extensions`、`typecheck` 均已存在 |
| CI 门禁 | `test-web`（tsc / next lint / next build）+ `check-web-overlay`（含扩展 manifest 校验）+ `audit` + `ci-passed` |

> 与方案原文的偏差：实现采用「prepare 自动安装钩子」而非 `.githooks/` + `core.hooksPath`，效果等价且在 Windows 下更稳健。

## 六、终验结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Web 类型检查 | `pnpm --filter navsphere exec tsc --noEmit`（TS 5.9.3，冷缓存） | **0 错误** |
| 根类型检查 | `pnpm typecheck`（@navhub/*） | **0 错误** |
| 单元/集成测试 | `pnpm test` | **42 文件全过 / 709 通过 / 11 跳过** |
| 覆盖层一致性 | `check-web-overlay.mjs` | **181 文件一致** |
| 扩展规范性 | `check-extensions.mjs` | **通过** |
| 运行时 | API `:8787/api/health` | `{ok:true, mode:lite, fts:true}` |

## 七、环境事件与处置（重要，供后续会话参考）

1. **多会话并行 + WorkBuddy 沙箱 CoW**：未提交的已跟踪文件改动会被并发会话的合并事件反复回退（本次 package.json / lockfile 至少 4 次）。**对策：改完立即验证并提交**。
2. **pnpm 状态文件陷阱**：`node_modules/.pnpm-workspace-state-v1.json` 与 `.pnpm/lock.yaml` 会让 install 报「Already up to date」而跳过重链；可靠解法是删除状态文件 **并删除 importer 的 `node_modules` 目录**后重装。
3. **native 模块文件锁**：`--force` 全量安装在运行中的 API 进程持有 `better-sqlite3` 原生模块时触发 `ERR_PNPM_EPERM`（rename 原子替换失败），导致该包目录残缺；经用户授权短暂停止 dev-all/API 后删除残留目录并全量重装修复，开发环境已恢复（API 健康检查含 `fts:true` 证明 SQLite 正常）。
4. **Node shim**：`CODEBUDDY_SESSION_ID=` / `CLAUDE_SESSION_ID=` 置空可禁用全部 Node 预加载钩子；对真实 FS 的操作必须使用沙箱禁用的执行模式。

## 八、遗留与建议

- `apps/web/src` 是 gitignored 的 vendored 工作副本，其自研改动（chart.tsx、vault.ts）均已镜像到 `apps/web-overlay/` 并入库；上游同步（`sync-web-overlay.mjs` / `vendor-web.mjs`）时需保留这些改动。
- 建议将「三处 @types peer 依赖」的根因补充到 vendor/overlay 维护文档，避免上游重拉后回归。
- 其他会话在途改动（`apps/api/*`、`packages/store/*`、`e2e/*`、`scripts/dev-all.mjs`）未在本轮触及。
