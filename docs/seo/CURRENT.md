# SEO 现行口径（CURRENT）

> 本文件是给人读的「当前事实」入口，不是方案。历史方案 / 审计报告一律不回写（见 [docs/INDEX.md](../INDEX.md) 的状态约定），
> 需要「当时为什么这么判」请点下面各链接进原文。本文所有数字与结论都来自对应原文或代码，不臆造。
>
> 生成方式：本文件为人工维护（2026-11-06 文档治理新建，不在任何生成器的写入范围内）。
> 若代码改动导致下列「现行」事实过期，请在同一次提交里改掉本文；复核命令见文末。

---

## 一句话：现在以哪份为准

seo/ 下 8 份 .md 按时间线是 **V1（10-20）→ V2（10-21）→ V3（10-21 复扫）→ V4（10-22 规模复核）** 四轮方案，
外加 3 份专题（审计 / 内链 / 标签文案）与 1 份裁决记录。**最新且口径被数据校准过的是 V4**；
V1/V2/V3 与 3 份专题的分类口径（594 类目 / 门槛 5）是旧平铺树的历史快照，原文已自行加了「口径更新」横幅，
**不要再据此改代码**。

| 你要干什么 | 看这份 | 状态 |
|---|---|---|
| 改索引门槛 / 类目树 / sitemap 口径 | [SEO-OPTIMIZATION-PLAN-V4-2026-10-22.md](./SEO-OPTIMIZATION-PLAN-V4-2026-10-22.md) | **现行主方案** |
| 查 ISR 收录型路由「判过不再重开」的裁决 | [ISR-ROUTES.md](./ISR-ROUTES.md) | **现行裁决记录** |
| 查收录型路由的自动门禁怎么跑 | 仓库根 `scripts/check-isr-routes.mjs`（两种模式：构建产物 / `--live` 线上抽查） | 现行门禁 |
| 查内链 / 信息架构设计（旧树快照） | [link-architecture-navhub.md](./link-architecture-navhub.md) | 历史（口径已废） |
| 查技术 SEO 体检评分（旧树快照） | [TECHNICAL-SEO-AUDIT-2026-10-20.md](./TECHNICAL-SEO-AUDIT-2026-10-20.md) | 历史（口径已废） |
| 查页面模板文案 / 薄内容风险 | [SEO-TEMPLATE-COPY-AUDIT-2026-10-21.md](../SEO-TEMPLATE-COPY-AUDIT-2026-10-21.md) | 历史 |
| 查标签描述文案（82 条） | [tag-descriptions-draft.md](./tag-descriptions-draft.md) | 现行文案草稿 |
| 查关键词研究 | [seo-keyword-research.md](../seo-keyword-research.md) | 历史 |

---

## 现行事实（均可复核）

### 1. 类目树与索引门槛（2026-10-22 升级后）

- 权威树 **18 根 / 215 叶**，定义在 `packages/core/src/category-registry.ts`；
  站点只挂叶子，一级根只做导航；根与父级的站点数按后代聚合
  （`apps/web-overlay/src/lib/seo/category-totals.ts`）。
- 索引门槛**已分档**：类目 **12** / 标签 **5**，定义在 `apps/web-overlay/src/lib/seo/thresholds.ts`。
  V4 在满量数据集（4765 站点）上建议把标签门槛 5 → 10，理由是 5 会放出 961 个零描述薄页；
  抬到 10 后收敛为 420 个。**该建议是否落地以代码为准，改代码前先读 thresholds.ts，不要照抄本文数字。**
- V4 修订记录明确撤回了两处初稿判断：①「门槛 12 会砍掉 59% 入口」是错的，按权威树叶子重算覆盖 89.6% 站点；
  ②「阈值分档从未接线」部分错，overlay（事实源）已接线，未接线的是 `apps/web` 镜像副本（陈旧）。

### 2. V4 规模实测（2026-10-22，独立库实跑，未碰生产库）

方法：`NAVHUB_SQLITE_PATH=./data/scale-test.db node scripts/seo-scale-bench.mts` 落 29 个 site-pack，
再用 PORT=8788 起中枢、PORT=3001 起前端，对真实 HTML 与 sitemap.xml 计数。

| 指标 | 实测 |
|---|---:|
| 存活站点 | 4765 |
| 分类总数 | 234（权威树 233 + 未分类） |
| 达标分类（≥12） | 136 |
| 标签总数 | 4619（初稿按 dev 库估 1080，低估 4 倍） |
| 达标标签（≥5 站） | 961（初稿按 dev 库估 82，低估 12 倍） |
| 达标标签中有 description | 0 |
| 站点描述长度中位数 | 23 字 |
| sitemap URL 总数 | 5400（单片，≤50000，无需分片） |
| sitemap 体积 / 首生成 / 缓存命中 | 0.98 MB / 9.85 s / 0.43 s |

页面级：分类页 200 且含 60 条站内 /site/ 内链、canonical 自指、JSON-LD 2 块；
站点页 200 且「收录档案区块」渲染成功、6 条同分类内链、JSON-LD 2 块；
边缘标签 `/tags/思维导图`（9 站）返回 `noindex, follow`，证明门槛生效。

### 3. 早前轮次已落地的事（引自 V2 / V3 结论，勿重复实现）

- V2：索引地基、RSC 化、软 404 归零、sitemap、JSON-LD 第一轮已完成；
  V3 复扫确认「能被收录」基本成立（sitemap 134 条、详情页有 SSR 正文与独立 title）。
- V3 指出的三处高杠杆缺口：首页 SSR 的 `/category` 出链为 0、站点详情是「内容终点」、
  页面级 openGraph 整体替换导致 og:image/og:type 等丢失、内容描述与审计闭环不足。

---

## 维护与复核

- **事实源优先级**：代码（`apps/web-overlay/src/app/**` 与 `lib/seo/**`）> V4 > 本文 > 更早方案。
  `apps/web` 是 vendor + overlay 镜像，**patch 只写 overlay**。
- **不要改历史方案**：V1/V2/V3 与 3 份专题顶部已有「口径更新」横幅，保留原样。
- 新增 seo/ 下的 .md 会被 `node scripts/gen-docs-index.mjs --check` 纳入登记棘轮（未登记即 exit 1）。
- 复核命令：
  ```bash
  node scripts/check-isr-routes.mjs --live --base=https://<线上域名>   # 线上 ISR 形态抽查
  node scripts/gen-docs-index.mjs --check                                 # 文档索引未漏登记
  ```
