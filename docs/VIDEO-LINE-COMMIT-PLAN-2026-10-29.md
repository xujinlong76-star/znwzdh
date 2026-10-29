# 视频线收口切片预案（2026-10-29）

> 用途：并行会话停稳后，按本清单把剩余 82 个未提交文件收口。
> 每一片都用 `scripts/check-commit-closure.mjs` 实测过**闭包完整**，可独立提交。
> 判据是「HEAD 缺哪些符号」——不是按目录切，是按依赖闭包切。

## 0. 收口前必做

1. **确认对方停稳**：`git status` 的最近改动 mtime 落后当前 **≥30 分钟**，且无 `node scripts/safe-commit` / `git commit` 进程。
2. **镜像成对**：`apps/web-overlay/**` 是事实源，`apps/web/test/**` 是执行面镜像，必须逐字节一起提交
   （`apps/web/src/**` 是 vendor 生成物、整个 gitignore，**只提交 overlay 侧**）。
3. **提交工具**：一律 `node scripts/safe-commit.mjs --msg-file <f> -- <paths>`（独立索引 + 显式路径）。
4. **提交原子性闸门会拦**「测试依赖的源码是脏的但不在提交集里」——所以测试必须和它的源码同片。

## 1. 已验证可独立提交的切片

| # | 主题 | 文件数 | 闭包 | 备注 |
|---|---|---|---|---|
| B | 存储适配器带标签缓存读 + GitHub 适配 | 3 | ✅ | `storage-adapter.ts` / `github.ts` / `storage-adapter.test.ts` |
| C | 点击出箱与离线补送 | 4 | ✅ | `navhub-api.ts` / `offline-recent.ts` + 2 测试 |
| D | 合成元数据默认关闭 | 4 | ✅ | `video-metadata-policy.ts`(新) / `video-autonomous-ai-harvester.ts` / `types/navigation.ts` / `video-metadata-policy.test.ts`(新) |
| E | 视频目录 API 与对账 | 7 | ✅ | `routes/videos.ts`(新) / `video-catalog.ts` / `video-catalog-main.ts`(新) / `server.ts` / `store/repository/videos.ts` / `store/repository.ts` / `videos-api.test.ts`(新) |
| F | 多源采集与 webhook 入库 | 4 | ✅ | `video-harvester.ts` / `video-multi-source-connector.ts` / `api/videos/harvest` / `api/videos/webhook-harvest` |
| G | 视频 REST / SEO 路由 | 5 | ✅ | `api/videos`、`api/videos/[id]`、`api/videos/[id]/items`、`videos/sitemap.xml`、`videos/feed.xml` |
| H | 事件幂等与遥测 | 4 | ✅ | `store/repository/events.ts` / `event-idempotency.test.ts` / `routes/telemetry.ts` / `event-replay-dedup.test.ts` |
| A | 文档 / e2e / package.json | 3 | ✅* | *唯一告警是 md 里指向 `video-topics.json` 的**文字链接**，非 import，可忽略 |

### 命令模板

```bash
node scripts/safe-commit.mjs --msg-file tmp/cmsg-<slice>.txt -- <上面表格里的路径>
```

## 2. 剩余（视频 UI 大杂烩，需按需再切）

以下是尚未归簇的部分，彼此通过 `NavigationSubItem` / `videoConfig` 弱耦合，
可以再切成 2~3 片，但要先对每片跑闭包：

- **播放器与卡片**：`video-player-page.tsx`、`video-card.tsx`、`video-content.tsx`、
  `video-mini-player.tsx`、`video-heatmap-timeline.tsx`、`navigation-card.tsx`
- **采集控制台 UI**：`video-auto-harvest-dialog.tsx`、`video-autonomous-harvest-console.tsx`、
  `video-multisource-webhook-dialog.tsx`
- **管理端视频页**：`admin/videos/page.tsx`、`admin/videos/[id]/items/page.tsx`、
  `admin/videos/components/VideoCategoryCard.tsx`
- **网关与内容数据**：`api/hub/[...path]/route.ts`、`hub-route-policy.generated.ts`、
  `api/cron/video-health-sweep/route.ts`、`navsphere/content/video-topics.json`
- **测试**：`video-evolution-v5~v10`、`video-api-guards`、`video-category-filter`、
  `video-items-honesty`、`video-topics-consistency`、`video-doc-read`、`video-evolution-suite`、
  `video-health-tristate`、`video-page-caching`、`video-scoring-guard`、`video-super-evolution`、
  `video-type-contract`（overlay + apps/web 镜像各一份）

> **注意**：`video-evolution-v9/v10` 与 `video-metadata-policy.test.ts` 必须与 D 片一起走——
> 它们断言的 `videoConfig.synthetic` 就是 D 片的类型与策略实现。

## 3. 随手带上的两处门禁修复（已在工作区，别丢）

这两处是为解开**被别人 WIP 卡住的门禁**做的最小契约修复，行为不变：

1. `apps/web-overlay/test/video-evolution-v9.test.ts` / `video-evolution-v10.test.ts`：
   补 `afterAll(() => delete process.env.NAVHUB_VIDEO_SYNTHETIC_METADATA)`——
   「测试文件 mock 卫生」守卫要求 afterAll 兜底，`try/finally` 不够。
2. `apps/web-overlay/src/lib/navhub-api.ts`：两处 `.catch(() => undefined)` 改块体并写理由——
   「吞掉失败的 catch 都要写明理由」守卫。

它们分别属于 C 片与 D 片，跟着一起提交即可（提交原子性闸门会强制源码与测试同片）。

## 4. 已定口径（不要推翻）

- `deliverables/**/shots/` **不入库**：HEAD 里 deliverables/ 自建立就是 0 张截图，
  截图是过程证据、报告与工装才是交付物（`gui-test-screenshots/` 同口径）。
  小体积结论性截图（`results/*.png`）随各自目录入库。
- `apps/web/src/**` 整个 gitignore（vendor 生成物）：镜像改动只提交 overlay 侧。
- 死键陷阱：配置/属性**名字写对不等于生效**。已修过两处
  （`<video>` 的 `referrerPolicy`、`next.config.js` 顶层的 `images.unoptimized`）。
