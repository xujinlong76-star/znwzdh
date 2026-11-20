// 首页 + 搜索 + 分类/站点 实测探针（跑在电脑上，目标 http://localhost:3002/）
// 用法：node probe-home.mjs  （需 playwright + chromium 已装）
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:3002";
const out = [];
const log = (k, v) => { out.push([k, v]); console.log(k + " = " + JSON.stringify(v)); };

const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"] });
try {
  // ---------- 1. 首页 1440x900 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const h1s = [...document.querySelectorAll("h1")].map(h => h.textContent.trim().slice(0, 40));
      const input = document.querySelector('input[type="search"], input[placeholder*="搜索"], input[placeholder*="搜"]');
      const ib = input ? input.getBoundingClientRect().toJSON() : null;
      const vw = window.innerWidth;
      const kbd = [...document.querySelectorAll("kbd")].map(k => k.textContent.trim());
      const today = [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && e.textContent.trim() === "今日").map(e => {
        const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        return { visible: b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none", x: Math.round(b.x), w: Math.round(b.width) };
      });
      // 首屏卡片露出：数 [data-site-card] 或 a[href^="/site/"] 在首屏可见的数量
      const cards = [...document.querySelectorAll('[data-testid*="site-card"], a[href^="/site/"]')];
      const vis = cards.filter(c => { const b = c.getBoundingClientRect(); return b.top < 900 && b.bottom > 0 && b.width > 0; });
      // 坞
      const dock = document.querySelector('[data-testid*="dock"], [class*="quick-dock"], [class*="home-quick"]');
      const dockH = dock ? Math.round(dock.getBoundingClientRect().height) : null;
      // 猫挂件状态
      const cat = document.querySelector('[data-testid*="xiaomaomao"], [class*="xiaomaomao"], [id*="xiaomaomao"]');
      const catInfo = cat ? { cls: (cat.className || "").toString().slice(0, 120), rect: (() => { const b = cat.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })() } : null;
      // 顶栏横向溢出
      const docScrollW = document.documentElement.scrollWidth;
      return { h1s, h1count: h1s.length, inputBox: ib, vw, inputCenterOffset: ib ? Math.round((ib.x + ib.width / 2) - vw / 2) : null, kbd, today, cardTotal: cards.length, cardVisible: vis.length, dockH, catInfo, docScrollW, hasHScroll: docScrollW > vw };
    });
    log("home1440", r);
    await ctx.close();
  }

  // ---------- 2. 首页 1280x800 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const input = document.querySelector('input[type="search"], input[placeholder*="搜索"], input[placeholder*="搜"]');
      const ib = input ? input.getBoundingClientRect().toJSON() : null;
      const today = [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && e.textContent.trim() === "今日").map(e => {
        const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        return { visible: b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none", x: Math.round(b.x), w: Math.round(b.width) };
      });
      const kbdVisible = [...document.querySelectorAll("kbd")].map(k => { const b = k.getBoundingClientRect(); return { t: k.textContent.trim(), visible: b.width > 0 && b.height > 0 }; });
      const docScrollW = document.documentElement.scrollWidth;
      // 顶栏工具组是否超宽：找 header 内最右元素
      const header = document.querySelector("header");
      const hBox = header ? header.getBoundingClientRect().toJSON() : null;
      return { inputBox: ib, inputW: ib ? Math.round(ib.width) : null, inputCenterOffset: ib ? Math.round((ib.x + ib.width / 2) - 640) : null, today, kbdVisible, docScrollW, hasHScroll: docScrollW > 1280, headerH: hBox ? Math.round(hBox.height) : null };
    });
    log("home1280", r);
    await ctx.close();
  }

  // ---------- 3. 首页 1366x768 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const input = document.querySelector('input[type="search"], input[placeholder*="搜索"], input[placeholder*="搜"]');
      const ib = input ? input.getBoundingClientRect().toJSON() : null;
      return { inputW: ib ? Math.round(ib.width) : null, inputCenterOffset: ib ? Math.round((ib.x + ib.width / 2) - 683) : null, docScrollW: document.documentElement.scrollWidth };
    });
    log("home1366", r);
    await ctx.close();
  }

  // ---------- 4. 移动端 360x800 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const h1b = h1 ? h1.getBoundingClientRect().toJSON() : null;
      const h1Visible = h1 ? (() => { const b = h1.getBoundingClientRect(); const cs = getComputedStyle(h1); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; })() : false;
      const docScrollW = document.documentElement.scrollWidth;
      // 工具栏/胶囊条横向溢出
      const header = document.querySelector("header");
      const headerScrollW = header ? header.scrollWidth : null;
      const headerClientW = header ? header.clientWidth : null;
      return { h1Text: h1 ? h1.textContent.trim().slice(0, 40) : null, h1Visible, h1Box: h1b, docScrollW, hasHScroll: docScrollW > 360, headerScrollW, headerClientW, headerOverflow: headerScrollW !== null ? headerScrollW > headerClientW : null };
    });
    log("mobile360", r);
    await ctx.close();
  }

  // ---------- 5. 搜索：站内搜索 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const input = page.locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="搜"]').first();
    await input.fill("考研");
    await input.press("Enter");
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => {
      const url = location.href;
      const cards = [...document.querySelectorAll('a[href^="/site/"]')];
      const vis = cards.filter(c => { const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
      const empty = document.body.innerText.includes("没有找到") || document.body.innerText.includes("未找到") || document.body.innerText.includes("空");
      return { url, resultCards: vis.length, emptyHint: empty, title: document.title };
    });
    log("search-nei", r);
    await ctx.close();
  }

  // ---------- 6. 搜索页空态 chips ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/search", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const text = document.body.innerText;
      // 找 chips：常见为 button 或 a，含热门词
      const chips = [...document.querySelectorAll("button, a")].filter(e => e.children.length <= 2 && e.textContent.trim().length > 0 && e.textContent.trim().length <= 12).map(e => e.textContent.trim()).slice(0, 30);
      return { url: location.href, hasChips: chips.length > 0, chipsSample: chips.slice(0, 12), bodyLen: text.length };
    });
    log("search-empty", r);
    await ctx.close();
  }

  // ---------- 7. 分类页 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/category/ai-tools", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('a[href^="/site/"]')];
      const vis = cards.filter(c => { const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
      const h1 = document.querySelector("h1");
      return { url: location.href, h1: h1 ? h1.textContent.trim().slice(0, 50) : null, cards: vis.length, title: document.title };
    });
    log("category-ai", r);
    await ctx.close();
  }

  // ---------- 8. U-261：hover-reveal 操作簇触屏目标尺寸 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      // hover-reveal：卡片内默认 opacity-0 的操作按钮（星标、速览）
      const els = [...document.querySelectorAll("button")].filter(b => {
        const cs = getComputedStyle(b);
        const cls = (b.className || "").toString();
        return cls.includes("opacity-0") || cs.opacity === "0";
      });
      const sizes = els.slice(0, 20).map(b => { const r = b.getBoundingClientRect(); return { label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height), opacity: getComputedStyle(b).opacity }; });
      const small = sizes.filter(s => (s.w > 0 && s.w < 24) || (s.h > 0 && s.h < 24));
      return { hoverRevealButtons: els.length, sample: sizes.slice(0, 10), smallCount: small.length, small };
    });
    log("u261-touch", r);
    await ctx.close();
  }

  // ---------- 9. 站点详情 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/category/ai-tools", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const first = page.locator('a[href^="/site/"]').first();
    const href = await first.getAttribute("href");
    if (href) {
      await page.goto(BASE + href, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => ({ url: location.href, h1: (document.querySelector("h1") || {}).textContent?.trim()?.slice(0, 60) || null, title: document.title, bodyLen: document.body.innerText.length }));
      log("site-detail", r);
    } else log("site-detail", { error: "no site link found" });
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log("PROBE-DONE");
