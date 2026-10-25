/**
 * NavHub 浏览器随身扩展 Background Service Worker
 * 功能：Omnibox 地址栏快捷检索 (输入 nh + 空格/Tab + 关键词)
 */

const DEFAULT_API_URL = "http://127.0.0.1:8787";
const DEFAULT_WEB_URL = "http://localhost:3000";

async function getApiUrl() {
  const store = await chrome.storage.local.get(["apiUrl"]);
  return (store.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
}

async function getWebUrl() {
  const store = await chrome.storage.local.get(["webUrl"]);
  return (store.webUrl || DEFAULT_WEB_URL).replace(/\/$/, "");
}

// 监听地址栏输入改变
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  if (!text || text.trim().length === 0) return;

  try {
    const apiBase = await getApiUrl();
    // 带上已配置的个人令牌：/api/search 里的事件归属走 requestIdentityOf（Header→Query→Body），
    // 令牌有效时命中的是 auth.ownerIdentity（服务端校验过的真实身份），与 web 端同口径；
    // 令牌无效/过期时，public 路由按「与不带 token 一致」当匿名处理（server.ts 的鉴权钩子），
    // 所以这里不会因为多带一个头而把建议列表打成空。
    const token = await getToken();
    const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(text.trim())}&limit=6`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return;

    const data = await res.json();
    const items = data.hits || data.items || [];

    // hits[].site 允许为 null（命中来自向量/标签而站点已进回收站），
    // 直接取 site.url 会抛错并被外层 catch 吞掉——整条建议列表空返回。
    const suggestions = items
      .filter((item) => item && item.site && item.site.url)
      .map((item) => {
        const site = item.site;
        const channels = item.channels?.join("+") || "hub";
        return {
          content: site.url,
          description: `[${channels}] <match>${escapeXml(site.title)}</match> - <dim>${escapeXml(site.description || site.url)}</dim>`,
        };
      });

    suggest(suggestions);
  } catch (err) {
    console.warn("[NavHub Extension] 搜索失败:", err);
  }
});

// 监听地址栏回车选定
chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const url = text.startsWith("http://") || text.startsWith("https://")
    ? text
    : `${await getWebUrl()}/?q=${encodeURIComponent(text)}`;

  switch (disposition) {
    case "currentTab":
      chrome.tabs.update({ url });
      break;
    case "newForegroundTab":
      chrome.tabs.create({ url, active: true });
      break;
    case "newBackgroundTab":
      chrome.tabs.create({ url, active: false });
      break;
  }
});

function escapeXml(unsafe) {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


// ---------------------------------------------------------------------------
// 右键「收藏到 NavHub」（B1）：与 popup 的收藏按钮同一套两步链路
// ---------------------------------------------------------------------------
async function getToken() {
  const store = await chrome.storage.local.get(["navhub_api_token"]);
  return String(store.navhub_api_token || "").trim();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "navhub-favorite",
    title: "⭐ 收藏到 NavHub",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "navhub-favorite" || !tab || !tab.url) return;
  const token = await getToken();
  const apiBase = await getApiUrl();
  const badge = (text, color) => {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
  };
  if (!token) { badge("配置", "#f59e0b"); return; }
  try {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const autoRes = await fetch(`${apiBase}/api/sites/auto`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: tab.url }),
    });
    if (autoRes.status === 401 || autoRes.status === 403) { badge("401", "#ef4444"); return; }
    const autoData = await autoRes.json().catch(() => ({}));
    const siteId = autoData.site && autoData.site.id;
    if (!siteId) { badge("失败", "#ef4444"); return; }
    const favRes = await fetch(`${apiBase}/api/favorites`, {
      method: "POST",
      headers,
      body: JSON.stringify({ siteId }),
    });
    if (favRes.status === 403) { badge("只读", "#f59e0b"); return; }
    badge(favRes.ok ? "已藏" : "失败", favRes.ok ? "#10b981" : "#ef4444");
  } catch {
    badge("离线", "#ef4444");
  }
});
