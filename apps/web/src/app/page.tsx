import { NavigationContent } from "@/components/navigation-content";
import { Metadata } from "next/types";
import { ScrollToTop } from "@/components/ScrollToTop";
import { Container } from "@/components/ui/container";
import { getProcessedData } from "@/lib/data-loader";
import { getFileContent } from "@/lib/github";

/**
 * 从存储层读取首页数据。
 *
 * NavHub 改动点：上游这里直接 import 构建期静态 JSON，改成经由 StorageAdapter 异步读取，
 * 因此首页内容反映的是数据库（中枢）里的真实数据，后台改完立即生效。
 *
 * 注意：JSON 的 import 已移除，路径常量与上游保持一致，便于后续跟进上游更新。
 */
/**
 * 强制动态渲染。
 *
 * 原因：首页数据来自中枢，若让它参与构建期预渲染，<title> 等元信息会被**固化在构建产物里**
 * （实测：库里标题已是"NavHub 导航"，但页面 <title> 仍是构建时的回退值"NavSphere导航"）。
 * 站点列表之所以看起来正常，是因为它恰好也走了客户端/动态路径。
 * 声明 force-dynamic 后，每次请求都实时读中枢，后台改完立即生效。
 */
export const dynamic = "force-dynamic";

const NAVIGATION_PATH = "src/navsphere/content/navigation.json";
const SITE_PATH = "src/navsphere/content/site.json";

async function getData() {
  // 并行读取，避免两次串行往返
  const [navigationRaw, siteRaw] = await Promise.all([
    getFileContent(NAVIGATION_PATH),
    getFileContent(SITE_PATH),
  ]);
  return getProcessedData(navigationRaw as never, siteRaw as never);
}

export async function generateMetadata(): Promise<Metadata> {
  const { siteData } = await getData();

  return {
    title: siteData.basic.title,
    description: siteData.basic.description,
    keywords: siteData.basic.keywords,
    icons: {
      icon: siteData.appearance.favicon,
    },
  };
}

export default async function HomePage() {
  const { navigationData, siteData } = await getData();

  return (
    <>
      <NavigationContent navigationData={navigationData} siteData={siteData} />
      <ScrollToTop />
    </>
  );
}