# 生产缺陷：route handler 响应完全没有压缩（Next 16.4.5 上游 bug）

> 作者：山羊胡网总管 ｜ 发现时间：2026-11-28 18:0x ｜ 性质：**已在生产环境生效的通用缺陷**
> 影响：所有 `app/api/**` route handler 返回的 JSON、以及 `/sitemap.xml` `/feed.xml`，**全部以未压缩明文传输**

## 1. 一句话结论

本地 3005 生产构建实测：**24,164,621 B（23.05 MB）本应压缩的响应，实际一个字节都没压**。
压缩后应约 **3,914,498 B（3.73 MB）**，可省 **20,250,123 B（19.3 MB，-83.8%）**。

## 2. 实测证据（2026-11-28 18:0x，3005 —— 注意：3005 实际是 `next dev`，见第 10 节的生产 start 验证）

```
status  enc    wire       raw        type                       path
200    gzip      641387    3083137     text/html                  /                        ← 页面正常压缩
200    gzip       23778     285869     text/html                  /videos/player           ← 页面正常压缩
200    NONE     1017809    1017809     application/xml            /sitemap.xml             ← 未压缩
200    NONE       26950      26950     application/rss+xml        /feed.xml                ← 未压缩
200    NONE      929019     929019     application/json           /api/videos?view=index   ← 未压缩
200    NONE    10836616   10836616     application/json           /api/videos?compact=1   ← 未压缩
200    NONE     1556627    1556627     application/json           /api/videos?summary=1    ← 未压缩
200    NONE      124827     124827     application/json           /api/navigation/category/reg-ai-tools  ← 未压缩
200    NONE       41731      41731     application/json           /api/hub/search?q=python ← 未压缩
200    NONE     9631042    9631042     application/json           /api/videos              ← 未压缩
200    gzip      163030     216342     application/json           /drama-media.json        ← 静态 JSON 正常（走静态文件路径）
```

逐条压缩收益（gzip -6 / brotli q5）：

```
/api/videos                    wire=  9631042  gzip6= 1393507  br5= 1124150  省 85.5%
/api/videos?compact=1          wire= 10836616  gzip6= 1699064  br5= 1398331  省 84.3%
/api/videos?summary=1          wire=  1556627  gzip6=  353667  br5=  289688  省 77.3%
/api/videos?view=index         wire=   929019  gzip6=  291718  br5=  253043  省 68.6%
/api/navigation/category/..    wire=   124827  gzip6=   36330  br5=   32392  省 70.9%
/api/hub/search?q=python       wire=    41731  gzip6=    5082  br5=    4457  省 87.8%
/sitemap.xml                   wire=  1017809  gzip6=  128973  br5=  126512  省 87.3%
/feed.xml                      wire=    26950  gzip6=    6157  br5=    5343  省 77.2%
```

## 3. 根因（我已定位到行，可复验）

**Next 16.4.5 的 `NodeNextResponse.appendHeader` 把单值 header 存成单元素数组，而内置 compression 中间件要求字符串。**

三处代码：

① `node_modules/.pnpm/next@16.4.5_.../node_modules/next/dist/server/lib/router-server.js:142-144, 318-320`
```js
let compress;
if ((config == null ? void 0 : config.compress) !== false) {
    compress = (0, _compression.default)();
}
...
if (compress) { compress(req, res, ()=>{}); }
```
—— 中间件本身装了，且对 HTML 生效（所以不是「没启用」）。

② `next/dist/compiled/compression/index.js:4574`
```js
function shouldCompress(a,e){
  var i=e.getHeader("Content-Type");
  if(i===undefined||!c(i)){ p("%s not compressible",i); return false }
  return true
}
```
—— 用的是 `getHeader()`，要求返回**字符串**。

③ `next/dist/server/base-http/node.js:120-129`（**16.4.5 的 bug 所在**）
```js
appendHeader(name, value) {
    const currentValues = this.getHeaderValues(name) ?? [];
    if (!currentValues.includes(value)) {
        this._res.setHeader(name, [
            ...currentValues,
            value          // ← 单值时也存成 ['application/json']
        ]);
    }
    return this;
}
```
—— 单值也写成数组。`getHeader()` 走 `getHeaderValues()`，而 `getHeaderValues` 的实现是
`Array.isArray(values) ? values.map(v=>v.toString()) : [values.toString()]`，
数组经 `getHeader()` 处理返回 `'application/json'`… 但 **compression 拿到的是 `_res.getHeader()` 原始值**，
即 `['application/json']`（Array）。`compressible(['application/json'])` → `typeof !== 'string'` → `false`。

**最小复现（我已跑通，node 原生 http + Next 自带的 compression 包）**：
```
A string  -> gzip 1329   vary=Accept-Encoding
B array   -> NONE 363011 vary=-
C array+cs-> NONE 363011 vary=-
```
⇒ 只要 Content-Type 以**数组**形态存在，压缩中间件就静默跳过，且连 `Vary: Accept-Encoding` 都不加。

**服务端对照实测**：`/api/videos?view=index` 的响应头 `vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch`
—— **没有 Accept-Encoding**，正是「被过滤掉」的指纹；而 `/` 的 vary 末尾有 `Accept-Encoding`，正是「压缩生效」的指纹。


## 3.5 AB 对照复现（我已亲手跑通，不依赖任何人的报告）

用 Next 自带的 `dist/compiled/compression` 包 + node 原生 http，只替换 `appendHeader` 的两个版本（16.4.5 数组形态 / 16.4.6 字符串形态），其余完全相同：

```
payload raw = 180791 B

16.4.5 appendHeader(单值→数组)  -> enc=NONE  vary=-                 wire=180791
16.4.6 appendHeader(单值→字符串) -> enc=gzip  vary=Accept-Encoding   wire=15458

✅ 复现并确认修复
```

**这就把「读代码推测」变成了「AB 对照实证」**：同一份数据、同一个压缩包、同一个 node，唯一变量是 header 的存储形态。
16.4.5 一个字节不压（180,791B），16.4.6 压到 15,458B（**-91.4%**），且 `vary` 正确带上 `Accept-Encoding`。

## 4. 为什么 HTML 压缩而 API 不压

`next/dist/server/send-response.js` 的 header 复制逻辑：

```js
const headersWithMultipleValuesAllowed = ['set-cookie','www-authenticate','proxy-authenticate','vary'];
...
const isHeaderPresent = typeof res.getHeader(name) !== 'undefined';
if (headersWithMultipleValuesAllowed.includes(name.toLowerCase()) || !isHeaderPresent) {
    res.appendHeader(name, value);   // ← 走 appendHeader → 单值变数组
}
```

- **页面 HTML**：由 Next 内部渲染管线直接 `res.setHeader('Content-Type', 'text/html; charset=utf-8')`（`base-server.js:1566` 等路径），**字符串** ⇒ 压缩生效。
- **route handler JSON**：走 `sendResponse` → `appendHeader` → **数组** ⇒ 压缩被跳过。

## 5. 上游修复已发布

- 修复 PR：[#101220](https://github.com/vercel/next.js/pull/101220) → backport [#101280](https://github.com/vercel/next.js/pull/101280)
- 标题：**Automatically compress route handler responses if not already compressed**
- 合并时间：2026-11-06
- 发布版本：**next@16.4.6**（`releases/lts/active`）
- 上游源码 `canary` 的 `appendHeader` 现在明确写着：
  > `// Keep a single value as a plain string. Consumers such as the compression middleware expect string header values and skip headers stored as single-element arrays.`

实测 `next@16.4.6` 的 `dist/server/base-http/node.js` 已改为：

```js
appendHeader(name, value) {
    const currentValues = this.getHeaderValues(name);
    if (currentValues === undefined || currentValues.length === 0) {
        // Keep a single value as a plain string. Consumers such as the
        // compression middleware expect string header values and skip
        // headers stored as single-element arrays.
        this._res.setHeader(name, value);      // ← 单值保持字符串
    } else if (!currentValues.includes(value)) {
        this._res.setHeader(name, [...currentValues, value]);
    }
    return this;
}
```


## 5.5 追查过程中额外发现的真实缺陷（都与压缩独立，各自成立）

### 5.5.1 `compact=1` 语义反转：比不 compact 大 12.6%

`/api/videos?compact=1` = **10,836,616 B raw**；`/api/videos`（不 compact）= **9,631,042 B raw**。
**compact 反而大 1,205,574 B。**

我逐条比了同一 id 在 full / compact 两个响应里的字段长度（6036 条全量，不抽样）：

```
条数 6036
compact 剥掉的 chapters   合计      7,583 字符  (平均 1.26/条)
compact 剥掉的 transcript 合计      1,774 字符  (平均 0.29/条)
compact 新增 mediaProxyIconUrl  1,080,568 字符  (平均 179.0/条)
原 icon 合计                      465,124 字符  (平均 77.1/条)
净差 = -7583 - 1774 + 1080568 = +1,071,211 字符
实测 raw 差 = 1,209,358 字符  →  吻合度 88.58%
```

根因：`apps/web-overlay/src/app/api/videos/route.ts:33` 的 `compactCategory` 里
`const sign = (it) => signIcon(stripHeavyFields(it))` —— 先剥 chapters/transcript（只省 9KB），
再**给每条加一个 `mediaProxyIconUrl`**（平均 179 字符 × 6036 = 1.08MB）。

**而 `/api/videos`（不 compact）不下发 `mediaProxyIconUrl`**（`signIcon` 只在 compact 与搜索路径被调用）。
⇒ **「compact」这个名字承诺的语义是「更小」，实际是「更大」**，这是语义反转。

### 5.5.2 `/videos` 页启动即预取 10.8MB（未压缩）

`apps/web-overlay/src/components/video-content.tsx:118-148`：

```js
const loadFullCatalog = async () => {
    const res = await fetch('/api/videos?compact=1')   // 10,836,616 B 未压缩
    ...
    fullCatalogRef.current = data
}
if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(loadFullCatalog, { timeout: 3500 })
}
```

每个进 `/videos` 的人在浏览器空闲时无条件拉 10.8MB。而 `fullCatalogRef` 只有三个消费点：

| 位置 | 用途 | 是否真需要全量 |
|---|---|---|
| `video-content.tsx:168` | `searchVideoIndex(searchIndex, query, fullCatalogRef.current?.navigationItems \|\| navigationData.navigationItems)` | 搜索时需全量，但 `:157` 已有 `hasQuery` 布尔量可作门 |
| `:1403-1404` | 展开子分类补 items：`fullCatalogRef.current.navigationItems.flatMap(c=>c.subCategories\|\|[]).find(s=>s.id===subCategory.id)?.items` | **只要那一个子分类的 items** |
| `:1482-1483` | 展开分类补 items：`fullCatalogRef.current.navigationItems.find(c=>c.id===category.id)?.items` | **只要那一个分类的 items** |

⇒ 后两处完全可以走 `/api/videos?categoryId=<id>`（`route.ts:160` 已支持）。
实测单分类体积：

```
?categoryId=cat_ai_engineering            raw= 589,937  gzip6= 126,787   (508 条，最大分类)
?categoryId=cat_ai_engineering&compact=1  raw= 690,234  gzip6= 151,679
?categoryId=cat_ai_engineering&summary=1  raw= 128,980  gzip6=  37,951
全量 ?compact=1                            raw=10,836,616 gzip6=1,699,064
```

**按需拉一个最大分类（126KB gzip）比拉全量（1.7MB gzip）省 92.5%。**

### 5.5.3 `/videos` 页 SSR 的 `$undefined` 占位放大

`/videos` HTML raw=989,838 / wire(gzip)=159,172。其中：

```
"mediaProxyIconUrl" 出现   355 次
"videoConfig" 出现         370 次
$undefined 出现          4,353 次
唯一 harvest_ id             29 个
```

**29 个唯一视频，却下发 355 个 `mediaProxyIconUrl` 与 370 个 `videoConfig`** —— 说明同一条视频在 flight 里被重复序列化了十余次
（分类壳 + 子分类壳 + 各个 props 各带一份）。这是 RSC 序列化的重复下发，不是数据量问题。



### 5.5.4 `videoConfig` 的真实消费面（我差点给错结论，必须留痕）

我一度转述「`VideoCard` 不读 `videoConfig`」——**错的**。实测 `apps/web-overlay/src/components/video-card.tsx` 读了 8 个子字段：

| 行 | 消费点 |
|---|---|
| `:31` | `const { videoConfig } = item` |
| `:111` | `if (videoConfig)` —— 决定卡片点击是进站内播放器还是外链 |
| `:120` | `videoConfig?.type \|\| 'bilibili'` |
| `:131` | `videoConfig?.sourceType === 'auto_trend'` |
| `:207/:209` | `videoConfig?.durationSec` |
| `:237/:241` | `videoConfig?.author` |
| `:243-248` | `videoConfig.stats?.views` |
| `:260/:262-264/:267` | `videoConfig?.tags` / `videoConfig?.subCategoryTitle` |
| `:272/:277` | `videoConfig?.difficulty === 'advanced' / 'beginner'` |

⇒ **「整个剥掉 videoConfig」会打没卡片上的时长/作者/播放量/难度/来源标记。**

三种投影在 `?categoryId=cat_ai_engineering&compact=1`（3005 实时中枢，508 条）上的实测：

| 方案 | raw | gzip6 | 相对基线 |
|---|---|---|---|
| 基线 `categoryId+compact=1` | 936,401 | **151,679** | — |
| A 整个剥掉 `videoConfig` | 373,602 | 99,714 | −51,965 |
| **B 只留消费的 8 字段** | 453,763 | **110,998** | **−40,681（−26.8%）** |
| C = B 再删 `mediaProxyIconUrl` | 350,850 | 84,285 | −67,394（**会破图，不可行**） |

**可行的是 B。** A 多省的那 11,284 B 正是「卡片上那些信息」的体积，不能省。
**`hasVideoConfig` 布尔不能替代 `videoConfig`**——它只能替代 `:111` 的存在性判断。

### 5.5.5 数据来源口径（必须标，否则数字对不上）

| 口径 | 视频条数 | 分类数 | 最大分类 |
|---|---|---|---|
| **3005 实时中枢**（本文所有 508 条数字） | 6,036 | 12 | `cat_ai_engineering` 508 条 |
| **仓库快照** `apps/web-overlay/src/navsphere/content/videos.json` | 2,265 | 12 | `cat_algorithms_interview` 290 条 |

**本文所有体积数字，除特别标注外均为 3005 实时中枢口径。** 差 2.66 倍，不可混用。


### 5.5.6 `videoConfig` 投影的最终字段与实测（含一个反直觉的坑）

**投影字段 9 个**（不是 8 个 —— 我第一版漏了 `publishedAt`）：

| 字段 | 消费点 |
|---|---|
| `type` | `video-card.tsx:120`、`video-content.tsx:380`（平台过滤） |
| `sourceType` | `video-card.tsx:131` |
| `durationSec` | `video-card.tsx:207/:209`、`video-content.tsx:412/:1408/:1487`（时长排序/过滤） |
| `author` | `video-card.tsx:237/:241` |
| `stats` | `video-card.tsx:243-248`、`video-content.tsx:395-396`（都只读 `views`） |
| `subCategoryTitle` | `video-card.tsx:262/:264` |
| `tags` | `video-card.tsx:260/:267` |
| `difficulty` | `video-card.tsx:272/:277` |
| **`publishedAt`** | **`video-content.tsx:401`（"按最新排序"）** |

**`publishedAt` 的类型实测（6036 条全量）**：

```
number = 0     string = 6018     undefined = 18
string 样本: "2026-10-28T02:00:00.000Z" / "2026-03-27T00:00:00.000Z" / "2025-01-10T10:00:00Z"
```

**全是字符串，零个 number。** 但 `video-content.tsx:402-405` 同时处理两种形态 —— 那是防御性代码。
⇒ **投影必须原样透传，不许 `Date.parse`、不许转时间戳、不许格式化。** 18 条缺失的会走 `:407` 的 `harvestedAt || 0`（既有行为），**不要给默认值**。

**`videoConfig` 实际出现过的键（全量实测，31 个）**：

```
aid, author, authorUrl, bvid, chapters, difficulty, durationSec, failStreak, freshnessScore,
harvestedAt, healthStatus, indexable, lastIndexedAt, lastVerifiedAt, p, pinned, publishedAt,
qualityScore, seoDescription, seoKeywords, seoSlug, seoTitle, sourceType, stats, subCategoryId,
subCategoryTitle, tags, transcript, transcripts, trendKeyword, type, videoId
```

`stats` 实际键：`coins, danmaku, favorites, likes, views`。
注意 **`p` 这个单字母键不在 `VideoConfig` 类型里**，白名单重建时会自动丢弃（正确行为，但要在报告里说明）。

**三种投影的实测收益（`?categoryId=cat_ai_engineering&compact=1`，508 条，gzip-6）**：

```
基线 categoryId+compact=1    gzip6 = 151,679
9 字段 + stats{views}        gzip6 = 113,267   省 38,412（-25.3%）  ← 最终方案
9 字段，stats 全留            gzip6 = 116,105   省 35,574（-23.5%）  ← 实施第一步
8 字段（漏 publishedAt）      gzip6 = 108,092   省 43,587（-28.7%）  ← 数字更好看，但「按最新排序」会坏
```

**⚠️ 反直觉的坑**：漏掉 `publishedAt` 的体积**反而最小**（108,092，比正确方案还小 5,175 B）。
**选正确的那个，不选小的那个。** 这条必须写进测试注释，防止未来有人看到 108KB 就回去删 `publishedAt`。

`stats` 只留 `views` 只多省 2,838 B。**值得做，但优先级最后**：它的价值不是省字节，而是消除「stats 里 likes/coins/favorites/danmaku 的形态契约」——投影后任何人想加「按点赞排序」都会立刻发现要走 API，而不是偷偷改投影。


### 5.5.7 投影必须是**三层**白名单，不是一层（我的清单漏了两层，会全白卡）

我第一版只列了 9 个 `videoConfig` 子字段。**如果照那个做「白名单重建对象」，item 顶层的 `id/title/href/description/icon/tags/enabled/mediaProxyIconUrl` 全部会被丢掉，卡片直接全白。**

两层消费面是我逐字段核出来的（不是 grep 猜的）：

```
video-card.tsx 读的 item 顶层字段:
  description, href, icon, id, mediaProxyIconUrl, tags, title, videoConfig

video-content.tsx 读的:
  it.*          → 只有 videoConfig（其余走解构，已被 video-card 覆盖）
  category.*    → description, enabled, icon, id, items, subCategories, title, totalCount
  subCategory.* → description, id, items, title, totalCount
```

⇒ **三层白名单**：

```ts
ITEM_TOP = ['id','title','href','description','icon','tags','enabled','mediaProxyIconUrl']
CARD_VC  = ['type','sourceType','durationSec','author','stats','subCategoryTitle','tags','difficulty','publishedAt']
CAT_TOP  = ['id','title','description','icon','enabled','totalCount']
SUB_TOP  = ['id','title','description','totalCount']
```

**完整三层白名单投影的实测收益**（`?categoryId=cat_ai_engineering&compact=1`，508 条）：

```
基线 categoryId+compact=1              gzip6 = 151,679
完整投影（三层白名单）                  gzip6 = 112,152   raw=457,000   省 39,527（-26.1%）
再压 stats -> {views}                  gzip6 = 109,197   raw=444,487   省 42,482（-28.0%）
```

**注意：完整投影 112,152 比我先前只算 videoConfig 的 113,267 还小 1,115 B** —— 因为顶层也剥掉了 `useDefaultIcon` / `hubId` / `health` / `status` 等未消费字段。**加白名单不等于变大。**

### 5.5.8 签名与投影的**顺序**是静默失败点（存储算法师提出，我确认）

`route.ts` 的 `view=card` 分支内必须按此顺序：

```
1. 取出该分类原对象（含完整 items）
2. signCategory(cat) 或 compactCategory(cat)  →  生成 mediaProxyIconUrl
3. 再对结果做三层白名单投影
```

**绝不能先投影再签名**：投影会先把 `icon` 剥掉（若白名单漏了它），`signIcon`（`media-proxy.ts:141-148`）会因 `!icon` 直接早退，`mediaProxyIconUrl` 永远不生成。**这是静默失败，不报错，只破图。**

守卫判据（一条断言同时抓两种错）：
> `view=card` 响应里，每一条「有 `icon`」的条目都必须「有 `mediaProxyIconUrl`」；反之亦然。

`signIcon` 的三个早退分支（`media-proxy.ts:141-148`）：`!icon` 直接返回、非 `http(s)` 开头直接返回。**存在「有 icon 但无 mediaProxyIconUrl」的条目 ⇒ 它们落在那两个早退分支**，需要实测计数（派给存储算法师）。

## 6. 关键修正：`overrides: next` 会压过 package.json —— 只改 package.json 是空转

这一节是本文档最重要的一节。**我第一版方案在这里是错的，必须留痕。**

### 6.1 HEAD 的事实（`e3977bb4`）

```
HEAD apps/web/package.json            "next": "16.4.6"     ← 声明要 16.4.6
HEAD apps/web-overlay/package.json    "next": "16.4.6"     ← 声明要 16.4.6
HEAD pnpm-workspace.yaml:119          next: 16.4.5         ← override 钉死 16.4.5
HEAD pnpm-lock.yaml                   specifier: 16.4.5
                                      version:   16.4.5
磁盘实际安装                            16.4.5
```

**HEAD 是一次「半截升级」**：package.json 声明了 16.4.6，但 override 未解除，pnpm 把 lock 里的 specifier 直接改写回 16.4.5，**16.4.6 从未被安装过**。
⇒ 压缩缺陷在 HEAD 上同样生效，**不是「工作树没跟上」**。

### 6.2 反证：`eslint-config-next` 真的升上去了

```
HEAD pnpm-lock.yaml:
  eslint-config-next:
    specifier: 16.4.6
    version: 16.4.6(...)                  ← 真的装了
  '@next/eslint-plugin-next@16.4.6':       ← 连带升了
```

`eslint-config-next` 不受 `overrides: next` 管辖，所以它升成功了。
**这同时证明 16.4.6 这套包与我们现有 `eslint 10.15.0` / `typescript 5.9.3` 是兼容的**（HEAD 上已经跑了很久没报错）。

### 6.3 工作树的方向冲突（收敛期红线）

```
git diff HEAD -- apps/web/package.json
-    "next": "16.4.6",
+    "next": "16.4.5",
-    "eslint-config-next": "16.4.6",
+    "eslint-config-next": "16.4.5",
```

工作树把 16.4.6 改回 16.4.5，**方向与 HEAD 相反**。按收敛期规矩「发现方向相反立即上报，不照改」，**不直接采用任一侧**。

两边都不对的理由：

| | 声明 | 实际装 | 判定 |
|---|---|---|---|
| HEAD | 16.4.6 | 16.4.5 | **声明撒谎**（override 压着） |
| 工作树 | 16.4.5 | 16.4.5 | 一致，**但缺陷仍在** |
| **应采取** | **16.4.6** | **16.4.6** | 解除 override，真正升上去 |

### 6.4 修正后的完整改动清单（6 处，缺一空转或崩）

| # | 位置 | 现在 | 改成 |
|---|---|---|---|
| 1 | `pnpm-workspace.yaml:119` | `next: 16.4.5` | **删除**（理由见 6.5） |
| 2 | `pnpm-workspace.yaml:52-62` | 10 条 `@16.4.5` 的 `minimumReleaseAgeExclude` | **删除整段**（16.4.6 发布于 2026-11-09T20:33:38Z，已过 `minimumReleaseAge=1440` 的 24h 门） |
| 3 | `pnpm-workspace.yaml:79` | 台账行「next 16.4.2 硬钉…2027-03-31」 | 删除，或改为「已解除（2026-11-28 升 16.4.6）」并写依据 |
| 4 | `.npmrc:14-15` | 「当前只有 next 16.4.2 的 9 个平台包——它被 backport 标签固定」 | **整段改写**（该理由随升级失效，留着会误导） |
| 5 | `apps/web/package.json:61,87` + `apps/web-overlay/package.json` | 工作树 = 16.4.5 | **16.4.6**（= HEAD 的值；改完工作树无净改动） |
| 6 | `README.md:135`、`docs/security/dependabot-upgrade-checklist.md:77` | 16.4.5 | 16.4.6 |

**`pnpm-lock.yaml` 必须重新解析**：解除 override 后 next 才会真的变成 16.4.6。
工作树 lock 与 HEAD 已差 243 行（含 `eslint-config-next` 16.4.6→16.4.5 回退、`@types/trusted-types` 与 `@typescript-eslint/eslint-plugin@8.72.2` 被移除等），重解析会再动一批 —— **这是需要人工批准的破坏性依赖变更，不自动执行。**

### 6.5 `overrides: next` 删除 vs 改成 16.4.6

**判：删除。** 依据：

1. 台账（`pnpm-workspace.yaml:79`）自己写着它存在的唯一理由是「与 `minimumReleaseAgeExclude` 平台包绑定」；
2. 第 2 条把那段 exclude 删掉后，绑定关系消失，override 失去存在依据；
3. 留着会有害：它会**静默压制 package.json 的版本声明**，正是本次「半截升级」的成因。留着等于保留一个「声明与实际不一致」的陷阱。

⇒ 两个一起删，台账干净，且以后改 package.json 立即生效。


## 7. 隔离副本完整预演结果（决定性证据，不是估算）

### 7.1 做法

在 `%TEMP%\navhub-lock-probe` 建独立目录，复制 12 个清单（根 `package.json` / `pnpm-workspace.yaml` / `.npmrc` / `pnpm-lock.yaml` + `packages` 4 个 + `apps` 4 个），执行：

1. `pnpm-workspace.yaml` 删 `overrides: next: 16.4.5` 一行
2. `pnpm-workspace.yaml` 删 `minimumReleaseAgeExclude` 整段（10 条）
3. 两个 `package.json` 的 `next` / `eslint-config-next` 设为 `16.4.6`
4. `pnpm install --lockfile-only --ignore-scripts`

**主仓一个字节未碰**（全程隔离目录）。

### 7.2 结果

```
pnpm install EXIT=0（28.2s, pnpm v11.7.0）
✓ Lockfile passes supply-chain policies (1019 entries in 22.6s)

新 lock 里所有 16.4.x：
  specifier: [ '16.4.6' ]
  version:   [ '16.4.6' ]
  含 16.4.5 ? false          ← 完全清零
```

**lock 差异：72 insertions / 62 deletions（134 行，10689 → 10699 行）**，100% 是版本串替换：

```
-  next: 16.4.5                                     ← overrides 段删除
-  specifier: 16.4.5  →  specifier: 16.4.6           （next + eslint-config-next，两处 importer）
-  @next/env@16.4.5                → @next/env@16.4.6
-  @next/eslint-plugin-next@16.4.5 → 16.4.6
-  @next/swc-darwin-arm64@16.4.5   → 16.4.6
-  @next/swc-darwin-x64@16.4.5     → 16.4.6
-  @next/swc-linux-arm64-gnu@16.4.5 → 16.4.6
-  @next/swc-linux-arm64-musl@16.4.5 → 16.4.6
-  @next/swc-linux-x64-gnu@16.4.5  → 16.4.6
-  @next/swc-linux-x64-musl@16.4.5 → 16.4.6
-  @next/swc-win32-arm64-msvc@16.4.5 → 16.4.6
-  @next/swc-win32-x64-msvc@16.4.5 → 16.4.6
-  next-auth@5.0.0-beta.32(next@16.4.5…)  → (next@16.4.6…)
-  next-themes@0.2.1(next@16.4.5…)        → (next@16.4.6…)
```

**8 个平台包 integrity 全部解析成功** —— 消掉了「缺一个平台包会让 macOS/ARM 构建崩」的担心。
`overrides` 段升级后不再含 `next`，其余 16 条安全钉版原样保留。

### 7.3 一处必须更正的判断

我在群消息里曾说「重解析会让 lock 变 243 行、牵连整条 CI」——**那是错的**。
243 行是**工作树相对 HEAD 的既有收敛期差异**（含 `@types/trusted-types`、`@typescript-eslint/eslint-plugin@8.72.2` 被移除等），**与本次升级无关**。
本次升级自身只产生 134 行变动，且无依赖树增减。

### 7.4 主仓执行清单（待人工批准后才能跑）

```
1. git diff HEAD -- pnpm-workspace.yaml .npmrc apps/web/package.json apps/web-overlay/package.json
   （重点核工作树 16.4.6→16.4.5 的方向冲突）
2. 改 6 处：pnpm-workspace.yaml（override 1 行 + exclude 10 行 + 台账 1 行）、.npmrc（注释 2 行）、两个 package.json（各 2 行）
3. pnpm install
4. 核 node_modules/next/package.json 的 version === 16.4.6
5. 重启 3005，逐端点复测 vary + content-encoding，比对第 8 节验收表
6. 回滚 = git 还原 6 文件 + pnpm install
```

**这是动依赖锁的动作，需人工批准。**

## 8. 升级后验收基线（这是我给的验收表，缺一行不算完）

现状是 3005 `next start`（生产构建 `cBim7RomAsyF3Wu-FXZ6Z`）在 2026-11-28 18:2x 的实测。
「升版后应达」= 对**当前未压缩原文**做 `gzip -6` 得到的字节数，即压缩真正生效后 wire 应落在的量级。

| 端点 | 现状 wire(raw) | 升版后应达(wire≈gzip6) | vary 现状 |
|---|---|---|---|
| `/api/videos` | 9,631,042 | 1,393,507 | **无 Accept-Encoding（缺陷）** |
| `/api/videos?compact=1` | 10,836,616 | 1,699,064 | **无（缺陷）** |
| `/api/videos?summary=1` | 1,556,627 | 353,667 | **无（缺陷）** |
| `/api/videos?view=index` | 929,019 | 291,718 | **无（缺陷）** |
| `/api/videos?categoryId=cat_ai_engineering` | 837,140 | 126,787 | **无（缺陷）** |
| `/api/navigation/category/reg-ai-tools` | 124,827 | 36,330 | **无（缺陷）** |
| `/api/hub/search?q=python` | 41,733 | 5,084 | **无（缺陷）** |
| `/sitemap.xml` | 1,017,809 | 128,973 | **无（缺陷）** |
| `/feed.xml` | 26,950 | 6,157 | **无（缺陷）** |
| `/robots.txt` | 164 | 112 | **无（缺陷）** |
| **合计** | **25,001,927** | **4,041,399** | **省 83.8%** |

升级后的验收判据（三条同时成立才算修好）：

1. **`vary` 含 `Accept-Encoding`** —— 这是压缩中间件真正介入的指纹，**比看 content-encoding 更早暴露问题**（16.4.5 连 Vary 都不加）；
2. `content-encoding: gzip`（或 br）；
3. wire 落在上表「应达」的 ±10% 内。

**注意 `/robots.txt`（164B）不在修复范围内**：它低于 compression 中间件默认 1KB 的 `threshold`，本来就不压，属正确行为。

## 9. 复算命令（报数字必须一起贴）

```powershell
node -e "const h=require('http'),z=require('zlib');for(const p of ['/','/videos/player','/api/videos?view=index','/sitemap.xml']){h.get({host:'127.0.0.1',port:3005,path:p,headers:{'accept-encoding':'gzip, br'}},r=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>{const b=Buffer.concat(c);let raw=b;try{raw=zlib.gunzipSync(b)}catch(e){}const g=zlib.gzipSync(raw,{level:6}).length;console.log(p,'wire='+b.length,'gzip6='+g,'enc='+(r.headers['content-encoding']||'NONE'),'vary='+(r.headers['vary']||'-'))})})}"
```

判据：**`vary` 里有没有 `Accept-Encoding`** 就是压缩是否生效的指纹，比看 `content-encoding` 更早暴露问题。


## 10. 最终验收：生产 `next start` 上 12/12 PASS（决定性结果）

### 10.1 完整证据链

```
① next 16.4.5 → 16.4.6 install 完成
   pnpm-lock.yaml: 16.4.5 命中 47 → 0；16.4.6 命中 0 → 44
   apps/web/node_modules/next → 软链指向 next@16.4.6

② 用 16.4.6 重新 build
   BUILD_ID: cBim7RomAsyF3Wu-FXZ6Z → Nf24e8XJf0Y_5JyTMR4JO
   mtime:    2026-11-28T09:05:58Z  → 2026-11-28T10:42:23Z
   日志:     ✓ Compiled successfully in 117s / ✓ Generating static pages (379/379) in 70s

③ 起真正的 next start（端口 4010，非 dev）
   启动: ▲ Next.js 16.4.6 / ✓ Ready in 548ms

④ 12 端点验收
```

### 10.2 实测（生产 `next start`，这是最终证据）

| 端点 | status | enc | wire | raw | vary 含 AE |
|---|---|---|---|---|---|
| `/api/videos` | 200 | gzip | 1,393,793 | 9,629,839 | YES |
| `/api/videos?compact=1` | 200 | gzip | 1,699,411 | 10,835,413 | YES |
| `/api/videos?summary=1` | 200 | gzip | 353,673 | 1,556,627 | YES |
| `/api/videos?view=index` | 200 | gzip | 291,725 | 929,019 | YES |
| `/api/videos?categoryId=cat_ai_engineering` | 200 | gzip | 126,748 | 837,735 | YES |
| `/api/navigation/category/reg-ai-tools` | 200 | gzip | 36,337 | 124,827 | YES |
| `/api/hub/search?q=python` | 200 | gzip | 5,091 | 41,734 | YES |
| `/sitemap.xml` | 200 | gzip | 128,980 | 1,017,809 | YES |
| `/feed.xml` | 200 | gzip | 6,164 | 26,950 | YES |
| `/robots.txt` | 200 | gzip | 112 | 164 | YES |
| `/` | 200 | gzip | 634,554 | 3,019,030 | YES |
| `/videos/player` | 200 | gzip | 16,950 | 76,678 | YES |

**PASS=12  FAIL=0**

### 10.3 升级前后对照（同一端点）

```
                  升级前（dev, 16.4.5）        升级后（start, 16.4.6）
/api/videos       wire 9,631,042 (= raw)        wire 1,393,793 (= raw × 14.5%)
vary              无 Accept-Encoding            有 Accept-Encoding
content-encoding  NONE                          gzip
```

### 10.4 与第 8 节预测的吻合度

```
端点            预测        实测        误差
view=index     291,718    291,725      7 B (0.002%)
/sitemap.xml   128,973    128,980      7 B
/api/videos  1,393,507  1,393,793    286 B (0.02%)
compact=1    1,699,064  1,699,411    347 B
/feed.xml        6,157      6,164      7 B
```

### 10.5 收益

```
12 个端点合计：
  升级前 wire = 25,001,927 B  (23.84 MB)
  升级后 wire =  4,041,457 B  ( 3.85 MB)
  节省        = 20,960,470 B  (19.99 MB，-83.8%)
```

### 10.6 附带发现：`/videos/player` 的 raw 从 457,495 降到 76,678

**这不是压缩的功劳，是新构建的功劳。** 之前那份 `.next` 是 16.4.5 时期建的，播放器瘦身改动（`initialVideo` + `view=index`）当时还没进构建产物。重建后播放器页 raw 只有 76,678B（wire 16,950B）——**播放器瘦身方案也随之落地并验证生效**。

### 10.7 build 不会破坏 dev server（已验证）

`next/dist/build/index.js` 的 `cleanDistDir` 分支（`config.cleanDistDir` 默认 `true`，见 `config-shared.js:98`）：

```js
if (config.cleanDistDir && !isGenerateMode) {
    await nextBuildSpan.traceChild('clean').traceAsyncFn(
        () => recursiveDeleteSyncWithAsyncRetries(distDir, new Set([
            'cache', 'dev', 'diagnostics', 'lock', 'trace'
        ]))
    )
}
```

⇒ **保留 `.next/dev`**，所以 `next build` 不会破坏正在跑的 `next dev`。但 `.next/server` 会被整个删掉重建，dev server 在 build 期间会短暂 500（可接受）。

### 10.8 `next build` 的 PowerShell 陷阱（踩过，记下来）

`next build` 往 stderr 写正常日志（`[storage] navigation 快照体积已达…`），**PowerShell 会把原生命令的 stderr 当错误**，导致：
- 管道版（`| Tee-Object`）拿到 **exit code 1**，但构建实际成功
- `Start-Process` 重定向版才能干净地跑

判据：不看 exit code，看 **`✓ Generating static pages (379/379)`** 与 **新 BUILD_ID 的 mtime**。

### 10.9 `next start` 在端口 3057 上的诡异 404（踩过，记下来）

3057 起服务日志显示 `✓ Ready`，但所有请求返回 401/404。原因是**该端口被 `karingService.exe`（代理软件）同时占用**（`Get-NetTCPConnection` 显示两个 PID 绑同一端口）。换端口 4010 后正常。
⇒ 起验证服务前先查端口占用，别用常见的 30xx。

## 附录 A · 升版约束第一版清单（已被第 6 节修正，仅保留作对照，勿照此执行）

仓库当前把 next **硬钉在 16.4.5**，三处联动：

| 位置 | 内容 |
|---|---|
| `pnpm-workspace.yaml:52-62` | `minimumReleaseAgeExclude` 里的 8 个 `@next/swc-*` 平台包 + `next@16.4.5` |
| `pnpm-workspace.yaml:79` | 台账行「next 16.4.5 硬钉：与 minimumReleaseAgeExclude 平台包绑定 2027-03-31」 |
| `pnpm-workspace.yaml:119` | `overrides: next: 16.4.5` |
| `apps/web/package.json:61,87` `apps/web-overlay/package.json` | `"next": "16.4.5"` / `"eslint-config-next": "16.4.5"` |
| `README.md:135` `docs/security/dependabot-upgrade-checklist.md:77` | 文档口径 |

**注意 `.npmrc` 有 `minimumReleaseAge=1440`**（只安装发布超过 24h 的版本，防供应链投毒）。
⇒ 升 16.4.6 前必须先确认它已发布满 24h，否则要加进 `minimumReleaseAgeExclude`。
这一步**必须实测发布时间**，不能假设。

## 附录 B · 验收回填（2026-11-28）

> 本附录为 2026-11-28 next 16.4.5→16.4.6 升级与配套改造的完整验收结论回填，由山羊胡网总管汇总、文档工程师逐条照抄落盘。所有数字均为实测值，未作推算。第 1-9 节与附录 A 保持原样，勿据此附录回改正文。

### B.1 升级门 PASS

- 升级门 PASS：next 16.4.5→16.4.6；pnpm install EXIT=0；lock 命中 16.4.5 由 47→0、16.4.6 由 0→44；apps/web 解析 16.4.6；压缩归因 build 的 BUILD_ID=Nf24e8XJf0Y_5JyTMR4JO；wire 实测 BUILD_ID=uK-J-bt04vElkui0bG6Gs。

### B.2 压缩缺陷因果坐实

- 压缩缺陷因果坐实：zlib level 6 预测差 7 字节 + appendHeader 单变量 AB 180,791→15,458 + vary 大小写指纹三层；16.4.6 已修复。

### B.3 /videos 按需取数落地（前端 3 文件）

- /videos 按需取数落地（前端 3 文件）：route.ts 加 view=card 三层白名单 + 先 signCategory 后投影 + publishedAt 9 字段；video-content.tsx 删启动预取 + 同 id 去重；test/video-card-on-demand.test.ts 11 条。live wire 109,203 B gzip ≤115,000 阈值（4010 next start/.next-wire 实测）。收益分账：-92.2% 归删启动全量预取、投影本身 -13.8% wire / -46.9% decoded（126,740→109,203），按架构师裁定口径。

### B.4 P0 缺陷：MCP 重复 import 启动崩溃

- P0 缺陷：apps/mcp/src/http-server.ts:33/34 重复 import createServer 致 node apps/mcp/src/http.ts 抛 SyntaxError，CI 三门禁全漏（vitest esbuild 去重假绿 / typecheck --list 5 包不含 @navhub/mcp-app / ci.yml+gates.json 无 mcp）。后端删第 34 行修复、health 200、无残留监听；但 HEAD 里重复行仍在——上线提交必带此文件（硬条件）。

### B.5 门禁补覆盖

- 门禁补覆盖：运维加 mcp-http-smoke CI job（真进程 + health）、gates.json 登记、ci.yml:1177 ci-passed needs 由 10→11，双 check EXIT=0。

### B.6 QA 三批对拍

- QA 三批对拍：批 A 6 红（收敛期质量债，前端 /videos 改造 + 在途，非升级）· 批 B 3 红（SSRF 连接层重写遗留 fetch 桩债，非升级）· 批 C 全绿 250 文件 / 2434 用例。13 红全部登记为债，升级门 PASS 不受影响。

### B.7 契约债（登记不追）

- 契约债（登记不追）：架构师签字放宽 McpHostContext.embedding→|null（apps/api/src/context.ts:39 本就 |null），后端落地 host-context.ts:31 + 降级语义测试变异证明成立。受控实验证伪「3 个 TS2345 自动通过」：放宽消 embedding 层不匹配后，暴露第二层 capabilities 形状错配（McpHostContext.capabilities?{mcp,embed} vs AppContext.capabilities{semantic,fts,llm,notes}），3 个 TS2345 一个没消。裁定不追（apps/mcp 不在 typecheck 覆盖、P0 已被 CI smoke 兜住、真修需 capabilities 下沉 core）。

### B.8 撤防账

- 撤防账：运维变异实验证伪派单前提——scripts/ci-defused.test.ts 基线 85 passed 全绿，2 红实为前端 apps/web/test/ci-gate.test.ts（:66 聚合 10→11、:76-77 needs 字面量）。裁定方案 B：scripts 域零改动、字节还原即终态（9 作业 / 35 门禁）；前端 ci-gate 2 红已修，只改 apps/web-overlay/test/ci-gate.test.ts，两文件 SHA256 一致 cd79ad60…e7ae6c5f7867、diff 5+/5-、总管亲跑 8/8 EXIT=0。

### B.9 MCP 三道门（egress）

- MCP 三道门（egress）：per-token 配额/429、读操作审计 actor+count、只读可吊销 token。后端落 apps/mcp/src/egress-gates.ts + 真进程验收（6/6、5 个 @@POC@@ 标记、变异证明成立、全量 13 文件 160 测试全绿）。性能安全师红队复核 PASS（总管复验成立）：无第三条公网入口、配额 key 取鉴权后 token 身份、只读 token 调写全入口被拒（13 处 requireScope）、批量 5 调用整批 429、伪造 actor 被忽略、6 门文件 SHA256 前后一致（A787D663/7495BF42/39EB2493）。

### B.10 协议语义红线

- 协议语义红线：标准 /mcp 通道写工具被拒是 HTTP 200 + result.isError=true（MCP 协议），不是 403；门禁必须用 isError 判据，不能用 HTTP 状态码，否则假绿。已写入 docs/arch/mcp-call-metrics-adr-2026-11-28.md:62。

### B.11 调用量 ADR

- 调用量 ADR：docs/arch/mcp-call-metrics-adr-2026-11-28.md 状态 Accepted，双签人架构师 + 山羊胡网总管，日期 2026-11-28；:60 次序修正（allowed 判定在 audit 之前但 audit 无条件执行故 429 留痕）。

### B.12 G620 首访信任簇 e2e 复签

- G620 首访信任簇 e2e 复签：64/64 全绿 E2E_FINAL_EXIT=0（改前 2red/62passed）。根因跨 spec 状态污染——settings-and-empty 的 seedNavigation(beforeAll) 往共享 E2E 库种单分类导航索引不清理。修法按 spec 注释「改用受控存储桩、不放宽断言」：first-visit-degrade.spec.ts 加 beforeAll 写 kind 非法索引桩（sourceVersion=424242）强制 parseIndex 判降级，空库 publicDoc 为空故 ensureNavigationShardsFresh:786 不自愈覆盖。改前 2red→改后 degrade+settings 合跑 22 passed，天然变异对照成立。AC-1.3 注入点行为级实测（trust 单跑 30/30）、AC-1.5 UI 覆盖、AC-3.2/3.3 UI+源码双覆盖。两 e2e 文件 untracked(??)，上线提交必带。

### B.13 上线硬条件

- 上线硬条件：提交必带 apps/mcp/src/http-server.ts + 两个首访 e2e untracked 文件；上线审批待用户人工批（未授权不动）。
