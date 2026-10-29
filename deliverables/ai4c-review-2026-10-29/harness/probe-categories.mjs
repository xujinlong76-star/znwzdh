// 一次性探针：登录后打开审核 Tab，打印类目下拉选项与 console/network 证据
import { chromium } from "@playwright/test";

const BASE = process.env.AI4C_WEB || "http://127.0.0.1:3415";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30_000);

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on("response", (r) => {
  if (r.url().includes("/api/hub/categories")) logs.push(`[net] ${r.status()} ${r.url()}`);
});

await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 10; i += 1) {
  await page.getByRole("button", { name: /以管理员身份一键进入/ }).click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => fetch("/api/auth/session").then((r) => r.json()).catch(() => null));
  if (s?.user?.email) break;
}

await page.goto(`${BASE}/admin/ai`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /切换到富化结果字段级审核/ }).click();
await page.waitForSelector('[aria-label="富化审核网址"]');
await page.waitForTimeout(4000);

const options = await page.$$eval("#enrich-review-category option", (os) => os.map((o) => o.textContent));
const direct = await page.evaluate(async () => {
  const r = await fetch("/api/hub/api/categories");
  const t = await r.text();
  return { status: r.status, head: t.slice(0, 200) };
});
console.log(JSON.stringify({ options, direct, logs }, null, 2));
await browser.close();
