import { cache } from "react";
import { NavigationContent } from "@/components/navigation-content";
import { HomeBriefStrip } from "@/components/home-brief-strip";
import { Metadata } from "next/types";
import { getProcessedData } from "@/lib/data-loader";
import { getFileContent } from "@/lib/github";
import { configuredSiteOrigin } from "@/lib/seo/origin";
import { webSiteLd, organizationLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/json-ld";
import { normalizeBrandName, pageShareMetadata } from "@/lib/seo/metadata";
import { MIN_SITES_FOR_CATEGORY_INDEX } from "@/lib/seo/thresholds";
import { descendantSiteCounts } from "@/lib/seo/category-totals";
import { categoryUrlKey, isHiddenCategory } from "@/lib/seo/category-url";
import {
  categoryDisplayName,
  loadActiveCategoryCounts,
  loadCategories,
} from "@/lib/server/categories";

/**
 * 从存储层读取首页数据。
 *
 * NavHub 改动点：上游这里直接 import 构建期静态 JSON，改成经由 StorageAdapter 异步读取，
 * 因此首页内容反映的是数据库（中枢）里的真实数据（ISR 60s 再验证，见下方 revalidate）。
 *
 * 注意：JSON 的 import 已移除，路径常量与上游保持一致，便于后续跟进上游更新。
 */
/**
 * ISR：60 秒再验证（2026-10-21 从 force-dynamic 改来）。
 *
 * 为什么改：首页每个请求都同步读一次中枢，Googlebot 抓一次就是一次全量
 * 读取，标签云/目录页的爬虫突发还会放大成并发读。现在读请求本身带
 * `next: { revalidate: 60 }` 进 Data Cache（storage-adapter.ts 的
 * HttpAdapterOptions.revalidateS），路由配 revalidate 即 ISR：缓存期内
 * 本地渲染秒回，过期后 Next 先吐旧页面再后台再生，没有请求阻塞在枢纽上。
 *
 * 代价（知情交易）：后台改导航后最多 60s 全站可见（NAVHUB_STORAGE_REVALIDATE_S
 * 可调，置 0 退回实时读）。导航是人工策划内容，变更以天计，这个延迟换
 * 爬虫预算与中枢负载划算。sitemap 用 3600 是同一模式更激进的档位。
 *
 * 仍会动态渲染的一种可接受降级：中枢开启鉴权（带 Authorization 的 fetch 不进缓存）。
 * origin 走 configuredSiteOrigin()（只读环境变量），所以未注入 NAVHUB_SITE_URL 时首页
 * 仍然是预渲染的，代价只是这份 WebSite/Organization JSON-LD 不输出、分享图地址落回
 * localhost；配上变量后一个 revalidate 周期自愈。
 */
export const revalidate = 60;

/**
 * 历史包袱（保留备查）：这里曾经是 force-dynamic，原因是构建期预渲染会把
 * <title> 固化（库里已改标题，产物里还是构建时的回退值）。ISR 解决了同
 * 一类问题的正确姿势——元信息随 60s 再验证更新，既不固化也不用每请求
 * 打穿中枢。若哪天标题又出现「改了不变」，先查 ISR 再验证是否在跑，
 * 而不是把 revalidate 改回 force-dynamic。
 */

const NAVIGATION_PATH = "src/navsphere/content/navigation.json";
const SITE_PATH = "src/navsphere/content/site.json";

const getData = cache(async () => {
  // 并行读取，避免两次串行往返
  const [navigationRaw, siteRaw] = await Promise.all([
    getFileContent(NAVIGATION_PATH),
    getFileContent(SITE_PATH),
  ]);
  return getProcessedData(navigationRaw as never, siteRaw as never);
});

/**
 * 首页目录带最多展示的分类数（2026-11-07 SEO 扫描上调 8 → 50）。
 *
 * 原值 8 的顾虑是「再多就成了分类总览页的重复」；但一级根实测 19 个，
 * 上限 8 意味着首页 HTML 里 11 个根分类没有任何直链，只能靠 /category 二跳
 * 被发现。目录带是纯文本内链、19 条约几 KB，代价可忽略；保留 50 作安全上界，
 * 防止脏数据把根分类撑成几百条时页面失控。
 */
const DIRECTORY_CATEGORY_LINKS = 50;

/**
 * 首页每组的首屏卡片数（渐进披露，2026-10-26）。
 *
 * 实测（2026-11-07，`node scripts/html-budget.mjs`）：4074KB / 预算 4096KB，
 * SSR 208 张卡。构成：RSC flight 1.87MB（46%，全量数据本就要下发）、class 属性
 * 1.14MB、内联 SVG 591KB。卡片级瘦身（5 个操作按钮复用 shadcn 基类，换成 @apply
 * 短类名约省 0.4MB 未压缩）在 br/gzip 后几乎为零——重复串本来就会被压缩掉，不值得
 * 为此重写卡片交互区。预算仍通过；只剩「减少首屏卡数」这个杠杆，而它会减少内链，
 * 非超预算不动。其余卡片点「展开全部」在客户端即时揭示（数据本来就在 props 里，
 * 展开不发请求、没有加载态）。
 *
 * 2026-11-09 孤儿行治理：保持默认 4，由 CSS 按**真实列数**收敛。
 *
 * 曾把默认值改成 3 来消除 3 列网格的 3+1 孤儿，但实测列数并不只有 3：
 *   - 1 列（≤516px 容器）、2 列（516~781px）、3 列（782~1047px）、4 列（≥1048px）
 *   - 4 张卡在 1/2/4 列下都恰好整行，只有 3 列是 3+1 孤儿；
 *   - 改成 3 之后，4 列变成「3 张 + 1 个空格」，2 列反而变成 2+1 孤儿。
 *
 * 因此保留 4，由 globals.css 的 [data-grid-cols="3"] 规则在折叠态隐藏第 4 张。
 * 列数由 navigation-category-section.tsx 的 ResizeObserver 读 grid-template-columns
 * 得出，不靠视口断点猜（左侧栏宽度可拖拽，视口宽度推不出列数）。
 *
 * `NAVHUB_HOME_CARDS_PER_GROUP` 可覆盖；传 0 即恢复全量 SSR 的旧行为。
 */
const HOME_CARDS_PER_GROUP_DEFAULT = 4;

function homeCardsPerGroup(): number {
  const raw = process.env.NAVHUB_HOME_CARDS_PER_GROUP?.trim();
  if (!raw) return HOME_CARDS_PER_GROUP_DEFAULT;
  const parsed = Number(raw);
  // 非法值退回默认：不让一个错字的配置把首页变成空壳
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : HOME_CARDS_PER_GROUP_DEFAULT;
}

/**
 * 首页首屏服务端渲染的分类数上限（默认 4 个主分类，其余水合后即时呈现）。
 * 超出的分类在客户端水合后即时挂载，控制 SSR HTML 体积在 4MB 预算哨兵以内。
 * 环境变量 NAVHUB_HOME_INITIAL_SSR_CATEGORIES 可调；传 0 即全量 SSR。
 */
const HOME_INITIAL_SSR_CATEGORIES_DEFAULT = 4;

function homeInitialSsrCategories(): number {
  const raw = process.env.NAVHUB_HOME_INITIAL_SSR_CATEGORIES?.trim();
  if (!raw) return HOME_INITIAL_SSR_CATEGORIES_DEFAULT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : HOME_INITIAL_SSR_CATEGORIES_DEFAULT;
}

/**
 * 首页 → 分类 hub 的入口数据。
 *
 * 实测（2026-10-21）：首页模板里 0 条 `/category` 链接，分类页只能靠
 * sitemap 被发现，点击深度断在首页。这里只挑达标分类（分类页对
 * < 门槛的页面直接 404）。URL 用 slug 形态：目录带是全站权重最高的一批内链，
 * 链到 uuid 等于把旧 URL 继续喂给爬虫。
 * 取数失败返回空数组——页面上仍有 /category、/sites、/tags 三个入口，
 * 不因中枢抖动把整条目录带吞掉。
 *
 * 新树口径（2026-10-22，方案 P4）：目录带只放**一级根**，站点数按后代聚合。
 * 一级根在原始 counts 里恒为 0（站点只挂叶子），不聚合就等于目录带永久消失。
 * 选取从「站点数降序」改成权威树 `sort` 升序：这排内链的位置不该随数据浮动，
 * 否则同一个站今天排第一、明天第五，首页每天换脸，爬虫也难判断锚点。
 *
 * 这里返回的 `count` 是**中枢 active 口径**，首页只把它当回退值用：实际显示的数字
 * 来自本页渲染的导航树（`navigation-content.tsx` 的 treeSiteCounts），一屏一个平面。
 * active 计数在这条链路上的职责是「链过去的分类页会不会 404」，不是「有几张卡片」。
 */
async function loadDirectoryLinks() {
  const [categories, rawCounts] = await Promise.all([
    loadCategories(3600),
    // 与类目页的 404 判定同频：页面按 60s 的 active 搜索结果判「是否达标」，
    // 目录带若用 3600s 的计数，健康巡检一次抖动就会出现最长 1 小时的死链。
    loadActiveCategoryCounts(60),
  ])
  const counts = descendantSiteCounts(categories ?? [], rawCounts)
  if (!categories || !counts) return [];
  // 存量脏行的 sort 可能是 0 或缺失：视为「没排过序」沉到末尾，而不是抢首位
  const rank = (c: (typeof categories)[number]) => (c.sort && c.sort > 0 ? c.sort : Number.MAX_SAFE_INTEGER);
  return categories
    .filter(
      (c) =>
        !c.parentId &&
        c.enabled !== false &&
        !isHiddenCategory(c) &&
        (counts.get(c.id) ?? 0) >= MIN_SITES_FOR_CATEGORY_INDEX,
    )
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, DIRECTORY_CATEGORY_LINKS)
    .map((c) => ({
      id: c.id,
      slug: categoryUrlKey(c),
      title: categoryDisplayName(c, categories),
      count: counts.get(c.id) ?? 0,
    }));
}

/**
 * 搜索引擎站点验证：只在配置了对应环境变量时输出 meta。
 *
 * 空字符串不能输出空标签——Google 会把 `content=""` 当成验证失败，而且
 * 空标签会让打包检查误以为「已经配置」。各家 meta 名不同：
 * 百度是 `baidu-site-verification`，Bing 是 `msvalidate.01`（Next 没有专门
 * 字段，走 verification.other），360 是 `360-site-verification`，
 * 搜狗是 `sogou_site_verification`（2026-11-11 补齐这两家）。
 */
function searchEngineVerification(): Metadata['verification'] | undefined {
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  const baidu = process.env.BAIDU_SITE_VERIFICATION?.trim();
  const so360 = process.env.SITE_VERIFICATION_360?.trim();
  const sogou = process.env.SOGOU_SITE_VERIFICATION?.trim();

  const other: Record<string, string> = {};
  if (bing) other["msvalidate.01"] = bing;
  if (baidu) other["baidu-site-verification"] = baidu;
  if (so360) other["360-site-verification"] = so360;
  if (sogou) other["sogou_site_verification"] = sogou;

  const verification: NonNullable<Metadata['verification']> = {};
  if (google) verification.google = google;
  if (Object.keys(other).length > 0) verification.other = other;
  return Object.keys(verification).length > 0 ? verification : undefined;
}

/**
 * 首页 title/description 的搜索口径合成（2026-11-11，SEO_PLAN §二）。
 *
 * 后台 site.json 的 basic.title/description 是品牌与自述口径，不是搜索口径：
 * 实测 title 只有品牌名、description 是「支持中文语义检索、拼音与关键词混合
 * 召回」这类技术自述，搜索用户不搜这些词。所以首页的 <title>/description
 * 在这里按**真实数据**合成，规则是「尊重完整配置、只补裸品牌」：
 * - title：后台已写出含「网址导航」或分隔符的完整标题时原样用；只是裸品牌名
 *   时拼成「品牌 - 网址导航 | AI工具、短剧与在线工具大全」（每个词都有站内
 *   真实内容对应：AI 工具一级分类、短剧专区、在线工具与场景包）。
 * - description：后台文案 ≥60 字视为已认真写过、原样用；否则用真实计数合成
 *   （收录站点数按一级分类后代聚合，与 sitemap/分类页同口径），计数取不到
 *   时退回后台原文案，绝不编数字。
 * generateMetadata 与页面 JSON-LD 共用这一份（React cache 去重），保证
 * head 与结构化数据口径一致。
 */
const getHomeSeo = cache(async () => {
  const { siteData } = await getData();
  const rawTitle = (siteData.basic.title ?? "").trim();
  const brand = normalizeBrandName(rawTitle || siteData.basic.title);
  const titleLooksComplete =
    rawTitle.includes("网址导航") || /[|｜]/.test(rawTitle) || rawTitle.length >= 12;
  // 拼接基底用收敛后的品牌名而不是原文案：配置里若还是上游旧名
  // （NavSphere 系），normalizeBrandName 会给出站内统一品牌，原文案直接拼
  // 会把旧名带进全站最重要的 title（2026-11-11 沙盒构建实测）。
  const title = titleLooksComplete ? rawTitle : `${brand} - 网址导航 | AI工具、短剧与在线工具大全`;

  const rawDesc = (siteData.basic.description ?? "").trim();
  let description = rawDesc;
  if (rawDesc.length < 60) {
    const [categories, rawCounts] = await Promise.all([
      loadCategories(3600),
      loadActiveCategoryCounts(60),
    ]);
    if (categories && rawCounts) {
      const counts = descendantSiteCounts(categories, rawCounts);
      const roots = categories.filter((c) => !c.parentId && c.enabled !== false);
      const totalSites = counts
        ? roots.reduce((sum, c) => sum + (counts.get(c.id) ?? 0), 0)
        : 0;
      if (counts && totalSites > 0) {
        description =
          `${brand}收录 ${totalSites} 个精选网站的网址导航，按 ${roots.length} 个大类与使用场景整理，` +
          `覆盖 AI 工具、热门短剧、效率办公、学习考试与设计创作；输入一句需求，AI 帮你找到顺手的网站与工具。`;
      }
    }
  }
  return { title, description, brand };
});

export async function generateMetadata(): Promise<Metadata> {
  const { siteData } = await getData();
  const verification = searchEngineVerification();
  // title/description 走搜索口径合成（见 getHomeSeo）：后台原文案是品牌自述，
  // 直接当 <title> 会让全站权重最高的页面没有任何搜索词。
  const seo = await getHomeSeo();

  return {
    title: seo.title,
    description: seo.description,
    // canonical 只写相对路径，交给 metadataBase 解析成绝对地址；
    // RSS 用 alternates.types 声明，聚合器与浏览器扩展据此自动发现 feed
    alternates: {
      canonical: '/',
      types: { 'application/rss+xml': '/feed.xml' },
    },
    // 页面级 share 元信息必须整体走 helper：裸写 openGraph 会把根布局的
    // type/siteName/locale/images 整体顶掉（Next 不深合并）
    ...(await pageShareMetadata({
      url: '/',
      title: seo.title,
      description: seo.description,
    })),
    keywords: siteData.basic.keywords,
    icons: {
      icon: siteData.appearance.favicon,
    },
    ...(verification ? { verification } : {}),
  };
}

export default async function HomePage() {
  // WebSite 结构化数据：全站唯一入口页挂一份即可。
  // SearchAction 已接入：/search 结果页上线且 ?q= 端点经 2026-11-11 生产实测
  // 可达、结果真实（红线 1 的前置条件消失，见 lib/seo/json-ld.ts 文件头）。
  // 不写 aggregateRating（没有评价体系）。
  // origin 只读配置：首页带 revalidate，一旦回退到 headers() 就会在构建期落成 ƒ、
  // 60s 缓存静默作废（缺配置的正确降级是「这份 JSON-LD 不输出」，地址保持相对）。
  const origin = configuredSiteOrigin();
  const seo = await getHomeSeo();
  // 导航数据与目录带互不依赖：串行 await 等于在白送一个中枢往返的 TTFB，
  // 而首页是爬虫面第一入口（getData 内部已并行，loadDirectoryLinks 内部也已并行）。
  const [{ navigationData, siteData }, directoryLinks] = await Promise.all([getData(), loadDirectoryLinks()]);

  return (
    <>
      <HomeBriefStrip />
      <NavigationContent
        navigationData={navigationData}
        siteData={siteData}
        directoryLinks={directoryLinks}
        cardsPerGroup={homeCardsPerGroup()}
        initialCategoryLimit={homeInitialSsrCategories()}
      />
      {origin ? (
        <>
          <JsonLd
            data={webSiteLd(
              origin,
              siteData.basic.title,
              seo.description,
              `${origin.replace(/\/+$/, "")}/search?q={search_term_string}`,
            )}
          />
          <JsonLd
            data={organizationLd(origin, siteData.basic.title, '/icons/icon-512.png', seo.description)}
          />
        </>
      ) : null}
    </>
  );
}