/**
 * 渲染期 URL 卫生：所有「用户/模型/插件能影响的地址」都必须过安全闸。
 *
 * 为什么需要一台扫描机（和 keyboard-activation.test.ts 同一个思路）：
 * 站点 URL 的源头是匿名投稿与插件清单，模型回答里的 Markdown 链接是模型输出，
 * RSS 的 `item.link` 是第三方 XML —— 它们最后都落进 `<a href>`、`window.open`
 * 或 `location.href =`。入库侧的 `httpUrl` schema 管不到历史脏数据，
 * 而 `javascript:` / `/\t/evil.com` / `https://显示名@真域` 只要有一次漏网，
 * 打穿的就是管理员或普通用户的浏览器。
 *
 * 三条硬口径（详见 lib/safe-url.ts）：
 *   - `href={...}` -> safeHref / safeSrc 包过
 *   - `window.open(...)` -> 用 safeWindowOpen（顺带补齐 noopener，防 reverse tabnabbing）
 *   - `location.href = ...` -> 值必须先过 safeHref 或（登录回调那种）normalizeCallbackUrl
 * 例外一律进 SANCTIONED 清单：写死在本地的导航常量可以是裸的，
 * 但必须给出「它为什么是静态的」证据，证据没了或者命中没了都会红。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

/** 取从 openParen 之后的第一个顶层实参（按括号与引号配平，避开 replace('{"q"}') 这类内层括号） */
function firstArg(text: string, openParen: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(openParen + 1, i).split(",")[0] ?? "";
    } else if (ch === "," && depth === 1) {
      return text.slice(openParen + 1, i);
    }
  }
  return text.slice(openParen + 1);
}

/** 取 JSX 属性 `href={` 之后的表达式（花括号配平） */
function jsxExpr(text: string, braceIndex: number): string {
  let depth = 0;
  for (let i = braceIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(braceIndex + 1, i);
    }
  }
  return text.slice(braceIndex + 1);
}

interface Hit {
  file: string;
  line: number;
  kind: "href" | "window.open" | "location";
  expr: string;
}

/** 表达式里出现这些形状，说明值是外部数据而不是本地常量 */
const EXTERNAL_SHAPE = String.raw`(?:\.(?:url|href|link|targetUrl|searchUrl|website|feedUrl|saveUrl|issueUrl|directUrl|image)\b|\b(?:url|href|link)(?:Url)?\b)`;

function collectHits(): Hit[] {
  const hits: Hit[] = [];
  for (const file of listSources(join(ROOT, "src"))) {
    // 安全闸自己的实现里有 window.open / '#'，不能当命中
    if (file === "src/lib/safe-url.ts") continue;
    const text = readFileSync(join(ROOT, file), "utf8");
    const lineOf = (index: number) => text.slice(0, index).split("\n").length;

    for (const m of text.matchAll(/\bhref=\{/g)) {
      const expr = jsxExpr(text, m.index! + m[0].length - 1).replace(/\s+/g, " ").trim();
      // 模板字面量以 / 开头：`/category/${slug}` 这类站内拼接不构成出口
      if (/^["'`]\/(?!\/)/.test(expr)) continue;
      if (!new RegExp(EXTERNAL_SHAPE, "i").test(expr)) continue;
      if (/safe(?:Href|Src)\(/.test(expr)) continue;
      hits.push({ file, line: lineOf(m.index!), kind: "href", expr });
    }
    for (const m of text.matchAll(/\bwindow\.open\(/g)) {
      const expr = firstArg(text, m.index! + m[0].length - 1).replace(/\s+/g, " ").trim();
      // 本地常量（写死的站内路径）不构成风险
      if (/^["'`]\/(?!\/)/.test(expr)) continue;
      hits.push({ file, line: lineOf(m.index!), kind: "window.open", expr });
    }
    // 只认「真的会导航」的写法：window.location(.href) = 与 location.assign/replace。
    // 裸 `location =` 会误伤 `const location = response.headers.get('location')` 这类变量声明。
    for (const m of text.matchAll(/\bwindow\.location(?:\.href)?\s*=\s*|\blocation\.(?:assign|replace)\(/g)) {
      const tail = text.slice(m.index! + m[0].length);
      const expr = (m[0].endsWith("(") ? firstArg(text, m.index! + m[0].length - 1) : tail.split("\n")[0])
        .replace(/[;]\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (/^["'`]\/(?!\/)/.test(expr)) continue;
      hits.push({ file, line: lineOf(m.index!), kind: "location", expr });
    }
  }
  return hits;
}

/**
 * 已经人工核对过的例外。
 * evidence 必须逐字出现在同一个文件里 —— 否则「它为什么安全」这个理由就过期了。
 */
const SANCTIONED: Array<{ file: string; kind: Hit["kind"]; expr: string; why: string; evidence: string[] }> = [
  // ---- 本地写死的导航常量（不是外部数据）----
  {
    file: "src/app/admin/AdminDashboardClient.tsx",
    kind: "href",
    expr: "item.href",
    why: "快捷管理导航来自同文件 navigationItems 常量表",
    evidence: ["href: '/admin/sitelist'"],
  },
  {
    file: "src/app/admin/AdminLayoutClient.tsx",
    kind: "href",
    expr: "item.href",
    why: "侧栏一级导航是同文件写死的 /admin/* 常量",
    evidence: ["href: \"/admin\""],
  },
  {
    file: "src/app/admin/AdminLayoutClient.tsx",
    kind: "href",
    expr: "subItem.href",
    why: "侧栏二级导航与一级同源（同一份常量表）",
    evidence: ["subItem.href"],
  },
  {
    file: "src/app/not-found.tsx",
    kind: "href",
    expr: "link.href",
    why: "404 推荐入口是同文件常量",
    evidence: ["link.href"],
  },
  {
    file: "src/app/not-found.tsx",
    kind: "href",
    expr: "home.href",
    why: "404「回首页」是同文件常量",
    evidence: ["home.href"],
  },
  {
    file: "src/components/user-center/center-page-header.tsx",
    kind: "href",
    expr: "back.href",
    why: "返回入口由各用户中心页面写死传入，不是外部数据",
    evidence: ["back.href"],
  },
  {
    file: "src/components/user-center/dashboard/stats-grid.tsx",
    kind: "href",
    expr: "item.href",
    why: "概览卡片的跳转目标是同文件 STAT_LINKS 常量表",
    evidence: ["href: '/me/history'"],
  },
  {
    file: "src/components/user-center/user-center-nav.tsx",
    kind: "href",
    expr: "item.href",
    why: "用户中心固定六个入口，同文件常量表",
    evidence: ["href: '/me/plugins'"],
  },
  {
    file: "src/app/me/plugins/me-plugins-view.tsx",
    kind: "href",
    expr: "href",
    why: "插件入口卡片来自同文件 cards 常量表（全是站内路径）",
    evidence: ["href: '/marketplace/installed'"],
  },
  {
    file: "src/components/mobile-nav.tsx",
    kind: "href",
    expr: "href",
    why: "移动端底栏四项写死在同文件 ITEMS 常量表",
    evidence: ["href: '/favorites'"],
  },
  {
    file: "src/components/user-center/dashboard/entry-groups.tsx",
    kind: "href",
    expr: "href",
    why: "概览分组入口写死在同文件 GROUPS 常量表",
    evidence: ["href: '/me/history'"],
  },
  {
    file: "src/components/user-center/dashboard/quick-actions.tsx",
    kind: "href",
    expr: "href",
    why: "快捷操作写死在同文件 ACTIONS 常量表",
    evidence: ["const ACTIONS = ["],
  },
  // ---- 上一行已经过安全闸，这里只是把值交给 open / location ----
  {
    file: "src/components/search-bar.tsx",
    kind: "window.open",
    expr: "href",
    why: "href 来自 safeHref，且 isSafeHttpUrl 判定通过才走到这里",
    evidence: ["const href = safeHref(itemWithHref.href, '')", "if (href && isSafeHttpUrl(href))"],
  },
  {
    file: "src/components/search-bar.tsx",
    kind: "location",
    expr: "href",
    why: "同上：_self 分支用的是已过闸的 href",
    evidence: ["const href = safeHref(itemWithHref.href, '')", "window.location.assign(href)"],
  },
  {
    file: "src/components/search/spotlight-modal.tsx",
    kind: "window.open",
    expr: "url",
    why: "openSite 先 safeHref 再 isSafeHttpUrl，脏 URL 直接 return",
    evidence: ["const url = safeHref(site.url, '')", "if (!url || !isSafeHttpUrl(url)) return"],
  },
  {
    file: "src/components/search/spotlight-modal.tsx",
    kind: "location",
    expr: "url",
    why: "同上：_self 分支复用过了安全闸的 url",
    evidence: ["const url = safeHref(site.url, '')", "window.location.href = url"],
  },
  {
    file: "src/components/search-palette.tsx",
    kind: "window.open",
    expr: "url",
    why: "openSite 与超级控制台同一条闸：safeHref + isSafeHttpUrl",
    evidence: ["const url = safeHref(site.url, '')", "if (!url || !isSafeHttpUrl(url)) return"],
  },
  {
    file: "src/components/search-palette.tsx",
    kind: "location",
    expr: "url",
    why: "同上：_self 分支复用过了安全闸的 url",
    evidence: ["const url = safeHref(site.url, '')", "window.location.href = url"],
  },
  {
    file: "src/components/site-peek-dialog.tsx",
    kind: "window.open",
    expr: "targetUrl",
    why: "深链模板先判 isSafeHttpUrl 才打开",
    evidence: ["if (!isSafeHttpUrl(targetUrl)) return"],
  },
  {
    file: "src/components/site-peek-dialog.tsx",
    kind: "window.open",
    expr: "u",
    why: "访问主站先 safeHref(item.href, '') 再 isSafeHttpUrl",
    evidence: ["const u = safeHref(item.href, '')", "if (!u || !isSafeHttpUrl(u)) return"],
  },
  {
    file: "src/components/site-peek-dialog.tsx",
    kind: "window.open",
    expr: "rel.targetUrl",
    why: "关联站点上一行就 return 掉非 http(s)",
    evidence: ["if (!isSafeHttpUrl(rel.targetUrl)) return"],
  },
  {
    file: "src/components/site-peek-dialog.tsx",
    kind: "window.open",
    expr: "alt.site.url",
    why: "双曲平替同一道闸",
    evidence: ["if (!isSafeHttpUrl(alt.site.url)) return"],
  },
  {
    file: "src/app/auth/signin/page.tsx",
    kind: "location",
    expr: "callbackUrl",
    why:
      "callbackUrl 由 normalizeCallbackUrl 强制同源并收敛为 path+search+hash，且只在 isSignInSuccess(res) 判定登录真成功后才赋值给 location.href",
    evidence: ["const callbackUrl = normalizeCallbackUrl(", "if (isSignInSuccess(res)) {"],
  },
  // ---- 站内路径：值只由一个构造点生成，生成时就完成编码 ----
  {
    file: "src/components/modular/modules/custom-category-widget.tsx",
    kind: "href",
    expr: "selected.href",
    why:
      "三处渲染点共用同一个 CategoryTab，href 只在 toTab 里由 `lib/seo/category-url` 的 " +
      "categoryHref 产出（`/category/${encodeURIComponent(key)}`）：脏 slug 逃不出这一段路径，" +
      "也不可能是伪协议。这里刻意不再叠一层 safeHref——那只会把「构造点已编码」这件事变模糊。",
    evidence: ["href: categoryHref(c)", "import { categoryHref } from '@/lib/seo/category-url'"],
  },
];

describe("渲染期 URL 卫生：外部可控地址一律过安全闸", () => {
  const hits = collectHits();

  it("全部裸 URL 出口都在例外清单里（新代码想裸着写会在这里红）", () => {
    const offenders = hits
      .filter(
        (hit) =>
          !SANCTIONED.some(
            (entry) => entry.file === hit.file && entry.kind === hit.kind && entry.expr === hit.expr,
          ),
      )
      .map((hit) => `${hit.file}:${hit.line} ${hit.kind}={${hit.expr}}`);
    expect(offenders, "这些出口把外部数据直接交给 href / window.open / location：\n" + offenders.join("\n")).toEqual([]);
  });

  it("例外清单没有过期条目（每条都还对应一处真实命中）", () => {
    const stale = SANCTIONED.filter(
      (entry) => !hits.some((hit) => hit.file === entry.file && hit.kind === entry.kind && hit.expr === entry.expr),
    ).map((entry) => `${entry.file} ${entry.kind}={${entry.expr}}`);
    expect(stale, `这些例外已经不再对应任何裸出口，应当删掉：\n${stale.join("\n")}`).toEqual([]);
  });

  it("例外清单给出的理由仍然在代码里", () => {
    const missing: string[] = [];
    for (const entry of SANCTIONED) {
      const text = readFileSync(join(ROOT, entry.file), "utf8");
      for (const evidence of entry.evidence) {
        if (!text.includes(evidence)) missing.push(`${entry.file} 缺少证据：${evidence}`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("扫描机本身没有瞎掉：确实抓到了 href / window.open / location 三类出口", () => {
    // 这条不是形式主义：正则一旦写错，前三条会「全绿」但一台空转的机器什么都拦不住
    const kinds = new Set(hits.map((hit) => hit.kind));
    expect(kinds.has("href")).toBe(true);
    expect(kinds.has("window.open")).toBe(true);
    expect(kinds.has("location")).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(SANCTIONED.length - 1);
  });
});

describe("这一批补齐的出口：确实换成了公共安全闸", () => {
  const cases: Array<[string, string]> = [
    ["src/app/hot/hot-view.tsx", "href={safeHref(site.url)}"],
    ["src/app/collections/[slug]/collection-detail-view.tsx", "href={safeHref(site.url)}"],
    ["src/components/tag-results-board.tsx", "href={safeHref(site.url)}"],
    ["src/app/admin/sitelist/page.tsx", "href={safeHref(site.url)}"],
    ["src/app/admin/resources/page.tsx", "href={safeHref(resource.items[0].url)}"],
    ["src/app/favorites/page.tsx", "href={safeHref(f.href)}"],
    ["src/components/modular/modules/rss-feed-widget.tsx", "href={safeHref(item.link)}"],
    ["src/components/modular/modules/iframe-widget.tsx", "safeSrc(config?.url)"],
    ["src/components/ai/ai-copilot-drawer.tsx", "const safe = safeHref(url, '')"],
    ["src/components/video-card.tsx", "safeWindowOpen(item.href)"],
    ["src/components/ecosystem-graph.tsx", "safeWindowOpen(selectedNode.url)"],
    ["src/components/graph/knowledge-star-map-modal.tsx", "safeWindowOpen(selectedNode.url)"],
    ["src/components/search-bar.tsx", "safeWindowOpen(matchedShortcut.directUrl)"],
    ["src/components/search/spotlight-modal.tsx", "safeWindowOpen(res.saveUrl)"],
    ["src/app/marketplace/installed/page.tsx", "safeWindowOpen(eng.searchUrl.replace('{q}', ''))"],
    ["src/components/site-peek-dialog.tsx", "if (snap) safeWindowOpen(snap)"],
    ["src/app/admin/videos/[id]/items/page.tsx", "safeWindowOpen(item.href)"],
  ];

  it.each(cases)("%s 用上了 %s", (file, needle) => {
    expect(readFileSync(join(ROOT, file), "utf8"), file).toContain(needle);
  });

  it("短链跳转以解析结果为准，不再只看字面前缀", () => {
    const route = readFileSync(join(ROOT, "src/app/s/[code]/route.ts"), "utf8");
    expect(route).toContain("isInternalShortLinkTarget(target)");
    const lib = readFileSync(join(ROOT, "src/lib/shortlink-target.ts"), "utf8");
    expect(lib).toContain("resolved.pathname.startsWith('/marketplace/')");
  });
});
