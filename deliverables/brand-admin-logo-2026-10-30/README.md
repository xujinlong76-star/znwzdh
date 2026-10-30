# [4] 品牌资产生命周期 · 收尾：后台侧栏 logo 跟随站点设置

日期：2026-10-30 · 隔离栈实测（web :3420 → hub :8920，空库）

## 结论

1. 后台侧栏三处 logo（移动端抽屉头、移动端顶栏、桌面侧栏）不再写死上游图，
   统一消费站点设置 `appearance.logo`；未配置时回退内置 `/assets/images/alogo.webp`。
   真实浏览器 10/10 断言通过，保存与清空两条路径均在首次刷新收敛（attempts=1）。
2. 顺带修掉一个真缺陷：`/api/site` 写成功后的标签失效在 Next 16 里是
   **stale-while-revalidate**（`revalidateTag(tag, 'max')` 只把条目标 stale，不标 expired）。
   实测「保存 logo → 页面刷新」仍拿到旧图，连续 3 次请求、1.5s 内不变；改成立即过期
   `revalidateTag(HUB_CACHE_TAG, { expire: 0 })` 后，首刷即新值。
   站点设置写是低频操作，用一次回源换「保存后刷新即见新值」是合理的；中枢代理的
   通用写（收藏、审核等）仍保留 `'max'`，不在此项范围内。

## 代码位置

| 改动 | 位置 |
| --- | --- |
| 服务端读取站点设置并传 `brandLogo` | `apps/web-overlay/src/app/admin/layout.tsx:41-48` |
| 三处 `<img alt="Logo">` 改用 `brandLogo` | `apps/web-overlay/src/app/admin/AdminLayoutClient.tsx:382,401,465` |
| 写后立即过期 HUB 标签（本次修复） | `apps/web-overlay/src/app/api/site/route.ts:127-137` |
| 品牌 logo 消费守卫 | `apps/web-overlay/test/admin-brand-logo.test.ts` |
| 站点设置标签失效守卫（改为钉 expire:0） | `apps/web-overlay/test/crawl-page-isr.test.ts:58-65` |

overlay → `apps/web` 镜像已同步（`node scripts/check-web-overlay.mjs`：934 个文件一致）。

## 浏览器证据（Playwright headless Chrome，真实 HTTP）

`node deliverables/brand-admin-logo-2026-10-30/browser.mjs` → 10 PASS：

- 凭证登录成功、会话里确有 admin 用户
- 写入 `appearance.logo=/icons/icon-192.png` 成功，回读一致
- 后台 DOM 内 2 处 `img[alt="Logo"]` 全部换成新图（桌面侧栏可见，移动端顶栏隐藏）
- 清空 logo 成功，回读为空
- 刷新收敛到内置图，无空 src
- 页面无未捕获异常

收敛细节（`evidence.json`）：保存后 attempts=1 / 1393ms；清空后 attempts=1 / 1547ms
（耗时含整页加载）。截图：`shot-admin-logo-custom.png`、`shot-admin-logo-fallback.png`。

### 修复前后的时序证据（隔离栈，连续 GET /admin）

```
修复前（'max'，SWR）：
  保存 logo  → GET#1 旧图  GET#2 旧图  GET#3(1.5s) 旧图
  清空 logo  → GET#4 旧图  GET#5 旧图  GET#6(1.5s) 新值   ← 始终慢一拍
修复后（{ expire: 0 }）：
  保存 logo  → GET#1 新图  GET#2 新图  GET#3 新图
  清空 logo  → GET#4 旧图  GET#5 旧图  GET#6(1.5s) 新值   ← dev 标签清单落盘刷新
  浏览器整页刷新（上表）：两条路径均首刷收敛
```

「清空后前两次 GET 仍旧」是 `next dev` 的标签清单落盘刷新窗口（Next 默认缓存处理器
明确为 dev 提供 stale 条目以加速刷新）；真实页面刷新在写入完成后 1.4~1.6s 内收敛。
生产构建未单独复验，结论仅覆盖 dev 隔离栈。

## 门禁与消融

| 检查 | 结果 |
| --- | --- |
| `apps/web/test/{admin-brand-logo,crawl-page-isr,hub-cache-revalidate,site-settings}.test.ts` | 24/24 通过（仓库根 vitest，`@/` 别名生效） |
| `node scripts/check-web-overlay.mjs` | 934 个覆盖层文件一致 |
| `tsc -p apps/web/tsconfig.json --noEmit` | 实测当时仅并行归属的 `apps/web/src/app/videos/page.tsx(87,32): Cannot find name 'NavigationData'`；收尾复验时该问题已被并行提交 `1b509ecc` 修复，退出码 0 |
| 消融 1：`{ expire: 0 }` → `'max'` | crawl-page-isr 红；恢复后 md5 一致 |
| 消融 2：layout 的 `brandLogo={settings...}` → 写死回退图 | admin-brand-logo 红；恢复后 md5 一致 |
| 消融 3：AdminLayoutClient 一处 `src={brandLogo}` → 写死 `/assets/images/alogo.webp` | admin-brand-logo 红；恢复后 md5 一致 |

## 边界与后续观察

- `/api/hub/[...path]` 代理写仍用 `revalidateTag(HUB_CACHE_TAG, 'max')`：中枢通用内容
  （收藏、审核、插件安装）按设计容忍一次旧读，换取「写后不清空全站缓存」。
  如后续要求「后台改完立刻全站可见」，可单独评估把该处也改为 `{ expire: 0 }`，
  代价是每次写都触发一次全量回源。
- 本次只验证后台侧栏；前台 logo/favicon/manifest/分享图的生命周期见此前 [4] 主体结论。
- 并行会话的提交 `61525fd8` 把本项前半部分改动（layout、AdminLayoutClient、守卫测试）
  扫进了提交；`expire: 0` 修复与对应测试改动仍在工作树，未提交。

## 复现

```bash
# 隔离中枢（空库）
(cd apps/api && NAVHUB_PORT=8920 NAVHUB_MODE=lite \
  NAVHUB_SQLITE_PATH="<repo>/data/ai6/navhub.db" NAVHUB_EMBEDDING_ENABLED=0 node src/main.ts)
# 隔离前端
(cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8920 NEXT_DIST_DIR=.next-ai6 \
  NAVHUB_ADMIN_PASSWORD=sk-ai6-admin AUTH_SECRET=dev-secret AUTH_TRUST_HOST=true npx next dev -p 3420)
# 验证
node deliverables/brand-admin-logo-2026-10-30/browser.mjs
```

清理：停掉 :8920 / :3420、删除 `apps/web/.next-ai6` 与 `data/ai6`、移除
`apps/web/tsconfig.json` 里 Next 自动追加的 `.next-ai6` include（本次已做）。
