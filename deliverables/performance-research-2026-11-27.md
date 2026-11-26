# 网站性能优化深度研究报告（2026-11-27）

## 方法论
6 路只读子代理并行审计（首屏渲染 / 取数缓存 / 打包体积 / 数据库 / 交互 / 网络缓存头）+ 自主真机实测（Chrome 157 + Playwright，8 条路由）+ RSC flight 逐字节解剖。全程严格只读，未改任何文件。所有 headline 结论均已二次核验源码。

## 真机实测基线（dev server，绝对耗时含编译噪声，体积/节点数可信）
| 路由 | HTML 字符 | JS 字节 | DOM 节点 | 备注 |
|---|---|---|---|---|
| / | 2,872,792 | 1,096,202 | 4,411 | RSC flight 2.04MB 占 HTML 70.9%，含 5090 条站点记录 |
| /hot | 342,098 | 287,501 | 1,067 | 实测动态渲染（见 P0-4） |
| /marketplace | 1,061,856 | 1,193,456 | 6,465 | DOM 最多 |
| /favorites | 109,011 | 1,448,193 | 377 | JS 最高，逼近 default 预算 1,270,784 |
| /algorithms | 113,814 | 1,128,187 | 468 | — |
| /graph | 85,653 | 1,179,259 | 227 | — |

> 首页实测 flight 2.04MB / 5090 条站点记录（本地导航.json 仅 392 站，说明 dev 直连了 5096 站生产库快照）；page.tsx:95-101 声称 flight 234KB 已过期，以实测为准。

---

## P0 — 立即修，小改动大收益

### P0-1 searchSites 的 single-flight 去重被永久旁路（全站最高 QPS 路径）
- 证据：apps/web-overlay/src/lib/navhub-api.ts:213 `const dedupe = !signal && !extraHeaders`；:405-407 anonHeaders() 无 identity 时返回 `{}`（真值）；:481 搜索调用永远传它 → dedupe 恒 false，inflightGets（:210）形同虚设。
- 后果：Cmd+K 搜索、搜索框联想、搜索页多组件同 tick 挂载时各自发重复 /api/search。现有 single-flight 测试只测 fetchCategories()，故漏掉。
- 修法：anonHeaders() 无 identity 返回 undefined（或 getJson 用 Object.keys(extraHeaders).length 判定），补 searchSites 去重回归测试。约 30 分钟。

### P0-2 hubGetProbe 的 Data Cache 条目不打标签 → 写后失效对其无效
- 证据：apps/web-overlay/src/lib/server/hub.ts:105 `init.next = { revalidate }`（缺 tags），对照同文件 :72 hubGet 有 `tags: [HUB_CACHE_TAG]`。受影响调用方全部 revalidate=60：site/[id]、plugin-detail、plugin-author、scenes 共 4 类页。
- 后果：收藏/投稿/审核/插件安装触发 revalidateTag 后，这些页仍吐旧数据最多 60s。
- 修法：hub.ts:105 加 tags: [HUB_CACHE_TAG]。一行。

### P0-3 sites.sub_category_id 缺索引 → 仪表板分类分布 & 插件占用全表扫
- 证据：packages/store/src/repository/dashboard.ts:162-170 的 `(s.category_id = c.id OR s.sub_category_id = c.id)` 只命中 sites_patrol_idx，热测 117.6ms；plugins.ts:1727 同类 OR 查询 SCAN sites。schema.ts:98-103 / migrate.ts:664-756 / driver.ts 三处真相源均无该索引，实测 sqlite_master 12 个索引无它。
- 修法：`CREATE INDEX sites_sub_category_idx ON sites(sub_category_id)`（SQLite+PG 各一处，进版本化迁移）。一条 DDL 修两条热路径。约 30 分钟。

### P0-4 /hot、/marketplace 声称 ISR 60s 实际被 searchParams 钉成动态
- 证据：app/hot/page.tsx:37 revalidate=60 且注释承诺不再每次打穿中枢；:117-134 await searchParams 读 tab/fq/domain；apps/build-418.log:143 判 /hot 为 ƒ。marketplace 同类（:30 + :102-137）。每次请求跑 7 路 hubGet。
- 修法：拆静态壳 + 客户端岛读 URL 参数（真 ISR），或删误导性 ISR 注释并接受动态。属产品取舍（深链首帧直出是刻意设计），需拍板。

## P1 — 高 ROI，排期修

### P1-1 公共只读 API 几乎无 CDN 共享缓存
- apps/api/src/server.ts:472-485 只在显式 sharedMaxAge>0 时输出 s-maxage；全仓仅 4 处（categories.ts:48/60/95、compare-share.ts:258）。sites/tags/collections/rank/hotlist/recipes/similar 全是 private max-age。
- server.ts:430-434 已对带身份头自动降 private，故给匿名安全端点补 sharedMaxAge 安全。对照 categories.ts:48。

### P1-2 /api/home/navigation 每次浏览器加载 206KB 且无 max-age/ETag
- app/api/home/navigation/route.ts:16-22 只有 s-maxage=300；4 处消费（ecosystem-graph:314、home-drama-cinema:145、watchlist:436、drama-sites:69）每次挂载全量下载。补 max-age=60 + ETag；顺带修 ecosystem-graph:301 注释漂移（写 60 实际 300）。

### P1-3 图谱拖拽/力导向布局无节流，整图重渲
- ecosystem-graph.tsx:826-834 handleMouseMove 每个 mousemove setPan；:537-584 力导向 46 帧 × 每帧 setNodes 全图 React 提交。rAF 合并 + 一次性算完再 setNodes，改动小收益大。

### P1-4 管理端两处表单三件套未懒加载
- app/admin/videos/page.tsx:6-11 静态引入 6 个重型面板（含 AddVideoCategoryForm 的 react-hook-form+zod）；实测 /admin/videos 1,181,501 B vs 已懒加载的 /admin/site 880,573 B。app/admin/resources/page.tsx:5-7 同样静态。对照 admin/site/page.tsx:15-24 的 dynamic()+Skeleton。预计省 200-300KB / 145KB。

### P1-5 搜索高亮逐行重编译正则
- components/search-palette.tsx:221-236 Highlighted 未 memo + lib/highlight.ts:37,40,49 每行 new RegExp + matchAll。键盘导航每次 activeIndex 变化重算 24+ 次。用 useMemo(text,query) 缓存。

## P2 — 中 ROI / 需产品决策

| 项 | 证据 | 说明 |
|---|---|---|
| 搜索纠错词典硬编码 LIMIT 5000 | packages/store/src/search.ts:699-700,715,796,800 | 库 5096 站已越界，零结果查询每次全表读（44ms）；内存词典+写时失效 |
| link-health / plugin-audit N+1 | apps/api/src/routes/link-health.ts:60-61、plugin-audit.ts:821-824,945-950 | 逐 slug 串行 await；批量仓储 IN 查询 |
| BentoStaticGrid 首帧 12 列水合后重排 | diy/bento-static-grid.tsx:56-59 + workspace-layout-v2.ts:790-850 | 窄桌面/平板 hydration 后整页 reflow；CSS 容器查询化 |
| 全量 lucide 异步 chunk 772KB | nav-icon.tsx:22-26 表外图标名动态 import 整包 | 不在首屏 manifest，仅表外值触发；收敛白名单 |
| ISR 门禁只覆盖 9 条路由 | scripts/check-isr-routes.mjs:111-161 | 大量 revalidate 页静默绿；加通用断言 |
| 首页 JS ~1.415MB | scripts/bundle-budget.json routes[/]=1486848 | 功能取舍，历史上三次选择放宽预算保功能 |

## 明确排除（假阳性 / 已优化，勿动）

- 空 health 527KB / flight 1.87MB：data-loader.ts:80 已改为 health: item.health?.lastCheckedAt ? item.health : undefined，page.tsx:95-101 标注旧数过期。当前本地实测 0 条 health 字段。
- cookies()/headers() 动态化首页：已用 proxy.ts middleware 重写到预渲染变体（build-418.log:30 首页 ○ 1m）。
- 42,803 DOM 水合爆炸：LazyMountSection（IntersectionObserver + rootMargin 800px）+ content-visibility:auto + EAGER_CATEGORY_COUNT=2 三层防护。
- dynamic 滥用 / 死 providers / 字体 / 图片优化器 / 预取 / gzip / ETag / SWR 键：均有明确注释与测试，逐项核过。
- Brotli 缺失：http-compression.ts:9-13 明确有意取舍，低 ROI。
- RSC 全量导航树：120KB 原始/32KB gzip，是「展开全部不发请求」的前提，page.tsx:98-105 已论证暂不分页。

## 建议执行顺序
P0 四项（约半天）→ P1 五项（约 2 人日）→ P2 按排期。P0-4 与首页 JS 含产品取舍，需先拍板。
