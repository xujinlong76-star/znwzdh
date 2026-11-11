# 审计结论：「后端控制前端」+「用户中心管个人内容」（2026-11-11）

代码基线：main @ 8412679。应用在 `apps/web-overlay`（Next.js），中枢 API 在
`apps/api`（Fastify，:8787），存储在 `packages/store`（SQLite/PG 双言）。

## 一、站点级：已有什么

站点配置的存储与读写通道**早已存在且做得相当扎实**，本轮是扩展，不是新建：

- 存储：中枢 KV 路径 `src/navsphere/content/site.json`，经 StorageAdapter
  （`lib/storage-adapter.ts` / `lib/github.ts`）读写；不是写死在构建里。
- 写口：`POST /api/site`（web 层），`verifyAdminSession()` 鉴权（NextAuth
  会话 + 管理员判定；管理员可用 NAVHUB_ADMIN_PASSWORD / NAVHUB_ADMIN_TOKEN
  经 credentials 登录）。语义为「读现值 → 深合并 → 写回」，按 tab 部分更新，
  写后 `revalidateTag(..., {expire:0})` 立即失效前台缓存。
- 读口：前台 RSC 走 `lib/site-config-source.ts` 的 `readSiteSettings()`
  （带标签 Data Cache）；公开原始读有 `GET /api/home/site`。
- 后台页：`/admin/site`（`page.impl.tsx`，5 个 tab：基本信息/外观/分享图/
  导航设置/页脚与备案），字段经 zod schema（`lib/site-settings.schema.ts`）
  校验、读侧 `normalizeSettings` 归一化（脏值折叠、永不抛错）。
- 已可控字段：站名 title、描述 description、关键词、ogImage、logo、
  favicon、PWA 图标、默认主题、主题色、外链打开方式与 rel 策略、页脚文案、
  备案号。前端消费点已核实：`app/layout.tsx`（标题模板、品牌、页脚、主题
  默认值）、`app/manifest.ts`、SEO metadata、首页 h1 与副文案
  （`components/navigation-content.tsx` 读 `siteData.basic.*`）。

## 二、站点级：缺什么（写死/不可控）

1. **没有公告**：全站没有任何公告条组件，后台无公告开关/文案字段。
2. **没有功能开关**：首页模块（AI 找站、短剧影院、首访引导、极速启动展板）
   与全局小猫猫挂件（`layout.tsx` 里无条件 `<Script src="/xiaomaomao/...">`）
   全部写死渲染，后台关不掉。
3. **没有副标题/标语字段**：首页 h1 下的文案直接用 description（SEO 描述）
   兼任，两者被迫同文。
4. **首页板块顺序不可控**：模块顺序写死在 `navigation-content.tsx` JSX 里。
5. 用户在首页有本地「移除模块」能力（localStorage `nav_pruned_ids`），但那
   是访客级本地掩码，与全站配置无关、不同步。

## 三、用户中心：已有什么（后端比想象中全）

中枢 API 已有完整的账号级用户数据面（`apps/api/src/routes/`），且 web 侧
`/api/me/[[...path]]` 已做代理、前端 `me-view` / `me-settings-view` 已接线：

- 收藏 `routes/favorites.ts`：增删、改备注/标签/文件夹、文件夹 CRUD、
  分页+标题/时间排序、清空、增量同步与版本水位。**真服务端持久化**。
- 追剧清单：`POST /api/me/watchlist/sync`（与收藏同一同步协议），
  `/me/watchlist` 页已存在。
- 设置 `GET/PATCH /api/me/settings`：个性化开关、默认搜索引擎、新标签打开、
  卡片密度、快捷键、搜索历史开关、遥测开关、历史保留天数——存
  `user_settings.preferences_json`（`packages/store/src/repository/settings.ts`），
  真跨设备。
- 搜索历史 `routes/history.ts`：列表、单删、批删、清空。
- 个人数据清除：`DELETE /api/profile`（画像信号）、`DELETE /api/me`
  （注销级）、`/me/data` 页有本地数据管理。
- 个人令牌、会话设备管理、通知，均已实装。

## 四、用户中心：缺什么 / 假什么

1. **没有「自定义站点」**：收藏 POST 强制 `siteId` 必须是目录内已有站点
   （不存在回 404），用户无法把自己的网址存进个人区。`/custom` 页是模块化
   工作台（本地持久化），不是自定义站点。
2. **主题/皮肤偏好不进服务端设置**：主题只存 next-themes 的 localStorage，
  换设备丢失；`user_settings` 里没有 theme 字段。
3. **首页个人模块显隐只存本地**：`nav_pruned_ids`（localStorage）不跨设备；
  服务端设置里没有对应字段，登录后新设备要重新移除一遍。
4. 收藏不能改「标题」：收藏指向目录站点，标题由目录决定，只有备注可改
   （模型使然，记一笔，不强改）。

## 五、本轮实现计划（按主题取舍）

站点级（扩展现有 site-settings 体系，不另起炉灶）：
- `basic.tagline`：标语，与 description 分离，首页 h1 下优先展示 tagline。
- `announcement`：{enabled, text, linkUrl?, startAt?, endAt?}——含定时上下线
  （授权提到的顺手项，字段校验成本低、价值直观）；全站公告条组件挂 layout，
  服务端按窗口期判断，前台运行时读配置。
- `features`：模块开关 {aiFinder, dramaCinema, onboarding, heroDeck,
  xiaomaomao}，默认全开；首页与 layout 消费。
- `home.order`：首页可控板块（aiFinder/dramaCinema/onboarding）的排序数组，
  后台上/下移；归一化保证缺失/脏值回退默认序。

用户级（扩展现有 me/settings 与 store）：
- 新表 `user_custom_sites` + 仓库方法 + `routes/custom-sites.ts`
  （GET/POST/PATCH/DELETE /api/me/custom-sites，含 sortOrder 排序），身份/
  信任校验与收藏同口径；web 新增 `/me/sites` 页管理（增删改、排序），并在
  用户中心导航加入口。
- 设置新增 `themePreference`（light/dark/system，null=未设）与
  `hiddenHomeModules`（string[]）两个服务端偏好：登录后由客户端同步组件
  应用（主题走 next-themes、模块掩码写入既有 `nav_pruned_ids` 机制），
  实现「个人设置覆盖全站默认」的最小闭环：全站 features 开着、个人隐藏了
  就不显示（经既有 isModuleHidden 机制生效）。

不顺手开的（与主题无关，记一笔）：收藏标题自定义、三级分类、场景包全站
开关（入口分散在导航数据里，属导航编辑范畴，不是布尔开关能收口的）。

## 六、本轮调研结论（2026-11-11，动手前查证）

按 William 的长期纪律，先查业界做法再动手，查了三组：

1. **功能开关/远程配置平台**（Unleash、Flagsmith、Flipt、GrowthBook、
   ConfigCat 的架构对比）：两类评估模型——服务端评估（每次求值一次 API
   调用）与本地评估（下发整份 config.json、本地求值，ConfigCat 默认 60s
   轮询）。平台全家桶都要独立服务 + 独立库 + SDK + 前端代理层。
   **本仓不引入**：本站开关只有个位数、配置是一份 JSON 文档，现有
   site.json + 写时校验 + 标签失效本质就是 ConfigCat 式「整份配置下发 +
   本地评估」，且失效是写后立即过期（revalidateTag expire:0），比 60s
   轮询更强。引入 Unleash 类服务等于多养一个有状态服务，违背「少而实」。
2. **配置下发的缓存/失效**（ETag 条件请求与 Azure AppConfig 的 sentinel
   模式）：通行做法是「哨兵键/版本号派生 ETag + 条件 GET」，ETag 应由
   版本计数或 updated_at 派生、不要哈希响应体。本仓用户面已有同款实现
   （`/api/me` 的 ETag/304 协商缓存、收藏的 version 水位线），站点配置走
   Next Data Cache 标签失效已等价覆盖，本轮不另造轮询层。
3. **账号级偏好同步**（多端同步的通行模式）：共识是服务端为事实源、
   字段级合并 PATCH（JSON Merge Patch 语义）、标量偏好用 last-write-wins
   可接受、增量同步用服务端水位线。本仓现有 `/api/me/settings` 的
   PATCH 部分更新 + `preferences_json` + 收藏 version 水位正是这套，
   本轮新增偏好字段沿用同一协议，不新建同步通道；CRDT/OT 对单用户偏好
   属过度设计，明确不用。

一句话：**选「扩展现有配置文档 + 现有同步协议」，不用更重的平台方案**——
先进性体现在校验/失效/合并语义都对齐业界共识，而不是多装一个系统。

## 七、实施结果（本轮落地）

站点级（扩展现有 site.json 配置文档，零新依赖）：
- `basic.tagline` 标语（与 SEO description 解耦，首页副标题优先读它）。
- `announcement` 首页公告：开关 + 文案 + 链接 + **定时窗口 startAt/endAt**
  （`isAnnouncementVisible` 判定，到点自动上下线）；layout 顶栏渲染
  `components/announcement-bar.tsx`。
- `features` 功能开关 5 个：aiFinder / dramaCinema / onboarding / heroDeck /
  xiaomaomao（挂件脚本注入点受控）；归一化口径「只有显式 false 才关」，
  脏值/缺失一律按开，配置写坏也关不掉全站。
- `home.order` 首页编排：上述前三块按后台顺序渲染；后台「公告与功能」
  新 tab 提供开关、顺序上下移、公告定时（datetime-local ↔ epoch 互转）。
- 写侧 zod 同步扩展；`POST /api/site` 的 isEmptySettings 防线已把新字段
  计入「已配置」判定。

用户级（账号级持久化，服务端为事实源）：
- **自定义站点**（全新）：`user_custom_sites` 表（SQLite/PG 双言 DDL +
  迁移）、仓库层 CRUD + 全集重排、上限 200/人；中枢
  `GET/POST /api/me/custom-sites`、`PATCH/DELETE /api/me/custom-sites/:id`、
  `POST /api/me/custom-sites/reorder`（显式 scope=public + 处理器内签名身份
  与 favorites 域闸，与收藏同级）；已登记数据清单（注销必删）、REST 契约
  与路由策略快照；用户中心新页 `/me/sites`（增删改 + 上下移排序）并入导航。
- **偏好同步补两字段**：`themePreference`（light/dark/system/null）与
  `hiddenHomeModules` 进 `PATCH /api/me/settings` 与 preferences_json；
  设置页加「主题（账号级）」选择 + 4 个首页模块个人显隐开关；新组件
  `UserPrefsSync` 登录后把云端主题（每会话一次）与模块掩码落地本机，
  个人隐藏叠加在全站 features 之上（个人优先于全站默认，全站关仍为关）。
- 收藏/追剧/历史/一键清除：审计确认既有实现完整（文件夹、备注、排序、
  版本水位同步、单删、清空、注销删净），本轮未重造；收藏改名不做
  （标题归目录所有，备注字段已覆盖该需求）。

验证：新增/扩展测试 3 文件（store 4 + api 7 + web 6 用例）全过；受影响
门禁（route-policy / response-contracts / hub-policy / generated 4/4 /
前端类型 0 错）全过；本地全栈实测（API :8791 + Web :3100，隔离库）：
管理员改站名/标语/公告后首页 HTML 即刻出现新值，关 aiFinder 与
xiaomaomao 后刷新对应模块与脚本消失；普通用户注册登录后加自定义站点、
改主题与隐藏模块，换新会话仍在。全量测试 7921 过 / 18 红，红的全是
基线既有问题（其中 category-registry、nav-icons 已被上游 50dd6771 修复，
SitePeek/SearchPalette 为已登记在修项），本轮引入的红已全部修清
（main-landmark / url-hygiene / a11y 类名 / 契约与策略登记）。
