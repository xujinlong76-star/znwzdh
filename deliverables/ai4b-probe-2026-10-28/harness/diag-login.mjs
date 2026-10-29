/** 取证脚本：登录快捷通道到底有没有生成会话（只读，不写库） */
import { chromium } from "@playwright/test";

const BASE = process.env.AI4B_WEB || "http://127.0.0.1:3414";
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultNavigationTimeout(180_000);

await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
const csrf = await page.evaluate(async () => {
  const r = await fetch("/api/auth/csrf");
  return (await r.json()).csrfToken;
});
console.log("csrf", csrf ? csrf.slice(0, 16) + "…" : "(none)");

const signin = await page.evaluate(async (csrfToken) => {
  const body = new URLSearchParams({
    csrfToken,
    provider: "credentials",
    json: "true",
    bypass: "true",
    username: "admin",
    password: "",
    callbackUrl: location.origin,
  });
  const r = await fetch("/api/auth/callback/credentials", {
    method: "POST",
    body,
    credentials: "include",
    redirect: "follow",
  });
  return {
    status: r.status,
    url: r.url,
    type: r.type,
    text: (await r.text().catch(() => "")).slice(0, 200),
  };
}, csrf);
console.log("signin", JSON.stringify(signin));

console.log("cookies", JSON.stringify((await page.context().cookies()).map((c) => `${c.name}:${c.httpOnly ? "HttpOnly" : "js"}:${c.secure ? "Secure" : "plain"}:${c.sameSite}`)));

const session = await page.evaluate(async () => {
  const r = await fetch("/api/auth/session");
  return { status: r.status, text: (await r.text()).slice(0, 300) };
});
console.log("session", JSON.stringify(session));

const gate = await page.evaluate(async () => {
  const r = await fetch("/api/hub/admin/audit/report", { headers: { "content-type": "application/json" }, credentials: "include" });
  return { status: r.status, text: (await r.text()).slice(0, 200) };
});
console.log("gate", JSON.stringify(gate));

await browser.close();
