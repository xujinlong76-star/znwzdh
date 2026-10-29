/**
 * [AI-4c] 真实浏览器实测：富化字段级审核必须「看到什么、勾了什么、就落什么」。
 *
 * 三条判据都在浏览器里量，不看源码字符串：
 *   1. 来源徽章逐字段可见（模型归纳 / 页面抓取 / 未获取），missing 行禁用并给原因；
 *   2. 取消勾选的字段不出现在建站请求体里（抓真实 POST /api/hub/sites 的 postData）；
 *   3. 建站前后假模型的调用次数不变 —— 证明没有二次富化（审 A 写 B 的根源）。
 * 另测两个负向：取消标题且不填 → 拒绝且不建站；未选类目 → 拒绝。
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "results");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.AI4C_WEB || "http://127.0.0.1:3415";
const HUB = process.env.AI4C_HUB || "http://127.0.0.1:8915";
const ADMIN_TOKEN = process.env.NAVHUB_ADMIN_TOKEN || "ai4c-local-admin-token";
const STUB_LLM = process.env.AI4C_STUB_LLM || "http://127.0.0.1:8922";
const SITE = process.env.AI4C_STUB_SITE || "http://127.0.0.1:8923";

const rows = [];
const record = (id, pass, detail) => {
  rows.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} :: ${JSON.stringify(detail).slice(0, 240)}`);
};

const adminHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };

async function hubFetch(path, init = {}) {
  const res = await fetch(HUB + path, { ...init, headers: { ...adminHeaders, ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/* ---------------------------- 前置：类目 ---------------------------- */

const catList = await hubFetch("/api/categories");
if (catList.status !== 200) {
  console.log("前置不成立：拿不到类目表", catList.status, catList.body);
  process.exit(3);
}
let leaf = (catList.body ?? []).find((c) => c.title === "开发工具" && c.parentId);
if (!leaf) {
  const root = await hubFetch("/api/categories", {
    method: "POST",
    body: JSON.stringify({ title: "AI4C 测试根", titleEn: "ai4c-root" }),
  });
  if (root.status >= 300) {
    console.log("前置不成立：建根类目失败", root.status, root.body);
    process.exit(3);
  }
  const child = await hubFetch("/api/categories", {
    method: "POST",
    body: JSON.stringify({ title: "开发工具", titleEn: "devtools", parentId: root.body.id }),
  });
  if (child.status >= 300) {
    console.log("前置不成立：建叶子类目失败", child.status, child.body);
    process.exit(3);
  }
  leaf = child.body;
}
console.log(`[seed] 叶子类目 ${leaf.id} / ${leaf.title}`);

async function llmStats() {
  const res = await fetch(STUB_LLM + "/__stats");
  return res.json();
}

/* ------------------------------ 浏览器 ------------------------------ */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultNavigationTimeout(180_000);
page.setDefaultTimeout(180_000);

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 240)));

/** 建站出口的真实请求体（审核是否生效，看这里最硬） */
const createRequests = [];
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/api/hub/sites") && !r.url().includes("/sites/")) {
    createRequests.push(r.postData() ?? "");
  }
});

await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
let signedIn = false;
for (let attempt = 1; attempt <= 10 && !signedIn; attempt += 1) {
  await page.getByRole("button", { name: /以管理员身份一键进入/ }).click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => fetch("/api/auth/session").then((r) => r.json()).catch(() => null)).catch(() => null);
  signedIn = Boolean(s?.user?.email);
  if (!signedIn) console.log(`登录第 ${attempt} 次未生效（多半还在 hydration），重试`);
}
if (!signedIn) {
  console.log("前置不成立：快捷通道登录拿不到管理员会话。");
  await browser.close();
  process.exit(3);
}
record("G-0 管理员会话前置成立", true, {});

await page.goto(`${BASE}/admin/ai`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /切换到富化结果字段级审核/ }).click();
await page.waitForSelector('[aria-label="富化审核网址"]', { timeout: 90_000 });
record("G-1 审核入口可打开（Tab 渲染出面板）", true, {});
// 类目下拉是异步拉取的：不等它有选项就解析，建议匹配会落空（假红灯）
await page.waitForFunction(
  () => document.querySelectorAll("#enrich-review-category option").length > 1,
  { timeout: 60_000 },
);

const panelText = await page.locator("body").innerText();
record("G-2 面板明说不会二次调用模型", panelText.includes("不会再次调用模型"), {});

/* ---------------------- 场景 A：勾选子集 + 改写标题 ---------------------- */

const beforeA = await llmStats();
await page.fill('[aria-label="富化审核网址"]', `${SITE}/rich`);
await page.getByRole("button", { name: "解析并审核" }).click();
await page.waitForSelector('[aria-label="采用标题"]', { timeout: 120_000 });
await page.waitForSelector("text=结果来源", { timeout: 30_000 });
const afterPreviewA = await llmStats();
record("A-1 解析触发一次模型调用", afterPreviewA.calls - beforeA.calls === 1, {
  delta: afterPreviewA.calls - beforeA.calls,
  seen: afterPreviewA.seenUrls.slice(-1),
});

const richText = await page.locator("body").innerText();
record("A-2 模型来源可见（标题/描述/标签/类目）", (richText.match(/模型归纳/g) ?? []).length >= 4, {
  modelBadges: (richText.match(/模型归纳/g) ?? []).length,
});
record("A-3 页面抓取的图标来源可见", richText.includes("页面抓取") && richText.includes("favicon.ico"), {});
record("A-4 模型值出现在审核界面", richText.includes("富化演示站（模型标题）") && richText.includes("开发者工具"), {});

const selectValue = await page.locator("#enrich-review-category").inputValue();
record("A-5 类目建议唯一匹配 → 预选同名叶子类目", selectValue === leaf.id, { selectValue, leafId: leaf.id });

// 取消勾选描述与图标；标题改写为人工版本
await page.getByLabel("采用描述").uncheck();
await page.getByLabel("采用图标").uncheck();
await page.fill('[aria-label="标题（可改写）"]', "人工改写标题（AI-4C）");

const beforeCreateA = await llmStats();
await page.getByRole("button", { name: "按所选字段建站" }).click();
await page.waitForSelector("text=已创建：", { timeout: 60_000 });
const afterCreateA = await llmStats();
record("A-6 建站没有第二次模型调用", afterCreateA.calls === beforeCreateA.calls, {
  before: beforeCreateA.calls,
  after: afterCreateA.calls,
});

const createdText = await page.locator("body").innerText();
const idMatch = createdText.match(/已创建：.*?（([^）]+)）/);
const siteAId = idMatch?.[1] ?? "";
record("A-7 成功卡片带出站点 id", Boolean(siteAId), { siteAId });

const wireA = createRequests.at(-1) ?? "";
let payloadA = null;
try {
  payloadA = JSON.parse(wireA);
} catch {
  payloadA = null;
}
record("A-8 建站请求体不含未勾选字段", payloadA !== null && !("description" in payloadA) && !("iconKey" in payloadA), {
  keys: payloadA ? Object.keys(payloadA) : null,
});
record("A-9 请求体标题 = 人工改写值", payloadA?.title === "人工改写标题（AI-4C）", { title: payloadA?.title });
record("A-10 请求体带所选标签", Array.isArray(payloadA?.tags) && payloadA.tags.join(",") === "开发者工具,效率", {
  tags: payloadA?.tags,
});
record("A-11 请求体类目 = 预选叶子类目", payloadA?.categoryId === leaf.id, { categoryId: payloadA?.categoryId });

const siteA = await hubFetch(`/api/sites/${encodeURIComponent(siteAId)}`);
record("A-12 落库：描述为空（未勾选不写入）", siteA.status === 200 && !siteA.body?.description, {
  status: siteA.status,
  description: siteA.body?.description ?? null,
});
record("A-13 落库：图标为空（未勾选不写入）", siteA.status === 200 && !siteA.body?.iconKey, {
  iconKey: siteA.body?.iconKey ?? null,
});
record("A-14 落库：标题为人工改写值", siteA.body?.title === "人工改写标题（AI-4C）", { title: siteA.body?.title });
record("A-15 落库：标签来自模型且被采用", JSON.stringify(siteA.body?.tags ?? []) === JSON.stringify(["开发者工具", "效率"]), {
  tags: siteA.body?.tags,
});

await page.screenshot({ path: resolve(OUT, "review-rich-created.png"), fullPage: true }).catch(() => {});

/* --------------------- 场景 B：missing 行禁用 + 原因可见 --------------------- */

const beforeB = await llmStats();
await page.fill('[aria-label="富化审核网址"]', `${SITE}/bare`);
await page.getByRole("button", { name: "解析并审核" }).click();
await page.waitForSelector('[aria-label="采用标签"]', { timeout: 120_000 });
await page.waitForTimeout(500);
const bareText = await page.locator("body").innerText();
record("B-1 missing 徽章出现两次以上（标签/图标）", (bareText.match(/未获取/g) ?? []).length >= 2, {
  missingBadges: (bareText.match(/未获取/g) ?? []).length,
});
record("B-2 标签 missing 的原因可见", bareText.includes("模型没有给出标签"), {});
record("B-3 图标 missing 的原因可见", bareText.includes("页面没有声明图标"), {});
record("B-4 标签勾选框被禁用", await page.getByLabel("采用标签").isDisabled(), {});
record("B-5 图标勾选框被禁用", await page.getByLabel("采用图标").isDisabled(), {});
const afterPreviewB = await llmStats();
record("B-6 第二次解析也只多一次模型调用", afterPreviewB.calls - beforeB.calls === 1, {
  delta: afterPreviewB.calls - beforeB.calls,
});

/* ----------------------- 场景 C：负向（标题 / 类目） ----------------------- */

// C1：取消标题、清空改写 → 拒绝
await page.fill('[aria-label="标题（可改写）"]', "");
await page.getByLabel("采用标题").uncheck();
const beforeC = createRequests.length;
await page.getByRole("button", { name: "按所选字段建站" }).click();
await page.waitForSelector("text=标题是必填项", { timeout: 20_000 });
record("C-1 取消标题且不填 → 拒绝并说明原因", true, {});
record("C-2 拒绝时不发建站请求", createRequests.length === beforeC, {
  before: beforeC,
  after: createRequests.length,
});

// C2：重新勾标题，清空类目 → 拒绝
await page.getByLabel("采用标题").check();
await page.locator("#enrich-review-category").selectOption("");
await page.getByRole("button", { name: "按所选字段建站" }).click();
await page.waitForSelector("text=请选择站点要挂载的类目", { timeout: 20_000 });
record("C-3 未选类目 → 拒绝并说明原因", true, {});
record("C-4 仍没有发出建站请求", createRequests.length === beforeC, { count: createRequests.length });

// C3：恢复正常（选回叶子类目）→ 建站成功
await page.locator("#enrich-review-category").selectOption(leaf.id);
await page.getByRole("button", { name: "按所选字段建站" }).click();
await page.waitForSelector("text=已创建：", { timeout: 60_000 });
const createdTextB = await page.locator("body").innerText();
const idMatchB = createdTextB.match(/已创建：.*?（([^）]+)）/);
const siteBId = idMatchB?.[1] ?? "";
record("B-7 missing 行不影响其余字段建站", Boolean(siteBId) && siteBId !== siteAId, { siteBId, siteAId });

const siteB = await hubFetch(`/api/sites/${encodeURIComponent(siteBId)}`);
record("B-8 落库：标签为空（missing 不写空值）", siteB.status === 200 && (siteB.body?.tags ?? []).length === 0, {
  tags: siteB.body?.tags,
});
record("B-9 落库：图标为空", siteB.status === 200 && !siteB.body?.iconKey, { iconKey: siteB.body?.iconKey });

const afterAll = await llmStats();
record("Z-1 全程模型调用次数 = 2（两次解析各一次，两次建站 0 次）", afterAll.calls === 2, { calls: afterAll.calls });
record("Z-2 无 console error", consoleErrors.length === 0, { errors: consoleErrors.slice(0, 5) });

await page.screenshot({ path: resolve(OUT, "review-bare.png"), fullPage: true }).catch(() => {});

/* ------------------------------- 收尾 ------------------------------- */

const passed = rows.filter((r) => r.pass).length;
const evidence = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  hub: HUB,
  leafCategory: leaf,
  createRequests,
  llmCalls: afterAll,
  consoleErrors,
  rows,
  summary: { total: rows.length, passed, failed: rows.length - passed },
};
writeFileSync(resolve(OUT, "browser-evidence.json"), JSON.stringify(evidence, null, 2));
console.log(`\n结果：${passed}/${rows.length} 通过`);
await browser.close();
if (passed !== rows.length) process.exit(1);
