# [AI-4c] 富化结果字段级审核与选择性应用 —— 交付说明

> 2026-10-29 · NavHub web 仓库 · 隔离栈真实浏览器实测

## 1. 一句话结论

富化不再「审 A 写 B」：运营在管理端看到**逐字段来源**（模型归纳 / 页面抓取 / 规则推测 / 未获取）、
勾选要采用哪些字段、可改写标题、选挂载叶子类目，然后**只把这些字段**一次写库；
全程**不触发第二次富化**（浏览器实测：两次解析共 2 次模型调用，两次建站 0 次）。
33/33 项浏览器判据全部通过，后端全量回归 1426 测试通过。

## 2. 交付内容

### 服务端

| 文件 | 作用 |
| --- | --- |
| `packages/ai/src/enrich.ts` | `EnrichmentResult.fields`：title/description/tags/category/icon 逐字段来源（`llm`/`scraped`/`heuristic`/`missing`）+ 原因 note；图标区分「页面声明」与「按根路径猜的 favicon」 |
| `packages/ai/src/metadata.ts` | `ExtractedMetadata.iconSource: "declared" \| "fallback" \| null`——猜的 `/favicon.ico` 不再冒充页面声明 |
| `apps/api/src/enrich-fields.ts` | 纯函数 `selectEnrichmentFields(result, requested)`：不传=全应用（旧行为）；传了=只应用列出字段；未知字段进 `ignoredFields`；missing/空值进 `skipped` 并给原因 |
| `apps/api/src/routes/enrich.ts` | `/api/sites/auto` 接受 `title`/`description`/`enrichFields`；取消 title 又没给标题 → 400；响应与审计含 `appliedFields`/`skippedFields`/`ignoredFields` |
| `apps/api/src/routes/sites.ts` | `POST /api/sites`（enrich:true 分支）同样支持 `enrichFields` 与显式标题 |

### 前端（overlay 为源，apps/web 为镜像，哈希一致）

| 文件 | 作用 |
| --- | --- |
| `apps/web-overlay/src/lib/enrich-review.ts` | 审核纯逻辑：字段行（可用性/原因/来源提醒）、默认勾选、`buildReviewedSiteDraft`（标题必填、类目必选、标签去重截断 8、第三方图标拒收）、叶子类目、建议类目唯一匹配 |
| `apps/web-overlay/src/components/ai/enrichment-review-panel.tsx` | 管理端「富化结果字段级审核」Tab：逐字段徽章、勾选、标题改写、类目下拉、建站；明示「不会再次调用模型」「只写勾选字段」 |
| `apps/web-overlay/src/lib/navhub-api.ts` | `enrichSitePreview`（POST /api/enrich）、`createSiteFromReview`（POST /api/sites，普通建站不富化） |
| `apps/web-overlay/src/app/admin/ai/page.tsx` | 第三个 Tab「富化结果字段级审核」 |

### 测试与取证

| 文件 | 说明 |
| --- | --- |
| `apps/api/test/enrich-fields.test.ts` | 8 例：全应用/子集/顺序无关/空值跳过/missing 原因/未知字段/空数组=全不选 |
| `apps/api/test/enrich-selective-api.test.ts` | 9 例：子集落库、只选标题、400、拼错字段、无描述、enrich:true 分支、旧行为不变、`/api/enrich` 字段契约 |
| `packages/ai/test/metadata-entities.test.ts` | +3 例：声明的 icon=declared、无声明=fallback 且如实标注、apple-touch-icon 算声明 |
| `apps/web-overlay/test/enrich-review.test.ts` | 25 例：契约对等（直接读服务端 `ENRICH_FIELD_KEYS`）、行构造、草稿构建、类目匹配、图标净化、**可用但带提醒的值保留 note**、面板接线守卫 |
| `harness/browser.mjs` | 真实浏览器 33 项判据（见 §5） |
| `harness/stub-enrich-llm.mjs` | 假模型（:8922，统计调用次数与见过的 URL） |
| `harness/stub-site.mjs` | 假目标站（:8923，/rich 全字段 / /bare 仅标题） |
| `results/browser-evidence.json` | 33 项逐条结果、建站真实请求体、模型调用计数、console 错误 |
| `results/review-rich-created.png` / `review-bare.png` | 两个场景的整页截图 |

## 3. 复现（隔离栈，零外网、零真实数据）

```bash
# 1) 假模型 + 假目标站
node deliverables/ai4c-review-2026-10-29/harness/stub-enrich-llm.mjs   # :8922
node deliverables/ai4c-review-2026-10-29/harness/stub-site.mjs         # :8923

# 2) 隔离中枢（独立 SQLite，关语义通道，LLM 指向假模型）
cd apps/api
NAVHUB_MODE=lite NAVHUB_PORT=8915 \
NAVHUB_SQLITE_PATH=../../deliverables/ai4c-review-2026-10-29/data/navhub.db \
NAVHUB_ADMIN_TOKEN=ai4c-local-admin-token \
NAVHUB_LLM_BASE_URL=http://127.0.0.1:8922/v1 NAVHUB_LLM_API_KEY=sk-stub-local-only \
NAVHUB_LLM_MODEL=stub-enrich-1 NAVHUB_LLM_ALLOW_PRIVATE=1 NAVHUB_ALLOW_PRIVATE_NETWORKS=1 \
NAVHUB_EMBEDDING_ENABLED=false node src/main.ts

# 3) 隔离前端（独立 dist 目录，勿碰并行会话的 :3411）
cd apps/web
NEXT_PUBLIC_API_URL=http://127.0.0.1:8915 NAVHUB_STORAGE_BASE_URL=http://127.0.0.1:8915 \
NAVHUB_ADMIN_TOKEN=ai4c-local-admin-token NEXT_DIST_DIR=.next-ai4c-dev AUTH_TRUST_HOST=1 \
node node_modules/next/dist/bin/next dev -p 3415

# 4) 浏览器实测
AI4C_WEB=http://127.0.0.1:3415 NAVHUB_ADMIN_TOKEN=ai4c-local-admin-token \
node deliverables/ai4c-review-2026-10-29/harness/browser.mjs
```

根 `.env.local` 里的真实 AUTH_SECRET 只用于登录会话；LLM 相关环境变量在命令里覆盖，
保证假模型不会被真实密钥替换（`.env` 不被 vitest 加载，但中枢 `main.ts` 会 `loadEnvFile`）。

## 4. 判据与结果

`browser-evidence.json` = 33/33 通过，分四组：

- **G（前置）**：管理员会话、审核 Tab 可打开、面板明说「不会再次调用模型」。
- **A（勾选子集 + 改写标题）**：解析只调一次模型；≥4 个「模型归纳」徽章；抓取图标可见；
  建议类目唯一匹配 → 预选同名叶子；取消勾选描述/图标后**建站请求体与落库都不含它们**；
  标题=人工改写值；标签=模型给出且被采用；建站 0 次模型调用。
- **B（未获取行）**：标签 missing 徽章 + 原因「模型没有给出标签」+ 勾选框禁用；
  页面未声明 icon → 标「规则推测」并注明「按站点根 /favicon.ico 推测」，运营取消勾选后不落库；
  missing 行不影响其余字段建站。
- **C（负向）**：取消标题且不改写 → 拒绝且不发请求；未选类目 → 拒绝且不发请求。
- **Z（总账）**：本次运行模型调用恰好 2 次；console 零错误。

## 5. 消融记录（证明守卫真的咬）

| 消融动作 | 结果 | 还原 |
| --- | --- | --- |
| `selectEnrichmentFields(…, undefined)` 忽略入参（退回全应用） | 5 个 API 用例红 | 逐字节还原 |
| 删掉 missing/空值跳过分支 | 1 个单测红 | 逐字节还原 |
| 审核字段表删掉 `tags` | 4 个前端守卫红 | 逐字节还原（overlay+镜像 md5 一致） |
| 建站改走 `enrich:true` + 原始 url（审 A 写 B） | 2 个守卫红 | 逐字节还原 |
| `iconSource` 恒为 null | 3 个元数据用例红 | `cmp` 一致 |
| 行构造 `note` 恒为 null | 1 个审核用例红 | `cmp` 一致 |

## 6. 诚实边界

1. **实测用的是假模型**：验证的是「契约、取舍、落库、无二次调用」，不是模型质量；
   真实 Agnes 端点的输出质量不在此次判据内。
2. **favicon 回退是猜的**：页面未声明 icon 时按 `/favicon.ico` 推测（历史行为）。
   复审面板现在把它标为「规则推测」并给出说明；运营可取消勾选。
   旧的 `/api/sites/auto` 与 `enrich:true` 路径仍会写入该推测值——本次只改了「来源标注与审核可控」，
   未改自动路径的取值策略。
3. **审核面板只支持标题改写**：描述/标签/图标的编辑仍回到站点管理弹窗；
   审核面板解决的是「采用哪些字段」，不是「逐个字段编辑」。
4. **建站走普通 `POST /api/sites`**：必须选叶子类目（与既有边界一致），标签上限 8，
   第三方图标服务地址拒收；这正是「审完直接写」的代价最小路径，不引入第二次富化。
5. **隔离库跨运行累积**：同一隔离库重复跑会撞 URL 去重（409），
   因此实测 URL 带每次唯一的 `?run=` 参数；这本身也验证了去重守卫有效。
6. **`browser-evidence.json` 是最后一次运行的结果**（33/33）；早期失败轮次只在本说明中留痕
   （等待类目下拉时机、成功卡片 id 提取、跨运行计数三类是**测试脚本自身**的问题，已在脚本中修正并加注释）。

## 7. 回归与门禁

- `apps/api/test` + `packages/ai/test`：**143 文件 / 1426 测试全通过**（vitest 5.0.5）。
- `node scripts/check-web-overlay.mjs`：929 个覆盖层文件与 apps/web 一致。
- `node scripts/typecheck.mjs`：5 个后端包通过；`apps/web` tsc（`-p apps/web/tsconfig.json`）0 错误。
- 镜像一致性：`navhub-api.ts` / `enrich-review.ts` / `enrichment-review-panel.tsx` / `admin/ai/page.tsx` /
  `test/enrich-review.test.ts` 全部 md5 相同。

## 8. 进程与清理

本次实测只使用自己的隔离进程：中枢 :8915、前端 :3415（`NEXT_DIST_DIR=.next-ai4c-dev`）、
假模型 :8922、假站 :8923；结束后全部停止，临时 dist 目录删除。
`data/` 下的隔离 SQLite 为实测快照，随交付保留以便复核（不含真实数据）。
