### P0-2 视频 sitemap 用可伪造 Host 头拼 origin（Host 头投毒）
```ts
// apps/web-overlay/src/app/videos/sitemap.xml/route.ts:26-30
const host = request.headers.get('host') || 'localhost:3000'
const protocol = host.startsWith('localhost') ? 'http' : 'https'
const siteUrl = `${protocol}://${host}`
const sitemap = generateVideoSitemapXml(items, siteUrl)
```
**风险**：`apps/web-overlay/src/app/robots.ts:34` 把 `${origin}/videos/sitemap.xml` 公布给爬虫；`lib/seo/origin.ts:8-30` 已明确「Host / x-forwarded-* 可由客户端伪造，Host 头投毒会把 canonical、sitemap、OG 全部指向攻击者域名」并做了 `originFromHeaders` 格式收敛 + `normalizeConfiguredOrigin` 优先环境变量。唯独这个 route **没复用该唯一事实源**，直接裸读 `host`，且响应带 `s-maxage=3600`（`route.ts:36`）——一次投毒请求可让 CDN 缓存一整份指向攻击者域名的视频 sitemap。

**改进**：`import { siteOrigin } from '@/lib/seo/origin'`，`const origin = await siteOrigin(); if (!origin) return 503`（与 `app/feed.xml/route.ts:24-33` 完全同构）；去掉手工 `host/protocol`；补 `test/video-sitemap-origin.test.ts` 断言「Host: evil.example 时输出仍为 NAVHUB_SITE_URL」与「缺 origin 返回 503」。同步改 `Cache-Control` 与 `robots.ts` 口径。

---

## 2. P1 高

### P1-1 巨型文件：单文件承载 30+ hooks 与 15+ handler，无分层
**证据**
- `components/plugins/plugin-url-health-panel.tsx:1` `'use client'`，3092 行、10 个顶层 export、33 处 hooks、4 个 handler、17 处 `await`、仅 1 处 `Promise.all`（`1616`）；`18-57` 单条 import 拉 35 个 lucide 图标。
- `app/favorites/page.tsx:105-145`：一个组件内 22 个 `useState` + 6 `useEffect` + 6 `useCallback`（37 hooks），同时管本地收藏、云端同步、文件夹、标签编辑、批量选择、排序、渐进渲染、保险库加解密。
- `components/video-player-page.tsx` 2760 行 / 22 函数 / 16 handler / 14 hooks，且 `1002-1008` 在客户端组件里注入 JSON-LD（见 P1-4）。
- `lib/navhub-api.ts` 3635 行 / **247 个 export** / 145 函数，把搜索、标签、榜单、收藏、点击上报、离线队列、插件、AI 配置全塞进一个模块。

**风险**：任何改动都要回归整个交互面；单文件 3000 行让 code review（`docs/CODE-REVIEW.md:54` 硬性要求「单 PR ≤400 行 diff」）事实上无法执行；`React Compiler` 的 5 条规则被 `eslint.config.mjs:32-36` 降为 warn，巨型组件的重渲染问题无门禁。文档 `docs/CODEBASE_OVERVIEW.md:472-474` **已记录**「巨型文件 P1，建议按容器/视图/hooks/纯函数四层拆分」，但清单已过时（写的是 `algorithm-lab.tsx 2212`、`sitelist/page.tsx 2063`，前者已不在树里、后者现 1538），且**没有任何可执行拆分方案或门禁**。

**改进方案**（按依赖顺序，每个文件单独 PR）
1. **先纯逻辑下沉**（零风险、可单测）：`navhub-api.ts` 按域拆 `lib/navhub/{search,tags,rank,favorites,click-outbox,plugins,admin}.ts`，保留 `lib/navhub-api.ts` 为 re-export 桶（调用点零改动，与 `lib/github.ts:1-10`「保持签名不变」同一手法）；为 `degrade`/`identity` 已有边界补 `test/navhub-api-barrel.test.ts`。
2. **再抽 hooks**：`favorites/page.tsx` → `hooks/use-favorite-folders.ts`、`use-cloud-sync.ts`、`use-batch-selection.ts`、`use-vault.ts`，页面只留组装与 JSX；`plugin-url-health-panel.tsx` → `lib/health-panel-state.ts`（已存在，继续扩）+ `hooks/use-health-batch.ts` + 4 个 Tab 子组件。
3. **加棘轮门禁** `scripts/check-file-size.mjs`：对 `apps/web-overlay/src/**/*.tsx` 设阈值（新文件 ≤600 行，存量 >1200 行的 11 个文件登记进 `allowlist.json`、只许减不许增），进 `pnpm verify` 默认档与 CI `check-web-overlay`。这把「文档建议」变成「可执行约束」。
4. `generated` 文件（`rest-contracts.generated.ts`、`hub-route-policy.generated.ts`）加入 `.gitattributes linguist-generated` 与 size 门禁白名单，避免误拆。

### P1-2 39/70 页面整页 `'use client'`，SEO 元数据只能靠 layout 兜底
**证据**
```tsx
// apps/web-overlay/src/app/favorites/page.tsx:1
'use client'
...
// apps/web-overlay/src/app/favorites/layout.tsx:11-16（服务端 layout 补位）
export const metadata: Metadata = {
  title: '我的收藏', description: '你收藏的站点',
  robots: { index: false, follow: true },
}
```
- 客户端页面清单：`admin/*` 22 个（`admin/sitelist/page.tsx:1` 1538 行、`admin/plugins/page.tsx:1` 1346 行）、`auth/*` 5、`me/*` 5、`marketplace/{import,installed,mine,publish}` 4、`favorites`、`preferences`。
- 已做对的：`app/site/[id]/page.tsx` 与 `app/collections/page.tsx` 已 RSC 化（`docs/seo/link-architecture-navhub.md:229`、`docs/seo/SEO-OPTIMIZATION-PLAN-2026-10-20.md:188` 记录了这次拆分），`app/providers.tsx` 的 `metadata` 分层也已成体系；`app/page.tsx:52` `revalidate = 60`。
- **但 `app/admin/layout.tsx:13-25` 的 `generateMetadata` 没有 `robots: { index: false }`**，而 `robots.ts:30` 只 Disallow `/admin`（`docs/seo/robots` 注释明确「Disallow 会让爬虫读不到 noindex」）——22 个后台页若已进索引，无法自行退出；与之对照 `auth/layout.tsx:14`、`me/layout.tsx:14`、`favorites/layout.tsx:14`、`preferences/layout.tsx:14` 都写了 noindex。
- 未注入 `NAVHUB_SITE_URL` 时 `lib/seo/metadata.ts:118-126` 会**完全不输出 og:image**（`app/layout.tsx:50-56`、`76` 也记录了这个「知情交易」），属于已文档化的降级，不算缺陷。

**改进**：
1. `admin/layout.tsx:13` 的 metadata 补 `robots: { index: false, follow: false }`，新增 `apps/web-overlay/test/admin-noindex.test.ts`（与既有 `indexation-policy.test.ts` 同配方）。
2. 对 4 个「公开可收录但整页客户端」的路由做 RSC 壳改造（优先级 `marketplace/page.tsx`/`tags/page.tsx` 若仍是客户端、`favorites` 保持私密可不动）：`page.tsx`（RSC，`generateMetadata` + `hubGet` 注入 initialData）+`xxx-client.tsx`（原样搬 `'use client'`）。复用 `app/collections/page.tsx:25-38` 已验证的「服务端取数 + 客户端岛」模板。
3. 验收：收录面路由 RSC 占比从 31/70 提升到 ≥45/70；`pnpm seo:audit --all` 的 canonical/og 覆盖率 100%。

### P1-3 两套 `Providers` 并存，其中一份是死代码且已漂移
- `app/layout.tsx:9` `import { Providers } from '@/components/providers'` ⇒ 全仓 grep `app/providers` **0 引用**，`apps/web-overlay/src/app/providers.tsx`（49 行）是死代码。
- 两者职责重叠且已分叉：`app/providers.tsx:7-9` 静态引入 `sonner`/`Toaster`/`OfflineBanner`/`SessionProvider`/`PredictivePrefetchProvider`；`components/providers.tsx:15-24` 把 sonner 与主题试用条改成 `next/dynamic({ssr:false})`，并额外挂 `SWRConfig`/`SiteContext`/`DensityProvider`/`VideoPlayerProvider`/`GlobalAiGateway`/`GlobalSpotlightGateway`。`docs/AUDIT-2026-10-20.md:17` 记录的「根布局静态拉入 sonner 改为动态加载，首屏 -11.2 KB」正是发生在 `components/providers.tsx`，说明死文件保留的是**修复前**版本。
- 同类重复（case-insensitive basename）：`components/ui/{button,dialog,input,textarea}.tsx` ↔ `registry/new-york/ui/*`（4 组）、`app/components/ThemeToggle.tsx` ↔ `components/ThemeToggle.tsx` ↔ `components/theme-toggle.tsx`（web-only 底座，`docs/CODEBASE_OVERVIEW.md:486-488` 已标注为「旧版遗留」）。

**改进**：删除 `app/providers.tsx`（overlay + 镜像同步）；在 `scripts/check-component-contracts.mjs` 旁新增 `scripts/check-dead-modules.mjs`，用现有 `scripts/lib/source-refs.mjs` 的 `extractSpecifiers` 建反向引用图，对 `src/**` 中「0 入边且非路由约定文件/非 `index` 桶」的模块报红；先跑一次把白名单固化。`components/ui` ↔ `registry/new-york/ui` 的重复由 `docs/CODEBASE_OVERVIEW.md:487` 已定性为 vendored 遗留，建议只做「统一 import 别名」不删文件（删会破坏上游 tarball 合并）。

### P1-4 客户端组件注入 JSON-LD 到一个 `noindex` 的 `force-dynamic` 页面
```tsx
// apps/web-overlay/src/app/videos/player/page.tsx:10,31
export const dynamic = 'force-dynamic'
robots: { index: false, follow: true },
// apps/web-overlay/src/components/video-player-page.tsx:1002-1008（'use client'）
{/* Schema.org VideoObject 搜索引擎结构化数据 */}
{videoSchema && (
  <script type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: jsonLdScript(videoSchema) }} />
)}
```
**风险**：结构化数据挂在「明确不索引 + 每请求现渲」的页面上，Google 永远不会消费；而 `videoSchema` 由 `useMemo`（`video-player-page.tsx:357`）在客户端算出，爬虫拿到的是首帧无 `selectedVideo` 的空壳，JSON-LD 根本不进 HTML。同时 `app/videos/v/[id]/page.tsx`（`revalidate=300`、可收录）才是该放 `VideoObject` 的地方。`docs/seo/TECHNICAL-SEO-AUDIT` 与 `lib/seo/json-ld.ts:3-12` 的三条红线都没有覆盖「客户端注入 + noindex」这一组合。

**改进**：把 `generateVideoObjectSchema` 的调用上移到 `app/videos/v/[id]/page.tsx` 的 RSC（该页已有 `dangerouslySetInnerHTML` 一处），用 `JsonLd` 组件 + `jsonLdScript`；`video-player-page.tsx:1002-1008` 删除。播放页 `force-dynamic` 若无服务端取数必要，改为 `revalidate=60` + RSC 壳（与 P1-2 同模板）。

### P1-5 请求瀑布：批量体检/自愈是「每包 3 次串行 POST × N 包」
```ts
// components/plugins/plugin-url-health-panel.tsx:1904,1930,1976（auto-heal 循环体内）
activeRes = await hubSend<AuditResult>(`/plugins/${...}/audit`, 'POST', {...})
const healRes = await hubSend<AiHealResult>(`/plugins/${...}/ai-heal`, 'POST', {...})
const fixRes = await hubSend<{...}>(`...`, 'POST', {...})
```
`1832` / `2039` / `2152` 是同一链条的三份复制（单包体检 / 批量体检 / 批量自愈），`1826` 外层 `for` 逐包 `await`，全库 200 包最坏 600 次串行往返。对照 `app/sitemap.ts:107-133` **已修**：`loadActiveSites` 改成 `SITE_BATCH=4` 的 `Promise.all` 并注释「串行 10 页首访 9.85s」。`app/page.tsx:61-65` 的 `getData` 也已 `Promise.all` 并行。

**改进**：把三条链抽成 `lib/health-panel/{audit,heal,fix}.ts` 纯函数（顺带完成 P1-1 拆分），循环体改有界并发 `p-limit`（并发 4，与 `sitemap.ts` 同档），用 `AbortController` 串起 `cancelBatchRef`；`Promise.allSettled` 已在 `1616` 用于首屏两路，扩展到批量即可。验收：200 包全量体检墙钟下降 ≥60%，并在 `test/health-panel-batch.test.ts` 用 fake timers 断言并发度上限。

### P1-6 镜像同步「合并式 + 生成器 + --staged」的结构性脆弱（根因未消除）
- `scripts/generate-web-mirror.mjs:9-17,65`：`逐文件覆盖，不删除 web 里的任何其它文件`。⇒ overlay 里**删除或重命名**一个文件，`apps/web` 的旧副本会永久残留（幽灵文件被打包/被 import），而 `check-web-overlay.mjs` 的正向检查只看「overlay 有 ⇒ web 有且一致」，看不出幽灵。
- `scripts/check-web-overlay.mjs:200-207`：反向候选 **仅 `console.warn`，退出 0**；当前就有 126 个 web-only 文件（124 在 src），其中 `app/components/*`、`components/Navigation*.tsx` 是 `docs/CODEBASE_OVERVIEW.md:486-488` 明确标注的死代码，永远不会被门禁清理。
- `package.json:37` `"check:overlay": "node scripts/generate-web-mirror.mjs && node scripts/check-web-overlay.mjs"`：**先跑生成器会无条件用 overlay 覆盖 apps/web**。`check-web-overlay.mjs:38-43` 自己警告「若这次的改动本来就在 apps/web 侧（还没回移植到 overlay），请先把改动合回，否则 --fix 会把它盖掉」——但 `check:overlay` 把覆盖做成了默认动作，等于把这个警告变成了自动执行的静默数据丢失。
- `check-web-overlay.mjs:29-32` 的 `--staged`（pre-commit）只判本次提交涉及的文件，仓库级漂移留给 CI；`ci.yml:689` 的 CI 检查**不带生成器**（`686` 先 `vendor-web.mjs`），所以 CI 是「真校验」、本地是「自愈」，两侧语义不一致。
- `scripts/lib/overlay-drift.mjs:17` 亲口承认排除规则「不能直接 import sync-web-overlay.mjs，改了那边记得同步改这里」——**两份排除规则靠人肉同步**，正是该领域最典型的漂移源。

**已有覆盖（避免重复建议）**：`scripts/check-web-overlay.mjs`（正向严格 + git 跟踪自研文件硬失败 + `upstream-baseline.json` 第三向 + 反向告警）、`scripts/sync-overlay-drift.mjs`（定点同步）、`scripts/apply-web-overlay.mjs`、`scripts/sync-web-overlay.mjs`（联网拉上游确诊）、`scripts/generate-web-mirror.mjs` 4 个工具分工已在脚本头部写清；`scripts/test/generate-web-mirror.test.mjs`、`scripts/lib/overlay-drift.test.ts`、`scripts/check-core-mirrors.mjs` 均有单测；`ci.yml:657-709` 有独立 job + 撤防账；`docs/CODEBASE_OVERVIEW.md:457-463` 已把「双目录同步」列为 P0 并建议「长期以构建期注入替代双副本」。**当前 738/738 一致，不是失修，是机制性风险。**

**改进**（不推翻现有体系，补三个缺口）
1. 给生成器加 **`--prune` 孤儿回收**：以 `upstream-baseline.json` + `vendor-web.mjs` 的产物清单为白名单，删除「web 有、overlay 无、不在基线、不被 git 跟踪」的 `src/**` 文件；默认 dry-run 打印清单，`--apply` 才删。补 `test/generate-web-mirror-prune.test.mjs`（临时目录隔离，脚本已支持 `--source/--target`）。
2. 把 `check:overlay` 改名为 `mirror:web`（生成）并**拆开**：`check:overlay` 只做纯校验（`node scripts/check-web-overlay.mjs`），`--fix` 才走生成器，避免本地静默覆盖未回移改动；保留 `pnpm mirror:web` 作为显式动作。
3. 排除规则抽到 `scripts/lib/overlay-drift.mjs` 单份导出，`sync-web-overlay.mjs` 与 `vendor-web.mjs` 都 import 它（后者目前靠 `.gitignore` 与手工清单）；加 `test/overlay-exclude-parity.test.ts` 断言三处口径一致。
4. 长期：按 `docs/CODEBASE_OVERVIEW.md:463` 的既定方向，让 `apps/web` 在 Docker/CI 构建期由 `vendor-web.mjs` 从 `apps/web-overlay` 生成、不再提交双份（当前 CI 已是这个形态，本地可跟进）。

---

## 3. P2 中

### P2-1 类型安全：`any` 293 处、0 个 `@ts-ignore`（好事），但规则全是 warn
`apps/web/eslint.config.mjs:20` `"@typescript-eslint/no-explicit-any": "warn"`；`32-36` 把 React Compiler 5 条诊断（`set-state-in-effect`/`immutability`/`refs`/`purity`/`incompatible-library`）全部降为 warn，注释说明「命中的几乎全是 vendored 上游组件」。但 `ci.yml:247` 跑的是 `eslint .` **不带 `--max-warnings 0`**，warn 不阻断。
`any` 集中：`lib/navhub-api.ts`38、`components/navigation-category-section.tsx`25、`lib/modular/diy-presets.ts`17、`components/video-auto-harvest-dialog.tsx`11、`lib/modular/layout-sync.ts`10。
**改进**：把 `no-explicit-any` 按目录分级——`src/lib/**`、`src/app/api/**` 设 `error`，`src/components/**` 暂留 warn 并配 `scripts/check-any-ratchet.mjs`（按文件登记当前计数，只许减）；`scripts/typecheck-video-scope.mjs:681` 已证明「按目录增量收敛」在本仓库可行，直接复用其 `--scope` 机制。验收：`lib/` 内 `any` 从 ~90 降到 0。

### P2-2 水合：仍有一处 SSR/CSR 首帧分歧（同类问题已在别处修过）
```tsx
// apps/web-overlay/src/app/favorites/page.tsx:130-132
const [localFolders, setLocalFolders] = useState<LocalFolder[]>(() =>
  typeof window === 'undefined' ? [] : readLocalFolders(),
)
```
`readLocalFolders()`（`89-95`）读 localStorage；SSR 返回 `[]`、客户端首帧返回真实文件夹，而 `333` 的 `folders` 直接参与渲染 ⇒ 水合文本/列表不匹配。对照 `components/quick-tools-drawer.tsx:40-44`：
```tsx
// 水合安全：Date.now() 在 SSR 与客户端必然不同，不能做 useState 初始值（文本水合不匹配）
const [currentTs, setCurrentTs] = useState(0)
useEffect(() => { setCurrentTs(Date.now()) }, [])
```
`docs/acceptance-report.md:570` 已把这类问题列为「P1 水合不匹配」并修复；`hooks/useFavorites.ts:129-140` 用 `useSyncExternalStore` 的三参 `getServerSnapshot` 做对了同一件事。**修法照抄**：`localFolders` 初始 `[]`，在已有 `useEffect`（`278-279` 附近）里 `setLocalFolders(readLocalFolders())`，与 `useIdentityReady` 的「等就绪」语义对齐。
另：`suppressHydrationWarning` 6 处（`app/layout.tsx:135,212`，`components/footer.tsx`×2，`app/auth/{signin,signup}/page.tsx` 各1）——根布局用于主题/密度预绘脚本属合理，但 auth 页两处应逐条复核是否掩盖了真实的不匹配。

### P2-3 `error.tsx` 在 render 阶段发网络上报（副作用）
```tsx
// apps/web-overlay/src/app/error.tsx:35-42
useEffect(() => { console.error('Next.js Page Error:', error) }, [error])
// 上报到中枢（脱敏：只发分类 + 指纹 + pathname + digest；开关默认关闭）
reportClientError({ message: error?.message ?? String(error), digest: error?.digest })
```
`reportClientError`（`lib/client-error-report.ts:82-90`）内部 `sendBeacon`/fetch + 模块级 `sent` Set 写入，属于 render 期副作用；StrictMode 双调用、React 重渲染都会触发，`sent` 去重是唯一的兜底。**且 `eslint.config.mjs:34` 把 `react-hooks/purity` 降为 warn，正好让这条漏网**（该规则本该报它）。把上报挪进上面的 `useEffect` 即可，并把 `react-hooks/purity` 在 `src/app/error.tsx` 与 `global-error.tsx` 上恢复为 error。

### P2-4 错误/加载态覆盖不均
- `error.tsx` 18 个，但 `admin/` 下 22 个页面**只有 `admin/loading.tsx` 一个、零 `error.tsx`**（`admin/ai`、`admin/sitelist`、`admin/plugins` 等均 `L-`）；`auth/*` 5 个页面 `loading` 与 `error` 双缺；`algorithms`/`graph`/`me/*`/`preferences` 有 loading 无 error。
- 好消息：`app/error.tsx` 本身是高质量实现（`describeCrash` 分类 + digest + 可复制诊断 + 重试按钮），`useMeOverview` 有 `loading/anonymous/ready/error` 四态，`hooks/useIdentityReady.ts:26-35` 有 3 秒兜底——**错误处理框架已具备，缺的只是覆盖**。
- **改进**：为 `admin/` 补一个 `app/admin/error.tsx`（段级边界自动覆盖全部 22 个子页），`auth/` 补 `app/auth/error.tsx`；剩余按「有取数的路由」清单补齐。验收：70 个 `page.tsx` 中带可达 `error.tsx` 的比例从 ~50% 到 100%（段级继承算覆盖）。

### P2-5 图片与字体
- `<img>` 34 处、`next/image` 7 处，`eslint.config.mjs:27` `"@next/next/no-img-element": "off"`，`next.config.js:62` `unoptimized: true` 且注释写明「任意第三方 favicon 直出」——**这是有意的架构决策，不建议改**。`alt=` 35 处与 img 34 处基本 1:1，覆盖良好。
- 字体：`app/layout.tsx:27-29` `const inter = { variable: '' }`，注释说明「优雅回退至原生系统字体栈，解耦构建期对 Google Fonts 网络的依赖」，但 `public/fonts/inter.css` 与 `public/fonts/inter-var-latin.woff2`、`src/app/fonts/inter-var-latin.woff2` 仍在仓库且**无任何引用**（全仓 grep `inter.css` 0 命中）⇒ 死资源。`tailwind.config.js:4-9` 的 content 只扫 `pages/components/app/registry`，**漏了 `src/hooks/**`、`src/lib/**`、`src/contexts/**`**（这些目录里若出现 Tailwind 类名将不生成 CSS；`docs/acceptance-report.md:568,603-604` 记录过 v4 漏扫导致整批工具类缺失的真实事故，靠 `@source` 修的）。
- **改进**：删死字体资源或明确标注保留；在 `styles/globals.css` 的 `@source` 里补 `../hooks/**/*.{ts,tsx}`、`../lib/**/*.{ts,tsx}`、`../contexts/**/*.{ts,tsx}`，并扩 `scripts/test/tw-source-coverage.test.ts` 的断言（该测试已存在）。

### P2-6 a11y：框架完善，但大客户端组件 aria 覆盖为 0
`aria-` 928 处 / `role=` 167 处，整体不差；`scripts/a11y-sweep.mjs`（5 条 token 规则 + 豁免自动清退）、`apps/web-overlay/test/a11y-token-contrast.test.ts`、`docs/CODE-REVIEW.md:127` 列出的 5 条门禁（field-names/nested-interactive/keyboard-activation/a11y-contrast/design-system）**已完整覆盖，勿重复造**。但 **13 个 >400 行的客户端文件 `aria-` 命中为 0**，其中 UI 组件：`app/admin/AdminLayoutClient.tsx`(508L)、`app/admin/categories/page.tsx`(469L)、`app/admin/tokens/page.tsx`(711L)、`app/auth/signin/page.tsx`(433L)、`app/marketplace/publish/page.tsx`(581L)、`components/plugins/plugin-install-modal.tsx`(640L)、`components/tools/geek-micro-tools.tsx`(617L)；其余为 hooks/lib（不算 UI，无需 aria）。
**改进**：把 `control-names`/`label-association` 门禁的扫描范围从「全仓文本不变量」细化到「>400L 客户端文件」，为上述 7 个文件补 `aria-label`/`aria-labelledby` 并让 `a11y-sweep --write` 处理对比度 token。

### P2-7 i18n 缺失（**已文档化为产品决策，不建议现在动**）
全仓 grep `hreflang` / `alternates.languages` = **0 命中**；`app/layout.tsx:135` 硬编码 `lang="zh-CN"`，`manifest.ts:29` `lang: 'zh-CN'`，`lib/seo/origin.ts` 无 locale 维度；`package.json` 无 `next-intl`/`i18next`。`docs/PROJECT-PROGRESS-SCAN-2026-10-28.md:167,241` 明确「全站单一中文，属产品方向决策不是技术缺口」、`docs/DEV-PLAN-2026-10-19-NEXT.md:168`「暂缓：V3 结论是无证据表明缺它掉用户」、`docs/UPGRADE-PROPOSAL-2026-10-18.md:250` 估算「文案约 800 条 + hreflang」。**标注为已被文档覆盖、暂缓项**；仅在「升级蓝图长期」中保留 `[locale]` 路由 + hreflang 的预案。

---

## 4. 已有文档 / 脚本 / 测试覆盖清单（明确「不要重复建议」）

| 主题 | 已有资产 | 状态 |
|---|---|---|
| overlay↔web 一致性 | `check-web-overlay.mjs`(238L, 四向检查) / `generate-web-mirror.mjs` / `sync-overlay-drift.mjs` / `apply-web-overlay.mjs` / `sync-web-overlay.mjs` / `upstream-baseline.json` / `scripts/lib/overlay-drift.mjs` + 单测 / `ci.yml:657-709` 独立 job + 撤防账 | **当前 738/738 逐字节一致** |
| 首屏包体积 | `check-bundle-budget.mjs`(775L, Turbopack 口径 + CI annotations) / `bundle-budget.json` 逐路由阈值 + `_raise_log` / `bundle-budget-summary.mjs` | 已修：sonner/主题条动态加载、Spotlight/AI 首次呼出、拖拽库 `lazy-dnd` 别名、管理端表单栈按需加载（`docs/AUDIT-2026-10-20.md:17-45`） |
| RSC/Client 边界 | `check-client-node-imports.mjs`(284L, 传递闭包 + `import type` 擦除 + 模板串 mask，`EXCEPTIONS` 陈旧例外判红) / `check-import-boundaries.mjs` | **已修**：`media-proxy.ts` 的 `node:crypto` 事故（`/videos` +476KB）；`video-ocr-code-extractor-dialog.tsx:49` 的 `node:http` 在模板串里是**脚本刻意 mask 的示例文本，非真实违规** |
| SEO | `sitemap.ts`(171L, 并发分页 + 阈值过滤) / `robots.ts` / `manifest.ts` / `lib/seo/{metadata,origin,json-ld,sitemap-entries,category-totals,feed}.ts` / 5 个 `opengraph-image` / `seo-audit.mjs` / `check-isr-routes.mjs`(786L) / `html-budget.mjs` / `indexnow.mjs` / `docs/seo/*` | 已修：软 404、`site/[id]` RSC 化、og:image localhost 烤死、SearchAction/aggregateRating 红线、永久快照 500 |
| 缓存/ISR | 17 处 `export const revalidate`(60/300/3600) / `lib/server/hub.ts` 的 `HUB_CACHE_TAG` + `revalidateTag` / `lib/github.ts` Data Cache 60s / `app/page.tsx:52` | 已体系化，勿再提「加 ISR」 |
| a11y | `a11y-sweep.mjs` / `a11y-token-contrast.test.ts` / 5 条文本不变量门禁 / `docs/CODE-REVIEW.md:127` | 已修：对比度 token、嵌套交互、键盘激活、main landmark |
| 水合 | `docs/acceptance-report.md:570` 修复 `quick-tools-*` / 4 个 auth 页 `<Suspense>` 包裹 `useSearchParams`（`signup/page.tsx:27-33` 等，注释标注 2026-11-01） / `useFavorites` `useSyncExternalStore` / `density-provider.tsx:70-80` 预绘脚本 | 大部分已修，仅 P2-2 一处残留 |
| 错误态 | `app/error.tsx`(137L 分类 + digest + 复制诊断) / `global-error.tsx` / `lib/error-report.ts` / `lib/client-error-report.ts`(脱敏开关默认关) / `useMeOverview` 四态 | 框架完善，缺覆盖（P2-4） |
| 测试 | **930 个测试相关文件**：`apps/web-overlay/test` 262 + `apps/web/test` 262（镜像）/ `apps/api/test` 162 / `packages/*` 143 / `scripts/*.test.ts` ~60 / `e2e` 24 spec（含 `daypart-hydration`、`dark-mode-smoke`、`diy-shared-state`）；`pnpm coverage` + `check-coverage.mjs`（当前**非门禁**，`package.json:11` 注释写明「存量摸清后再收紧」） | 覆盖极厚，缺的是「覆盖率阈值」与「巨型文件/死模块」两类新门禁 |
| 巨型文件 | `docs/CODEBASE_OVERVIEW.md:472-474` 已列 P1 并给四层拆分建议 | **清单过时、无门禁、无方案**（本报告的增量） |
| 类型债务 | `docs/VIDEO-HOTSPOT-BACKEND-AUDIT-2026-10-28.md:685,737` 与 `ci.yml:678-680` 记录「21555 错，A8 未做」；`scripts/typecheck-video-scope.mjs` 已按目录清零 | **实测已降到 26**（本报告的增量，见 P0-1） |
| i18n | `docs/PROJECT-PROGRESS-SCAN-2026-10-28.md:167,241` 等 | 已文档化为产品决策暂缓 |
| 死代码 | `docs/CODEBASE_OVERVIEW.md:484-488` 已列 `NavigationToggleButton.tsx` 等 vendored 遗留 | 未含 `app/providers.tsx`（本报告的增量） |

---

## 5. 升级蓝图

### 短期（1~2 周，目标：把「隐性红」变成「显性绿」）
1. **P0-1 清零 26 个 tsc 错误**（含 `harvest/route.ts` 的运行时 ReferenceError），`ignoreBuildErrors` 条件化，新增错误数棘轮。
2. **P0-2 视频 sitemap 改用 `siteOrigin()`**，补投毒回归测试。
3. **P1-3 删 `app/providers.tsx`** + 新增 `check-dead-modules.mjs`（复用 `source-refs.mjs`）。
4. **P2-2 / P2-3** 两处一行级修复（favorites 水合、error.tsx 上报入 effect）。
5. **P2-4** 补 `app/admin/error.tsx` 与 `app/auth/error.tsx`（段级继承覆盖 27 页）。
6. **P1-2** `admin/layout.tsx` 补 `robots: { index:false, follow:false }`。

**量化验收**：`pnpm --filter navsphere exec tsc --noEmit` = 0 error；CI `test-web` 首次全绿且 `ignoreBuildErrors` 不再无条件开启；`check-web-overlay` 仍 100% 一致；新增 4 个回归测试；死模块数 0。

### 中期（1~2 月，目标：把「文档建议」变成「可执行约束」）
1. **P1-1 巨型文件拆分**：按 `navhub-api.ts` → 7 个域模块（re-export 桶）、`favorites/page.tsx` → 4 个 hooks + 4 个子组件、`plugin-url-health-panel.tsx` → hooks + 4 Tab 子组件、`video-player-page.tsx` → 播放器/信息/推荐/笔记 4 块，分 4 个 PR（每个 ≤400 行 diff，符合 `CODE-REVIEW.md:54`）。
2. **新增 3 条棘轮门禁**：`check-file-size.mjs`（>1200L 白名单只减不增）、`check-dead-modules.mjs`、`check-any-ratchet.mjs`（`lib/` 与 `api/` 的 `any` 降 error），全部进 `pnpm verify` 默认档 + CI `check-web-overlay` job 的撤防账。
3. **P1-5 批量瀑布并发化**（有界并发 4 + AbortController），`app/videos/v/[id]` 承接 VideoObject JSON-LD（P1-4）。
4. **P1-6 镜像机制补三缺口**：`--prune` 孤儿回收、`check:overlay` 拆成「纯校验 / 显式生成」、排除规则单份导出 + parity 测试。
5. **P1-2 RSC 壳改造**：把 4 个可收录客户端页改成「RSC `generateMetadata` + 客户端岛」，复用 `app/collections/page.tsx` 模板。
6. **P2-5 `@source` 补全** `hooks/lib/contexts`，删除死字体资源。
7. **覆盖率阈值落地**：`package.json:11` 已预告「存量摸清后收紧」，给 `check-coverage.mjs` 传 `--max-lines/--max-functions` 并进 CI。

**量化验收**：>1200 行的手写文件从 11 个降到 ≤4（仅保留生成物与已登记的待拆文件）；单文件 hooks 上限 ≤12；`lib/` `any` = 0；200 包全量体检墙钟 −60%；RSC 页面 31→≥45/70；收录面 `seo:audit --all` 0 finding；镜像孤儿文件 = 0；行覆盖率有明确阈值且 CI 阻断。

### 长期（季度级，目标：消除双副本这一根因）
1. **按 `docs/CODEBASE_OVERVIEW.md:463` 既定方向收敛为单事实源**：`apps/web` 完全成为 CI/Docker 构建期产物（`vendor-web.mjs` 从上游 tarball + `apps/web-overlay` 生成），本地开发直接跑 `apps/web-overlay`；删除仓库里对 `apps/web` 的第二份 git 跟踪（当前 `apps/web/test` 262 个测试也是镜像副本，`vitest.config.ts` 只收集 web/test）。这一步能同时消掉 P1-6 的全部风险与 `check:overlay` 这条门禁本身。
2. **算法/契约单一来源**：`docs/CODEBASE_OVERVIEW.md:465-470` 的「14 个纯算法双份维护」用 `@navhub/core` 编译产物 + 构建期注入解决；`rest-contracts.generated.ts` 与 `hub-route-policy.generated.ts` 固化为 `pnpm gen:rest-contracts` / `gen:hub-policy` 的 CI 前置步骤（已有 `--check` 门禁）。
3. **i18n（产品决策解锁后）**：`app/[locale]/` 路由 + `next-intl` + 800 条文案抽离 + `alternates.languages` hreflang + `sitemap.ts` 多语言条目；当前 0 hreflang，目标 100% 收录页带 hreflang。
4. **状态层收敛**：`SWRConfig`(`components/providers.tsx:34`) + `useSyncExternalStore`(`useFavorites`) + `VideoPlayerContext` + 220 处 localStorage 四套机制并存；中期先统一到 `SWR` + `useSyncExternalStore`，长期评估 `Zustand` 只用于跨路由播放态，减少 666 个 `useState` / 285 个 `useCallback` 的样板。
5. **图像策略复核**：`unoptimized: true` 是任意第三方 favicon 的合理选择，但若引入自建 CDN，可用 `NAVHUB_IMAGE_HOSTS` 白名单 + `next/image` 逐页替换（当前 7 处已用），目标 LCP 图体积 −40%。

**量化验收**：仓库内 `apps/web/src` 不再有手工 git 跟踪文件（0 双副本、0 同步脚本）；CI 门禁数不增反降（删掉 `check-web-overlay`）；首屏预算保持 `bundle-budget.json` 不上调；新增语言 1 套且 hreflang 覆盖 100%；状态管理样板代码行数 −30%。

---

### 附：本次扫描的执行面
只读（未修改任何源文件）。除 `tsc --noEmit` 与 `git status/log` 外均为静态读取；排除 `node_modules/.git/.next*/public/assets/*.db/dist/coverage`。所有行数、文件数、SHA-1 比对均由脚本在 `G:\web\源码镜像` 实测得出。报告正文唯一新增文件为本 md 本身（deliverables/），未触碰任何源码。
