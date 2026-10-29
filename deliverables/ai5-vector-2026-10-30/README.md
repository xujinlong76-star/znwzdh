# AI-5 向量索引生命周期与质量控制（2026-10-30）

## 结论

向量链路原有三个会「静默出错」的缺口，本次全部修复并用测试钉住：

1. **相似度没有下限**：语义通道永远返回 top-N，哪怕最相近的余弦相似度只有 0.1 也进 RRF；
   插件语义检索同样「总能找到结果」。→ 增加余弦相似度闸门，默认 **0.40**（真实模型标定值）。
2. **distance 口径不一**：memory/pgvector 的 `distance` 是余弦距离，sqlite-vec 的 vec0 默认是
   **L2**。任何按 distance 写的阈值/展示分数都会在换存储后端时静默改变语义。
   → `VectorMatch` 增加统一的 `similarity`（余弦口径），闸门与插件展示分数只认它。
3. **向量覆盖率说谎**：健康巡检只看 `embeddings` 里有没有这个 site_id，换模型/维度后旧向量
   仍在表里，巡检会把「内核里一条新向量都没有的站点」报成已覆盖；全量 reindex 也从不清理
   旧模型行。→ 巡检按「当前模型 + 当前维度」判定并新增 `staleEmbeddings`；
   全量 reindex（站点 + 插件）在重建前清理旧模型/旧维度残留，清理条数写进事件 meta。

## 标定证据（为什么是 0.40）

`calibration/measure-threshold.mts`，真实模型 `Xenova/bge-small-zh-v1.5`（q8，512 维），
50 个站点标题/描述、37 条查询、64 个相关对、1786 个噪声对。输出：
`results/threshold-calibration.json`。

| 阈值 | 相关命中保留 | 噪声保留 | 丢失相关 top-5 的查询数 |
| ---: | ---: | ---: | ---: |
| 0    | 100%   | 1786（100%） | 0 |
| 0.30 | 98.4%  | 73.57% | 0 |
| 0.35 | 98.4%  | 50.95% | 0 |
| **0.40** | **96.9%** | **27.16%（剔除 73%）** | **0** |
| 0.45 | 89.1%  | 11.2%  | 1 |
| 0.50 | 81.3%  | 4.37%  | 2 |
| 0.60 | 54.7%  | 0.22%  | 9 |

相关对最低 0.2703、p10 0.449；噪声中位数 0.3517、p90 0.4553。0.40 是「噪声腰斩 ×
相关几乎不丢」的拐点，再往上就开始丢查询。0.40 之前的 0.35 保留一半噪声，0.45 起
开始出现查询丢失相关 top-5。

## 改动清单

### 契约与存储（packages）

| 文件 | 改动 |
| --- | --- |
| `packages/store/src/vector/types.ts` | `VectorMatch.similarity`；`clampSimilarity()`（±1 裁剪、NaN→0） |
| `packages/store/src/vector/memory.ts` | 余弦距离实现：`similarity = 1 - distance` |
| `packages/store/src/vector/sqlite-vec.ts` | vec0 默认 L2：`similarity = 1 - d²/2`（归一化前提下等价余弦） |
| `packages/store/src/vector/pgvector.ts` | `<=>` 即余弦距离：`similarity = 1 - distance` |
| `packages/store/src/search.ts` | `SearchEngineOptions.semanticMinSimilarity`（0=关闭，钳到 [0,1]）；`channelSemantic` 回表前按 similarity 过滤；`ChannelTimings.semanticFiltered` 计量剔除数 |
| `packages/core/src/types.ts` / `rest-responses.ts` | REST 契约补 `semanticFiltered`，web 生成类型已重生成并镜像 |

### 中枢（apps/api）

| 文件 | 改动 |
| --- | --- |
| `config.ts` | `search.semanticMinSimilarity` ← `NAVHUB_SEMANTIC_MIN_SIMILARITY`，默认 0.40，越界钳制、非数字回退 |
| `context.ts` | 装配 SearchEngine 时注入闸门 |
| `plugins-search.ts` | 插件语义检索同一闸门；展示分数改用 `m.similarity`（原来 `1 - distance` 在 L2 下是错的） |
| `jobs.ts` | 巡检 `sitesMissingEmbedding` 按 model+dim 判定，新增 `staleEmbeddings`/`embeddingModel`/`embeddingDim`；全量 reindex 清理站点与插件的旧模型残留，事件 meta 记 `staleEmbeddingsPurged`/`stalePluginEmbeddingsPurged` |

### 测试

新增 5 个文件/组共 27 条断言：

- `packages/store/test/vector-similarity.test.ts`（3）：同向/正交/反向的 similarity 跨实现一致；
  并钉住「sqlite-vec 的 distance 确实是 L2」——换算公式依赖这个前提。
- `packages/store/test/search-semantic-gate.test.ts`（7）：闸门关闭/0.5/0.99、越界钳制、
  `semanticFiltered` 计量、只认 similarity 不认 distance、early-exit 与 disableSemantic 时为 0。
- `apps/api/test/config-semantic-gate.test.ts`（6）：默认 0.40、环境变量覆盖、越界与非数字钳制。
- `apps/api/test/vector-index-lifecycle.test.ts`（5）：巡检错模型判定、全量清残留（含回收站站点）、
  增量不动全表、插件清残留、vectors:false 不清。
- `apps/api/test/plugins-search.test.ts`（+1）：插件语义闸门低于阈值时回退关键词并标 degraded。

## 消融验证（全部字节级还原）

| 改坏点 | 红灯 |
| --- | --- |
| 闸门改用 `distance` 比较 | 3 条 |
| 巡检去掉 model/dim 过滤 | 1 条（missing 0 vs 1） |
| 站点 purge 只计数不删除 | 1 条（回收站站点的旧行仍在） |
| 插件 purge 只计数不删除 | 1 条 |
| sqlite-vec 用 `1 - d` 代替 `1 - d²/2` | 1 条（正交得 -0.414 而非 0） |
| 插件闸门整段删除 | 1 条（mode semantic vs keyword） |

全部改动用 `cp` 备份、`cmp`/`md5` 验证还原后逐字节一致。

## 全量回归与失败归因（2026-10-30 01:15）

全量 `vitest run` 首轮 3 个失败文件，逐条归因后**均非 AI-5 改动引入**：

| 失败 | 根因 | 处置 |
| --- | --- | --- |
| `apps/api/test/config-semantic-gate.test.ts`（`ReferenceError: vi is not defined`） | 并行提交 `f988237d` 的 mock 卫生工具在 01:03:46 正在改本文件：先追加 `afterAll(vi.resetModules())`、后补 import，全量跑恰好读到半写状态 | 提交后的完整文件 import 齐全，单跑 + 与 `job-health-budget` 同跑均绿 |
| `scripts/check-ci-gate.test.ts`（fixture 里找不到锚点行） | 同窗口 `scripts/check-ci-gate.mjs`（mtime 01:03:46）处于并行写入中途 | 该窗口结束后单跑 11/11 绿，regex 对 HEAD 的 ci.yml 实测可匹配 |
| `apps/web/test/video-all-suite.test.ts`（离线缓存删除后仍判 true） | 并行 WIP `apps/web-overlay/src/lib/offline-video-cache.ts`：`removeOfflineVideo` 未从 `_offlineIdSet` 删除，缓存永不过期 | 并行会话所有（文件 dirty），未触碰；已上报 |

复跑取证（01:15，HEAD `f988237d`）：`Test Files 1 failed | 555 passed | 1 skipped (557)`，
唯一失败即上表第三行；前两条在并行写入窗口结束后消失，确认与 AI-5 无关。

## 运维入口

- 新配置：`NAVHUB_SEMANTIC_MIN_SIMILARITY`（0..1，默认 0.40；0=关闭闸门）。
- 换模型/维度后：巡检会报 `sitesMissingEmbedding` 与 `staleEmbeddings`；执行一次
  `POST /api/jobs {"kind":"reindex","payload":{"vectors":true}}` 即可全量重灌并清残留。
- 检索响应 `channelTimings.semanticFiltered` 可直接观测闸门每天剔除多少条向量命中。

## 诚实边界

- 标定集规模有限（50 站点/37 查询/64 相关对），结论对**当前模型**（bge-small-zh-v1.5）
  成立；换模型后阈值应重新标定（脚本可复用）。
- 站点→站点相似端点（`/api/rank/similar`）不做阈值：相关推荐的相似度分布与
  「查询→站点」不同，同一阈值会误杀；其响应仍暴露存储原生 `distance`，调用方
  不应跨后端比较。
- 软删站点的当前模型向量**故意保留**（恢复即可用）；全量 purge 只清旧模型/旧维度。
- 插件 `similarPlugins`（共现 + 向量混合）未加闸门——它不是「查询→条目」管线；
  其向量召回仅用于补充候选池。
- L2→余弦换算依赖「写入与查询两侧都归一化」，这一点由 upsert/search 两端 normalize
  保证并有既有测试覆盖；若未来接入不归一化的外部向量库，换算公式需重审。
