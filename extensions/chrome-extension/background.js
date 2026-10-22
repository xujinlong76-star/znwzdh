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
    const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(text.trim())}&limit=6`);
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
