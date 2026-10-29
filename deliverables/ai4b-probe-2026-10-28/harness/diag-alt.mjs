/** 取证：登录态下经由 Next 代理调用平替接口，打印客户端真正看到的响应 */
import { chromium } from "@playwright/test";

const BASE = process.env.AI4B_WEB || "http://127.0.0.1:3414";
const SITE = process.env.AI4B_SITE || "9ee7e927-ad06-4867-8168-9bea0f016c5d";

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultNavigationTimeout(180_000);

await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 10; i += 1) {
  await page.getByRole("button", { name: /以管理员身份一键进入/ }).click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => fetch("/api/auth/session").then((r) => r.json()).catch(() => null)).catch(() => null);
  if (s?.user?.email) break;
}
const out = await page.evaluate(async (siteId) => {
  const r = await fetch(`/api/hub/sites/${siteId}/recommend-alternative`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    credentials: "include",
  });
  const text = await r.text();
  return { status: r.status, head: text.slice(0, 1200) };
}, SITE);
console.log("proxied status", out.status);
try {
  const j = JSON.parse(out.head.length ? out.head : "{}");
  console.log("keys", Object.keys(j).join(","));
  console.log("model", j.model, "aiDegraded", j.aiDegraded, "probe", JSON.stringify(j.probe || null)?.slice(0, 120));
  for (const c of j.recommendations || []) console.log(" -", c.title, c.url, "grade=" + c.grade);
} catch {
  console.log("raw", out.head);
}
await browser.close();
