import { cache } from "react";
import { NavigationContent } from "@/components/navigation-content";
import { Metadata } from "next/types";
import { ScrollToTop } from "@/components/ScrollToTop";
import { Container } from "@/components/ui/container";
import { getProcessedData } from "@/lib/data-loader";
import { getFileContent } from "@/lib/github";
import { siteOrigin } from "@/lib/seo/origin";
import { webSiteLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/json-ld";

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

export async function generateMetadata(): Promise<Metadata> {
  const { siteData } = await getData();

  return {
    title: siteData.basic.title,
    description: siteData.basic.description,
    // canonical 只写相对路径，交给 metadataBase 解析成绝对地址
    alternates: { canonical: '/' },
    // og:url 与 canonical 同值：根 layout 已提供 og:image/site_name/locale，
    // 这里只补 url（不写 images —— 会被 file-convention 的 opengraph-image 覆盖规则搞混）
    openGraph: { url: '/' },
    keywords: siteData.basic.keywords,
    icons: {
      icon: siteData.appearance.favicon,
    },
  };
}

export default async function HomePage() {
  const { navigationData, siteData } = await getData();
  // WebSite 结构化数据：全站唯一入口页挂一份即可。
  // 不写 potentialAction（没有 /search 页面），不写 aggregateRating（没有评价体系）。
  const origin = await siteOrigin();

  return (
    <>
      <NavigationContent navigationData={navigationData} siteData={siteData} />
      {origin ? <JsonLd data={webSiteLd(origin, siteData.basic.title, siteData.basic.description)} /> : null}
      <ScrollToTop />
    </>
  );
}