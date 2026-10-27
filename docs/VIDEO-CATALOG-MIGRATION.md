# 视频库关系化：灰度手册（C6）

> 适用版本：`apps/api/src/video-catalog.ts` 落地之后。
> 相关设计见 `docs/VIDEO-HOTSPOT-BACKEND-AUDIT-2026-10-28.md` 第 15 章。

## 1. 它解决什么

改造前，视频库只有 `videos.json` 一个整包文档（存在中枢 `jobs` 表的 `kv:videos`）。
所有读写都是整包：

- 想看「哪些视频健康状态是 broken」要把整个文档解析一遍；
- 想按分类分页要先把全部条目读进内存（`B7` 已在接口层补了 `limit/offset`，但仍基于整包）；
- 两个写入方并发改不同条目，后写的整体覆盖前者（`ifVersion` 只能让后者报 409，不能合并）。

关系表把**可过滤/可排序的字段**落成列，把章节树与字幕留在 `payload`，
使上述查询变成一次带索引的 `SELECT`。

## 2. 三档模式

| `NAVHUB_VIDEO_STORE` | 写 | 读 | 什么时候用 |
|---|---|---|---|
| `json`（默认，不配就是它） | 只写 KV 文档 | KV 文档 | 与改造前**完全一致** |
| `dual` | KV 文档 + 关系表 | KV 文档 | 灰度：让影子表被真实数据填满并受校验 |
| `db` | KV 文档 + 关系表 | 关系表（空表回落 KV） | 切换读路径 |

**任何模式都继续写 KV 文档**，它是回滚快照。影子表写失败只记状态、不影响本次写入
（`videoCatalogSyncState()` 可读，`consecutiveFailures` 持续增长说明表这边坏了）。

非法取值（例如 `NAVHUB_VIDEO_STORE=database`）退化成 `json` 并告警一次 ——
一个拼写错误不应该改变读路径。

## 3. 上线顺序

```bash
# 0) 备份。关系表是副本，但 KV 文档是正本，先备份永远不亏
pnpm backup            # 或按 docs/BACKUP-RUNBOOK.md

# 1) 先只开双写，读路径不动
NAVHUB_VIDEO_STORE=dual   # 写进 .env / 容器环境变量后重启 API

# 2) 手工补一次全量导入（幂等；不依赖当前模式，json 下也能跑）
pnpm video:catalog

# 3) 校验：文档压平后的行 vs 表里的行
pnpm video:catalog:check
#    ✓ 一致 → 继续；✗ 不一致 → 按输出的 missing / extra / mismatched 排查

# 4) 观察一个采集周期（cron 6 小时一次，或手工触发 POST /api/cron/video-harvest）
#    再跑一次 check，确认增量写入也同步了

# 5) 切读路径
NAVHUB_VIDEO_STORE=db     # 重启 API
```

## 4. 回滚

把 `NAVHUB_VIDEO_STORE` 改回 `json` 并重启即可。

因为三种模式都在写 KV 文档，**KV 里始终是完整的、最新的数据**，
回滚不需要反向导入，也不会丢这期间采集到的内容。关系表留在原地不影响任何行为。

如果只是想临时绕开一张坏表：`NAVHUB_VIDEO_STORE=dual`（写还是写，读回文档）。

## 5. 已知边界（不要当成 bug）

- **`replacementHistory` 的两个字段不 round-trip**：`subCategoryId` / `subCategoryTitle`
  没有对应列。审计记录的其余字段（含 `oldItem`/`newItem` 全文）都在。
  当前库里该数组为 0 条，实际无影响。
- **单次读取上限 500 条**。超过时 `loadVideoCatalogFromDb()` 会**回落文档读取**
  而不是截断 —— 宁可变慢，不可返回残缺的视频库。
- **多实例**：影子表是同一个库（sqlite 单实例 / PG 多实例共享），
  但 `videoCatalogSyncState()` 是进程内状态，各实例各看各的。
- **`db` 模式不做写合并**：写入仍是整包文档 + 全量替换表。真正的按条 UPDATE
  属于下一阶段（需要把 overlay 的写入口改成调用条级 API），不在本次范围。

## 6. 排障

| 现象 | 检查 |
|---|---|
| `video:catalog:check` 报 missing | 同步没跑（模式还是 json），或上一次写入的同步失败了 → 看 `lastSyncError` |
| `db` 模式页面显示空 | 表被清空 → 会自动回落文档，但应立刻跑 `pnpm video:catalog` 重建 |
| 表里条目数比文档少 | 有重复 id 被加过后缀（`dup#2`）→ 属预期；对照日志 |
| 采集后表没更新 | 检查 cron 是否真的调了 API（`video-harvest.yml` 需要 `CRON_SECRET`） |
