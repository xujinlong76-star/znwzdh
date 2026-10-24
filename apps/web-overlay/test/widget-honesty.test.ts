/**
 * 仪表盘小卡的「不许编数据」保证。
 *
 * 真实缺陷（两个都在引擎监控 / 趋势小卡上）：
 *  1. metrics-widget 探活失败时依然显示绿色呼吸灯「中枢在线」，
 *     并用 `stats?.sites ?? 50` 把站点数**编**成 50 —— 假的绿灯比没有数据更危险，
 *     用户会据此认为系统正常而不去排查；
 *  2. trending-widget 在中枢不可用时把 4 条硬编码站点渲染成
 *     「今日技术飙升热度榜」，与真实榜单样式完全一致，没有任何标注。
 *     （同目录的天气卡当时也只是贴了个「演示数据」标签，就继续用源码里写死的
 *       温度表冒充「实时天气」——后来整卡改成走 /api/weather 真取数。）
 *  3. 同一个 trending 卡片还把量纲用错：trendScore 是 log1p(访问)+1.5·log1p(收藏)
 *     −0.1·天数 的**个位数指数**，却被 `Math.round(score / 1000)k` 配着星形图标画成
 *     GitHub 星标；实测中枢返回的站点全被算成「0k」。加上没测到时补的 `?? 100`
 *     和底注写死的「全网开发者实时协同偏好」，这张卡等于在教用户读一个不存在的数。
 *
 * 所以这里锁两件事：hub-health.ts 的判定结果（纯函数），
 * 以及两个组件源码里不许再出现「填默认值 / 不标注」的写法。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeHealth, type HubHealthLike } from "../src/lib/hub-health";
import { buildCategoryTabs } from "../src/components/modular/modules/custom-category-widget";
import { formatAltScore, manifoldLabel } from "../src/components/modular/modules/hyperbolic-radar-widget";
import { heatLabel, rowMetric, visitLabel } from "../src/components/modular/modules/trending-widget";
import { suggestCategoryForSite } from "../src/lib/modular/diy-presets";
import {
  WEATHER_CITIES,
  ageLabel,
  airQualityUrlPath,
  aqiLevel,
  describeWeatherCode,
  dayLabel,
  forecastUrlPath,
  formatTemp,
  normalizeUnit,
  observedAtLabel,
  resolveCityKey,
  windLabel,
} from "../src/lib/modular/weather";
import type { HubCategoryLite } from "../src/lib/navhub-api";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return hit;
}

/** 定位仓库根下的文件（core 的卡片目录与 overlay 必须同口径）；HERE 是 apps/<web|web-overlay>/test */
function repoFile(rel: string): string {
  const hit = resolve(HERE, "..", "..", "..", rel);
  if (!existsSync(hit)) throw new Error("无法定位仓库根文件 " + rel + "（候选：" + hit + "）");
  return hit;
}

/**
 * 只留代码、去掉注释。
 * 重写后的卡片会在文件头把「曾经的假数据长什么样」写进注释里当反面教材，
 * 直接对全文断言 not.toContain 会被这些注释顶穿。
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const full: HubHealthLike = {
  ok: true,
  mode: "standard",
  capabilities: { semantic: true, fts: true },
  stats: { sites: 128, categories: 12, tags: 340 },
};

describe("describeHealth：拿不到的数据一律说未知", () => {
  it("探测中 → probing 态，且不宣称任何能力", () => {
    const s = describeHealth(null, false, true);
    expect(s.tone).toBe("probing");
    expect(s.label).toBe("探测中...");
    expect(s.sitesLabel).not.toMatch(/\d/);
  });

  it("探活失败 → offline，且绝不显示「中枢在线」", () => {
    const s = describeHealth(null, true, false);
    expect(s.tone).toBe("offline");
    expect(s.label).toBe("中枢离线");
    expect(s.label).not.toContain("在线");
    expect(s.sitesLabel).toBe("站点统计不可用");
    expect(s.engineLabel).toBe("引擎架构未知");
  });

  it("即使 failed 为假但从来没拿到 health，也不能当成在线", () => {
    expect(describeHealth(null, false, false).tone).toBe("offline");
    expect(describeHealth(undefined, false, false).tone).toBe("offline");
  });

  it("中枢返回 ok:false → 异常态，而不是在线", () => {
    const s = describeHealth({ ok: false, mode: "lite" }, false, false);
    expect(s.tone).toBe("offline");
    expect(s.label).toBe("中枢异常");
    expect(s.semanticLabel).toBe("能力状态未知");
  });

  it("健康时如实展示统计与能力", () => {
    const s = describeHealth(full, false, false);
    expect(s.tone).toBe("online");
    expect(s.label).toBe("中枢在线");
    expect(s.sitesLabel).toBe("收录 128 个站点");
    expect(s.engineLabel).toBe("PG + pgvector");
    expect(s.semanticLabel).toBe("向量 KNN 就绪");
  });

  it("缺少 stats 时写「站点数未知」，绝不填默认数字（回归：曾用 ?? 50）", () => {
    const s = describeHealth({ ok: true }, false, false);
    expect(s.sitesLabel).toBe("站点数未知");
    expect(s.sitesLabel).not.toMatch(/\d/);
  });

  it("脏统计值（NaN / 负数 / 字符串 / 小数以外）也视为未知", () => {
    for (const bad of [Number.NaN, -1, "128", null, undefined, Number.POSITIVE_INFINITY]) {
      const s = describeHealth({ ok: true, stats: { sites: bad as number } }, false, false);
      expect(s.sitesLabel).toBe("站点数未知");
    }
    expect(describeHealth({ ok: true, stats: { sites: 0 } }, false, false).sitesLabel).toBe("收录 0 个站点");
  });

  it("引擎与语义能力：未知就是未知，不猜默认值", () => {
    expect(describeHealth({ ok: true }, false, false).engineLabel).toBe("引擎架构未知");
    expect(describeHealth({ ok: true, mode: "lite" }, false, false).engineLabel).toBe("lite");
    expect(describeHealth({ ok: true, capabilities: { semantic: false } }, false, false).semanticLabel).toBe(
      "关键词+拼音",
    );
    expect(describeHealth({ ok: true }, false, false).semanticLabel).toBe("关键词+拼音");
  });

  it("任意脏输入都不抛异常", () => {
    for (const dirty of [{}, { ok: true, stats: {} }, { stats: null }, { capabilities: null }]) {
      expect(() => describeHealth(dirty as HubHealthLike, false, false)).not.toThrow();
    }
  });
});

describe("组件源码：不许编造在线状态 / 不许不标注演示数据", () => {
  const metrics = readFileSync(overlayFile("src/components/modular/modules/metrics-widget.tsx"), "utf8");
  const trending = readFileSync(overlayFile("src/components/modular/modules/trending-widget.tsx"), "utf8");

  it("引擎监控小卡：状态与统计都来自 describeHealth，禁止默认值兜底", () => {
    expect(metrics).toContain("describeHealth(health, failed, loading)");
    expect(metrics).toContain("setFailed(true)");
    // 回归守卫：曾经的 `stats?.sites ?? 50` 把站点数编成 50
    expect(metrics).not.toMatch(/stats\?\.sites\s*\?\?/);
    expect(metrics).not.toContain("?? 50");
  });

  it("引擎监控小卡：不再硬编码绿色在线胶囊", () => {
    // 状态文案必须来自 status.label，源码里不该再出现无条件写死的「中枢在线」
    expect(metrics).not.toMatch(/>\s*\{\s*loading\s*\?\s*'探测中\.\.\.'\s*:\s*'中枢在线'\s*\}/);
    expect(metrics).toContain("status.label");
    expect(metrics).toContain("TONE_DOT[status.tone]");
  });

  it("趋势小卡：兜底列表必须打上「演示数据」标记", () => {
    expect(trending).toContain("演示数据");
    expect(trending).toContain("setDemo(true)");
    expect(trending).toContain("DEMO_SITES");
    // 兜底数据只允许出现在 DEMO_SITES 常量里，不许再内联两份重复清单
    expect(trending.match(/Next\.js 15/g)?.length).toBe(1);
  });
});

describe("GitHub 热力小卡：真实事件 + 模拟矩阵必须显式标注", () => {
  const widget = readFileSync(overlayFile("src/components/modular/modules/github-heatmap-widget.tsx"), "utf8");
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");

  it("数字来自公开事件聚合，源码里不再自己造数", () => {
    expect(widget).toContain("fetchPublicPushEvents");
    expect(widget).toContain("buildHeatmap");
    expect(widget).not.toMatch(/Math\.sin\(/);
    // 说明注释里会提到旧的造数手法，但不能真的出现在代码里
    expect(widget).not.toMatch(/=\s*Math\.sin/);
    // 回归守卫：曾经写死别人的账号当默认用户名
    expect(widget).not.toMatch(/torvalds/i);
  });

  it("没填用户名时直说没填，不预填他人账号、不铺假矩阵", () => {
    expect(widget).toContain("尚未设置 GitHub 用户名");
    expect(widget).toMatch(/if\s*\(!username\)\s*\{[\s\S]{0,200}return/);
  });

  it("模拟矩阵只能由显式按钮产生，并常驻「模拟数据」标记与免责说明", () => {
    expect(widget).toContain("预览模拟布局");
    expect(widget).toContain("模拟数据");
    expect(widget).toContain("不是任何人的真实贡献记录");
    expect(widget).toContain(`source: 'demo'`);
  });

  it("取数失败有独立文案，不静默退回假数据", () => {
    for (const reason of ["invalid_user", "not_found", "rate_limited", "queued", "network"]) {
      expect(widget).toContain(reason);
    }
    expect(widget).toContain("未取到数据");
  });

  it("注册表：描述不许超过 API 能给的窗口，且必须暴露 username 配置", () => {
    const entry = /'github-heatmap': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    expect(entry).not.toBe("");
    // API 只给最近 90 天 / 300 条事件，「52 周」「年度提交热度」都是假承诺
    expect(entry).not.toMatch(/52\s*周/);
    expect(entry).not.toMatch(/年度/);
    expect(entry).toContain("configSchema");
    expect(entry).toMatch(/key:\s*'username'/);
    expect(entry).toContain("13 周");
  });
});

describe("订阅小卡：真实代取，不再放写死的假新闻", () => {
  const widget = readFileSync(overlayFile("src/components/modular/modules/rss-feed-widget.tsx"), "utf8");
  const route = readFileSync(overlayFile("src/app/api/rss/route.ts"), "utf8");
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");

  it("组件真的取数：读 feedUrl 并打 /api/rss", () => {
    expect(widget).toContain("config?.feedUrl");
    expect(widget).toContain("/api/rss");
    expect(widget).toContain("AbortController");
  });

  it("五条假标题彻底删除（回归守卫）", () => {
    for (const fake of ["React 19.2 正式发布", "Next.js 15.5", "Rust 2026 Edition", "SQLite 推出轻量向量扩展", "TypeScript 5.8 候选版"]) {
      expect(widget).not.toContain(fake);
    }
    expect(widget).not.toContain("PRESET_FEEDS");
    // 也不再宣称「演示数据」，因为现在要么真实要么明确失败
    expect(widget).not.toContain("演示数据");
  });

  it("没配地址 / 取失败 / 陈旧快照三种状态各有可见文案", () => {
    expect(widget).toContain("尚未配置订阅地址");
    expect(widget).toContain("REASON_HINT");
    expect(widget).toContain("陈旧快照");
    expect(widget).toContain("无时间标记");
  });

  it("抓取时刻缺失就写「时间未知」，不拿 Date.now() 冒充刚抓过", () => {
    expect(widget).toContain("时间未知");
    expect(widget).toContain("typeof body.fetchedAt === 'number'");
    expect(widget).toContain("typeof body?.staleAt === 'number'");
    // 旧写法把「响应没带时间」渲染成「刚刚抓取」，等于替上游作证
    expect(widget).not.toContain("fetchedAt: Number(body.fetchedAt ?? Date.now())");
    expect(widget).not.toContain("fetchedAt: Number(body?.staleAt ?? Date.now())");
  });

  it("缓存时刻等于 body.fetchedAt：staleAt 不会报一个什么都没抓过的时刻", () => {
    expect(route).toContain("cachePut(key, { at: body.fetchedAt, body })");
    expect(route).not.toContain("cachePut(key, { at: Date.now(), body })");
  });

  it("代取路由复用 SSRF 三层防护，私网一律拒绝", () => {
    expect(route).toContain("guardedFetch");
    expect(route).toContain("isProbablySafeUrl");
    expect(route).toContain("allowPrivateNetworks: false");
    expect(route).toContain("readTextLimited");
    expect(route).toContain("export const runtime = 'nodejs'");
    expect(route).toContain("'Cache-Control': 'no-store'");
    // 有界缓存 + 限流：否则这是一个可以被刷爆的开放代理
    expect(route).toContain("MAX_ENTRIES");
    expect(route).toContain("rateLimited");
  });

  it("只回解析后的条目，不把原始 XML 透给前端", () => {
    expect(route).not.toMatch(/body:\s*\{[\s\S]{0,120}raw/);
    expect(route).toContain("items: parsed.items");
  });

  it("注册表把订阅地址暴露成可配字段，描述不再空承诺", () => {
    const entry = /'rss-feed': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    expect(entry).toMatch(/key:\s*'feedUrl'/);
    expect(entry).toContain("服务端代取");
    expect(entry).not.toContain("保持敏锐技术嗅觉");
  });
});

describe("嵌入小卡：配置项必须真的作用到 iframe", () => {
  const widget = readFileSync(overlayFile("src/components/modular/modules/iframe-widget.tsx"), "utf8");
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");

  it("改配置会重新加载，而不是只当 useState 初值", () => {
    expect(widget).toContain("safeSrc(config?.url)");
    expect(widget).toMatch(/useEffect\(\(\) => \{[\s\S]{0,240}appliedConfigUrl\.current = configuredUrl[\s\S]{0,120}reloadWith\(configuredUrl\)/);
  });

  it("allowFullscreen 真的传到 iframe，且拒绝内嵌有超时解释", () => {
    expect(widget).toContain("allowFullScreen={allowFullscreen}");
    expect(widget).toContain("STALL_MS");
    expect(widget).toContain("X-Frame-Options");
    // 非法配置地址要说明被拒绝，而不是悄悄换成预设
    expect(widget).toContain("不是合法 http(s)");
  });

  it("注册表暴露 url / allowFullscreen，并说明多数站点拒绝内嵌", () => {
    const entry = /'iframe-embed': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    expect(entry).toMatch(/key:\s*'url'/);
    expect(entry).toMatch(/key:\s*'allowFullscreen'/);
    expect(entry).toContain("拒绝被内嵌");
    expect(entry).not.toMatch(/任意自定义 Web 应用/);
  });
});

/* ------------------------------ 分类精选卡 ------------------------------ */

function cat(id: string, title: string, extra: Partial<HubCategoryLite> = {}): HubCategoryLite {
  return { id, title, parentId: "root-dev", enabled: true, sort: 0, ...extra };
}

describe("buildCategoryTabs：页签只可能是真的有存活站点的叶子类目", () => {
  const counts = new Map<string, number>([["c-ai", 42], ["c-editor", 17], ["c-empty", 0], ["c-build", 5]]);

  it("一级根、停用、空标题的类目都不做页签（根的自身计数恒为 0）", () => {
    const { tabs } = buildCategoryTabs(
      [
        cat("root-dev", "开发", { parentId: null }),
        cat("c-ai", "AI 工具", { parentId: "" }),
        cat("c-off", "停用的", { enabled: false }),
        cat("c-blank", "   ", { parentId: "root-dev" }),
        cat("c-editor", "编辑器"),
      ],
      counts,
      "",
    );
    expect(tabs.map((t) => t.id)).toEqual(["c-editor"]);
  });

  it("有计数表时按存活站点数降序，0 站点的类目直接不进页签", () => {
    const { tabs } = buildCategoryTabs(
      [cat("c-editor", "编辑器"), cat("c-ai", "AI 工具"), cat("c-empty", "空类目"), cat("c-build", "构建工具")],
      counts,
      "",
    );
    expect(tabs.map((t) => t.id)).toEqual(["c-ai", "c-editor", "c-build"]);
    expect(tabs[0]?.siteCount).toBe(42);
  });

  it("计数表拿不到（返回 null）时退回 sort 升序，且 siteCount 记 null 而不是 0", () => {
    const { tabs } = buildCategoryTabs(
      [cat("c-b", "乙", { sort: 5 }), cat("c-a", "甲", { sort: 1 }), cat("c-c", "丙", { sort: 3 })],
      null,
      "",
    );
    expect(tabs.map((t) => t.id)).toEqual(["c-a", "c-c", "c-b"]);
    expect(tabs.every((t) => t.siteCount === null)).toBe(true);
  });

  it("slug 优先当标识，没有 slug 才用 id；分类页链接同口径", () => {
    const { tabs } = buildCategoryTabs(
      [cat("c-ai", "AI", { slug: "ai-tools" }), cat("c-x", "无 slug")],
      new Map([["c-ai", 3], ["c-x", 2]]),
      "",
    );
    expect(tabs[0]?.ref).toBe("ai-tools");
    expect(tabs[0]?.href).toBe("/category/ai-tools");
    expect(tabs[1]?.ref).toBe("c-x");
    expect(tabs[1]?.href).toBe("/category/c-x");
  });

  it("脏 slug 逃不出 /category/ 这一段：href 在构造点就完成编码", () => {
    const { tabs } = buildCategoryTabs(
      [
        cat("c-escape", "越狱", { slug: "../../evil?q=1" }),
        cat("c-proto", "伪协议", { slug: "javascript:alert(1)" }),
        cat("c-cjk", "中文", { slug: "ai-编程" }),
      ],
      new Map([["c-escape", 3], ["c-proto", 2], ["c-cjk", 1]]),
      "",
    );
    const hrefOf = (id: string) => tabs.find((t) => t.id === id)?.href;
    expect(hrefOf("c-escape")).toBe("/category/..%2F..%2Fevil%3Fq%3D1");
    expect(hrefOf("c-proto")).toBe("/category/javascript%3Aalert(1)");
    expect(hrefOf("c-cjk")).toBe("/category/ai-%E7%BC%96%E7%A8%8B");
    // 落点必须还在站内 /category/ 前缀下：这一条断了就是开放重定向/XSS 载体
    for (const href of tabs.map((t) => t.href)) {
      expect(new URL(href, "https://navhub.example").pathname.startsWith("/category/")).toBe(true);
    }
  });

  it("同 slug 的重复类目只留一个，页签最多 8 个", () => {
    const many = Array.from({ length: 12 }, (_, i) => cat(`c${i}`, `类目${i}`, { slug: `s${i}` }));
    many.push(cat("c-dup", "重复", { slug: "s0" }));
    const countsAll = new Map(many.map((c) => [c.id, 10]));
    const { tabs } = buildCategoryTabs(many, countsAll, "");
    expect(tabs.length).toBe(8);
    expect(new Set(tabs.map((t) => t.ref)).size).toBe(tabs.length);
  });

  it("配置的类目在表里但排位靠后：提到第一位，让改配置立刻可见", () => {
    const { tabs, configuredMissing } = buildCategoryTabs(
      [cat("c-ai", "AI 工具"), cat("c-build", "构建工具", { slug: "build" })],
      new Map([["c-ai", 42], ["c-build", 5]]),
      "build",
    );
    expect(configuredMissing).toBe(false);
    expect(tabs[0]?.ref).toBe("build");
  });

  it("配置匹配大小写不敏感（id 与 slug 都可以）", () => {
    const { tabs } = buildCategoryTabs(
      [cat("c-ai", "AI 工具", { slug: "AI-Tools" }), cat("c-build", "构建工具")],
      new Map([["c-ai", 3], ["c-build", 9]]),
      "ai-tools",
    );
    expect(tabs[0]?.ref).toBe("AI-Tools");
  });

  it("配置的是站点数为 0 的类目：仍然选中它，但不谎称它可用", () => {
    const { tabs, configuredMissing } = buildCategoryTabs(
      [cat("c-ai", "AI 工具"), cat("c-empty", "空类目", { slug: "empty" })],
      counts,
      "empty",
    );
    expect(configuredMissing).toBe(false);
    expect(tabs[0]?.ref).toBe("empty");
    expect(tabs[0]?.siteCount).toBe(0);
  });

  it("配置完全不认识时才报 configuredMissing（组件据此显式提示）", () => {
    const { tabs, configuredMissing } = buildCategoryTabs([cat("c-ai", "AI 工具")], counts, "not-here");
    expect(configuredMissing).toBe(true);
    expect(tabs.map((t) => t.ref)).toEqual(["c-ai"]);
  });

  it("脏输入不抛异常", () => {
    for (const dirty of [[], [{} as HubCategoryLite], [null as unknown as HubCategoryLite]]) {
      expect(() => buildCategoryTabs(dirty, counts, "")).not.toThrow();
    }
    expect(buildCategoryTabs([], new Map(), "")).toEqual({ tabs: [], configuredMissing: false });
  });
});

describe("分类精选小卡：数据来自中枢，不再是写死的外链清单", () => {
  const code = codeOnly(readFileSync(overlayFile("src/components/modular/modules/custom-category-widget.tsx"), "utf8"));
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");

  it("三类数据源都真的调用：类目表 + 计数表 + 类目检索", () => {
    expect(code).toContain("fetchCategories");
    expect(code).toContain("fetchCategoryCounts");
    expect(code).toContain("searchSites");
    expect(code).toContain("categoryId: tab.ref");
    expect(code).toContain("status: 'active'");
  });

  it("旧的 12 条硬编码外链与假页签彻底删除（回归守卫）", () => {
    expect(code).not.toContain("PRESET_CATEGORIES");
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).not.toMatch(/'ai'\s*,\s*'dev'/);
  });

  it("失败与空态分开：中枢不可用说「不可用」，类目为空说「暂无存活站点」", () => {
    expect(code).toContain("中枢不可用，取不到类目表");
    expect(code).toContain("取数失败（中枢不可用）");
    expect(code).toContain("中枢里还没有有存活站点的类目");
    expect(code).toContain("暂无存活站点");
    // res.degraded 必须参与判定，否则「失败」会被渲染成「这个类目没内容」
    expect(code).toContain("res.degraded");
  });

  it("截断要申报：计数缺失时只说「还有更多」，不编差额数字", () => {
    expect(code).toContain("类目内还有更多");
    expect(code).toMatch(/remaining === null/);
    expect(code).toContain("还有 {remaining} 个 →");
  });

  it("卡片内切类目不算配置：未落到配置的页签打「临时」", () => {
    expect(code).toContain("isTemporary");
    expect(code).toContain("临时");
  });

  it("注册表把 categoryId / limit 暴露成可配字段，描述不再吹「精选集合」", () => {
    const entry = /'custom-category': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    expect(entry).toMatch(/key:\s*'categoryId'/);
    expect(entry).toMatch(/key:\s*'limit'/);
    expect(entry).toContain("中枢类目");
    expect(entry).not.toContain("精选站点卡片集合");
  });
});

/* ------------------------------ 双曲平替雷达 ------------------------------ */

describe("manifoldLabel：口径外显，启发式估算不能伪装成语义结论", () => {
  it("真向量 + 语义可用才说「真实语义向量」", () => {
    expect(manifoldLabel("lorentz-hyperboloid", true)).toBe("真实语义向量 · 双曲测地距离");
  });

  it("标着双曲曲面但语义不可用时，不能宣称真实语义向量", () => {
    expect(manifoldLabel("lorentz-hyperboloid", false)).toBe("双曲推理未能完成");
  });

  it("启发式投影写清楚是估算", () => {
    const label = manifoldLabel("lorentz-heuristic", true);
    expect(label).toContain("启发式");
    expect(label).toContain("非语义结论");
  });

  it("站点已消失 / 未知取值都落到「未能完成」，不给数字当结论", () => {
    expect(manifoldLabel("missing_site", false)).toBe("该站点已不在中枢库中");
    for (const unknown of ["none", "", "hyperboloid", "pptx", "lorentz"]) {
      expect(manifoldLabel(unknown, true)).toBe("双曲推理未能完成");
    }
  });
});

describe("formatAltScore：非有限值给破折号，有效值只保留 2 位", () => {
  it("NaN / Infinity 不渲染成数字", () => {
    expect(formatAltScore(Number.NaN)).toBe("—");
    expect(formatAltScore(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("端点给 4 位小数，展示时不做精度镀金", () => {
    expect(formatAltScore(0.81234)).toBe("0.81");
    expect(formatAltScore(1)).toBe("1.00");
  });
});

describe("双曲平替雷达：读真端点，不留编造的对照表", () => {
  const code = codeOnly(readFileSync(overlayFile("src/components/modular/modules/hyperbolic-radar-widget.tsx"), "utf8"));
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");

  it("走中枢平替端点，并把 manifold 与 semanticAvailable 一路带到展示层", () => {
    expect(code).toContain("fetchHyperbolicAlternatives");
    expect(code).toContain("hyper.manifold");
    expect(code).toContain("hyper.semanticAvailable");
    expect(code).toContain("manifoldLabel(");
    expect(code).toContain("formatAltScore(hit.alternativeScore)");
  });

  it("旧的硬编码「商业 vs 开源」对照与假几何文案彻底删除（回归守卫）", () => {
    expect(code).not.toContain("ALTERNATIVE_PAIRS");
    // 「减少 80%」这类量化结论只能来自端点返回值，不能是字面量
    expect(code).not.toMatch(/减少\s*\d+(\.\d+)?\s*%/);
    expect(code).not.toMatch(/Poincar/i);
    expect(code).not.toMatch(/\b80%\b/);
  });

  it("未命中 / 无候选 / 取数失败各有文案，失败不渲染成空结果", () => {
    expect(code).toContain("中枢里没有收录");
    expect(code).toContain("没有可比较的候选");
    expect(code).toContain("平替推理取数失败");
    expect(code).toContain("res.degraded");
    expect(code).toContain("提交该站点");
  });

  it("输入防抖 + 卸载时取消请求：逐字打中枢会让检索洪水", () => {
    expect(code).toContain("DEBOUNCE_MS");
    expect(code).toContain("setTimeout(() => void lookup(q)");
    expect(code).toContain("abortRef.current?.abort()");
  });

  it("注册表暴露 site / limit，标题不再吹「几何推演」", () => {
    const entry = /'hyperbolic-radar': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    expect(entry).toMatch(/key:\s*'site'/);
    expect(entry).toMatch(/key:\s*'limit'/);
    expect(entry).toContain("启发式");
    expect(entry).not.toMatch(/几何平替推演/);
  });
});

describe("天气纯函数：读数缺失说「未知」，不补 0 也不猜天气码", () => {
  it("formatTemp：null / NaN 给破折号，华氏按 9/5+32 换算", () => {
    expect(formatTemp(null, "celsius")).toBe("—");
    expect(formatTemp(Number.NaN, "celsius")).toBe("—");
    expect(formatTemp(0, "celsius")).toBe("0°C");
    expect(formatTemp(-3.2, "celsius")).toBe("-3°C");
    expect(formatTemp(0, "fahrenheit")).toBe("32°F");
    expect(formatTemp(100, "fahrenheit")).toBe("212°F");
  });

  it("describeWeatherCode：表内码给中文，表外码与 null 明说未知", () => {
    expect(describeWeatherCode(0)).toEqual({ label: "晴", kind: "sun" });
    expect(describeWeatherCode(63).kind).toBe("rain");
    expect(describeWeatherCode(75).kind).toBe("snow");
    expect(describeWeatherCode(45).kind).toBe("fog");
    expect(describeWeatherCode(96).kind).toBe("storm");
    expect(describeWeatherCode(null).label).toBe("天气状况未知");
    expect(describeWeatherCode(4999).label).toContain("未知天气码");
    expect(describeWeatherCode(Number.NaN).label).toBe("天气状况未知");
  });

  it("windLabel：缺风速就不给风向文案，绝不退化成「微风」", () => {
    expect(windLabel(315, 12.4)).toBe("西北风 12 km/h");
    expect(windLabel(0, 5)).toBe("北风 5 km/h");
    expect(windLabel(null, 5)).toBe("风力 5 km/h");
    expect(windLabel(90, null)).toBeNull();
    expect(windLabel(null, null)).toBeNull();
  });

  it("aqiLevel：未知归 null，分档按 EPA 边界", () => {
    expect(aqiLevel(null)).toBeNull();
    expect(aqiLevel(28)?.label).toBe("优");
    expect(aqiLevel(50)?.label).toBe("优");
    expect(aqiLevel(51)?.tone).toBe("moderate");
    expect(aqiLevel(180)?.tone).toBe("poor");
  });

  it("dayLabel 按下标给今天/明天/后天，再往后写日期（跨时区不算错）", () => {
    expect(dayLabel("2026-10-23", 0)).toBe("今天");
    expect(dayLabel("2026-10-24", 1)).toBe("明天");
    expect(dayLabel("2026-10-25", 2)).toBe("后天");
    expect(dayLabel("2026-10-26", 3)).toBe("2026-10-26");
    expect(dayLabel("", 7)).toBe("第 8 天");
  });

  it("resolveCityKey：脏城市标要报 unknown，而不是静默换城市", () => {
    expect(resolveCityKey("tokyo")).toEqual({ key: "tokyo", requested: "tokyo", unknown: false });
    expect(resolveCityKey("  SF ")).toEqual({ key: "sf", requested: "sf", unknown: false });
    expect(resolveCityKey(undefined)).toEqual({ key: "shanghai", requested: "", unknown: false });
    const bad = resolveCityKey("nanjing");
    expect(bad.unknown).toBe(true);
    expect(bad.requested).toBe("nanjing");
    expect(bad.key).toBe("shanghai");
    // 原型链上的键不是城市：命中 constructor 会让卡片拿到 undefined 坐标
    for (const poison of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(resolveCityKey(poison).unknown, poison).toBe(true);
      expect(resolveCityKey(poison).key).toBe("shanghai");
    }
    for (const dirty of [null, 42, {}, [], Number.NaN]) {
      expect(resolveCityKey(dirty).unknown).toBe(false);
      expect(resolveCityKey(dirty).key).toBe("shanghai");
    }
  });

  it("normalizeUnit 只认华氏，其余一律摄氏", () => {
    expect(normalizeUnit("fahrenheit")).toBe("fahrenheit");
    expect(normalizeUnit("F")).toBe("fahrenheit");
    for (const dirty of [undefined, null, "", "kelvin", 42, "celsius"]) {
      expect(normalizeUnit(dirty)).toBe("celsius");
    }
  });

  it("出网路径只由城市表决定：URL 里没有可被前端控制的域名或经纬度", () => {
    const city = WEATHER_CITIES.shanghai;
    const path = forecastUrlPath(city, 3);
    expect(path.startsWith("/v1/forecast?")).toBe(true);
    expect(path).toContain("latitude=31.2304");
    expect(path).toContain("forecast_days=3");
    expect(path).not.toMatch(/https?:\/\//);
    expect(airQualityUrlPath(city)).toContain("current=us_aqi");
    // 脏 key 也不能把坐标变成 NaN 打给上游
    for (const c of Object.values(WEATHER_CITIES)) {
      expect(forecastUrlPath(c, 3)).not.toContain("NaN");
    }
  });

  it("ageLabel / observedAtLabel：没有时刻就说未知，不给「刚刚」冒充新鲜", () => {
    expect(ageLabel(0, 1_700_000_000_000)).toBe("时间未知");
    expect(ageLabel(1_700_000_000_000 - 90_000, 1_700_000_000_000)).toBe("1 分钟前");
    expect(ageLabel(1_700_000_000_000 - 2 * 3_600_000, 1_700_000_000_000)).toBe("2 小时前");
    expect(observedAtLabel(null)).toBe("观测时间未知");
    expect(observedAtLabel("2026-10-23T20:15")).toBe("10-23 20:15");
  });
});

describe("天气小卡：改真取数，静态表和「演示数据」一起下线", () => {
  const code = codeOnly(readFileSync(overlayFile("src/components/modular/modules/weather-widget.tsx"), "utf8"));
  const route = codeOnly(readFileSync(overlayFile("src/app/api/weather/route.ts"), "utf8"));
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");

  it("组件打 /api/weather，脏城市标在卡上说明而不是换个城市算了", () => {
    expect(code).toContain("`/api/weather?city=");
    expect(code).toContain("resolveCityKey");
    expect(code).toContain("不在内置城市表中");
    expect(code).toContain("AbortController");
    expect(code).toContain("reqId.current");
  });

  it("回归守卫：源码里那张按城市写死的温度表必须彻底消失", () => {
    expect(code).not.toContain("CITY_DATA");
    expect(code).not.toContain("演示数据");
    // 21/24/27 这类常年温度是编的源头，代码里不该再出现同名字面量
    for (const fake of ["tempC: 21", "tempC: 24", "tempC: 27", "condition: '晴"]) {
      expect(code).not.toContain(fake);
    }
  });

  it("读数缺失给「—」，不许用 0 顶替（0°C 是真实温度）", () => {
    expect(code).toContain("formatTemp");
    expect(code).not.toMatch(/\?\?\s*0\b/);
    expect(code).toContain("'—'");
    expect(code).toContain("AQI 未知");
  });

  it("加载 / 失败 / 就绪三态分开，失败有原因文案和重试", () => {
    expect(code).toContain("正在获取");
    expect(code).toContain("REASON_HINT");
    for (const reason of ["timeout", "network", "upstream_status", "bad_response", "rate_limited", "blocked", "request_failed"]) {
      expect(code, reason).toMatch(new RegExp(`\\b${reason}:`));
    }
    expect(code).toContain("重试");
  });

  it("陈旧观测要挂「旧观测」标记，单位切换标「临时」", () => {
    expect(code).toContain("payload?.stale");
    expect(code).toContain("旧观测");
    expect(code).toContain("临时");
    expect(code).toContain("unitOverride");
    expect(code).toContain("数据源 Open-Meteo");
  });

  it("路由只认固定域名 + 表内坐标，并且有超时、缓存与限流", () => {
    expect(route).toContain("https://api.open-meteo.com");
    expect(route).toContain("https://air-quality-api.open-meteo.com");
    expect(route).toContain("guardedFetch");
    expect(route).toContain("allowPrivateNetworks: false");
    expect(route).toContain("readTextLimited");
    expect(route).toContain("export const runtime = 'nodejs'");
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).toContain("TTL_MS");
    expect(route).toContain("rateLimited");
    expect(route).toContain("STALE_MAX_MS");
    // 城市不在表内就直接拒绝，避免变成任意坐标的开放代理
    expect(route).toContain("unknown_city");
    expect(route).toMatch(/WEATHER_CITIES\[resolved\.key\]/);
  });

  it("脏 JSON / 脏数值一律归 null，空气指数失败不拖累气温", () => {
    expect(route).toContain("function numOrNull");
    expect(route).toContain("Number.isFinite");
    expect(route).toContain("bad_response");
    expect(route).toContain("aqiNote");
    // 空气指数单独失败时只记 aqiNote，不抛错、不把整张卡判死
    expect(route).toMatch(/if \(!air\.ok\)|else \{[\s\S]{0,120}payload\.aqiNote/);
    expect(route).toMatch(/aqiNote = [`'][\s\S]{0,80}空气指数/);
  });

  it("注册表把 city / unit 变成真配置，描述不再承诺「端侧环境」", () => {
    const entry = /'weather-clock': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    expect(entry).toMatch(/key:\s*'city'/);
    expect(entry).toMatch(/key:\s*'unit'/);
    expect(entry).toContain("/api/weather");
    expect(entry).not.toContain("端侧环境温度");
  });
});

describe("快捷搜索：默认引擎可达，脏配置要说明", () => {
  const code = codeOnly(readFileSync(overlayFile("src/components/modular/modules/quick-search-widget.tsx"), "utf8"));
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");

  it("配了不存在的引擎时写出来，不静默走 Google", () => {
    expect(code).toContain("unknownEngine");
    expect(code).toContain("不存在，已选中 Google");
    // constructor 这类原型链键不能当成合法引擎（Record 查找会命中）
    expect(code).toContain("hasOwnProperty");
  });

  it("注册表暴露 defaultEngine，五个引擎都在候选里（含 MDN）", () => {
    const entry = /'quick-search': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    expect(entry).toMatch(/key:\s*'defaultEngine'/);
    for (const engine of ["google", "github", "npm", "bing", "mdn"]) {
      expect(entry).toContain(`'${engine}'`);
    }
    expect(entry).toContain("临时切换");
  });
});

describe("热度榜小卡：量纲要对得上，缺测不许编数", () => {
  const code = codeOnly(readFileSync(overlayFile("src/components/modular/modules/trending-widget.tsx"), "utf8"));
  const registry = readFileSync(overlayFile("src/lib/modular/registry.ts"), "utf8");
  const core = readFileSync(repoFile("packages/core/src/modular.ts"), "utf8");

  it("热度指数是个位数对数量纲，访问量另有单位，都不许除以 1000 取整", () => {
    expect(heatLabel(null)).toBe("—");
    expect(heatLabel(0)).toBe("0.0");
    expect(heatLabel(12.44)).toBe("12.4");
    expect(visitLabel(null)).toBe("—");
    expect(visitLabel(0)).toBe("0");
    expect(visitLabel(999)).toBe("999");
    expect(visitLabel(12_400)).toBe("12.4k");
  });

  it("两个指标都缺测给「—」，测到 0 说「暂无互动」，绝不补一个看起来像数据的数", () => {
    expect(rowMetric(null, null)).toEqual({ kind: "none", text: "—" });
    expect(rowMetric(0, 0)).toEqual({ kind: "none", text: "暂无互动" });
    // 回归守卫：旧写法是 s.trendScore ?? s.visitCount ?? 100
    expect(code).not.toMatch(/\?\?\s*100\b/);
    expect(code).not.toMatch(/Math\.round\(\s*[\w.]+\.score\s*\/\s*1000\s*\)/);
  });

  it("优先热度指数（排序依据），其次访问量，图标与量纲一致", () => {
    expect(rowMetric(4.2, 100)).toEqual({ kind: "heat", text: "热度 4.2" });
    expect(rowMetric(0, 320)).toEqual({ kind: "visits", text: "访问 320" });
    expect(rowMetric(null, 12_000)).toEqual({ kind: "visits", text: "访问 12.0k" });
    // 站内热度不是 GitHub 星标：星形图标不许回来
    expect(code).not.toMatch(/\bStar\b/);
    expect(code).toContain("Eye");
  });

  it("取数失败说原因并给重试；空榜与失败是两回事", () => {
    expect(code).toContain("describeDegrade");
    expect(code).toContain("fetchTrending(5,");
    expect(code).toContain("重试");
    expect(code).toContain("榜上还没有可排序的收录");
    expect(code).toContain("演示数据");
    expect(code).toContain("setDemo(true)");
    // 兜底清单只允许出现在 DEMO_SITES 一处
    expect(code.match(/Next\.js 15/g)?.length).toBe(1);
  });

  it("底注不再谎称「全网开发者实时协同偏好」", () => {
    expect(code).not.toContain("全网开发者实时协同偏好");
    expect(code).toContain("站内热度指数排序");
    expect(code).toContain("站内互动数据尚未积累");
  });

  it("卡片目录不再承诺 GitHub Star 增长榜 / 实时流（core 与 overlay 同步）", () => {    const entry = /'trending-radar': \{([\s\S]*?)\n {2}\}/.exec(registry)?.[0] ?? "";
    const coreEntry = /'trending-radar': \{([\s\S]*?)\n {2}\}/.exec(core)?.[0] ?? "";
    expect(entry).toContain("站内热度榜");
    expect(entry).toContain("log1p");
    // 描述里可以否认，但绝不能再把旧那句承诺当成卡片卖点
    expect(entry).not.toContain("GitHub Star 增长最快");
    expect(entry).not.toMatch(/badge:\s*'实时流'/);
    expect(coreEntry).toContain("站内热度榜");
    expect(coreEntry).toContain("log1p");
    expect(coreEntry).not.toContain("GitHub Star 增长最快");
  });
});

describe("分类推荐：字符串重合度不许冒充 AI 置信度", () => {
  const ui = codeOnly(readFileSync(overlayFile("src/components/navigation-content.tsx"), "utf8"));
  const overlayLib = codeOnly(readFileSync(overlayFile("src/lib/modular/diy-presets.ts"), "utf8"));
  const core = codeOnly(readFileSync(repoFile("packages/core/src/diy-layout/suggestion.ts"), "utf8"));

  const categories = [
    { id: "cat-dev", title: "前端与开发框架" },
    { id: "cat-ai", title: "AI 智能与大模型" },
  ];

  it("得分封顶 0.85，并如实声明来源是 keyword 启发式", () => {
    const hit = suggestCategoryForSite({ title: "前端与开发框架官方文档", description: "" }, categories);
    expect(hit).not.toBeNull();
    expect(hit?.categoryId).toBe("cat-dev");
    expect(hit?.confidence).toBeLessThanOrEqual(0.85);
    expect(hit?.method).toBe("keyword");
    // 回归守卫：曾经用 Math.min(0.99, ...) 把重合度抬成「99% 匹配」
    expect(overlayLib).not.toMatch(/Math\.min\(0\.99/);
    expect(core).not.toMatch(/Math\.min\(0\.99/);
    expect(overlayLib).toContain("KEYWORD_SCORE_CEILING");
    expect(core).toContain("KEYWORD_SCORE_CEILING");
  });

  it("界面写「按关键词推荐 / 本地字符串匹配，不是 AI 判断」，并给出命中理由", () => {
    expect(ui).toContain("按关键词推荐分类");
    expect(ui).toContain("本地字符串匹配，不是 AI 判断");
    expect(ui).toContain("categorySuggestion.matchReason");
    expect(ui).toContain("重合度");
    expect(ui).not.toContain("AI 推荐分类");
    // 闪光图标是这个含义的视觉承诺，换成标签图标
    expect(ui).not.toMatch(/Sparkles/);
  });
});
