/**
 * 路由状态覆盖门禁（F2：路由级加载骨架与局部错误边界补全）。
 *
 * 两个真实商用短板（2026-11 F2 收口）：
 *   1. 慢网白屏：此前 `loading.tsx` 只有零散几条路由有，其余 10+ 条路由在
 *      服务端渲染期间整页空白（/search、/submit 是 force-dynamic；/sites 等
 *      ISR 冷缓存首访同样要等中枢取数）；/site/[id]、/collections 系同病，
 *      但二者有软 404 回归锁（见 STATE_EXEMPT 的锁豁免），裁决不接 loading；
 *   2. 局部崩溃踢出外壳：路由级 `error.tsx` 缺失时，抛错一路冒泡到全局
 *      `app/error.tsx`，用户被踢出整个站内外壳（导航消失），只能回首页重来。
 *
 * 覆盖模型（与 Next.js App Router 运行时语义一致，不发明第二套规则）：
 *   - loading：目录自身**或任一祖先段**有 `loading.tsx` 即覆盖——父级
 *     loading.tsx 会把子段包进同一 Suspense 边界，子段导航时照样出骨架；
 *   - error：目录自身**或任一祖先段**有局部 `error.tsx` 即覆盖；但**根级
 *     `app/error.tsx` 是全局网**——对非根路由它意味着「踢出外壳」，不算
 *     局部覆盖（这正是本门禁要消灭的去向）。
 *
 * 豁免规则（照抄 failure-surface 的严格风格）：
 *   - STATE_EXEMPT **逐目录**写理由，**禁止通配/前缀放行**——新增路由默认
 *     红灯，必须显式接线或显式豁免，不许 `auth/*` 一票放行；
 *   - 清单双向校验：豁免条目必须对应**确实缺覆盖**的路由（残留豁免也红），
 *     保证清单与现状永远一致；
 *   - loading.tsx 一律引用 RouteSkeleton（防第二套骨架）；仅有的 5 个手写
 *     骨架（形状逐块对齐真实布局，N5/N11 教训）在 HANDCRAFTED_SKELETONS
 *     逐文件写明理由，冻结不许再增。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

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
const APP = join(ROOT, "src", "app");

function appPath(rel: string): string {
  return join(APP, ...rel.split("/").filter(Boolean));
}

function appFile(rel: string): string | null {
  const full = appPath(rel);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

/** src/app 下所有 loading.tsx / error.tsx（相对 app/ 的 '/' 路径，如 "hot/loading.tsx"） */
function listStateFiles(name: "loading.tsx" | "error.tsx", out: string[] = []): string[] {
  for (const entry of readdirSync(APP, { withFileTypes: true })) {
    const walk = (dirRel: string) => {
      const full = appPath(dirRel);
      for (const e of readdirSync(full, { withFileTypes: true })) {
        const child = dirRel ? `${dirRel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(child);
        else if (e.name === name) out.push(child);
      }
    };
    if (entry.isDirectory()) walk(entry.name);
    else if (entry.name === name) out.push(entry.name);
  }
  return out;
}

/** 所有含 page.tsx 的路由目录（'' 表示首页）。口径照抄 route-titles.test.ts。 */
function routeDirs(): string[] {
  const out: string[] = [];
  const walk = (dirRel: string) => {
    const full = appPath(dirRel);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (existsSync(join(appPath(child), "page.tsx"))) out.push(child);
      walk(child);
    }
  };
  walk("");
  if (existsSync(join(APP, "page.tsx"))) out.unshift("");
  return out;
}

/** 目录自身或任一祖先段是否有 loading.tsx（含根段）。返回命中的相对路径。 */
function loadingVia(dir: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (let i = parts.length; i >= 0; i--) {
    const seg = parts.slice(0, i).join("/");
    const rel = seg ? `${seg}/loading.tsx` : "loading.tsx";
    if (existsSync(appPath(rel))) return rel;
  }
  return null;
}

/**
 * 目录自身或任一祖先段是否有**局部** error.tsx。
 * 根级 error.tsx 是全局网：对非根路由返回 null（=「只剩全局兜底」），
 * 这正是「局部崩溃踢出外壳」的现状，必须显式豁免或补边界。
 */
function errorVia(dir: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (let i = parts.length; i >= 0; i--) {
    const seg = parts.slice(0, i).join("/");
    const rel = seg ? `${seg}/error.tsx` : "error.tsx";
    if (existsSync(appPath(rel))) {
      if (seg === "" && dir !== "") return null;
      return rel;
    }
  }
  return null;
}

/**
 * 豁免清单：逐目录、逐缺口写理由。禁止任何通配/前缀写法。
 * loading / error 分别声明——一条目录可以只缺其中一面。
 */
const STATE_EXEMPT: Record<string, { loading?: string; error?: string }> = {
  // ── 软 404 回归锁（裁决 2026-11-01：尊重已提交锁，不接 loading）─────────
  // 根因原文（三把锁一致）：「骨架屏边界会先流式刷 200，notFound 就改不了
  // 状态码」——loading.tsx 会让 generateMetadata 里的 notFound() 沦为
  // 200 + not-found 内容。error.tsx 不影响 404 状态码语义，错误边界照常保留。
  collections: {
    loading:
      "软 404 回归锁 collection-detail.test.ts（「/collections 段不得有 loading.tsx」，根因原文「骨架屏边界会先流式刷 200，notFound 就改不了状态码」）：不接 loading，保住合集不存在时的 404 状态码",
  },
  "collections/[slug]": {
    loading:
      "软 404 回归锁 collection-detail.test.ts（合集索引与详情两条都不得有骨架屏边界，根因原文「骨架屏边界会先流式刷 200，notFound 就改不了状态码」）：不接 loading，保住 /collections/:slug 不存在时的 404 状态码",
  },
  "site/[id]": {
    loading:
      "软 404 回归锁 site-detail-404.test.ts 与 site-detail-performance.test.ts（「不得恢复 loading.tsx——骨架屏边界会让 notFound() 变成流式 200」，根因原文「骨架屏边界会先流式刷 200，notFound 就改不了状态码」）：不接 loading，保住 /site/:id 不存在时的 404 状态码",
  },
  // ── 首页 ────────────────────────────────────────────────────────────
  "": {
    loading:
      "首页是复合布局（hero 轮展 + 目录分组 + DIY 展区），grid/detail/list 三形态都贴不上——形状错位的骨架比没有更糟（N11 教训）；且路由已是 ISR revalidate=60，缓存命中后首字节即到。错误面由 app/error.tsx 自身承担（根段没有比它更局部的边界）。",
  },
  // ── auth/*：静态客户端表单（'use client'，无服务端取数）─────────────
  "auth/forgot-password": {
    loading: "静态客户端表单：SSR 首字节即出完整表单，无服务端取数，不存在慢网白屏窗口",
    error:
      "忘记密码的失败态（邮箱不存在等）在表单内展示；渲染抛错面极小，落全局 error.tsx 可接受（F2 范围是内容浏览主路径）",
  },
  "auth/reset-password": {
    loading: "静态客户端表单：SSR 首字节即出完整表单，无服务端取数，不存在慢网白屏窗口",
    error:
      "重置密码的失败态在表单内展示；渲染抛错面极小，落全局 error.tsx 可接受（F2 范围是内容浏览主路径）",
  },
  "auth/signin": {
    loading: "静态客户端表单：SSR 首字节即出完整表单，无服务端取数，不存在慢网白屏窗口",
    error:
      "登录失败（凭证错误等）由 next-auth 回调在表单内提示；渲染抛错面极小，落全局 error.tsx 可接受（F2 范围是内容浏览主路径）",
  },
  "auth/signup": {
    loading: "静态客户端表单：SSR 首字节即出完整表单，无服务端取数，不存在慢网白屏窗口",
    error:
      "注册失败态在表单内提示；渲染抛错面极小，落全局 error.tsx 可接受（F2 范围是内容浏览主路径）",
  },
  "auth/verify-email": {
    loading: "静态客户端表单：SSR 首字节即出完整表单，无服务端取数，不存在慢网白屏窗口",
    error:
      "邮箱验证结果页为静态渲染；渲染抛错面极小，落全局 error.tsx 可接受（F2 范围是内容浏览主路径）",
  },
};

/**
 * 仅有的 5 个手写骨架（N5/N11 时期钉形状的存量，**冻结不许再增**）：
 * 形状逐块对齐真实布局（筛选条/统计条/密度行），RouteSkeleton 的
 * grid/detail/list 都贴不上。N11 教训：形状错位的骨架切换瞬间会
 * 「跳一下」，比没有骨架更糟。新路由一律用 RouteSkeleton 三形态。
 */
const HANDCRAFTED_SKELETONS: Record<string, string> = {
  "favorites/loading.tsx":
    "收藏页是「筛选条 + 4 列卡片墙」（N11 修掉的双骨架问题）：逐块对齐真实布局，形状比统一骨架重要",
  "me/loading.tsx":
    "用户中心是 force-dynamic 服务端壳（页头 + 身份条 + 统计卡 + 双栏面板）：骨架与 me-view.tsx 首屏逐块对齐（N5）",
  "me/data/loading.tsx":
    "数据与隐私页是「页头 + 导出/说明/危险区」定制布局：骨架与页面逐块对齐、容器宽度同源（N5）",
  "me/history/loading.tsx":
    "浏览历史页是「页头 + 4 行列表」定制布局：骨架与页面逐块对齐、容器宽度同源（N5）",
  "admin/loading.tsx":
    "管理台是指标卡 + 表格形态：与 admin 布局逐块对齐，且属内部运营面，不值得为统一骨架重排",
};

describe("扫描非空性：门禁必须真的看见全站路由与状态文件", () => {
  it("扫出全部可导航路由目录（否则空清单会假装通过）", () => {
    const dirs = routeDirs();
    expect(dirs.length).toBeGreaterThan(60);
    expect(dirs).toContain("");
    expect(dirs).toContain("site/[id]");
    expect(dirs).toContain("category/[slug]/p/[n]");
  });

  it("确实存在一批 loading.tsx / error.tsx（断言防的是「扫描坏了全绿」）", () => {
    expect(listStateFiles("loading.tsx").length).toBeGreaterThanOrEqual(18);
    expect(listStateFiles("error.tsx").length).toBeGreaterThanOrEqual(15);
  });
});

describe("豁免清单卫生：逐条理由、无通配、无幽灵、无残留", () => {
  it("禁止通配/前缀放行——豁免键必须是逐个写出的路由目录字面量", () => {
    const keys = Object.keys(STATE_EXEMPT);
    expect(keys.some((k) => k.includes("*"))).toBe(false);
    // 反例守卫：像 'auth/*'、'admin/' 这种前缀写法不是逐目录理由
    expect(keys.some((k) => k.endsWith("/") || k.endsWith("/*"))).toBe(false);
  });

  it("豁免键必须是真实存在的路由目录（幽灵条目红灯）", () => {
    const dirs = new Set(routeDirs());
    const ghosts = Object.keys(STATE_EXEMPT).filter((k) => !dirs.has(k));
    expect(ghosts).toEqual([]);
  });

  it("每条豁免都写了实质理由（不是占位符）", () => {
    for (const [dir, entry] of Object.entries(STATE_EXEMPT)) {
      if (entry.loading !== undefined) expect(entry.loading.length, `${dir} 的 loading 豁免理由`).toBeGreaterThan(15);
      if (entry.error !== undefined) expect(entry.error.length, `${dir} 的 error 豁免理由`).toBeGreaterThan(15);
    }
  });

  it("残留豁免红灯：豁免的缺口必须真的存在（接上边界后要同步删清单）", () => {
    const stale: string[] = [];
    for (const [dir, entry] of Object.entries(STATE_EXEMPT)) {
      if (entry.loading !== undefined && loadingVia(dir) !== null) stale.push(`${dir} loading`);
      if (entry.error !== undefined && errorVia(dir) !== null) stale.push(`${dir} error`);
    }
    expect(stale).toEqual([]);
  });
});

describe("加载骨架覆盖：每条路由有 loading.tsx（自身或父级）或显式豁免", () => {
  it("没有路由在慢网下白屏——逐目录检查，豁免必须在清单里", () => {
    const missing = routeDirs().filter((dir) => loadingVia(dir) === null && !STATE_EXEMPT[dir]?.loading);
    expect(missing).toEqual([]);
  });
});

describe("局部错误边界覆盖：每条路由有 error.tsx（自身或父级）或显式豁免", () => {
  it("没有路由的崩溃只剩全局兜底（踢出外壳）——逐目录检查", () => {
    const missing = routeDirs().filter((dir) => errorVia(dir) === null && !STATE_EXEMPT[dir]?.error);
    expect(missing).toEqual([]);
  });

  it("覆盖确实来自局部边界（app/error.tsx 全局网对非根路由不算数）", () => {
    // 语义不变量：任何非根路由的命中都不允许是根 error.tsx
    // （根 error.tsx 一命中就意味着「踢出外壳」，这正是门禁要消灭的去向）
    for (const dir of routeDirs()) {
      if (dir === "") continue;
      expect(errorVia(dir), dir + " 的错误覆盖来源").not.toBe("error.tsx");
    }
    // 正向抽查：/hot 有局部边界，必须命中它而不是全局网
    expect(errorVia("hot")).toBe("hot/error.tsx");
  });
});

describe("骨架体系唯一：loading.tsx 只许引用 RouteSkeleton", () => {
  it("手写骨架白名单只含既有的 5 个，且文件真实存在", () => {
    expect(Object.keys(HANDCRAFTED_SKELETONS).sort()).toEqual([
      "admin/loading.tsx",
      "favorites/loading.tsx",
      "me/data/loading.tsx",
      "me/history/loading.tsx",
      "me/loading.tsx",
    ]);
    for (const rel of Object.keys(HANDCRAFTED_SKELETONS)) {
      expect(existsSync(appPath(rel)), rel).toBe(true);
    }
  });

  it("所有 loading.tsx 引用 RouteSkeleton（白名单除外，逐文件有理由）", () => {
    const offenders = listStateFiles("loading.tsx").filter((rel) => {
      if (HANDCRAFTED_SKELETONS[rel]) return false;
      const src = appFile(rel) ?? "";
      return !src.includes("RouteSkeleton");
    });
    expect(offenders).toEqual([]);
  });
});

describe("错误文案口径统一：error.tsx 只许 RouteError 或 describeCrash", () => {
  it("所有 error.tsx 引用 RouteError 或 describeCrash（不自创文案体系）", () => {
    const offenders = listStateFiles("error.tsx").filter((rel) => {
      const src = appFile(rel) ?? "";
      return !src.includes("RouteError") && !src.includes("describeCrash");
    });
    expect(offenders).toEqual([]);
  });

  it("RouteError 的每一处调用都传 scope（错误卡标题按路由语义命名）", () => {
    const offenders = listStateFiles("error.tsx").filter((rel) => {
      const src = appFile(rel) ?? "";
      if (!src.includes("<RouteError")) return false;
      return !/scope="/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
