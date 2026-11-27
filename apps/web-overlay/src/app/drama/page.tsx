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
import { collectDramaSites, type DramaSite } from "@/lib/drama-sites";
import { loadDramaFeatured, type DramaFeatured } from "@/lib/drama-featured";
import { loadNavigationCatalog } from "@/lib/navigation-catalog-read";
import baselineNavigation from "@/navsphere/content/navigation.json";

export const revalidate = 60;


export interface DramaPageData {
  sites: DramaSite[];
  dramas: DramaFeatured[];
}

const getDramaData = cache(async (): Promise<DramaPageData> => {
  let navigationItems: unknown = baselineNavigation.navigationItems;
  try {
    // U-463：整包 navigation.json（3.16MB）进不了 Data Cache，每次渲染重拉；
    // 改读分片拼装（渲染字段等值），分片不可用时自动回落整包读。
    const load = await loadNavigationCatalog();
    if (Array.isArray(load.data?.navigationItems)) {
      navigationItems = load.data.navigationItems;
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
  // 与页面同取数（React cache 去重，同一请求只读一次导航）：文案里的平台数
  // 跟随 collectDramaSites 的实际条数，补站不再让数字漂移（U-282/U-265）。
  const { sites } = await getDramaData();
  return {
    title: "短剧专区",
    description:
      `短剧平台入口与热门剧追剧清单：红果、抖音、快手等 ${sites.length} 个平台；部分平台的短剧只在 App 内播，榜单页与频道页链接不是正片。`,
  };
}

export default async function DramaPage() {
  const { sites, dramas } = await getDramaData();
  return (
    <main id="main-content">
      <DramaContentLazy sites={sites} dramas={dramas} />
    </main>
  );
}
