# B 站高清解析：凭据通道、出站预算与缓存分桶（现行）

> **状态：现行。** 落地 2026-11-01（商用级升级批次 2 / A3）。
> 一句话：**访客的 B 站 `access_key` 不再进 URL、默认不出站给第三方解析站、解析缓存按
> 「真正出站的那把 key」分桶，并且这条匿名出站通道接上了既有的 `StreamBudget` 额度闸门。**
> 相关代码：[`apps/web-overlay/src/app/api/videos/bili-parse/route.ts`](../apps/web-overlay/src/app/api/videos/bili-parse/route.ts)、
> [`apps/web-overlay/src/lib/video-bilibili-hd-parser.ts`](../apps/web-overlay/src/lib/video-bilibili-hd-parser.ts)、
> [`apps/web-overlay/src/components/video-bilibili-hd-player.tsx`](../apps/web-overlay/src/components/video-bilibili-hd-player.tsx)。
> 守卫：[`apps/web-overlay/test/bili-parse-route.test.ts`](../apps/web-overlay/test/bili-parse-route.test.ts)（14 条）、
> [`apps/web-overlay/test/video-bilibili-hd-parser.test.ts`](../apps/web-overlay/test/video-bilibili-hd-parser.test.ts) 的「A3」组（9 条）。

## 一、四条真实缺陷（都是读当前代码 + 实测确认的，不是假想）

| # | 缺陷 | 证据 | 后果（用户视角） |
| --- | --- | --- | --- |
| 1 | **凭据走 GET query**：`/api/videos/bili-parse?...&access_key=...` | 旧 `route.ts` 的 GET 直接 `searchParams.get('access_key')` | key 留在浏览器历史、反代与服务端访问日志、任何一层错误上报里；而它**等同于那个人的 B 站登录态** |
| 2 | **匿名出站通道没有闸门**：一次解析最多顺序打 6 个上游（星之阁 / 米人 / WBI / 免登录 / PC / Android） | `/api/videos/bili-stream` 早已接 `StreamBudget`，`bili-parse` 却没有；实测同一 IP 连打 12 次全 200 | 任何人都能把本站当免费解析代理。**被目标站拉黑出口 IP 的是我们**，随后全体真实用户看到「全都解析失败」 |
| 3 | **解析缓存按 `custom|default` 两档分桶** | [`video-bilibili-hd-parser.ts:281`](../apps/web-overlay/src/lib/video-bilibili-hd-parser.ts#L281) 的注释位置就是旧键；签名流地址带 `deadline`/`uipk`，谁拿到谁能播 | A 账号解锁的高清结果被发给填了另一把 key 的 B——跨账号泄漏一条可播放的 bearer capability |
| 4 | **访客 key 无条件交给不受我们控制的一方**：全仓只有星之阁引擎消费 `access_key` | [`video-bilibili-hd-parser.ts:306-311`](../apps/web-overlay/src/lib/video-bilibili-hd-parser.ts#L306) | 用户在面板里粘贴 key 时，并不知道自己把账号凭据发去了 `api.xingzhige.com` |

## 二、机制

### 1. 凭据只走 POST body

```
GET  /api/videos/bili-parse?bvid=…[&access_key=…]  → 400 code=credential_in_query
                                                     （在拿到预算、进解析链之前就拒，凭据连日志都不落）
POST /api/videos/bili-parse  { bvid, aid, cid, p, accessKey, engine, forceRefresh }
     → 200 + Cache-Control: no-store（只要带了 key，无论成功失败）
```

`access_key` / `accessKey` 两种拼法都认（[`route.ts:68`](../apps/web-overlay/src/app/api/videos/bili-parse/route.ts#L68)）。
POST 的 `no-store` 判据是 `!input.accessKey`（[`route.ts:176`](../apps/web-overlay/src/app/api/videos/bili-parse/route.ts#L176)）：
带凭据的响应绝不进任何共享缓存，哪怕结果本身是可公开的 720P。

### 2. 出站闸门：默认不把访客 key 交给第三方

[`resolveOutboundAccessKey()`](../apps/web-overlay/src/lib/video-bilibili-hd-parser.ts#L269) 决定「本次真正出站的 key」：

| 访客填了 key | 部署开关 | 出站的 key | 结果里的标注 |
| --- | --- | --- | --- |
| 否 | 任意 | `NAVHUB_BILIBILI_ACCESS_KEY`（操作者自己的） | 无 |
| 是 | 未开（默认） | 操作者的 key（可能为空 = 免登录档） | `accessKeyIgnored: true` |
| 是 | `NAVHUB_BILI_FORWARD_USER_KEY=1` | 访客那把 | 无 |

**操作者自己配的 key 照旧出站**——那是部署者对自己账号的处置，不在闸门范围内。
`accessKeyIgnored` 不落缓存（[`route.ts` 存盘前 `delete`](../apps/web-overlay/src/lib/video-bilibili-hd-parser.ts#L901)）：
它是每次请求按当时的配置算出来的，进缓存就会在开关变更后继续骗人。

### 3. 缓存按「真正出站的那把 key」分桶

[`accessKeyCacheBucket()`](../apps/web-overlay/src/lib/video-bilibili-hd-parser.ts#L287) 取 SHA-256 前 8 字节的 hex：

- 空 key ⇒ 常量 `'anon'`（免登录结果可以共享，本来就没有身份差异）；
- 非空 ⇒ 摘要桶，**key 明文不进缓存键**（进程转储、错误日志、将来的观测导出都少一次泄漏）；
- 环境没有 `crypto.subtle` ⇒ 返回 `null` ⇒ **带 key 的请求一律不缓存**，宁可多解析一次，
  也不能让两个账号的结果共用一条缓存。这是故意的「安全侧失败」，不是降级。

缓存键形状：`{canonicalUrl}|p={p}|key={bucket}|pref={engine}`。被拦下的访客 key 归到 `'anon'` 桶
（因为真正出站的就是操作者档），不会和「真用了访客 key」的结果同桶。

### 4. 出站预算：复用既有原语，不新造一个限流器

[`route.ts:16-24`](../apps/web-overlay/src/app/api/videos/bili-parse/route.ts#L16) 用
[`StreamBudget`](../apps/web-overlay/src/lib/stream-budget.ts#L27)——和 `/api/videos/bili-stream` 同一套，
不新增第四份手写计数：

| 拒绝 | 状态码 | `code` | 为什么分开 |
| --- | --- | --- | --- |
| 该调用方窗口内超量 | 429 + `Retry-After: 10` | `rate_limited` | 是「你打太快」，等一会就好 |
| 进程并发满了 | 503 + `Retry-After: 10` | `saturated` | 是大家都挤，重试太快只会加剧 |

调用方标记 = `x-forwarded-for` 首段 → `x-real-ip` → `'unknown'`（[`route.ts:27`](../apps/web-overlay/src/app/api/videos/bili-parse/route.ts#L27)），
**只用于分桶，不作为身份**。GET / POST 共用同一份预算——换方法绕不开限流。
额度在 `finally` 归还：一次上游异常不能把并发槽永久吃掉（守卫第 9 条测的就是这条）。

### 5. 界面上的三处如实表达

| 位置 | 内容 |
| --- | --- |
| 密钥面板 | 写明 key **等同于 B 站登录凭据**、会交给谁、以及「**默认不出站**，需要管理员显式开启 `NAVHUB_BILI_FORWARD_USER_KEY=1`」（[`:664`](../apps/web-overlay/src/components/video-bilibili-hd-player.tsx#L664)） |
| 状态徽标 | 三态：`1080P+ 密钥` / `密钥未被使用` / `VIP 密钥已启用`（[`:574`](../apps/web-overlay/src/components/video-bilibili-hd-player.tsx#L574)）。被预算拦下时请求根本没进解析器 ⇒ 也判「未被使用」（[`:212`](../apps/web-overlay/src/components/video-bilibili-hd-player.tsx#L212)） |
| 拒绝提示条 | 429/503 走 `ParseDeniedError`，文案区分「解析太频繁」与「同时解析的人较多」，并给出可执行动作（[`:30-44`](../apps/web-overlay/src/components/video-bilibili-hd-player.tsx#L30)） |

**为什么第 3 条算功能而不是 polish**：加闸门会引入一个全新的失败态。原来的代码把所有非 2xx
一律 `throw new Error('HTTP 429')` 吞进「解析失败，自动切内嵌」，用户看到的是画质莫名降了一档，
而真实原因是额度——这正是本仓一贯禁止的「静默回退」。

### 6. 播放器与路由的契约怎么钉住

守卫测试直接从源码里抽出播放器组装的 body 字段名，再逐个要求路由读得到（[`bili-parse-route.test.ts`](../apps/web-overlay/test/bili-parse-route.test.ts) 的「契约」组）：

| 断言 | 抓什么漂移 |
| --- | --- |
| 播放器发的每个字段都被 `body.<字段>` 读取 | 改名 / 多塞字段后被静默丢弃（解析照跑，参数丢光） |
| 解析请求 URL 不含 query | 有人把 key 塞回 URL（凭据重新进日志） |
| 429 与 503 的文案是两条不同字符串 | 两种拒绝塌成一句「稍后再试」 |
| 被拦下时兜底结果带 `accessKeyIgnored` | 徽标继续谎称「VIP 密钥已启用」 |

每条都配了合成阳性（故意的错写法必须被抓到），避免规则退化成永远为真的正则。

## 三、配置（compose 与 `.env.example` 同步，由「compose 透传守卫」盯着）

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `NAVHUB_BILIBILI_ACCESS_KEY` | 空 | 操作者自己的 key；空 = 只走免登录 720P（与历史行为一致） |
| `NAVHUB_BILI_FORWARD_USER_KEY` | 空（关） | 显式 `1` 才把访客 key 交给星之阁 |
| `NAVHUB_BILI_PARSE_MAX_CONCURRENT` | 8 | 进程内在飞解析数 |
| `NAVHUB_BILI_PARSE_MAX_PER_MIN` | 12 | 单调用方每分钟次数，超限 429 |

两个凭据类变量在 compose 里是**纯透传不兜底**（`${VAR:-}`）：给 `NAVHUB_BILI_FORWARD_USER_KEY` 写默认值
等于替所有部署做出「把访客凭据发出去」的决定；给 key 写默认值等于把部署者的 B 站账号公开。
这四条已进 `SECURITY_KEYS_BY_SERVICE.web`，[`apps/api/test/compose-env-parity.test.ts`](../apps/api/test/compose-env-parity.test.ts) 会在漏透传时变红。

## 四、明确不做的

- **不把 rss / weather / csp-report 迁到 `StreamBudget`**：那是一次与本主题无关的全仓重构，
  它们的出站半径也小得多。等各自的真实痛点出现再动。
- **不做全局（跨副本）精确配额**：`StreamBudget` 按进程计，多副本部署总量 ≈ 副本数 × 阈值。
  要全局得进共享存储，在进程内造「假全局」更糟。
- **不在 web 层为解析接口加鉴权**：这是公开前台的播放能力，改成「登录才能解析」是把成本转嫁给用户。
- **不动 `/api/videos/bili-stream`**：它已有自己的预算与 Range 夹紧；本次只补 `bili-parse`。
- **不改 6 引擎的容灾顺序**：闸门只决定「哪把 key 出站」，不干预引擎选择。

## 五、验证记录（2026-11-01）

**单元与守卫**：`bili-parse-route.test.ts` 14/14、`video-bilibili-hd-parser.test.ts` 20/20（含 A3 组 9 条）、
`compose-env-parity.test.ts` 8/8。全量前端套件 **264 文件 / 3086 条全绿**。
`tsc --noEmit`（CI 同款，`apps/web`）：本次涉及的文件 0 条错误；仓内其余 24 条来自并行会话的进行中改动
（`quick-access-tray.tsx`、`category-board.tsx` 等，未动）。`eslint`：0 error / 10 warning，与改动前同数。

**消融自证**（逐条拆掉防护，确认对应判据变红，再按 md5 逐字节还原；日志在临时目录，不进仓库）：

| 摘掉什么 | 红了哪条 |
| --- | --- |
| GET 里的 key 不再拦 | query 里有 access_key 直接 400… |
| 限流不按调用方分桶（全走一个桶） | 限流按调用方分桶：别人不会被你刷的那几名下线 |
| 429 与 503 塌成同一个状态码 | 并发满了给 503（与「你打太快」分开报） |
| 带 key 的响应照旧进共享缓存 | body 里的 accessKey 原样交给解析器，响应一律 no-store |
| POST 绕过预算（只留 finally 归还） | 4 条：POST 组三条 + POST 与 GET 共用同一份预算 |
| 播放器把 `engine` 改名 `engineId` | 播放器发的每个字段都被路由读取 |
| 播放器把 key 拼回 URL | 解析请求的 URL 不带 query |
| 被限流后不写提示条 | 被预算拦下时如实区分「你太快」与「大家都挤」 |
| 访客 key 无条件出站 | 6 条：默认不转发 / 操作者 key 照旧 / 真实出站形状 / 如实标注 / 被拦时按操作者档分桶 / 星之阁主链路 |
| 被拦下却不标注 | key 被拦下时如实标注；正常情况不挂多余的 false 字段 |
| 缓存桶塌成单一 `anon` | 开启转发后，两把不同的 key 不共用同一份解析结果 |
| 没有 WebCrypto 时也硬缓存 | 环境没有 WebCrypto 时对带 key 的请求不缓存 |
| compose 不再透传转发开关 | 每个中枢/web 服务都活跃地透传安全变量 |
| 兜底结果不再标 `accessKeyIgnored` | 被预算拦下时如实区分…（徽标谎称「VIP 密钥已启用」） |

**真人浏览器 + 真进程实测**（隔离栈：中枢 `:8900` 用 dev 库的 sqlite backup 副本
`data/e2e/navhub-a3.db`；前端 `NEXT_DIST_DIR=.next-a3-dev next dev -p 3422/3433`；未碰并行栈 `:8787`）：

1. `GET /api/videos/bili-parse?bvid=…&access_key=SECRET_DO_NOT_LOG`
   → `HTTP 400 {"ok":false,"code":"credential_in_query","error":"…请改用 POST /api/videos/bili-parse 的请求体"}`
2. `POST {bvid, accessKey:"SECRET_DO_NOT_LOG", engine:"xingzhige"}`（默认开关）
   → `HTTP 200`、`cache-control: no-store`、响应含 `accessKeyIgnored: true`，全响应体里搜不到那把 key。
3. 同一调用方连打：`200 ×12 → 429`，429 体 `{"ok":false,"code":"rate_limited"}` + `retry-after: 10`；
   **换一个 `x-forwarded-for` 立刻回到 200**（分桶生效，不是全局熔断）。
4. `/videos/player` 页面里填 key 点「应用」，页面内 `fetch` 拦截器记到的真实请求：
   `method: POST`、`url: /api/videos/bili-parse`（**无 query**）、`bodyKeys: ["p","bvid","accessKey","forceRefresh"]`。
   密钥面板渲染出「它等同于你的 B 站登录凭据…默认不出站——需要管理员显式开启 NAVHUB_BILI_FORWARD_USER_KEY=1」，
   徽标显示「密钥未被使用」。
5. 把该调用方额度打满后点「重新解析」→ 页面出现提示条原文：
   「解析太频繁，已先用官方内嵌播放（清晰度受限）。等十几秒再点【立即换源】。」
   此时徽标为「密钥未被使用」（这条是实测中发现的真缺陷：兜底结果原先不带标注，徽标会继续谎称密钥已启用，已修并被第 14 条消融钉住）。
6. 换进程带 `NAVHUB_BILI_FORWARD_USER_KEY=1` 重启，两把不同的 key（`KEY_AAA` / `KEY_BBB`）解析同一片段：
   返回的 `expiresAt` 不同（各自重新出站），再用 `KEY_AAA` 第二次请求 ⇒ `expiresAt` 与第一次逐位相同（命中同一桶）。
   测试用的是编造的 `FAKE_KEY_…` 串，不是任何真实凭据；用完已清掉浏览器 `localStorage` 里的那份。

## 六、已知残留

- `StreamBudget` 按进程计，多副本要按副本数换算实际总闸（见「明确不做的」）。
- `callerKey` 取的是 `x-forwarded-for` 首段：**未经信任的反代下它可以被伪造**，只适合当限流分桶，
  绝不能当身份。前反代必须覆盖该头（与 `bili-stream` 同一前提）。
- 桶摘要取 SHA-256 前 8 字节（16 位 hex）：碰撞概率对「几个账号」的场景足够，但它不是加密承诺，
  不要把它当成可以公开的反查依据。
- 只有星之阁引擎吃 `access_key`：其余 5 个引擎的「1080P」承诺本来就不来自这把 key，
  面板文案已按这条写。
- 限流后用户仍可点【立即换源】再打一次，会再吃一格额度。文案写了「等十几秒」，但没做按钮禁用；
  真要做需要把剩余窗口回传（`Retry-After` 目前是固定 10s，不是实时余量）。
