# 站点健康度感知与死链替代回退（2026-11-01）

> 目标：解决导航站最痛的点——死链。站点详情页此前只有「最近一次巡检」的即时徽标，
> 用户无法判断偶发抖动还是长期不稳；死链站点若没有关系标注，详情页就是一个死链孤页。

## 1. 为什么做

竞品走查（`docs/competitor-walkthrough/README.md`）显示商用导航站竞争的是内容质量与体验，
不是计费。导航站最痛的点就是死链：用户点出去打不开，且没有任何替代可走。
站点已有 1240 条 `health_checks` 数据，但详情页只展示最近一次巡检的即时徽标，
健康趋势从未可视化；`/api/rank/alternatives` 端点已存在（双曲测地线评分），
但死链站点若没有关系标注（`site_relations` 只覆盖人工/AI 标注过的站点），
详情页就是一个死链孤页。

## 2. 交付内容

| 层 | 文件 | 内容 |
|---|---|---|
| 后端 | `apps/api/src/routes/sites.ts` | `GET /api/sites/:id/health-history` — 返回最近 N 次巡检，按时间正序（旧→新） |
| 前端 API | `apps/web-overlay/src/lib/navhub-api.ts` | `fetchSiteHealthHistory` / `fetchSiteAlternatives` 助手 |
| 前端 | `apps/web-overlay/src/components/site-detail-view.tsx` | 健康历史 sparkline + 死链替代回退区块 |

## 3. 关键设计

### 3.1 健康历史 sparkline

- 复用 `recentHealthChecks`（`health_checks` 表），返回最近 N 次巡检的 `ok/checkedAt`；
- 后端返回时间正序（旧→新），前端直接画折线，无需再排序；
- `HealthSparkline` 组件：ok=true 画绿点在顶部，false 画琥珀点在底部；
  少于 2 个点不渲染（单点画不出趋势，反而会让人误以为有数据）；
- 缓存口径与 `/api/sites/:id/similar` 一致（60s + ETag）。

### 3.2 死链替代回退

- 详情页已有来自 `site_relations` 的「对标平替」；但关系表只覆盖人工/AI 标注过的站点；
- 当站点非 active 且 relations 没有 alternative 时，回退到 `/api/rank/alternatives`
  （双曲测地线评分），让用户至少看到可用的替代，而不是一个死链孤页；
- 回退区块只在 `alternatives.length === 0 && alternativesFallback.length > 0 && site.status !== 'active'` 时渲染。

### 3.3 顺手修复的预存在问题

- `relatedScope` 属性类型漏了 `'similar'`（与 `page.tsx` 的 `RelatedScope` 不一致），
  导致 `relatedScope === 'similar'` 比较被 tsc 判为「无重叠」——已补上。

## 4. 测试

`apps/api/test/site-health-history.test.ts`（4 例）：
- 返回按时间正序的巡检历史；
- limit 越界被钳制到 [1,90]；
- 站点不存在返回 404；
- 无巡检数据时返回空数组。

全量回归：38 项（含 route-titles / main-landmark）通过。

## 5. 真实服务验证（2026-11-03）

在运行中的 API 服务（8787）上实测真实站点 `0035b857-030f-46f9-b074-c0502fbc2497`：
`GET /api/sites/{id}/health-history?limit=10` → **200**，返回 6 条真实巡检记录，
`checkedAt` 严格递增（时间正序），符合 sparkline 直接渲染的契约。

（注：用分类 id 请求该端点会得到 404——端点先校验站点存在性，这是正确行为，不是 bug。）

