# NavHub 全栈升级总方案（2026-11-06 定稿 · 同日第二批实施）

> 方法：四路并行深度审计（后端 apps/api / 数据层 packages/* / 前端 apps/web-overlay / 基建·CI·安全·依赖）
> + 全栈专家逐项复核。视频采集子系统已于 2026-11-05/06 单独深度审计并实施两轮
> （commit `6e4fba35`、`edbdd7c9`），本方案不重复其内容。
> 所有发现均有 file:line 证据；已实施项全部通过仓库自有门禁（测试/typecheck/lint/漂移检查）。

---

## 一、仓库画像与工程纪律评估

| 维度 | 数据 | 评价 |
|------|------|------|
| 规模 | overlay 166K / api 54K / store 20K / core 20K / ai 3K LOC，~265K 总量 | 中大型单仓 |
| 技术栈 | Next 16.4 / React 19.3 / Fastify 5.12 / zod 4 / TS 5.9(+7 native 检查管线) / vitest 5 / Node 24 | **非常新**，依赖升级不是主旋律 |
| 工程纪律 | 16 枚 pre-commit 门禁 + 9 CI 作业 26 门禁 + 426+ 测试全绿基线 + mock 卫生/诚实性/源码守卫测试文化 | **罕见的高纪律** |
| 死代码 | 孤儿模块仅 7 个 / 621 行（含 .d.ts 误报） | 清理不是赢面 |
| 渲染 | 69 页：force-dynamic 仅 7、revalidate 19、generateStaticParams 8；error.tsx 18 / loading.tsx 19 | 静态优先，边界覆盖良好 |
| 数据层 | 双方言(sqlite/pg) + 幂等列迁移 + FTS(unicode61+trigram 双索引，中文子串走 trigram) + 全参数化 SQL + 先归档后删除的分批保留机制 | 设计成熟 |
| 安全 | CSP 单一事实源(可 report-only 试运行)、条件 HSTS、COOP/CORP、生产 fail-closed 启动闸门、日志 redact、requestId 全链路 | 用心 |

**结论**：这是一个健康度显著高于平均水平的仓库。升级空间不在"补窟窿"，而在**未完成的架构演进**（影子表→关系表、启发式→真 LLM、平台硬编码→插件化、next-auth beta 迁移）与**运维长尾**（增长型表、可见性口径、门禁诚实度）。

## 二、已完成升级（本轮之前，见 git log）

1. **视频采集子系统两轮**：双层租约/排队语义/探活全覆盖/SSRF 加固/解析合规倒置/假数据治理/错误脱敏/指标落盘（`6e4fba35`）。
2. **暂缓项**：启动对账自愈（影子表 6014/6014 一致）、平台 URL 识别规则表化、LLM 评估设计定稿（`edbdd7c9`）。

## 三、本轮已实施（本次提交）

### 数据层
- ✅ **health_checks 保留清理**（P1）：`RetentionTarget.timeColumn` 参数化（`checked_at` 白名单），DEFAULT 目标纳入 health_checks/180d；daily dry-run 与 CLI 归档删除自动生效。该表原是增长最快的附加型表（retention.ts 原注释明文搁置）。

### 基建 / CI / 安全
- ✅ **外网抖动测试确定性修复**（P1）：`plugin-audit-api.test` 按红灯台账处方 stub `probeCandidateUrl`（候选探活与出站网络解耦，applyProbeResult/rankCandidate 走真实实现）；台账条目清账（`--strict-ttl` 下 2026-11-07 到期即红）。
- ✅ **video-harvest.yml 补 `permissions: contents: none`**（与 ci.yml 收敛标准对齐）。
- ✅ **@types/node 22→24.19 + engines 对齐**（root + overlay；@types/node 24 实测无类型回归）。
- ✅ **生产域名出库**（P1）：`serverActions.allowedOrigins` 改读 `NAVHUB_SERVER_ACTION_ORIGINS`（运行时生效），docker-compose 接线透传，.env.example 登记。
- ✅ **文档漂移 4 处**：README `/docs`→`/api/docs`、LLM 默认 URL 对齐代码（agnes-ai.cn）、wiki 任务路由（无 `/api/jobs/run`）、GATES-OPERATIONS 覆盖率门禁措辞诚实化（CI 阈值未接线前不得声称拦截）+ check-ci-gate.mjs 过时注释更新。
- ✅ **web-overlay 死脚本清理**：docker:build/prod/deploy 引用不存在的 `docker/Dockerfile`、`docker-compose.prod.yml`、`scripts/docker-deploy.sh`，删除。

### 后端（apps/api）
- ✅ **P1-2 未发布内容可见性统一**：`GET /api/sites/:id` 与列表侧同口径（pending/archived 对无权方 404，不泄露存在性）；匿名书签导出改用 `isPubliclyVisibleSite`（此前只过滤 enabled，凭导出可枚举待上线站点）。新增 4 组行为测试（read 令牌 404 / 管理令牌放行 / 开放模式不变 / 导出过滤）。
- ✅ **P1-1 导航写侧容量守卫**：`writeNavigationData` 复用读侧 MAX+1 探测，超限 413（此前存量基线被静默截断→缩水判据失真+误判新增撞主键 500）。
- ✅ **P2 速修 ×4**：`/api/admin/audit` 纳入快照失效前缀（应用修复后 30s 陈旧）；`collections by-id` scope write→read（读语义，只读令牌可用）；config `num()` 非法数字告警；备份恢复 staging 删除用归一化路径。

## 三点五、第二批实施（同日，按路线图 P0→P1）

### ✅ P0-2 覆盖率门禁真接线（装饰门禁 → 真拦截）

- **前置修复**：全量 coverage 跑基线时暴露 **MCP 插件搜索先天断链**——`pluginOps` 声明了接口却从未被任何启动器装配，`search_plugins` 恒走 `unavailable` 降级，`install` 后向量索引从不发生（D2 的 REST 通道能用是因为直连实现）。已在 `createContext` 完成唯一装配点（searchPluginsSemantic/indexSitesBatch/removePluginIndex 与 REST 同源），mcp.test 60/60 全绿。
- **基线实测**：641 文件全量 + coverage 插桩 = **lines 85.68% / functions 86.35%**（639 绿）。
- **接线**：新增独立 CI 作业 `coverage`（全量跑 + `check-coverage.mjs --max-lines 84 --max-functions 85`，阈值=基线留 1.5pct 余量）；进 ci-passed 聚合；gates.json 登记（CI 10 作业/阻塞 9）；DEFUSED_GATES 接线（typeTrust 声明：本作业不判整前端类型）；级联登记表补 products。为什么不进 test-sqlite：3 分片作业的覆盖率各自缺 2/3 覆盖面，`all:true` 会把未执行文件计 0%，分片内阈值必然失真。
- **GATES-OPERATIONS 恢复「CI 拦截」表述**（阈值/作业名/收紧方式写明）。
- 门禁账本同步：check-ci-gate.test（撤防账 9 作业/28 门禁）、ci-defused.test（WIRED 清单）、ci-gate.test（聚合 9 作业）、check-ci-gate.mjs CASCADE_RULES。

### ✅ P0-3 导航类目缩水守卫

- `storage.ts`：类目维度两道判据进 `writeNavigationData`——①`evaluateCategoryShrink`（独立基线 `NAV_CATEGORY_SHRINK_MIN_BASELINE=20` + 同款 80% 保留率；直接复用站点判据会把 100 基线带进来=永不触发）；②子树清空探测（挂 ≥`NAV_CATEGORY_SUBTREE_WIPE_MIN_CHILDREN=3` 个托管子类目的可见类目被快照清零——形状回归每次都长这样，与库规模无关）。
- 二阶段确认协议与站点判据**共用一套**：expectedCount 声明的都是站点数（重试客户端只需一个数字，两道判据同时校验）；`categoryViolation` 进 409 响应体与审计 diff；放行审计同样留痕。
- 测试：navigation-shrink-guard.test 新增 3 组（整层丢失 409+确认放行 / 基线 25→5 拦截+确认 / 正常保存与单类目合法移除不误伤）。

### ✅ P1-3 recompute_rank 修复（正确性+性能双重）

- `repository/health.ts setTrendScores`：逐行 UPDATE → 分批 CASE-WHEN（500/批）；**不再触碰 updated_at**——此前每小时把 updated_at 刷新，runRefetch 的「30 天没富化」判定被慢性短路，且 sites 的 UPDATE 推进 nav_version 使快照缓存与全站 ETag 每小时翻转重建。
- 回归锚：store.test 新增「trend 写入不碰 updated_at」用例。

### ✅ P1-4 视频库 KV 快照缓存

- `storage.ts`：`readVideosData` KV 路径接版本号+SingleFlight 缓存（纪律与导航 snapshotCache 同款：版本号先于构建读、降级读信任 TTL、写后显式失效）；**db 模式不缓存**（KV 版本与表写入无关）。6.37MB JSON.parse 不再是每次列表/详情请求的固定税。
- `videoSnapshotCacheInfo()` 观测出口；测试 3 组（命中同引用/写后失效/空文档 null 语义）。

**回归**：web+api+store+mcp 四套件 504+ 全绿（ai-config 1 例为全量并发下的既有偶发，单跑通过，与本批无关）；5 包 typecheck 通过。

## 四、后端审计结果（apps/api + mcp）——路线图部分

**健康度**：config/context/metrics 优秀；鉴权三层体系分层清晰（哈希令牌/身份 HMAC v1+v2/bootstrap），失败审计带节流；44 个路由的 scope 纪律由四层测试防线守护。已核实无问题：health_check SSRF 防护完整、KV 文档不受任务清理误删、日志 redact、requestId 透传、MCP HTTP 每请求重验 token。

### 待实施（按价值排序）

| # | 级别 | 问题 | 证据 | 实施草图 |
|---|------|------|------|---------|
| 1 | **P0** | **导航写回的类目维度无缩水守卫**：前端一次"丢 subCategories 字段"的形状回归会把子类目树物理删除（类目是硬删除，无回收站；站点守卫只盯站点数） | storage.ts:514-524, 564-567 | ① 类目独立基线守卫（`NAV_CATEGORY_SHRINK_MIN_BASELINE≈20`，复用 80% 判据）；② 子树清空探测：可见集类目存量子类目≥3 而快照为 0 → 同款二阶段确认（confirmLargeDeletion+expectedCount 通道已有）。挂 navigation-shrink-guard.test 扩展 |
| 2 | **P1** | **recompute_rank 每小时全库单行 UPDATE 且污染 updated_at**：废掉 refetch 的 30 天超期判定、每小时翻转 nav_version（快照缓存+全站 ETag 周期性重建）、5 万库=每小时 5 万行单事务 | repository/health.ts:88-95, jobs.ts:1542-1558 | 批量 CASE-WHEN 更新且不触碰 updated_at；新增 `last_ranked_at` 列（COLUMN_ALTERS 登记一行）承担 staleness 语义；runRefetch:1512 改读新列 |
| 3 | **P1** | **视频库 KV 读路径无缓存**：json/dual 模式每个列表请求解析 6.37MB 文档（对照导航侧有版本号+SingleFlight 快照缓存） | storage.ts:805-818, routes/videos.ts:190-196 | 仿 navigation snapshotCache：readKvVersion 已有现成版本号，包一层版本判据缓存+SingleFlight |
| 4 | P2 | 匿名 scopes 语义债（auth.ts:119-125 开放模式给全量 scope，逐路由 isAdminScope 打补丁）、MCP 无限流+session 无上限、plugins conflict 泄 DB 错误、user_data_audit N+1、orphan 反连接 NOT IN→NOT EXISTS、vault PUT 无速率守卫、config 嵌入维度断言、writeVideosData 基线读不在事务内 | 见审计原文 | 各自独立小改，按 P2 排期 |

## 五、前端审计结果（apps/web-overlay，自审）

**健康度**：渲染策略静态优先；88% tsx 为 client 组件（大量 lazy-guard 测试护住首屏）；next.config.js 是全仓文档化最好的文件（CSP 双档/条件 HSTS/懒加载别名/Turbopack 迁移记录）。

| # | 级别 | 发现 | 处置 |
|---|------|------|------|
| 1 | P2 | 超大 client 组件（plugin-url-health-panel 3092 行、video-player-page 2760 行、spotlight-modal 1794 行）是维护热点 | 不拆结构（lazy-guard 已护住加载），列入重构观察名单 |
| 2 | P2 | `ignoreBuildErrors: true`（vendored 上游表单组件类型不兼容所致）；web 包 typecheck 不在 5 包门禁内 | 已知取舍；根治=升级 @hookform/resolvers 组合后移除 ignore |
| 3 | P2 | tailwind-merge 停在 v1（配 Tailwind 4，新变体可能误判） | 升 v3（cn() 行为需视觉回归，与浏览器验证一起做） |
| 4 | P2 | video-* 系列 70+ 模块无任何 E2E（22 个 e2e spec 零 video 命中）——测试金字塔最大空洞 | 先补一条 /videos 加载+播放面板冒烟（半天），再铺采集面板 |

## 六、基建 / CI / 安全 / 依赖审计结果——路线图部分

**健康度**：两镜像非 root + API 多阶段 + HEALTHCHECK 真判据；26 道门禁逐项核对属实、无 continue-on-error 残留；CSP/限流/fail-closed 启动闸门有测试锁定；依赖新鲜 + minimumReleaseAge 供应链防护 + overrides 全带事故溯源。

### 待实施

| # | 级别 | 问题 | 证据 | 实施草图 |
|---|------|------|------|---------|
| 1 | **P0** | **next-auth 5.0.0-beta.32 在生产路径**（所在 beta 线 2026-07 公告含 CVSS 9.1 fail-open 认证绕过；缓解仅靠应用层白名单+fail-closed；迁移待办自 2026-10-16 挂起） | apps/web-overlay/package.json:63, docs/security-notes.md:6-28 | 单独立项：迁移 Better Auth 或回退 4.x；公网部署前在反代层对 `/api/auth/*` 加访问控制（security-notes:33-34 的临时缓解至今未实施） |
| 2 | **P0** | **覆盖率门禁是装饰**：GATES-OPERATIONS 宣称 CI test-sqlite 判定，实际无 coverage 步骤；check-coverage.mjs 不传阈值恒 exit 0 | docs/GATES-OPERATIONS.md:18, scripts/check-coverage.mjs:6 | 文档已诚实化（本轮）。接线步骤：① 本地跑 `pnpm coverage` 取实测基线；② test-sqlite 加 `pnpm coverage -- --coverage.thresholds.global.lines=基线-1` 或在 check-coverage 传参；③ 首周观察再收紧 |
| 3 | **P1** | Web 镜像单阶段构建（工具链全进运行镜像、非 standalone 整份 node_modules 进镜像） | docker/Dockerfile.web:9-13, 85-89 | 仿 Dockerfile.api 拆 deps/runtime 两阶段，或 CI(Linux) 构建 `NAVHUB_WEB_STANDALONE=1`。**需有 Docker 的环境验证**（本机无 Docker） |
| 4 | **P1** | Docker 默认形态 CSP 完全缺失；策略本身仍宽松（`unsafe-inline`、connect-src https: 通配） | docker/Dockerfile.web:72-74 | 镜像默认改下发 CSP-Report-Only 档收集一周违规，再决定 enforce 收紧哪些源 |
| 5 | **P1** | web eslint 259 告警不阻断且基线两个月未重估 | ci.yml:247 | 清零告警后补 `--max-warnings 0`（与 lint:backend 对齐）；与第 2 项同一批做 |
| 6 | P2 | zod dev 树双版本（shadcn 拖 3.20.2 越 peer 界）；Dockerfile.api 的原生编译链疑似死重（v13 自带 prebuilds）；根 docker-compose.yml 废弃未删；Chrome 扩展 tabs 权限疑似可降 activeTab | pnpm-lock.yaml:9520 等 | 各自独立小改 |

## 七、路线图

**已全部落库（本轮）**：第三节 10 项，含 2 个 P1 行为修复 + 4 个 P2 + 基建/文档批次。

**P0（下一步，按序）**
1. ~~覆盖率门禁真接线~~ ✅ 已实施（见三.五）
2. ~~导航类目缩水守卫~~ ✅ 已实施（见三.五）
3. next-auth beta 迁移立项（安全公告驱动，越拖越贵；迁移路径见六.1）

**P1（两周内）**
4. ~~recompute_rank 正确性修复~~ ✅ 已实施（见三.五）
5. ~~视频库快照缓存~~ ✅ 已实施（见三.五）
6. video E2E 冒烟（五.4）
7. web eslint 清零 + 阻断（六.5）
8. Web 镜像多阶段 + CSP report-only 默认（六.3/4，需 Docker 环境）

**P2（按需）**：四.4 / 五.1-3 / 六.6 清单。

**长线演进**（已有设计文档）：
- 存储去整包化读路径切换：前置已备齐（影子表 6014/6014 一致 + 启动自愈 + db 模式回落测试），差一轮压测
- 真 LLM 自治采集：docs/VIDEO-LLM-EVAL-PLAN.md（待模型/预算拍板）
- 平台插件化第二步：resolve/harvest 能力接口化（URL 识别规则表已落地）
