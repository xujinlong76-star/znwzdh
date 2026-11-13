/**
 * 短剧专区 (/drama)：独立专区页。
 * 骨架照抄 /videos：服务端组件取数 + 客户端岛交互 + revalidate = 60。
 * - 平台区：collectDramaSites (lib/drama-sites，已过滤 broken / disabled)。
 * - 剧目区：content/drama-featured.json (见 lib/drama-featured 的校验口径)。
 * 首屏“短剧影院”只是平台入口聚合 (海报是通用装饰图)，这里才是专区页。
 */
import { cache } from "react";
import type { Metadata } from "next";
import { DramaContentLazy } from "./drama-content-lazy";
import { ScrollToTop } from "@/components/ScrollToTop";
import { collectDramaSites, type DramaSite } from "@/lib/drama-sites";
import { loadDramaFeatured, type DramaFeatured } from "@/lib/drama-featured";
import { getFileContent } from "@/lib/github";
import baselineNavigation from "@/navsphere/content/navigation.json";

export const revalidate = 60;

const NAVIGATION_PATH = "src/navsphere/content/navigation.json";

export interface DramaPageData {
  sites: DramaSite[];
  dramas: DramaFeatured[];
}

const getDramaData = cache(async (): Promise<DramaPageData> => {
  let navigationItems: unknown = baselineNavigation.navigationItems;
  try {
    const navRaw = (await getFileContent(NAVIGATION_PATH)) as unknown as {
      navigationItems?: unknown;
    };
    if (Array.isArray(navRaw?.navigationItems)) {
      navigationItems = navRaw.navigationItems;
    }
  } catch {
    // Hub 读不到时回退到构建期基线（与 /videos 的口径一致），页面不挂。
  }
  return {
    sites: collectDramaSites(navigationItems),
    dramas: loadDramaFeatured().dramas,
  };
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "短剧专区",
    description:
      "短剧平台入口与热门剧追剧清单：红果、抖音、快手等 12 个平台；部分平台的短剧只在 App 内播，榜单页与频道页链接不是正片。",
  };
}

export default async function DramaPage() {
  const { sites, dramas } = await getDramaData();
  return (
    <main id="main-content">
      <DramaContentLazy sites={sites} dramas={dramas} />
      <ScrollToTop />
    </main>
  );
}
