/**
 * NavHub 随身导航 popup。
 *
 * 安全与配置约定（与 background.js 统一）：
 *  - API 地址可配：chrome.storage.local["apiUrl"]，默认 http://127.0.0.1:8787，
 *    background 的 omnibox 检索读的是同一个 key，改一处两处生效。
 *  - Token 存 chrome.storage.local["navhub_api_token"]（不用 localStorage，
 *    避免明文长期落在 Web 存储且与 SW 上下文不一致）。
 *  - 搜索结果渲染不用 innerHTML 拼接：全部 createElement + textContent；
 *    外链 href 只放行 http/https，其他协议降级为纯文本（防 javascript: 注入）。
 */

const DEFAULT_API_BASE = "http://127.0.0.1:8787";

async function getApiBase() {
  try {
    const store = await chrome.storage.local.get(["apiUrl"]);
    return (store.apiUrl || DEFAULT_API_BASE).replace(/\/$/, "");
  } catch {
    return DEFAULT_API_BASE;
  }
}

async function getToken() {
  try {
    const store = await chrome.storage.local.get(["navhub_api_token"]);
    return String(store.navhub_api_token || "").trim();
  } catch {
    return "";
  }
}

async function setStore(items) {
  try {
    await chrome.storage.local.set(items);
  } catch (err) {
    console.warn("[NavHub] 存储失败:", err);
  }
}

/** 只放行 http/https 外链，其他一律返回 null（调用方降级为纯文本） */
function safeHttpUrl(raw) {
  try {
    const u = new URL(String(raw || ""), "http://invalid.local");
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

function clearResults() {
  searchResults.replaceChildren();
}

function emptyHint(text) {
  clearResults();
  const div = document.createElement("div");
  div.setAttribute("style", "color:#94a3b8;font-size:11px;padding:8px;text-align:center;");
  div.textContent = text;
  searchResults.appendChild(div);
}

const tokenInput = document.getElementById("token-input");
const apiInput = document.getElementById("api-input");

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const currentTabInfo = document.getElementById("current-tab-info");
const saveBtn = document.getElementById("save-btn");
const statusIndicator = document.getElementById("status-indicator");

let currentTab = null;

// 0. 设置项回填（token + API 地址）
(async () => {
  if (tokenInput) {
    tokenInput.value = await getToken();
    tokenInput.addEventListener("input", (e) => {
      setStore({ navhub_api_token: e.target.value.trim() });
    });
  }
  if (apiInput) {
    apiInput.value = await getApiBase();
    apiInput.addEventListener("input", (e) => {
      setStore({ apiUrl: e.target.value.trim() });
    });
  }
})();

// 1. 检查 API 健康度
async function checkHealth() {
  const apiBase = await getApiBase();
  try {
    const res = await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (res.status === 401) {
      saveBtn.textContent = "❌ 401 未授权：请在下方填入有效 API Token";
      saveBtn.style.background = "#ef4444";
      return;
    }
    if (res.ok) {
      statusIndicator.textContent = "中枢已连接";
      statusIndicator.style.color = "#10b981";
    } else {
      throw new Error();
    }
  } catch {
    statusIndicator.textContent = "中枢未启动";
    statusIndicator.style.color = "#ef4444";
    statusIndicator.style.background = "rgba(239, 68, 68, 0.15)";
    statusIndicator.style.borderColor = "rgba(239, 68, 68, 0.3)";
  }
}

// 2. 获取当前活动标签页（需要 manifest 的 tabs 权限才能稳定拿到 url/title）
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs[0]) {
    currentTab = tabs[0];
    currentTabInfo.textContent = `${currentTab.title} (${currentTab.url})`;
  } else {
    currentTabInfo.textContent = "无法获取当前标签页";
    saveBtn.disabled = true;
  }
});

// 3. 搜索防抖与渲染
let debounceTimer = null;
searchInput.addEventListener("input", (e) => {
  clearTimeout(debounceTimer);
  const q = e.target.value.trim();
  if (!q) {
    clearResults();
    return;
  }

  debounceTimer = setTimeout(async () => {
    try {
      const apiBase = await getApiBase();
      const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(q)}&limit=5`);
      if (!res.ok) return;
      const data = await res.json();
      renderResults(data.hits || data.items || []);
    } catch (err) {
      console.warn("Search error:", err);
    }
  }, 200);
});

function renderResults(items) {
  clearResults();
  if (items.length === 0) {
    emptyHint("未找到相关站点");
    return;
  }

  for (const item of items) {
    const site = item.site || {};
    const title = String(site.title || site.url || "未命名");
    const desc = String(site.description || site.url || "");
    const channels = (item.channels || []).slice(0, 2).join("+");
    const href = safeHttpUrl(site.url);

    let row;
    if (href) {
      row = document.createElement("a");
      row.className = "result-item";
      row.href = href;
      row.target = "_blank";
      row.rel = "noopener noreferrer";
    } else {
      // 非 http(s) 链接不渲染为可点击外链，降级纯文本展示
      row = document.createElement("div");
      row.className = "result-item";
    }

    const titleDiv = document.createElement("div");
    titleDiv.className = "result-title";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = title;
    titleDiv.appendChild(titleSpan);
    if (channels) {
      const tag = document.createElement("span");
      tag.className = "channel-tag";
      tag.textContent = channels;
      titleDiv.appendChild(tag);
    }

    const descDiv = document.createElement("div");
    descDiv.className = "result-desc";
    descDiv.textContent = desc;

    row.appendChild(titleDiv);
    row.appendChild(descDiv);
    searchResults.appendChild(row);
  }
}

// 4. 一键收录当前网页
saveBtn.addEventListener("click", async () => {
  if (!currentTab || !currentTab.url) return;

  saveBtn.disabled = true;
  saveBtn.textContent = "正在调用 AI 抓取并富化...";

  try {
    const apiBase = await getApiBase();
    const headers = { "Content-Type": "application/json" };
    const savedToken = tokenInput ? tokenInput.value.trim() : await getToken();
    if (savedToken) {
      headers["Authorization"] = `Bearer ${savedToken}`;
    }
    const res = await fetch(`${apiBase}/api/sites/auto`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: currentTab.url,
      }),
    });

    if (res.status === 401) {
      saveBtn.textContent = "❌ 401 未授权：请在下方填入有效 API Token";
      saveBtn.style.background = "#ef4444";
      return;
    }
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.created === false && data.reason) {
        saveBtn.textContent = `ℹ️ ${data.reason}`;
        saveBtn.style.background = "#f59e0b";
      } else {
        saveBtn.textContent = "✅ 收录成功！";
        saveBtn.style.background = "#10b981";
      }
      setTimeout(() => {
        saveBtn.textContent = "AI 富化并收录到 NavHub";
        saveBtn.style.background = "";
        saveBtn.disabled = false;
      }, 2500);
    } else {
      const err = await res.json().catch(() => ({}));
      saveBtn.textContent = "❌ " + (err.error || err.message || "收录失败");
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "重试收录";
      }, 2000);
    }
  } catch (err) {
    saveBtn.textContent = "❌ 网络异常，中枢未响应";
    setTimeout(() => {
      saveBtn.disabled = false;
      saveBtn.textContent = "重试收录";
    }, 2000);
  }
});

checkHealth();
