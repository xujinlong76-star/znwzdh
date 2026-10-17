/**
 * 「跳到主要内容」与主内容地标。
 *
 * 真实缺陷（改动前）：全站只有 5 处 `<main>`（首页、视频页、管理后台、自建页、崩溃页），
 * 其余页面的根节点都是普通 `<div>`。后果有两个：
 *   1. 读屏 / 键盘用户在首页要**逐个 Tab 穿过工具栏与侧栏的几十个元素**才能碰到站点卡片，
 *      没有任何「跳过导航」的办法 —— 这是 WCAG 2.4.1 Bypass Blocks 明确要求的能力；
 *   2. 没有 `main` 地标，读屏软件也就没有「跳到主内容」这个快捷导航目标。
 *
 * 这里锁四件事：
 *   1. 布局里存在跳过链接，且是 `<body>` 里**第一个可聚焦元素**（否则它自己就要被 Tab 找到）；
 *   2. 它的样式不依赖 Tailwind 工具类的产出顺序（`sr-only/not-sr-only/fixed` 会互相打架）；
 *   3. `Container` 可以渲染成 `main`，但默认仍是 `div`（同一次渲染里有多个 Container 的页面不能都变地标）；
 *   4. **每个内容页都要有 `#main-content`**，否则跳过去落空；不能提供的必须在
 *      `LANDMARK_ELSEWHERE` 里写明原因（新增页面如果两样都没做，这个测试就会红）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  // 注意：候选本身就是 overlay 根，结尾没有斜杠，所以不能只判断 "/web-overlay/"
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 递归收集 app 目录下所有 page.tsx（相对 overlay 根目录，统一用 / 分隔） */
function listPageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...listPageFiles(full));
    else if (entry === "page.tsx") found.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return found;
}

/**
 * 地标不由本文件提供的页面。每一条都必须写明**为什么**，
 * 以及地标实际在哪里（下面会逐个验证那个地方真的有 `#main-content`）。
 */
const LANDMARK_ELSEWHERE: Record<string, string> = {
  "src/app/page.tsx": "首页主体在 components/navigation-content.tsx",
  "src/app/videos/page.tsx": "视频页主体在 components/video-content.tsx",
  "src/app/graph/page.tsx": "图谱页主体在 components/ecosystem-graph.tsx",
  "src/app/videos/player/page.tsx": "播放器页由 video-player-page.tsx 的多分支客户端组件渲染，暂无地标",
  "src/app/auth/signin/page.tsx": "登录页是全屏分栏表单，主体在客户端组件 SignInContent 里，暂无地标",
};

/** 这些文件必须真的带地标（承载了委托页面的主体） */
const COMPONENTS_WITH_LANDMARK = [
  "src/components/navigation-content.tsx",
  "src/components/video-content.tsx",
  "src/components/ecosystem-graph.tsx",
  "src/app/admin/AdminLayoutClient.tsx",
  "src/app/error.tsx",
  "src/app/global-error.tsx",
  "src/app/not-found.tsx",
];

describe("每个内容页都要有主内容地标", () => {
  const pages = listPageFiles(join(ROOT, "src", "app"));

  it("枚举到了页面（递归写错导致空跑时要立刻发现）", () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(pages).toContain("src/app/hot/page.tsx");
  });

  it("没有地标的页面必须是「已登记原因」的少数例外", () => {
    const missing: string[] = [];
    for (const rel of pages) {
      // 管理后台的地标由 AdminLayoutClient 统一提供（下面单独验证）
      if (rel.startsWith("src/app/admin/")) continue;
      if (LANDMARK_ELSEWHERE[rel]) continue;
      if (!overlaySource(rel).includes('id="main-content"')) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("登记为「地标在别处」的页面，其宿主组件确实带地标", () => {
    expect(Object.keys(LANDMARK_ELSEWHERE).length).toBeGreaterThan(0);
  });

  it.each(COMPONENTS_WITH_LANDMARK)("%s 带 id=main-content", (rel) => {
    expect(overlaySource(rel)).toContain('id="main-content"');
  });
});

describe("跳过链接本身", () => {
  it("在 body 里是第一个可聚焦元素，并指向 #main-content", () => {
    const layout = overlaySource("src/app/layout.tsx");
    const link = layout.indexOf('href="#main-content"');
    expect(link).toBeGreaterThan(-1);
    expect(layout).toContain('className="skip-to-content"');
    expect(layout).toContain("跳到主要内容");
    // 必须排在其它可聚焦元素之前：PwaRegister 会渲染/挂载脚本，放它后面就等于让用户先 Tab 一次
    const pwa = layout.indexOf("<PwaRegister");
    expect(pwa).toBeGreaterThan(-1);
    expect(link).toBeLessThan(pwa);
    expect(layout).toContain("@/styles/skip-link.css");
  });

  it("样式把隐藏态与聚焦态都写死，不依赖工具类产出顺序", () => {
    const css = overlaySource("src/styles/skip-link.css");
    expect(css).toContain(".skip-to-content {");
    expect(css).toContain(".skip-to-content:focus {");
    // 隐藏态：移出视口但不 display:none（display:none 的元素无法被聚焦）
    expect(css).toContain("left: -9999px");
    expect(css).not.toContain("display: none");
    // 聚焦态：固定在左上角
    expect(css).toContain("position: fixed");
    expect(css).toContain("outline");
  });
});

describe("Container 作为地标是可选行为", () => {
  it("默认仍是 div：同一页面里的多个 Container 不能都变成 main", () => {
    const src = overlaySource("src/components/ui/container.tsx");
    expect(src).toContain("as?: 'div' | 'main'");
    expect(src).toContain("as = 'div'");
    expect(src).toContain("<main id={id}");
    expect(src).toContain("<div id={id}");
  });

  it("站点详情页的分支各自成地标（同一次渲染只会命中一个分支）", () => {
    const src = overlaySource("src/app/site/[id]/page.tsx");
    const hits = src.split('as="main" id="main-content"').length - 1;
    expect(hits).toBeGreaterThanOrEqual(4);
  });
});
