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

**2026-10-23 补：双写复现了，但结论不变。** 在 CI 同构复现里清掉 `route-cache` 冷启动后：

```
curl -D - http://localhost:3079/category/ai-tools/p/1   → location: /category/ai-tools ×2
curl -D - http://localhost:3079/sites/p/1               → location: /sites ×1
（同一进程再请求一轮，两条路径都只剩 ×1）
```

即双写出现在**过期快照的后台再生成窗口**（`s-maxage=60` 而 `x-nextjs-stale-time: 300`），
不是某个路由的固有行为。要害在于两处值**完全相同**：真实客户端读单行 `Location`
（curl `-L` 实测 `final=/sites code=200`），拿到哪一条都一样。那个 404 从头到尾是
Node `Headers.get()` 把同名头用 `, ` 拼接的门禁侧假象。所以维持原判：不改产品，
门禁继续只取第一个片段。

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
**（2026-10-23 更正：最后这半句只在取数不持续失败时成立 —— 见 5.9。抓取式全量扫描下
`failed` 会反复重演，壳页集合每轮大幅轮换，坏快照并不会自己收敛掉。）**
**（同日 5.10：`failed` 的常态来源不是中枢挂了，是我方 SSR 取数撞上自家按 IP 限流拿到 429。
触发面消掉了，所以盖章方案保留下来只对真故障生效 —— 别把它当成「壳已修好」的证据。）**

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

---

## 裁决 4：CI 自建预览（`check-isr-live`）有两个必须成立的前提，否则红在无关处

门禁本身连红两次才把这两条逼出来 —— 每次都是「预览站根本没跑起来/没喂好」，
而不是收录形态有问题。两条都只在 CI 的作业形状里出现，本地手工复现很容易绕过。

**前提 A：`next start` 必须以 `apps/web` 为工作目录。**
在仓库根执行 `node apps/web/node_modules/next/dist/bin/next start` 会打印
`The module 'react' was not found`，然后起来一个**没有任何路由的空应用**：
`curl -sf /sitemap.xml` 一直非 2xx，就绪探测等满 120s 才红灯（2026-10-23 实测：
同一条命令在根目录拿不到 sitemap，`cd apps/web` 后立刻 137 条 `<loc>`、57 条 `/site/`）。
作业里写成 `working-directory: apps/web`。

**前提 B：中枢必须在 `next build` 之前起来（并额外 purge 一次快照）。**
`/sitemap.xml` 在产物里是 `compute: "static"` + `initialRevalidateSeconds: 300`
（读 `prerender-manifest.json` 的 `routes["/sitemap.xml"]`）。构建期没有中枢，烤出来的
就是**只有 9 条纯静态条目的快照**（`/site/*` 为 0），而 `next start` 会把它当
`x-nextjs-cache: HIT` 连续供满 300s —— 就绪探测只等 120s，永远等不到中枢喂进来的条目。

```bash
# 实测：清掉 route-cache、保持构建快照不动，冷启动第一次请求就是旧快照
rm -rf apps/web/.next-isrlive/server/route-cache
# → locs=9  site=0  x-nextjs-cache: HIT
# 再把 server/app/sitemap.xml.{body,meta} 一起删掉，同一份产物
# → locs=137 site=57（走真·运行时渲染，读活着的中枢）
```

所以作业顺序改成 `migrate → seed → 密钥 → 起中枢 → build → purge 快照 → next start → 抽查`：
构建期就有真数据（贴近真实部署），purge 只是补一道保险，让抽查测到的确实是运行时渲染
而不是构建产物。**删的只是 `.body`/`.meta` 这一对文件** —— `server/app/sitemap.xml/` 是
同名**目录**（里面是 `route.js`），删掉等于把路由删了。

**复核**：

```bash
node -e "const y=require('js-yaml'),f=require('fs');const d=y.load(f.readFileSync('.github/workflows/ci.yml','utf8'));
d.jobs['check-isr-live'].steps.forEach((s,i)=>console.log(i,s.name||s.run&&s.run.split('\n')[0],'cwd='+(s['working-directory']||'.')))"
```

## 裁决 5：抽查绿灯不等于收录面完好 —— `--live` 补三层（标签族 / 技术面契约 / sitemap 下限）

三层都源于同一个观察：`--live` 原来只判「sitemap 里抽到的页形态对不对」，
而**门禁跑不到的东西它一句话也不说**。2026-10-23 在 CI 同构预览（一次性 seed 库 +
`next start` 产物，`--sample=2`）实测：138 条 `<loc>`（站点 57 / 分类 1 / 标签 1 /
合集 6 / 插件 64 / 目录 1），抽到 12 页，lastmod 覆盖 128/138=93%。

**5.1 标签族必须有样本，否则是一族永久「跳过」。**
`MIN_SITES_FOR_TAG_INDEX=10`（`apps/web-overlay/src/lib/seo/thresholds.ts`），而种子库里
最大的标签只挂 5 个站点 —— `/tags/{slug}` 进不了 sitemap，门禁那一族每轮都打「跳过」，
既不绿也不红，没人看着。裁决：CI 用 `scripts/seed-isr-fixtures.mjs` 往**一次性预览库**
补一个挂 15 个站点的标签（`slug=gate-selfcheck`）。该脚本硬要求 `NAVHUB_ISR_FIXTURE_DB=1`，
不满足就退出码 2 —— 为的是不许误写真实库（它只 INSERT，不删不改已有行）。

**5.2 200 页默认过一遍技术面契约。**
复用 `scripts/lib/seo-audit.mjs` 的 `analyzeHtml` + `auditPageDetailed`，判据是爬虫
真正拿到的那份响应体：`title`、`meta description`、`canonical`、OG（`og:type` /
`og:site_name` / `og:locale` / `og:url` / `og:image`）、`robots`、JSON-LD。
本地 seo-audit 判的是「跑起来之后」的同一件事的另一种视角，产物门禁判的是构建目录里的
HTML —— 三处各管一段，缺一处就有中间地带。`links`（内链闭环）默认**不**进 --live：
它需要多页一起看，单页抽查会造出假红灯；要快跑用 `--no-contract` 出口。
分页族（`/…/p/N`）按设计是 `noindex` 且不带 JSON-LD，所以可索引性按页判定
（`expectIndexable = !paged`），只对可索引页要求 og/JSON-LD —— 否则门禁永久红在无关处。

**5.3 sitemap 自己进门禁：族下限 + lastmod 覆盖率。**
`--sitemap-min-site|category|tag|collection|plugin|directory` 与
`--sitemap-min-lastmod-ratio`。为什么单独一层：中枢失联时 sitemap 退化成 9 条纯静态条目，
`/site/*` 归零，但抽到的那几页形态全对 —— 只有族下限会把这件事说破。站点详情归零时
红灯文案里直接写明「只剩静态条目 = 中枢失联的降级形态」。lastmod 丢失会让搜索引擎
重估抓取优先级、改动也看不出新鲜度，所以按覆盖率（比例）判而不是按绝对条数。

下限数字全部来自上面那份实测并留余量（CI 里 `--min-checked=10`、`sitemap-min-site=20`、
`sitemap-min-plugin=10`、`lastmod-ratio=0.8`）；单一种子数据变薄可容忍，
整条链路失联必须红。

**5.4 sitemap 的集合级检查：不可收录形态不该出现在收录清单里。**
5.3 数的是「该有的族有没有」，这一层数的是「不该有的条目在不在」：`/…/p/{n}` 分页页与
任何带 query 的 `<loc>`。理由不是风格 —— 分页页自己声明 `noindex`，把它递进 sitemap 就是
主动请爬虫收录一份重复内容；带 query 的 `<loc>` 还会和裁决 3 的前提（落地页 canonical
必须干净）直接打架。这一层不看抽样，整份 sitemap 一次性判。
不会假红有两层依据：① 生成侧的 URL 模板全是纯路径 —— `sitemap-entries.ts` 里
`staticEntries` / `siteEntries` / `tagEntries` / `categoryEntries` / `collectionEntries`
和 `plugins/sitemap.ts` 的插件、作者条目，所有 `url:` 拼接都不带 `?`，也没有 `/p/`；
② 实测大库代理口径 1126 条里 0 条（CI 种子那一轮由门禁自己把数字打在日志里）。
用例：`scripts/check-isr-routes.test.ts` 的「不可收录形态…就红灯」与
「sitemap 只有归一后的路径段形态时不误红」—— 前者用 `extraLocs` 往假 sitemap 里塞
`/category/ai-tools/p/2` 与 `/sites?page=2`，后者证明归一版本不触发。

**5.5 契约层必须拿真实渲染的页面做变异自证。**
`check-isr-routes.test.ts` 里其余用例喂的是手写 HTML，只能证明「我预期它会红的形态」真的红。
判定链（`analyzeHtml` → `auditPageDetailed`）全靠正则，一旦和 Next 真实输出的结构错位
（属性换序、`ld+json` 落到 body、og:image 变成多组尺寸变体），契约层就退化成**静默绿** ——
比红灯更坏的失败。语料在 `scripts/fixtures/isr-live-corpus/`（6 个族、每个约 3–10 KB，
只有 head 区块 + `ld+json` + 首个 H1，正文不进仓库：正文随库里数据漂移，会把基线变成噪音），
由 `scripts/capture-isr-corpus.mjs` 对着跑起来的站点生成 —— 每个族从 `/sitemap.xml`
取第一条真实 URL，所以换库也能重跑，不硬编码站点 uuid；响应里的 origin 字面量统一改写成
`https://navhub.example`，否则先撞在「本机地址兜底」那条判定上，测不到契约本身。
每个文件断言两件事：未变异必须 0 问题（基线）、六类变异（剥掉 title / description /
canonical / og:image / 全部 `ld+json` / 注入 `noindex`）逐个必须被抓到并归对类。
变异还额外断言 `mutated.length !== html.length`：正则失配时 HTML 原样通过，
用「根本没改坏」来满足「坏页面被抓到」，是和静默绿同一类的假绿灯。

**5.6 三层带到生产口径（`seo-audit-prod` 的 ISR 步骤）。**
2026-10-23 用本地 996 站点库 + 同一份产物做代理实测：sitemap 1126 条
（站点 996 / 分类 36 / 标签 16 / 合集 4 / 插件 65 / 目录 1），lastmod 覆盖 1101/1126=98%，
不可收录形态 0 条，抽到的 14 页契约全绿。生产阈值取实测的 1/5～1/3
（`site=200 category=10 tag=5 collection=2 plugin=20 directory=1 lastmod-ratio=0.9`，
`--min-checked=8`），既不会因正常增删抖动红，也能在某族整条链路失联时立刻红。
两点差别要写清楚：① 生产有 16 个达标标签，不需要 5.1 那个门禁自检夹具；
② **s-maxage 那一层已经在 prod 口径下实证过了**（同日第二轮）：本地
`next build`（`NEXT_DIST_DIR=.next-prod-preview`）+ `next start -p 3079`（cwd 必须是
`apps/web`）起 996 站点库，运行时注入 `NAVHUB_SITE_URL`，`seo-audit-prod` 那一整条命令行
**rc=0**，14/14 页都带 `s-maxage=60, stale-while-revalidate=31535940`，契约与 sitemap 两层
同时全绿。早前那轮 `next dev` 代理里 14 项「没有 s-maxage」全红是 dev 无静态生成的预期红，
已被这一轮取代。**还没被覆盖的只剩一跳**：真实生产 CDN/反代会不会改写或吞掉
`cache-control` —— 首次 dispatch 若红在那儿，是真问题，不是门禁 bug。
另两个缺口也照实记：这次跑的是 `localhost:3079`，不是真域名；`AUTH_SECRET` 必须显式给
（生产守卫拒绝用仓库内开发回退密钥启动，`next start` 会直接 500 在 middleware）。

**5.7 抽查样本按 key 轮换：`--live --rotate[=KEY]`。**
固定取样的覆盖率是假的。`--sample=2` 时站点详情族永远取 sitemap 里前 2 个页，
996 个真实收录页里 994 个的技术面契约退化**没有任何一轮 CI 看得见** ——
门禁看起来在跑，实际是一盏只照两平方米的灯。轮换把起点按 `hash(key)+hash(族前缀)`
挪到排序后全集的任意位置、环形取 N 个，CI 与生产 dispatch 都传 `--rotate="$GITHUB_SHA"`。
三条判据（都有用例）：① **同 key 必须同结果** —— 用 FNV-1a 32 位散列，不用
`Math.random` 也不用时间戳，否则一次网络抖动会被读成「门禁时好时坏」，重跑与跨 job
比对也失去意义（实测同一 key 两次，14 页输出的 md5 一致）；② **与 sitemap 产出顺序解耦** ——
轮换在**排序后**的池子上取，sitemap 条目顺序一变（加一族、换排序字段）样本不会跟着整体漂移，
「这一轮扫了哪些页」只由 key 决定；③ **不带 `--rotate` 时逐字保持旧行为**（族内前 N 个、
不排序），既有 42 条用例与 CI 绿基线的前提是这个默认档没被动过。
坑（就是这一条差点变成假绿）：脚本的 `flags` 集合只收**不带 `=` 的裸 flag**，
第一版用 `flags.has('--rotate')` 判启用，于是 `--rotate=KEY` 完全走不到取样里 ——
三个不同 key 抽到**完全相同**的 14 页、照样 rc=0。纯函数测试抓不到它（函数本身是对的），
必须有用例穿过命令行那一层，所以现在「同 key 可复现 + 跨 key 覆盖更宽」是集成用例。
覆盖率实测（996 站点库，`--sample=2`，12 个 key 一轮）：168 次页面检查 → 86 个不同的页，
其中站点详情族 17/996；换算下来约 500 轮 CI 扫遍全族。这不等于全覆盖，
它等于「退化不再注定看不见」，全量口径仍归 `scripts/seo-audit.mjs` 对着整份 sitemap 跑。
分页样本挂哪个母页也一起轮换：`/…/p/2` 那条支路（按需生成最容易 500）以前永远只在
第一个分类页上验证。

**5.8 语料基线过期必须可判定：`capture-isr-corpus.mjs --check`。**
5.5 的变异自证有个没人管的失效模式：**渲染 head 的代码改了，语料没跟着改**。
旧语料照样让六类变异逐个红、基线照样 0 问题，于是「契约层在真实页面上成立」这句话
悄悄变成对一份历史快照成立 —— 静默绿换了个入口回来。`--check` 只读不写文件，
对每个族现抓一遍并和仓库语料比两件事：**结构签名**（title/description/canonical 的数量、
`<html lang>`、og 属性名集合、`ld+json` 区块数与其中 `@type` 的集合、H1 数、robots 标签原文）
和**契约裁决**（两边都喂门禁同一个 `contractFindings`，比较发现项集合）。
签名刻意不看字节数与正文文字：库里换个站点、标题多一个字都会红，那种红不是过期。
两边都按 `https://navhub.example` 判 canonical —— 现抓的那份同样经过 origin 改写，
拿 `--base` 去判会永远红在「域名不同」这个无关处（第一版就是这么常年 6 族全红）。
判据本身也要自证：`scripts/check-isr-routes.test.ts` 的「--check 的漂移判据」对
9 类过期形态（含「只换 JSON-LD 类型不换数量」这种签名级退化）逐个断言
`shapeDiff` 非空且归对字段，另断言未变异时 diff 为空 —— 不然这条和静默绿没区别。
CI 里这一条**只提示不阻断**（`::warning::`，红族名单进 annotation）：CI 种子库 57 个站点，
「按内容量才出」的模块本就和 996 站点库的快照不同，那是数据形态差异不是代码退化。
实测（996 库 prod 口径）：6/6 族一致 rc=0；把 site-detail 的一块 `ld+json` 删掉、
把 category 的 `<title>` 删掉、给 directory 挂个 `noindex`，rc=1 且逐条指到字段。
配套改造：`capture-isr-corpus.mjs` 尾部加了「被直接执行才 exit」的 realpath 守卫并导出
`shape`/`shapeDiff` —— 脚本原先在模块末尾无条件 `process.exit()`，被测试 import 时
会连带整个 vitest worker 消失，表现是「0 tests」的假绿。

**5.9 生产口径全量实测：收录面的真问题是自家限流把降级壳写进了缓存。**
2026-10-23 对着本地 996 站点库 + prod 产物（`next start -p 3079`）把 `seo-audit-prod` 的
三条命令跑全：① ISR 三层 rc=0（5.6 已记，14 页 `s-maxage=60` 实测）；② `seo-audit.mjs --all`
全量 1126 页 rc=1；③ `link-graph.mjs --check` rc=0（阈值全过，12 个随机 slug 探测 0 个 200）。
第二轮的退出码我当场读错了（`echo` 打断了 `PIPESTATUS`），按判据 `issues.length > 0` 应为 1，
不影响结论。

全量这一轮把结构性的事说清楚了：**canonical 0 / og:image 缺失 0 / JSON-LD 无效 0 / 取数失败 0**
（三轮独立跑都是 0，1126/1126 页都拿到 200），红的全是同一件事 —— `<h1>` 缺失的集合**包含**
「出现在 sitemap 却声明 `noindex, follow`」的集合：456（第一轮）/ 704（第二轮）/ 532（第三轮），
`internalLinkMissing`（459/717/538）与那个「站点详情 - NavHub 导航」被 456 页共享的标题重复组，
都是同一批页的连带症状。

集合**不是固定的**：第一轮那 456 个壳页到第三轮只剩 274 个还是壳（182 个恢复、258 个新坏）。
这条同时更正我自己前一轮的判断：当时按单轮取样写下「27 个 `/marketplace/*` 页稳定缺 `<h1>`」，
暖化后逐个复查（含 `/marketplace/travel-mobility`）是 `h1=1` —— 那 27 个与降级壳同源，
**不是模板缺口**，是同一批冷生成快照。

机制是实测出来的，不是推测：`/site/[id]` 渲染期直连中枢取数
（`hubGetProbe('/api/sites/{id}', 60)`），三分法只有中枢**确认 404** 才 `notFound()`，
其它非 2xx 一律算 `failed` 走降级壳 + `noindex, follow`（裁决 2 选的盖章方案）。
而中枢注册了**全局按 IP 的 300 req/min**（`apps/api/src/server.ts:146`），web 侧所有 SSR
取数在部署拓扑上是同一个出口 IP。抓取式扫 1126 页 ≈ 90 秒 ≈ 每分钟 750+ 次取数，
是额度的 2.5 倍。直接复现：取 60 个刚被判壳的 id，以 8 路并发把同一批重放 8 遍
（480 请求）→ **185 个 429、0 超时、0 连接错误、总耗时 1.0 秒**。
所以快照坏掉不是中枢挂了，是我方取数被自家限流挡住了 —— 而**这份降级壳是会被 ISR 缓存的那一份**：
爬虫在 60s 窗口里抓到的可能就是 `noindex, follow` 的骨架，配合
`stale-while-revalidate=31535940`，这份壳在 CDN 上理论上能活一年。1126 页的站，
任一次全站抓取里有 40%～63% 的页处在这个形态。
CI 里这条永远看不见：预览作业是 57 站点种子 + 14 页抽查，取数量级 10¹，碰不到 300/min；
只有 prod 口径全量跑才显形。

与 5.7 轮换的相互作用（新的门禁抖动，要会读）：`--rotate` 让每轮抽不同页，抽到当下是壳的页
就红三项（`<h1>` 0 / noindex / 无 `ld+json`）。实测同一个 key `bravo` 先后两轮
分别是 rc=1 和 rc=0 —— **取样是确定的，页面当下形态不是**。这不是轮换的 bug，
但它意味着生产 dispatch 的红必须分两类读：契约退化 vs 上游限流抖动，门禁本身不区分，
所以 dispatch 红了要先重跑一次才能定性。
顺带记下契约的一个盲区：壳页那个通用标题「站点详情 - NavHub 导航」在契约里判绿 ——
契约只查 title 有没有、长度够不够，不查它是否与本页站点名一致；
456 页共享同一标题这件事只有 `seo-audit` 的 `titleDuplicateGroups` 看得见。

仍未验证的两跳：真实域名的 dispatch，和 CDN/反代对 `cache-control` 的改写；
再加一条同族的未验证项 —— `trust proxy` 不配时限流会整站共享一桶（`server.ts:100` 自己写了这个前提）。

**复核**：

```bash
# CI 同构预览（本机 scratch 库 + 独立端口，不碰 data/navhub.db）
node scripts/check-isr-routes.mjs --live --base=http://localhost:3079 --sample=2 \
  --min-checked=10 --rotate=2026-10-23 \
  --sitemap-min-site=20 --sitemap-min-category=1 --sitemap-min-tag=1 \
  --sitemap-min-collection=1 --sitemap-min-plugin=10 --sitemap-min-directory=1 \
  --sitemap-min-lastmod-ratio=0.8
# 用例（夹具页自带齐契约；stripContract / barePaged / lastmod / extraLocs 四个开关分别造红灯）
node node_modules/vitest/vitest.mjs run scripts/check-isr-routes.test.ts
# 刷新真实语料（对着任意跑起来的站点，dev 或 next start 都行）
node scripts/capture-isr-corpus.mjs --base=http://localhost:3000
# 语料是否过期（只读；rc=1 = 变异自证正拿旧形状当基准）
node scripts/capture-isr-corpus.mjs --base=http://localhost:3079 --check
# 轮换覆盖：同一 key 两次必须同一批页，不同 key 必须换页
for k in alpha bravo charlie; do
  node scripts/check-isr-routes.mjs --live --base=http://localhost:3079 --sample=2 \
    --min-checked=1 --no-contract --rotate=$k | grep -E '^✓ ISR' | md5sum
done
# 生产阈值（prod 口径，不是 dev）：先构建，再以 apps/web 为 cwd 起 next start
(cd apps/web && NEXT_DIST_DIR=.next-prod-preview NAVHUB_SITE_URL=http://localhost:3079 \
  NAVHUB_API_URL=http://localhost:8787 node node_modules/next/dist/bin/next build)
# 注意：生产守卫要求显式 AUTH_SECRET（>=32 字符），否则 next start 会 500 在 middleware。
(cd apps/web && NEXT_DIST_DIR=.next-prod-preview NAVHUB_SITE_URL=http://localhost:3079 \
  NAVHUB_API_URL=http://localhost:8787 AUTH_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))') \
  node node_modules/next/dist/bin/next start -p 3079)
node scripts/check-isr-routes.mjs --live --base=http://localhost:3079 --sample=2 --min-checked=8 \
  --rotate=2026-10-23 \
  --sitemap-min-site=200 --sitemap-min-category=10 --sitemap-min-tag=5 \
  --sitemap-min-collection=2 --sitemap-min-plugin=20 --sitemap-min-directory=1 \
  --sitemap-min-lastmod-ratio=0.9
# 5.9 的降级壳轮换：全量审计连跑两轮，比较两轮 noindex 集合的交集/新增/恢复
node scripts/seo-audit.mjs --base=http://localhost:3079 --all --json > .tmp-a1.json
node scripts/seo-audit.mjs --base=http://localhost:3079 --all --json > .tmp-a2.json
node -e 'const s=(f)=>new Set(JSON.parse(require("fs").readFileSync(f,"utf8")).issues
  .filter(i=>String(i.message).startsWith("出现在 sitemap 却声明 noindex")).map(i=>i.scope));
  const a=s(".tmp-a1.json"),b=s(".tmp-a2.json");
  console.log({run1:a.size,run2:b.size,仍是壳:[...a].filter(u=>b.has(u)).length,
  恢复:a.size-[...a].filter(u=>b.has(u)).length,新坏:[...b].filter(u=>!a.has(u)).length})'
# 429 复现（把刚被判壳的 id 以 8 路并发重放）
node -e 'const j=JSON.parse(require("fs").readFileSync(".tmp-a1.json","utf8"));
  const ids=[...new Set(j.issues.filter(i=>String(i.message).startsWith("出现在 sitemap 却声明 noindex"))
    .map(i=>new URL(i.scope).pathname.split("/").pop()))].slice(0,60);
  (async()=>{let ok=0,n429=0,paths=[];for(let r=0;r<8;r++)paths.push(...ids);
   for(let i=0;i<paths.length;i+=8)await Promise.all(paths.slice(i,i+8).map(async id=>{
    const res=await fetch("http://localhost:8787/api/sites/"+id);res.status===429?n429++:ok++;}));
   console.log({requests:paths.length,ok,n429})})()'
```

**5.10 修复这条链：SSR 取数带共享凭据走限流豁免，收录面 A/B 实测 414 个壳 → 0。**

路线选择先说清楚：裁决 2 已经证伪「`failed` 不落缓存」（`connection()` → 500），所以剩下的口子
只有「让 SSR 取数不吃用户侧额度」这一条。做法是三处，缺一不可：

1. `apps/api/src/internal-traffic.ts` —— `isInternalTraffic(headerValue, configuredToken)`：
   **未配置 `NAVHUB_INTERNAL_TOKEN` 时恒为 false**（零豁免，与修复前逐字一致）；数组头取第一个；
   先比长度再 `timingSafeEqual`（长度不等时该函数会抛，抛错被上层吞掉就是「放行」）。
2. `apps/api/src/server.ts` 注册全局限流时挂 `allowList`。选型理由记一下：
   `@fastify/rate-limit@10.3.0` **没有 `skipFn`**（类型里只有 `keyGenerator`），能表达「豁免」的
   只有 `allowList`（`index.js:225-233`）；而路由级 `config.rateLimit` 是 `mergeParams` 覆写全局参数，
   所以全局 `allowList` 对带 per-route `max` 的路由依然生效 —— 不需要逐路由改。
3. `apps/web-overlay/src/lib/server/hub.ts` —— 只有这条服务端取数路径附带
   `x-navhub-internal-token`。**浏览器侧的 `/api/hub/*` 代理不许带**（否则全站访客流量整体被标成
   内部流量，按 IP 限流形同虚设）；这条边界由 `apps/web/test/hub-internal-token.test.ts` 里的
   源码级断言钉住，不是靠口头约定。

为什么不用「内网 IP 段」当判据：`NAVHUB_TRUST_PROXY=1` 采信 XFF 最左值（那是客户端自报的），
自报 `X-Forwarded-For: 127.0.0.1` 就能白拿无限额度。凭据没有这个口子。
凭据也不落日志：pino 的 redact 路径里加了 `req.headers['x-navhub-internal-token']`，
实测带凭据请求打完之后 api 日志里该 token 出现 **0 次**。
额度上限顺带显式化成 `NAVHUB_RATE_LIMIT_MAX`（默认 300，test 模式 10000），它是给压测和口径复现用的，
**不是豁免的替代品**。

部署前提（这条必须写在明面上，否则等于没修）：`NAVHUB_INTERNAL_TOKEN` 要在 **api 与 web 两侧同值**；
只配一侧等于没配（`apps/api/test/compose-env-parity.test.ts` 钉住三个服务的透传写法）；
prod 下配置值短于 32 字符直接启动失败（`assertSecurityConstraints` 2b）；
两侧都不设时行为与修复前逐字一致 —— **线上收录面仍然是 5.9 的形态，直到部署方把这个 env 配上**。

单元级前后对照（scratch 中枢，同一个 1 分钟窗口内连打三发 480 请求 @8 并发）：

| 请求形态 | ok | 429 |
| --- | --- | --- |
| 不带凭据（窗口起点） | 300 | 180 |
| 带 `x-navhub-internal-token` | 480 | 0 |
| 再打一发不带凭据 | 0 | 480 |

第三行是这组数据的要点：豁免那一发打完之后公共桶**确实已经被抽干**，不是运气好错开了时窗。

收录面 A/B（prod 口径：同一个 `.next-prod-preview` 产物、同一个 1020 站点库的在线快照、
同一个中枢进程，唯一变量是 web 侧有没有带凭据；库快照用 `better-sqlite3` 的 `backup()`，
不碰常驻中枢正在写的 `data/navhub.db`）：

| | A：不带凭据（修复前形态） | B：带凭据（修复后形态） |
| --- | --- | --- |
| 页数 | 1126 | 1126 |
| `robotsIssues`（在 sitemap 里却 `noindex`） | 414 | **0** |
| `pagesWithIssues` | 418 | 9 |
| `internalLinkMissing` | 418 | 9 |
| `titleDuplicateGroups` | 1（414 页共享「站点详情 - NavHub 导航」） | 4 |
| `descriptionTooShort` | 454 | 40 |
| 耗时 | 136s | 104s |

A 的壳集合与 B 的壳集合交集为 0（B 为空）。A 组这一发的 414 与 5.9 的 456/704/532 是同一量级 ——
壳集合本来就每轮随限流窗口轮换，**别把绝对数当基线，要看的是「A 有 B 无」这个形状**。
B 剩下的 9 项**不是壳**：都是
`站点详情缺少相关 /site/ 站内链接`，那些页有真实 title 与 `<h1>`，是相关推荐为空的内容面问题，
本轮（只看技术面）不动。这组对照也印证了 5.9 的判断：414 个壳贡献了「描述过短」里的绝大部分，
以及那一个 414 页共享的标题重复组。

**复测前必须先清的缓存（新坑，能把「复测」变成自欺）**：ISR 快照落盘在
`<distDir>/server/route-cache/APP_PAGE/**`，**清 `<distDir>/cache` 不够、重启 `next start` 也不够**。
本轮第一次复测就是被这个骗过去的：首个请求直接 `x-nextjs-cache: STALE`，拿到的还是上一轮的壳。
A/B 的正确前置是 `rm -rf <distDir>/cache <distDir>/server/route-cache`，并且验证首个请求是 `MISS`。
这条同时给 5.9 的观察补个解释：所谓「壳会自愈」是第二次请求触发的后台重生成，
而爬虫通常只看第一眼，且 `stale-while-revalidate=31535940` 会让中间层把第一眼供下去很久。

**复核**：

```bash
# 限流豁免（含真 429 对照）、compose 透传、web 侧带头与代理边界
node node_modules/vitest/vitest.mjs run apps/api/test/internal-rate-limit.test.ts \
  apps/api/test/compose-env-parity.test.ts apps/web/test/hub-internal-token.test.ts
# 单元级三发对照：scratch 中枢配上 token 后，对 /api/sites 各打 480 请求 @8 并发
#   顺序必须是 不带 → 带 → 不带，第三发才是「桶确实空着而豁免仍通」的证明
# 收录面 A/B：同一产物、同一库快照，唯一变量是 web 进程的 NAVHUB_INTERNAL_TOKEN
cd apps/web && rm -rf .next-prod-preview/cache .next-prod-preview/server/route-cache
NEXT_DIST_DIR=.next-prod-preview NAVHUB_SITE_URL=http://localhost:3079 \
  NAVHUB_STORAGE_BASE_URL=http://127.0.0.1:8792 AUTH_SECRET=$S \
  node node_modules/next/dist/bin/next start -p 3079   # B 组再加 NAVHUB_INTERNAL_TOKEN=$T
node scripts/seo-audit.mjs --base=http://localhost:3079 --all --json | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  console.log(JSON.stringify(JSON.parse(s).summary))})'
```

变异自证（非空性）：把 `server.ts` 里的 `ctx.config.internalToken` 换成 `null`、
把 `hub.ts` 里的 `INTERNAL_TOKEN` 常量换成 `''`，两处回退合计恰好 3 条用例变红
（豁免集成用例 1 条 + web 带头用例 2 条），恢复后本组 20 条全绿。
全仓 `vitest run` 在清场单跑时是 302 files / 3114 tests 全绿；**与 `next build` + 1126 页审计并发
跑的那一次出过 1 条时序红灯**，重跑即绿 —— 这类红要先看当时有没有并行负载，别记成契约退化。
另：上面 A/B 用 `better-sqlite3` 的 `db.backup()` 在线取库快照，不去动常驻中枢正在写的
`data/navhub.db`；常驻中枢本身没被这条链碰过。

环境坑（会伪装成门禁 bug）：这台机器上编辑工具会把 `scripts/*.mjs` 写成 **CRLF**，
而仓库 blob 是 LF（`core.autocrlf=true`）。Node 自己能解析 CRLF 的那份文件，
`node --check` 也过，但 **vitest 的 SSR transform 会失败**，症状是
`SyntaxError: Invalid or unexpected token` + 「0 tests」，不带任何行号 ——
看起来像门禁坏了，其实是行尾。判别：`git diff --stat` 只有几十行、却整片用例不收集，
就把文件按 LF 重写一遍再跑（`node -e` 一行 `replace(/\r\n/g,'\n')` 即可）。
