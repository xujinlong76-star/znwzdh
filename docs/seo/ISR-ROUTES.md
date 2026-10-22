# 收录型路由（ISR）裁决记录

这里只记**已经判过、且判完不再重开**的事：现象、实测证据、为什么不改、以及用什么命令复核。
机制本身写在代码注释里（`scripts/check-isr-routes.mjs` 头部、各页面的 `revalidate` 说明），
门禁写在 CI（`.github/workflows/ci.yml` 的 `test-web` / `check-isr-live`）。

---

## 裁决 1：旧形态 `?page=N` 的 308 `Location` 保留 query —— 不加 middleware 抹掉

**现象（实测）**：配置层 `apps/web/next.config.js` 的 `redirects()` 把源 URL 未匹配的 query
原样带进目标：

```
GET /category/ai-tools?page=2
→ 308  Location: /category/ai-tools/p/2?page=2
```

于是「旧 URL → 新形态」这一跳落地时是带参的。看起来像缺陷，因为路径段分页的初衷就是
让分页 URL 干净。

**为什么判为不改**：

1. **权重交接没有坏**：落地页 `/category/ai-tools/p/2?page=2` 的 `<link rel=canonical>`
   指向不带 query 的 `/category/ai-tools/p/2`。爬虫只看 HTTP 状态、`Location` 与 canonical，
   canonical 干净就意味着带参那份不会变成第二条可收录的重复页。
2. **代价与爆炸半径不划算**：配置层 `redirects()` 只能声明 `destination`，剥不掉 query；
   要剥只能新增一个 `middleware`（Edge bundle），而它会命中所有收录路由 —— 每请求多一次
   Edge 执行、多一份运行时产物，还要重新验证它不会把 `●` 打成 `ƒ`。收益只是让一个
   本来就不进索引的中间形态 URL 更好看。
3. **仓库里原本没有 middleware**，为一个 P3 美观问题引入这一层，等于给所有收录路由加
   了一个新的失败面。

**于是改成监控前提，而不是修现象**：`scripts/check-isr-routes.mjs --live` 在验完
「旧形态必须 30x 到路径段」之后，会**跟进 308 的落地 URL**，断言它的 canonical 存在且
不带 query（`跳转页 canonical` 那一行）。前提一旦破（canonical 把 query 吃回去，或缺失），
门禁立刻红灯 —— 那时带参 URL 才真的是一条重复页。

**复核**：

```bash
node scripts/check-isr-routes.mjs --live --base=http://localhost:3000 --sample=2 --min-checked=8
# 假站回归（含「canonical 带 query 就红灯」这条用例）：
node node_modules/vitest/vitest.mjs run scripts/check-isr-routes.test.ts
```

---

## 裁决 2：降级壳（中枢不可达）不落缓存这条路放弃，改为给坏快照盖 `noindex`

**现象（实测）**：`/site/[id]` 在中枢连不上时渲染 200 空壳，`x-nextjs-cache` 先 MISS 后 HIT、
`cache-control: s-maxage=60`。一轮全量审计里 997 个详情页有 551 个是这种壳 —— 它带全站共用的
「站点详情」标题、正文靠客户端补，而爬虫在这 60s 里拿到的是一个**可索引**的空页。

**为什么不修「不落缓存」**：把这份渲染标成不可缓存需要 `await connection()`，而本路由
**按需生成时调用它直接抛 `DYNAMIC_SERVER_USAGE` → HTTP 500**（2026-10-23 实测，无 origin 产物
+ 中枢不可达）。这与「缺 `NAVHUB_SITE_URL` 时读 `headers()`」是同一个失败形态，比坏快照更糟。

**做法**：`generateMetadata` 的 `probe.status === 'failed'` 分支输出 `robots: 'noindex, follow'`，
即「这份快照不可信，但仍顺着内链走」；一个 revalidate 周期后正常快照覆盖、标记自动消失。

**复核**：

```bash
# 用例钉住两件事：failed 分支必须有 noindex；源码里不许再出现 connection()
node node_modules/vitest/vitest.mjs run apps/web/test/degrade.test.ts
```

---

## 裁决 3：`revalidate=false` 的收录页只允许一种缺配置形态 —— 不出图

**现象（实测）**：缺 `NAVHUB_SITE_URL` 时 Next 用 `http://localhost:3000` 兜底解析 `og:image`。
带 `revalidate` 的路由一个周期自愈，`initialRevalidateSeconds: false` 的是**永久快照**，
只能等下次构建。

**做法**：`pageShareMetadata` 里 og/twitter 的图收在 `configuredSiteOrigin()` 之后（缺配置就
**不出图**，而不是出一张指向别人机器的图）；`/algorithms` 补了 `revalidate = 3600`。
两侧各有一条取证：构建产物（`checkPermanentSnapshots`，读 `server/app/*.html`）与线上响应
（`--live` 读响应体、用 `scripts/lib/seo-audit.mjs` 的端口感知判定）。
