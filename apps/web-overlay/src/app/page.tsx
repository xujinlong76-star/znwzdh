import { cache } from "react";
import { NavigationContent } from "@/components/navigation-content";
import { Metadata } from "next/types";
import { ScrollToTop } from "@/components/ScrollToTop";
import { getProcessedData } from "@/lib/data-loader";
import { getFileContent } from "@/lib/github";
import { siteOrigin } from "@/lib/seo/origin";
import { webSiteLd, organizationLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/json-ld";
import { pageShareMetadata } from "@/lib/seo/metadata";
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
 * 仍会动态渲染的两种可接受降级：① 未注入 NAVHUB_SITE_URL 时 siteOrigin()
 * 回退读请求头；② 中枢开启鉴权（带 Authorization 的 fetch 不进缓存）。
 * 生产环境注入 NAVHUB_SITE_URL 后即完整 ISR。
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

/** 首页目录带最多展示的分类数：再多就成了分类总览页的重复 */
const DIRECTORY_CATEGORY_LINKS = 8;

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
 */
async function loadDirectoryLinks() {
  const [categories, rawCounts] = await Promise.all([
    loadCategories(3600),
    loadActiveCategoryCounts(3600),
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
 * 空标签会让打包检查误以为「已经配置」。三家国内常用引擎的 meta 名不同：
 * 百度是 `baidu-site-verification`，Bing 是 `msvalidate.01`（Next 没有专门
 * 字段，走 verification.other）。
 */
function searchEngineVerification(): Metadata['verification'] | undefined {
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  const baidu = process.env.BAIDU_SITE_VERIFICATION?.trim();

  const other: Record<string, string> = {};
  if (bing) other["msvalidate.01"] = bing;
  if (baidu) other["baidu-site-verification"] = baidu;

  const verification: NonNullable<Metadata['verification']> = {};
  if (google) verification.google = google;
  if (Object.keys(other).length > 0) verification.other = other;
  return Object.keys(verification).length > 0 ? verification : undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const { siteData } = await getData();
  const verification = searchEngineVerification();

  return {
    title: siteData.basic.title,
    description: siteData.basic.description,
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
      title: siteData.basic.title,
      description: siteData.basic.description,
    })),
    keywords: siteData.basic.keywords,
    icons: {
      icon: siteData.appearance.favicon,
    },
    ...(verification ? { verification } : {}),
  };
}

export default async function HomePage() {
  const { navigationData, siteData } = await getData();
  // WebSite 结构化数据：全站唯一入口页挂一份即可。
  // 不写 potentialAction（没有 /search 页面），不写 aggregateRating（没有评价体系）。
  const [origin, directoryLinks] = await Promise.all([siteOrigin(), loadDirectoryLinks()]);

  return (
    <>
      <NavigationContent
        navigationData={navigationData}
        siteData={siteData}
        directoryLinks={directoryLinks}
      />
      {origin ? (
        <>
          <JsonLd data={webSiteLd(origin, siteData.basic.title, siteData.basic.description)} />
          <JsonLd
            data={organizationLd(origin, siteData.basic.title, '/icons/icon-512.png', siteData.basic.description)}
          />
        </>
      ) : null}
      <ScrollToTop />
    </>
  );
}