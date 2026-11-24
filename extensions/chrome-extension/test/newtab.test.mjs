/**
 * 新标签页扩展单测（P3-12 / U-23）。
 * 跑法：node --test extensions/chrome-extension/test/newtab.test.mjs
 * 只用 node:test + node:assert，不引 vitest；不涉及跨模块 vi.mock。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// newtab.js 是 MV3 classic 脚本（不能用 ESM export），这里用 vm 沙箱执行它，
// 只取文件末尾 module.exports 导出的纯函数；document/chrome 不存在，浏览器初始化自动跳过。
const moduleObj = { exports: {} };
const sandbox = { module: moduleObj, exports: moduleObj.exports, console, URL, Date };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(EXT_DIR, "newtab.js"), "utf8"), sandbox);
const newtab = moduleObj.exports;

const read = (name) => readFileSync(join(EXT_DIR, name), "utf8");

// --- manifest：接管 + 生产域 -------------------------------------------------
test("manifest：chrome_url_overrides 接管新标签页到 newtab.html", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.chrome_url_overrides.newtab, "newtab.html");
});

test("manifest：host_permissions 指向真实生产域，不含示例域", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.host_permissions.includes("https://www.shanyanghu.com/*"));
  assert.ok(manifest.host_permissions.includes("http://127.0.0.1/*"));
  assert.ok(manifest.host_permissions.includes("http://localhost/*"));
  // CodeQL #141：否定断言（清单里不得出现示例域），用转义点的正则写，与
  // includes("example.com") 同义但点不再通配。
  assert.equal(/example\.com/.test(JSON.stringify(manifest)), false);
  assert.equal(manifest.version, "1.2.0");
});

test("manifest 引用的 newtab.html / newtab.js 均存在", () => {
  assert.doesNotThrow(() => read("newtab.html"));
  assert.doesNotThrow(() => read("newtab.js"));
  assert.doesNotThrow(() => read("newtab.css"));
});

// --- newtab.html：结构与 MV3 CSP --------------------------------------------
test("newtab.html：含搜索框、今日一件事、常用站、状态徽标；无内联脚本", () => {
  const html = read("newtab.html");
  for (const id of ["search-form", "search-input", "focus-card", "focus-form", "focus-input", "quick-grid", "status-badge", "cache-note"]) {
    assert.ok(html.includes(`id="${id}"`), `缺少 #${id}`);
  }
  assert.ok(html.includes('<script src="newtab.js"></script>'));
  assert.equal(html.includes("<script>"), false, "MV3 CSP 禁内联脚本");
  assert.equal(html.includes("http://"), false, "新标签页不含 http 明文外链");
});

// --- 纯函数：日期与专注 ------------------------------------------------------
test("todayKey / formatTodayLine：本地日期，格式正确", () => {
  const now = new Date(2026, 10, 18, 9, 30); // 本地时区 2026-11-18 周三
  assert.equal(newtab.todayKey(now), "2026-11-18");
  assert.equal(newtab.formatTodayLine(now), "11月18日周三");
});

test("专注：超长截断 80 字，空内容建不出，坏日期建不出", () => {
  assert.equal(newtab.cleanFocusText("  a  b  "), "a b");
  assert.equal(newtab.cleanFocusText("x".repeat(100)).length, 80);
  assert.equal(newtab.createDailyFocus("   ", "2026-11-18", 1), null);
  assert.equal(newtab.createDailyFocus("做一件事", "2026/11/18", 1), null);
  // 跨 vm realm 的对象原型不同，deepStrictEqual 会误判，改比 JSON
  assert.equal(
    JSON.stringify(newtab.createDailyFocus("做一件事", "2026-11-18", 1700000000000)),
    JSON.stringify({ date: "2026-11-18", text: "做一件事", done: false, updatedAt: 1700000000000 }),
  );
});

test("专注：坏存储一律 null", () => {
  assert.equal(newtab.parseDailyFocus("not json"), null);
  assert.equal(newtab.parseDailyFocus(JSON.stringify({ date: "2026-11-18" })), null);
  assert.equal(newtab.parseDailyFocus(JSON.stringify({ date: "2026-11-18", text: "  ", done: false, updatedAt: 1 })), null);
  assert.equal(newtab.parseDailyFocus(JSON.stringify({ date: "2026-11-18", text: "x", done: "no", updatedAt: 1 })), null);
});
test("专注：合法存储解析成功；昨天的不带进今天", () => {
  const stored = newtab.parseDailyFocus(
    JSON.stringify({ date: "2026-11-17", text: "昨天的事", done: false, updatedAt: 1 }),
  );
  assert.ok(stored);
  assert.equal(newtab.focusForToday(stored, "2026-11-18"), null);
  assert.deepEqual(newtab.focusForToday(stored, "2026-11-17"), stored);
});

// --- 纯函数：常用站抽取与缓存 ----------------------------------------------
const NAV_SAMPLE = {
  navigationItems: [
    {
      title: "AI 工具",
      subCategories: [
        { title: "对话助手", items: [
          { title: "ChatGPT", href: "https://chatgpt.com", enabled: true },
          { title: "坏协议", href: "javascript:alert(1)", enabled: true },
          { title: "已下线", href: "https://gone.example", enabled: false },
        ] },
        { title: "写作", items: [{ title: "Notion AI", href: "https://notion.so", enabled: true }] },
      ],
    },
    {
      title: "开发",
      subCategories: [
        { title: "代码托管", items: [{ title: "GitHub", href: "https://github.com", enabled: true }] },
      ],
    },
  ],
};

test("extractQuickSites：轮询取满 8 格、跳过坏协议与下线站", () => {
  const sites = newtab.extractQuickSites(NAV_SAMPLE, 8);
  // 跨 vm realm 的数组原型不同，deepStrictEqual 会误判，改比 join 后的字符串
  assert.equal(sites.map((s) => s.title).join("|"), "ChatGPT|Notion AI|GitHub");
  assert.ok(sites.every((s) => s.url.startsWith("https://")));
  assert.equal(newtab.extractQuickSites(null).length, 0);
  assert.equal(newtab.extractQuickSites({ navigationItems: "坏" }).length, 0);
});

test("extractQuickSites：limit 生效", () => {
  assert.equal(newtab.extractQuickSites(NAV_SAMPLE, 2).length, 2);
});

test("parseNavigationCache / formatCacheAge：坏缓存 null，年龄文案正确", () => {
  assert.equal(newtab.parseNavigationCache("坏 json"), null);
  assert.equal(newtab.parseNavigationCache(JSON.stringify({ savedAt: 1, sites: [] })), null);
  const good = newtab.parseNavigationCache(JSON.stringify({
    savedAt: 1000,
    sites: [{ title: "A", url: "https://a.example", category: "X" }, { title: "", url: "https://b.example" }],
  }));
  assert.equal(good.sites.length, 1);
  assert.equal(newtab.formatCacheAge(1000, 1000 + 30 * 1000), "刚刚");
  assert.equal(newtab.formatCacheAge(1000, 1000 + 5 * 60 * 1000), "5 分钟前");
  assert.equal(newtab.formatCacheAge(1000, 1000 + 3 * 3600 * 1000), "3 小时前");
  assert.equal(newtab.formatCacheAge(1000, 1000 + 2 * 86400 * 1000), "2 天前");
});

// --- 纯函数：URL 安全 --------------------------------------------------------
test("safeHttpUrl：只放行 http/https", () => {
  assert.equal(newtab.safeHttpUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(newtab.safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(newtab.safeHttpUrl("chrome://extensions"), null);
  assert.equal(newtab.safeHttpUrl(""), null);
});

test("buildSearchUrl：有词进 /search?q=，空词回首页", () => {
  assert.equal(
    newtab.buildSearchUrl("https://www.shanyanghu.com", "写代码 AI"),
    "https://www.shanyanghu.com/search?q=%E5%86%99%E4%BB%A3%E7%A0%81%20AI",
  );
  assert.equal(newtab.buildSearchUrl("https://www.shanyanghu.com/", "  "), "https://www.shanyanghu.com");
  assert.equal(newtab.buildSearchUrl(undefined, "x"), "https://www.shanyanghu.com/search?q=x");
});

// --- 共享白名单：background / popup 已接生产域 -------------------------------
test("background.js / popup.js：白名单含生产域，不含示例域", () => {
  for (const name of ["background.js", "popup.js"]) {
    const src = read(name);
    assert.ok(src.includes('"www.shanyanghu.com"'), `${name} 白名单缺生产域`);
    // CodeQL #142：否定断言（源码里不得残留示例域），用转义点的正则写。
    assert.equal(/navhub\.example\.com/.test(src), false, `${name} 仍含示例域`);
  }
});

test("popup.js / background.js：默认站点地址为生产域（已存配置优先，不影响本地开发）", () => {
  assert.ok(read("popup.js").includes('DEFAULT_WEB_BASE = "https://www.shanyanghu.com"'));
  assert.ok(read("background.js").includes('DEFAULT_WEB_URL = "https://www.shanyanghu.com"'));
});
