/**
 * 山羊胡新标签页（U-23 / P3-12）：轻量首页 = 搜索框 + 今日一件事 + 常用站。
 *
 * 工程范式（抄组件世界 2026-11-16 文档）：先画“上次缓存的样子”秒开，
 * 后台再拉最新数据无缝替换；离线停在上次缓存的样子，绝不白屏。
 *
 * 安全约定（与 popup.js / background.js 同款）：
 *  - 渲染只用 createElement + textContent，不拼 innerHTML；
 *  - 外链 href 只放行 http/https，其他协议不渲染为链接；
 *  - 不发任何凭据：常用站拉取走公开的 /api/home/navigation，不带 token。
 *  - 今日一件事只存 chrome.storage.local（本机），不进云端。
 *
 * 纯函数集中在文件上半部分，可在 Node 下单测（见 test/newtab.test.mjs）；
 * 浏览器侧初始化在文件下半部分，由 `typeof document` 守卫。
 */

const DEFAULT_WEB_BASE = "https://www.shanyanghu.com";
/** 常用站缓存键：{ savedAt: number, sites: Array<{title, url, category}> } */
const CACHE_KEY = "navhub.newtab.cache.v1";
/** 今日一件事存储键：{ date, text, done, updatedAt }，语义与站内 daily-focus.ts 一致 */
const FOCUS_KEY = "navhub.newtab.focus.v1";
const MAX_QUICK_SITES = 8;
const FOCUS_MAX_LENGTH = 80;
const FETCH_TIMEOUT_MS = 5000;
/** 无缓存时的兜底：只放站内入口，不编造站外数据；联网拉到缓存后即被替换 */
const BUILTIN_QUICK_LINKS = [
  { title: "首页", url: "/?from=newtab", category: "山羊胡" },
  { title: "搜索", url: "/search", category: "山羊胡" },
  { title: "插件市场", url: "/marketplace", category: "山羊胡" },
  { title: "考试日历", url: "/exam", category: "山羊胡" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 本地日期键（YYYY-MM-DD），用本地时区——“今天”是用户的日子 */
function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** “11月18日周三”式日期行 */
function formatTodayLine(now = new Date()) {
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
  return `${now.getMonth() + 1}月${now.getDate()}日${week}`;
}

/** 只放行 http/https 外链，其他一律返回 null（调用方不渲染为链接） */
function safeHttpUrl(raw) {
  if (!String(raw || "").trim()) return null;
  try {
    const u = new URL(String(raw), "http://invalid.local");
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

/** 站内搜索地址：空查询回首页 */
function buildSearchUrl(webBase, q) {
  const base = String(webBase || DEFAULT_WEB_BASE).replace(/\/$/, "");
  const query = String(q || "").trim();
  if (!query) return base;
  return `${base}/search?q=${encodeURIComponent(query)}`;
}

/** 清洗一条专注：去首尾空白、连续空白折成一个空格、超长截断。空串 = 没内容 */
function cleanFocusText(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, FOCUS_MAX_LENGTH);
}

/** 新建一条专注：空内容或坏日期返回 null（调用方据此不写存储） */
function createDailyFocus(text, date, nowMs) {
  const cleaned = cleanFocusText(text);
  if (!cleaned || !DATE_RE.test(date)) return null;
  return { date, text: cleaned, done: false, updatedAt: nowMs };
}

/** 解析存储里的专注：坏 JSON、缺字段、空内容、坏类型一律返回 null，不抛 */
function parseDailyFocus(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { date, text, done, updatedAt } = parsed;
  if (typeof date !== "string" || !DATE_RE.test(date)) return null;
  if (typeof text !== "string") return null;
  const cleaned = cleanFocusText(text);
  if (!cleaned) return null;
  if (typeof done !== "boolean") return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  return { date, text: cleaned, done, updatedAt };
}

/** 当天有效的专注：跨天即失效（昨天没做完的不带进今天） */
function focusForToday(stored, today) {
  if (!stored || stored.date !== today) return null;
  return stored;
}

/**
 * 从 navigation.json（/api/home/navigation 的返回体）抽常用站。
 * 形状：{ navigationItems: [{ subCategories: [{ title, items: [{title, href, enabled}] }] }] }
 * 每轮每个二级分类最多取 1 条，轮询取满 limit——8 个格子不被单一分类霸占。
 * 只收 enabled 且 http(s) 的 href；坏结构返回 []，不抛。
 */
function extractQuickSites(navData, limit = MAX_QUICK_SITES) {
  const categories = navData && Array.isArray(navData.navigationItems) ? navData.navigationItems : [];
  const queues = [];
  for (const cat of categories) {
    if (!cat || !Array.isArray(cat.subCategories)) continue;
    for (const sub of cat.subCategories) {
      if (!sub || !Array.isArray(sub.items)) continue;
      const sites = [];
      for (const item of sub.items) {
        if (!item || item.enabled === false) continue;
        const href = safeHttpUrl(item.href);
        const title = String(item.title || "").trim();
        if (!href || !title) continue;
        sites.push({ title, url: href, category: String(sub.title || cat.title || "") });
      }
      if (sites.length > 0) queues.push(sites);
    }
  }
  const out = [];
  let round = 0;
  while (out.length < limit && queues.some((q) => q.length > round)) {
    for (const q of queues) {
      if (out.length >= limit) break;
      if (q.length > round) out.push(q[round]);
    }
    round += 1;
  }
  return out;
}

/** 校验缓存快照形状：坏结构返回 null（调用方按无缓存处理） */
function parseNavigationCache(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) return null;
  if (!Array.isArray(parsed.sites)) return null;
  const sites = parsed.sites
    .filter((s) => s && typeof s.title === "string" && s.title && safeHttpUrl(s.url))
    .slice(0, MAX_QUICK_SITES)
    .map((s) => ({ title: s.title, url: safeHttpUrl(s.url), category: String(s.category || "") }));
  if (sites.length === 0) return null;
  return { savedAt: parsed.savedAt, sites };
}

/** 缓存年龄文案：刚刚 / x 分钟前 / x 小时前 / x 天前 */
function formatCacheAge(savedAt, nowMs) {
  const diff = Math.max(0, nowMs - savedAt);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

// ---------------------------------------------------------------------------
// 浏览器侧初始化（Node 单测不执行：document / chrome 不存在时直接跳过）
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && typeof chrome !== "undefined" && chrome.storage) {
  const $ = (id) => document.getElementById(id);

  async function getWebBase() {
    try {
      const store = await chrome.storage.local.get(["webUrl"]);
      return String(store.webUrl || DEFAULT_WEB_BASE).replace(/\/$/, "");
    } catch {
      return DEFAULT_WEB_BASE;
    }
  }

  async function readStore(key) {
    try {
      const store = await chrome.storage.local.get([key]);
      return store[key];
    } catch {
      return undefined;
    }
  }

  async function writeStore(items) {
    try {
      await chrome.storage.local.set(items);
    } catch (err) {
      console.warn("[山羊胡新标签页] 存储失败:", err);
    }
  }

  function renderQuickSites(sites, webBase) {
    const grid = $("quick-grid");
    const empty = $("quick-empty");
    grid.replaceChildren();
    if (!sites || sites.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    for (const site of sites) {
      const href = safeHttpUrl(site.url);
      if (!href) continue;
      const link = document.createElement("a");
      link.className = "quick-link";
      link.href = href;
      link.rel = "noopener noreferrer";
      const title = document.createElement("div");
      title.className = "quick-title";
      title.textContent = site.title;
      const cat = document.createElement("div");
      cat.className = "quick-cat";
      cat.textContent = site.category || "山羊胡";
      link.appendChild(title);
      link.appendChild(cat);
      grid.appendChild(link);
    }
  }

  function renderFocus(focus) {
    const textEl = $("focus-text");
    const stateEl = $("focus-state");
    const toggleBtn = $("focus-toggle");
    const clearBtn = $("focus-clear");
    const input = $("focus-input");
    if (!focus) {
      textEl.textContent = "";
      textEl.classList.remove("done");
      stateEl.textContent = "今天还没定";
      stateEl.classList.remove("done");
      toggleBtn.disabled = true;
      clearBtn.disabled = true;
      return;
    }
    textEl.textContent = focus.text;
    textEl.classList.toggle("done", focus.done);
    stateEl.textContent = focus.done ? "已完成 ✓" : "进行中";
    stateEl.classList.toggle("done", focus.done);
    toggleBtn.disabled = false;
    toggleBtn.textContent = focus.done ? "↩ 恢复为未完成" : "✓ 完成了";
    clearBtn.disabled = false;
    if (input) input.value = "";
  }

  async function refreshCache(webBase) {
    try {
      const res = await fetch(`${webBase}/api/home/navigation`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return false;
      const data = await res.json();
      const sites = extractQuickSites(data, MAX_QUICK_SITES);
      if (sites.length === 0) return false;
      const snapshot = { savedAt: Date.now(), sites };
      await writeStore({ [CACHE_KEY]: JSON.stringify(snapshot) });
      return snapshot;
    } catch {
      return false;
    }
  }

  async function init() {
    const webBase = await getWebBase();
    const today = todayKey();
    $("today-date").textContent = formatTodayLine();

    // 链接统一走配置的站点地址（默认生产域，popup 里可改回本地开发地址）
    const linkMap = { "link-home": "", "link-market": "/marketplace", "link-guide": "/extension" };
    for (const [id, path] of Object.entries(linkMap)) {
      const el = $(id);
      if (el) el.href = `${webBase}${path}`;
    }

    // 搜索：回车直达站内 /search
    $("search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      location.href = buildSearchUrl(webBase, $("search-input").value);
    });

    // 今日一件事：读当天有效的，跨天失效
    let focus = focusForToday(parseDailyFocus(await readStore(FOCUS_KEY)), today);
    renderFocus(focus);
    $("focus-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const next = createDailyFocus($("focus-input").value, today, Date.now());
      if (!next) return;
      focus = next;
      await writeStore({ [FOCUS_KEY]: JSON.stringify(next) });
      renderFocus(focus);
    });
    $("focus-toggle").addEventListener("click", async () => {
      if (!focus) return;
      focus = { ...focus, done: !focus.done, updatedAt: Date.now() };
      await writeStore({ [FOCUS_KEY]: JSON.stringify(focus) });
      renderFocus(focus);
    });
    $("focus-clear").addEventListener("click", async () => {
      focus = null;
      await writeStore({ [FOCUS_KEY]: JSON.stringify("") });
      renderFocus(null);
      $("focus-input").focus();
    });

    // 常用站：先画缓存秒开，再后台拉新数据无缝替换；离线停在上次的样子
    const badge = $("status-badge");
    const note = $("cache-note");
    const cachedRaw = await readStore(CACHE_KEY);
    const cached = parseNavigationCache(cachedRaw);
    if (cached) {
      renderQuickSites(cached.sites, webBase);
      note.textContent = `缓存 · ${formatCacheAge(cached.savedAt, Date.now())}更新`;
    } else {
      renderQuickSites(
        BUILTIN_QUICK_LINKS.map((l) => ({ title: l.title, url: `${webBase}${l.url}`, category: l.category })),
        webBase,
      );
      note.textContent = "站内入口 · 联网后自动出现常用站";
    }

    const online = navigator.onLine !== false;
    if (!online) {
      badge.textContent = cached ? "离线 · 显示上次缓存" : "离线 · 显示站内入口";
      badge.classList.add("offline");
      return;
    }
    const fresh = await refreshCache(webBase);
    if (fresh) {
      renderQuickSites(fresh.sites, webBase);
      note.textContent = `已更新 · ${formatCacheAge(fresh.savedAt, Date.now())}`;
      badge.textContent = "在线";
      badge.classList.add("online");
    } else if (cached) {
      badge.textContent = "离线 · 显示上次缓存";
      badge.classList.add("offline");
    } else {
      badge.textContent = "未连上站点 · 显示站内入口";
      badge.classList.add("offline");
    }
  }

  init();
}

// Node 单测入口：浏览器里 module 不存在，不执行
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_WEB_BASE,
    CACHE_KEY,
    FOCUS_KEY,
    MAX_QUICK_SITES,
    FOCUS_MAX_LENGTH,
    BUILTIN_QUICK_LINKS,
    todayKey,
    formatTodayLine,
    formatCacheAge,
    safeHttpUrl,
    buildSearchUrl,
    cleanFocusText,
    createDailyFocus,
    parseDailyFocus,
    focusForToday,
    extractQuickSites,
    parseNavigationCache,
  };
}
