/**
 * U-239 + U-240：/hot 筛选进 URL（?fq=）+ 深链首帧不闪切。
 *
 * 缺陷：榜单内筛选词只活在 useState，刷新/分享/返回即丢；页签初值恒为
 * trending，深链 ?tab=new / ?tab=plugins 首帧先渲染 trending 再闪切。
 *
 * 修复（只改 overlay 两份，apps/web 由 mirror 生成）：
 *  1. 筛选词变化写回 ?fq=（replaceState，不产生历史记录），fqReady 守门
 *     + 写前比较 + 空值 delete('fq')，不留 ?fq= 残留；
 *  2. 挂载读回并入 syncFromUrl + 同一个 popstate，后退时 tab 与 fq 一起同步；
 *  3. 切页签 changeTab 全量保留参数，fq 自动保留，零改动；
 *  4. 清空路径（输入框 × + 三处空态「清空筛选条件」）零改动，走
 *     setFilterQuery('') 即自动 delete fq；
 *  5. page.tsx 从 searchParams 读 tab + fq 作首帧初值传入 HotView
 *     （initialTab / initialFilterQuery），深链首帧即正确，不闪切；
 *  6. fq 归一化复用 lib/search-page.ts 的 normalizeSearchQuery
 *     （去控制字符、折叠空白、截断 256，与 /search 同口径）；
 *  7. canonical 仍固定 /hot，?fq=/?tab= 变体由 canonical 收敛。
 *
 * 验收（8 条）：
 *  1. 输入筛选词后刷新，仍在同一筛选态；
 *  2. 复制带 ?fq= 的链接到新标签/分享给他人打开，恢复同一筛选态；
 *  3. 输入筛选词 → 点开站点卡片 → 返回，筛选词仍在；
 *  4. 带筛选词时切页签，fq 保留在 URL 里，切回后筛选词仍在；
 *  5. 清空筛选后 URL 里无 fq 参数（3 个空态都要）；
 *  6. 后退/前进：地址栏 fq 变化时框内词同步变化；
 *  7. 中文、空格、特殊字符筛选词经 URLSearchParams 往返无损；
 *  8. 深链首帧即初值（initialTab / initialFilterQuery），不闪切。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { normalizeSearchQuery } from "../src/lib/search-page";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("U-239：筛选词写回 URL（?fq=）", () => {
  const src = overlaySource("src/app/hot/hot-view.tsx");

  it("筛选变化写回 ?fq=，空值 delete('fq')，不留残留", () => {
    expect(src).toContain("params.set('fq', q)");
    expect(src).toContain("params.delete('fq')");
    expect(src).toContain("if (q) params.set('fq', q)");
    expect(src).toContain("else params.delete('fq')");
  });

  it("fqReady 守门：读回完成前不写回，免得冲掉进页参数", () => {
    expect(src).toContain("const [fqReady, setFqReady] = useState(false)");
    expect(src).toContain("if (!fqReady) return");
    expect(src).toContain("setFqReady(true)");
  });

  it("写前比较 + replaceState：地址相同不重写，不产生历史记录", () => {
    expect(src).toContain("if (next !== current) window.history.replaceState");
    expect(src).not.toContain("pushState");
  });

  it("fq 归一化复用 normalizeSearchQuery（与 /search 同口径）", () => {
    expect(src).toContain("import { normalizeSearchQuery } from '@/lib/search-page'");
    expect(src).toContain("normalizeSearchQuery(filterQuery)");
    expect(src).toContain("normalizeSearchQuery(params.get('fq') ?? undefined)");
  });
});

describe("U-239：挂载读回 + popstate 同步 fq", () => {
  const src = overlaySource("src/app/hot/hot-view.tsx");

  it("syncFromUrl 同时读回 tab 与 fq，后退时两者一起同步", () => {
    expect(src).toContain("params.get('tab')");
    expect(src).toContain("params.get('fq')");
    expect(src).toContain("window.addEventListener('popstate', syncFromUrl)");
    expect(src).toContain("window.removeEventListener('popstate', syncFromUrl)");
  });

  it("切页签 changeTab 全量保留参数、零改动，fq 自动保留", () => {
    // changeTab 从当前地址全量取参、只改 tab；全文件仅一处 delete('fq')，
    // 且在写回 effect 里——changeTab 内没有任何删 fq 的逻辑。
    expect(src).toContain("const params = new URLSearchParams(window.location.search)");
    expect(src).toMatch(/changeTab[\s\S]*?params\.delete\('tab'\)/);
    expect(src.match(/params\.delete\('fq'\)/g)).toHaveLength(1);
  });
});

describe("U-239：清空路径零改动，清空后无 fq 残留", () => {
  const src = overlaySource("src/app/hot/hot-view.tsx");

  it("三处空态「清空筛选条件」都只 setFilterQuery('')（输入框 × 已收进 FilterBar）", () => {
    expect(src.match(/清空筛选条件/g)).toHaveLength(3);
    // 2026-11-25 阶段 B：输入框的清空钮收进 FilterBar 原语（清空 → onChange('')），
    // hot-view 内只剩三处空态的 setFilterQuery('')。清空路径仍不直接操作 URL，
    // 全文件仅一处 delete('fq')，且在写回 effect 里。
    expect(src.match(/setFilterQuery\(''\)/g)).toHaveLength(3);
    const clearSites = [...src.matchAll(/setFilterQuery\(''\)/g)].map((m) => m.index ?? 0);
    for (const idx of clearSites) {
      expect(src.slice(Math.max(0, idx - 200), idx)).not.toContain("delete('fq')");
    }
  });
});

describe("U-240：深链首帧初值，不闪切", () => {
  const viewSrc = overlaySource("src/app/hot/hot-view.tsx");
  const pageSrc = overlaySource("src/app/hot/page.tsx");

  it("HotView 接受 initialTab / initialFilterQuery 可选初值并用作 state 初值", () => {
    expect(viewSrc).toContain("initialTab?: 'trending' | 'new' | 'plugins'");
    expect(viewSrc).toContain("initialFilterQuery?: string");
    expect(viewSrc).toContain("useState<'trending' | 'new' | 'plugins'>(initialTab)");
    expect(viewSrc).toContain("useState(initialFilterQuery)");
  });

  it("page.tsx 从 searchParams 读 tab + fq 并传初值给 HotView", () => {
    expect(pageSrc).toContain("searchParams: Promise<Record<string, string | string[] | undefined>>");
    expect(pageSrc).toContain("normalizeSearchQuery(sp.fq)");
    expect(pageSrc).toContain("initialTab={initialTab}");
    expect(pageSrc).toContain("initialFilterQuery={initialFilterQuery}");
  });

  it("非法 tab 回落 trending；canonical 仍固定 /hot", () => {
    expect(pageSrc).toContain("tabParam === 'new' ? 'new' : tabParam === 'plugins' ? 'plugins' : 'trending'");
    expect(pageSrc).toContain("canonical: '/hot'");
  });
});

describe("U-239/U-240：归一化与 URL 往返行为", () => {
  it("normalizeSearchQuery：折叠空白、去首尾空格、截断 256", () => {
    expect(normalizeSearchQuery("  中文  测试  ")).toBe("中文 测试");
    expect(normalizeSearchQuery("")).toBe("");
    expect(normalizeSearchQuery("   ")).toBe("");
    expect(normalizeSearchQuery("a".repeat(300))).toHaveLength(256);
  });

  it("中文、空格、特殊字符筛选词经 URLSearchParams 往返无损", () => {
    for (const q of ["中文筛选", "a b c", "a+b&c=d?e#f", "开发工具", "AI 视频 生成"]) {
      const params = new URLSearchParams();
      params.set("fq", normalizeSearchQuery(q));
      expect(new URLSearchParams(params.toString()).get("fq")).toBe(normalizeSearchQuery(q));
    }
  });

  it("分享链接恢复：?tab=plugins&fq=中文 解析出同一 tab 与筛选词", () => {
    const params = new URLSearchParams("tab=plugins&fq=%E4%B8%AD%E6%96%87");
    expect(params.get("tab")).toBe("plugins");
    expect(normalizeSearchQuery(params.get("fq") ?? undefined)).toBe("中文");
  });

  it("切页签保留 fq：?fq=中文&tab=new 切到 plugins 后 fq 仍在", () => {
    const params = new URLSearchParams("fq=中文&tab=new");
    params.set("tab", "plugins");
    expect(params.get("fq")).toBe("中文");
    expect(params.get("tab")).toBe("plugins");
  });

  it("清空后无 fq 残留：fq 被删、tab 保留，不留 ?fq= 空参", () => {
    const params = new URLSearchParams("fq=中文&tab=new");
    params.delete("fq");
    expect(params.toString()).toBe("tab=new");
    expect(params.has("fq")).toBe(false);
  });
});
