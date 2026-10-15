# 外部审计报告核验记录（2026-10-16）

对一份针对 `znwzdh`（NavHub）的"深度审计与优化建议"逐条对照代码核验的结果。
**结论：该审计大量基于过时或虚构前提，10 条建议中 7 条不应执行，3 条为真实缺口。**

## 基线验证（本次只读，未改代码）

| 项目 | 结果 |
| --- | --- |
| `pnpm exec vitest run` | **485 passed / 11 skipped**（22 文件，23.6s）；PG e2e 按设计跳过 |
| `pnpm -r exec tsc --noEmit` | 全 workspace **零错误** |
| GitHub Actions 实际状态 | **无法核实**——沙箱内 `api.github.com` 不可达（HTTP 000），且无 `gh` CLI |

> 因此审计"双方言 CI 持续报错"这一总前提在本次核验中**未获任何证据支持**，只能做静态核验。

## 逐条核验

### 1. CI 的 PG 镜像换 `pgvector/pgvector:pg16` — 已落地，无需改

`.github/workflows/ci.yml:45` 已经是 `image: pgvector/pgvector:pg16`，且带
`pg_isready` 健康检查（interval 5s / retries 10）。

### 2. 根 `package.json` 补 `pnpm.onlyBuiltDependencies` — 位置错误 + 部分多余

- 本仓用 **pnpm 11**，构建白名单的正确位置是 `pnpm-workspace.yaml` 的 `allowBuilds`，
  其中**已包含** `better-sqlite3`、`esbuild`、`onnxruntime-node`、`protobufjs`、`sharp`。
- 审计给的 `package.json` → `pnpm.onlyBuiltDependencies` 是 **pnpm ≤10 的写法**，写进去不生效。
- `sqlite-vec@0.1.9` **根本没有 install 脚本**（package.json 里只有 `optionalDependencies`
  按平台的预编译二进制），加不加白名单没有任何区别。

### 3. `pnpm test` 前插入拓扑预构建 — 不必要

`@navhub/core` / `@navhub/store` 的 `exports` 都直接指向 `./src/index.ts`，
vitest 直接跑源码，不存在"产物缺失"。加构建只会让 CI 变慢。

### 4. 统一向量编解码器（SeamVectorCodec）— 方向对，但真实缺陷另在别处

已有 `vectorToBlob`（SQLite BLOB）与 `toPgVector`（pgvector 文本）两侧实现，
"双环境向量格式漂移"已被封装住。**真正的缺陷是没有任何有限值守卫**：

```
toPgVector(new Float32Array([0.1, NaN, Infinity, -Infinity]))
→ "[0.10000000149011612,NaN,Infinity,-Infinity]"   // 直接拼进 SQL
```

PG 侧会抛 malformed array literal；SQLite 侧 BLOB 存进 NaN 后 KNN 距离全乱，
且不会报错、只会静默返回垃圾排序。这是本轮唯一被证实的 P0 级真实缺陷。

### 5. Sherman-Morrison 替代 LinUCB 求逆 — 不采纳（前提夸大 + 公式不等价）

- **性能前提夸大**：`CONTEXT_DIM = 5`。实测 5000 次 5×5 高斯消元求逆耗时 **100ms**，
  即单次预测 5 个 arm 合计约 **0.1ms**，完全不是请求链路瓶颈。即便启用 `expandPoly2Features`
  把 d 提到 20，也仅约 1.3ms。
- **数学上不等价（关键）**：本仓 `updateDiscountedArmReward` 的更新式是
  `A ← γA + (1-γ)I + xxᵀ`（`packages/core/src/linucb.ts:306`），
  而审计给的秩-1 更新只对应 `A ← γA + xxᵀ`，**漏掉了 `(1-γ)I` 正则项**。
  `(1-γ)I` 不是秩-1 修正，无法用 Sherman-Morrison 吸收。照抄会**静默改变算法收敛行为**。

### 6. 洛伦兹距离加 `1 + 1e-7` 钳制防 NaN — 前提不成立

`packages/core/src/hyperbolic.ts:212` 已经是 `Math.acosh(Math.max(1.0, -prod))`，
下界已被钉死在 1.0，`acosh` 定义域天然满足。实测：

```
lorentzDistance(u, u) = 0        isNaN: false
u vs u*(1+1e-16): -prod = 1      距离 = 0
```

即审计描述的"0.9999999999999998 → NaN → 污染推荐列表"在当前代码上**不可能发生**。
（附注：高维大幅值下自距离为 3.3e-6 而非精确 0，属无害的舍入残差。）

### 7. 0-RTT 推测执行双层配额 — 已落地，且数值与建议完全一致

`packages/core/src/speculative-prerender.ts:77-80`：
`prerenderConfidenceThreshold = 0.82`、`prefetchConfidenceThreshold = 0.45`、
`maxPrerenderCount = 2`、`maxPrefetchCount = 5`。审计建议的"预渲染 ≤2、预取 ≤5"已在位。

### 8. 多标签 CRDT / LWW 防覆盖 — 真实缺口 ✔

`apps/web/src/lib/modular/use-home-diy.ts:70` 把整个 DIY 配置 JSON 覆盖写入
`navhub_home_diy_config_v3`，无任何跨标签协调；全仓 grep `BroadcastChannel` **零命中**。
`packages/core/src/crdt-sync.ts` 已有 VectorClock + LWW 实现，但**未接入 DIY 布局**。
多标签同时打开时，旧标签失焦回写确实会覆盖新标签的布局。

### 9. OpenAPI / MCP Schema 同源 — 真实缺口 ✔

`packages/mcp/src/tools.ts` 用 zod 定义 `inputSchema`；
`apps/api/src/openapi.ts` 是手写文档，请求体一律 `{ type: "object" }` + 一句
"note 指向各 schema 的 zod 定义处"。两者演进时会漂移。

### 10. Weibull 死链巡检 — 部分已有

`wayback-resolver.ts` + `autonomous-healing.ts` 已实现坏链检测与 Wayback 回退；
缺的是寿命分布模型（Weibull）与定时巡检调度。优先级低于 8、9。

## 附加发现：审计中的 "Bento 流式排版引擎" 不存在

对 ts / tsx / md / json 全仓检索 `bento` **零命中**。审计所描述的能力在本仓的真实
对应物是 `modular-canvas.tsx`、`use-home-diy.ts`、`diy-layout.ts`。
后续若再按该审计定位模块，须先做存在性核验。

## 建议执行顺序（待确认）

1. **向量编解码有限值守卫**：`toPgVector` 与 `vectorToBlob` 前置 `Number.isFinite` 过滤并补单测（P0，约 30 行）
2. **DIY 布局多标签同步**：BroadcastChannel + 按卡片 LWW，复用现有 `crdt-sync.ts`
3. **zod → OpenAPI 同源生成**：以 `packages/mcp/src/tools.ts` 的 zod 为单一事实源反向生成 openapi 文档
4. Weibull 死链巡检（可选，优先级最低）
