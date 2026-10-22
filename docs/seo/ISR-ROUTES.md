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
「旧形态必须 30x 到路径段」之后，会**跟着跳转链走到底（最多 3 跳）**，在最后那个 200 页上
断言 canonical 存在且不带 query（`跳转页 canonical` 那一行）。前提一旦破（canonical 把
query 吃回去，或缺失），门禁立刻红灯 —— 那时带参 URL 才真的是一条重复页。

落地页不是 200 时**不断言**（打 `–` 行）：`/category/ai-tools?page=2` → `/p/2?page=2` → 硬 404
（2026-10-23 用新 seed 库实测），404 本身就是「这一页不存在、不可收录」的裁决，没有重复页
可谈；在 404 或 308 的响应体里找 canonical 只会造出一条假红灯 —— CI 首个 run 正是这样红的。

**复核**：

```bash
node scripts/check-isr-routes.mjs --live --base=http://localhost:3000 --sample=2 --min-checked=8
# 假站回归（含「canonical 带 query 就红灯」「落地页 404 不断言」两条用例）：
node node_modules/vitest/vitest.mjs run scripts/check-isr-routes.test.ts
```

---

## 裁决 1b：种子数据不足一页时，分页样本的 308 回基底是正确形态

**现象（实测，2026-10-23，新 migrate + 新 seed 库）**：站点目录每页 60 个，种子只有 57 个
活跃站点 ⇒ `totalPages = 1`。于是 `--live` 为分页族造的样本 `/sites/p/2` 不是 200 也不是 404，
而是页面自己的归一裁决：

```
GET /sites/p/2
→ 308  Location: /sites   （cache-control: s-maxage=60，x-nextjs-cache: HIT）
```

**为什么判为正确**：`apps/web-overlay/src/app/sites/p/[n]/page.tsx` 用
`sitesNormalizedPage(requested, totalPages)` 把越界页码送回归一后的页，这正是「不给不存在的
分页留一个 200 软 404」的设计。CI 自建预览的库永远是小库，所以这条在 CI 里必然出现。

**做法**：`--live` 的分页族样本额外接受「30x 且落点等于本条样本去掉 `/p/{n}` 的族基底」，
输出行写成 `308 → /sites`；其余 3xx（落点不是族基底）仍判失败。s-maxage 检查照旧 ——
连这条归一都得走 ISR 缓存，退化成每次现渲照样红灯。

**复核**：

```bash
node node_modules/vitest/vitest.mjs run scripts/check-isr-routes.test.ts
# 用例：分页样本 308 回归一后的族基底时判为正确（种子数据不足一页）
```

顺带记录一条只在冷生成时出现过的观察：`/sites/p/1` 的第一次生成发过**两条**
`location: /sites`（`Headers.get()` 合并成 `/sites, /sites`，喂给 `new URL()` 得到
`/sites,%20/sites` → 404）。删掉 `server/route-cache` 重新生成后只剩一条，同一份产物
没能复现第二次，因此不判失败，只在 `redirectTarget()` 里取第一个片段、不让门禁自己被
一个不存在的 URL 带跑（有用例钉住）。若哪天能在产物里稳定复现双写，那才是产品缺陷。

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
