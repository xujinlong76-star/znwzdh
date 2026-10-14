const API_BASE = "http://127.0.0.1:8787";

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const currentTabInfo = document.getElementById("current-tab-info");
const saveBtn = document.getElementById("save-btn");
const statusIndicator = document.getElementById("status-indicator");

let currentTab = null;

// 1. 检查 API 健康度
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
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

// 2. 获取当前活动标签页
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
    searchResults.innerHTML = "";
    return;
  }

  debounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=5`);
      if (!res.ok) return;
      const data = await res.json();
      renderResults(data.hits || data.items || []);
    } catch (err) {
      console.warn("Search error:", err);
    }
  }, 200);
});

function renderResults(items) {
  if (items.length === 0) {
    searchResults.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:8px;text-align:center;">未找到相关站点</div>';
    return;
  }

  searchResults.innerHTML = items
    .map((item) => {
      const site = item.site;
      const channels = (item.channels || []).slice(0, 2).join("+");
      return `
        <a class="result-item" href="${site.url}" target="_blank">
          <div class="result-title">
            <span>${escapeHtml(site.title)}</span>
            ${channels ? `<span class="channel-tag">${channels}</span>` : ""}
          </div>
          <div class="result-desc">${escapeHtml(site.description || site.url)}</div>
        </a>
      `;
    })
    .join("");
}

// 4. 一键收录当前网页
saveBtn.addEventListener("click", async () => {
  if (!currentTab || !currentTab.url) return;

  saveBtn.disabled = true;
  saveBtn.textContent = "正在调用 AI 抓取并富化...";

  try {
    const res = await fetch(`${API_BASE}/api/sites/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: currentTab.url,
      }),
    });

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

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

checkHealth();
