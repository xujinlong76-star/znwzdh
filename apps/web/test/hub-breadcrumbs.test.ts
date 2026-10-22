import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 枢纽面包屑与合集详情元数据的结构守卫（2026-10-21）。
 *
 * 背景：
 * - /hot、/collections 曾没有任何面包屑（可见 DOM 与 BreadcrumbList 双缺）；
 * - /collections/[slug] 全部共享写死的 `title: '合集详情'`（重复 title 成员），
 *   且无效 slug 返回 200 空壳（软 404）；
 * - /collections/layout 的字符串 title 截断根 title.template，孙级拿不到
 *   品牌后缀（与 /tags 家族同病，实测「合集详情」光杆）。
 *
 * 锁的不变量：
 *   1. /hot 服务端 page 挂 Breadcrumbs（旧 layout 已删除，元数据也回 page）；
 *   2. /collections 索引页用客户端 Trail（page 是 'use client'）；
 *   3. /collections/[slug] 服务端 page 挂 Breadcrumbs + generateMetadata；
 *   4. 确定性 miss 走 notFound()（hubGetProbe 区分 404 与网络失败）；
 *   5. /collections/layout 的 title 是 { default, template }（模板贯通到孙级）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** 与 list-degrade.test.ts 同款双候选解析：overlay 原位跑与 apps/web 镜像跑都能命中 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("枢纽面包屑与合集详情元数据", () => {
  it("/hot 服务端 page 挂 Breadcrumbs（首页 > 今日热榜）", () => {
    // 2026-10-21：客户端 page 服务端化后，面包屑从 layout 收回 page，
    // layout 已删除（空壳层会让路由结构更难读）
    const src = overlayFile("src/app/hot/page.tsx");
    expect(src).toContain("import { Breadcrumbs } from '@/components/breadcrumbs'");
    expect(src).toContain("<Breadcrumbs");
    expect(src).toContain("label: '今日热榜'");
  });

  it("/collections 索引页：服务端 Breadcrumbs + CollectionBoard 岛挂载", () => {
    const src = overlayFile("src/app/collections/page.tsx");
    // Batch D 后索引页是服务端壳：面包屑升级为带 JSON-LD 的服务端版，
    // 合集卡片经岛渲染（详情内链进 SSR HTML，消灭 4 个合集详情孤岛）
    expect(src).toContain("import { Breadcrumbs } from '@/components/breadcrumbs'");
    expect(src).toContain("<Breadcrumbs");
    expect(src).toContain("import { CollectionBoard } from '@/components/collection-board'");
    expect(src).toMatch(/<CollectionBoard\s+initialCollections=\{cols\}/);
    expect(src).not.toMatch(/export\s+const\s+metadata|'use client'/);
  });

  it("collection-board.tsx 是客户端岛：首帧吃服务端数据，null 时自动重取", () => {
    const src = overlayFile("src/components/collection-board.tsx");
    expect(src).toContain("'use client'");
    expect(src).toContain("initialCollections");
    // 服务端没取到时挂载即自动重取（不逼用户点按钮）
    expect(src).toMatch(/initialCollections\s*===\s*null/);
    // 诚实遥测：「策划中」与「中枢挂了」必须分开说
    expect(src).toContain("站长正在策划中");
    expect(src).toContain("不代表站长没有策划");
  });

  it("breadcrumb-trail.tsx 不许触碰服务端 API（模块边界锁）", () => {
    const src = overlayFile("src/components/breadcrumb-trail.tsx");
    // 只扫 import 行：注释里允许解释性提及（本文件的注释就该讲 next/headers 的坑）
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l))
      .join("\n");
    expect(imports).not.toContain("next/headers");
    expect(imports).not.toContain("seo/origin");
    expect(imports).not.toContain("components/json-ld");
  });

  it("/collections/[slug] 服务端 page 用 Breadcrumbs（带 JSON-LD，进 SSR HTML）", () => {
    // 客户端体已下沉到 collection-detail-view.tsx，page 是服务端组件
    const src = overlayFile("src/app/collections/[slug]/page.tsx");
    expect(src).toContain("import { Breadcrumbs } from '@/components/breadcrumbs'");
    expect(src).toContain("<Breadcrumbs");
    // 足迹完整：首页 > 合集 > 具体合集
    expect(src).toContain("label: '合集', path: '/collections'");
    expect(src).toContain("label: name");
  });

  it("/collections/[slug] 每合集独立 metadata（不再共享「合集详情」）", () => {
    const src = overlayFile("src/app/collections/[slug]/page.tsx");
    expect(src).toMatch(/export\s+async\s+function\s+generateMetadata\b/);
    expect(src).toContain("title: col.title");
    expect(src).toContain("/api/collections/");
    // 静态共享 metadata export 必须死掉（它才是重复 title 的来源）；
    // 降级回退里的通用标题是合法的（中枢挂了不编造合集名）
    expect(src).not.toMatch(/export\s+const\s+metadata\b/);
  });

  it("确定性 miss 走 notFound()，网络失败降级不误伤", () => {
    const src = overlayFile("src/app/collections/[slug]/page.tsx");
    // hubGetProbe 三态：只有 miss 判 404
    expect(src).toContain("hubGetProbe");
    expect(src).toMatch(/if\s*\(probe\.status\s*===\s*'miss'\)\s*notFound\(\)/);
    // failed 分支必须保留降级元数据
    expect(src).toContain("probe.status === 'failed'");
  });

  it("/collections/layout 的 title 是 { default, template }——模板贯通到孙级", () => {
    const src = overlayFile("src/app/collections/layout.tsx");
    // 中间层字符串 title 会截断根 title.template（实测「合集详情」光杆），
    // 必须用 default 供本层、template 供 [slug] 子层
    expect(src).toMatch(/title:\s*\{\s*default:\s*'合集',\s*template:/);
    // 品牌名与根 layout 同源取数，不硬编码
    expect(src).toContain("getFileContent");
  });

  it("/marketplace 索引页：服务端壳 + PluginMarketBoard 岛（64 插件入链的孤岛修复）", () => {
    const src = overlayFile("src/app/marketplace/page.tsx");
    expect(src).toContain("import { PluginMarketBoard } from '@/components/plugin-market-board'");
    expect(src).toMatch(/<PluginMarketBoard\s+initialItems=/);
    expect(src).toContain("<Breadcrumbs");
    expect(src).not.toMatch(/'use client'/);
    // 首屏取全：API 单页上限 100，旧的 limit=1000 会被静默截断，
    // 第 101 个之后的插件详情页会重新变成没有 SSR 入链的孤岛
    expect(src).toContain("MARKET_LIST_PAGE_SIZE = 100");
    expect(src).toContain("loadMarketPluginList(listQuery)");
  });

  it("plugin-market-board.tsx 是客户端岛：种子状态 + 单次跳过重取", () => {
    const src = overlayFile("src/components/plugin-market-board.tsx");
    expect(src).toContain("'use client'");
    expect(src).toContain("initialItems");
    expect(src).toContain("initialFeatured");
    // ref 单次消费：不能用粗守卫（会把筛选重取一起吃掉）
    expect(src).toContain("skipFirstLoad");
    expect(src).toContain("skipFirstSide");
  });
});
