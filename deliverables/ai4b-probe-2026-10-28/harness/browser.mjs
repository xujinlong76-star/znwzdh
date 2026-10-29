/**
 * [AI-4b] 真实浏览器实测：候选档位必须在 DOM 里说得出、拦得住。
 *
 * 判据来自「真读渲染后的 DOM」而不是源码字符串：源码守卫只证明代码写了，
 * 不证明浏览器里真的渲染出来、真的点不动。
 *
 * 两种模式各跑一次（用同一个隔离栈，只换中枢的模型配置）：
 *   AI4B_MODE=llm      → 模型推荐三条：verified / unverified / dead
 *   AI4B_MODE=fallback → 没有模型参与，同分类兜底三条：verified / blocked / suspicious
 * 两档合起来覆盖五档，其中 dead 与 suspicious 各占一次「必须拦下来」的场景。
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "results");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.AI4B_WEB || "http://127.0.0.1:3414";
const MODE = process.env.AI4B_MODE || "llm";
const BROKEN_TITLE = "AI4B 旧工具（已失效）";

const rows = [];
const record = (id, pass, detail) => {
  rows.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} :: ${JSON.stringify(detail).slice(0, 220)}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// dev 首次访问每个路由都要即时编译（实测 /auth/signin 冷启 18s），默认的 30s 导航超时会假红灯
page.setDefaultNavigationTimeout(180_000);
page.setDefaultTimeout(180_000);

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
/** 浏览器层真实发出去的请求：候选 URL 一个都不该出现（档位来自缓存，人工复核链接也不该被自动抓取） */
const outbound = [];
page.on("request", (r) => {
  if (!r.url().startsWith(BASE)) outbound.push(r.url());
});
/** 写库出口：禁用按钮若真被点动，这里会出现 audit/apply */
const applyCalls = [];
page.on("request", (r) => {
  if (r.url().includes("/admin/audit/apply")) applyCalls.push(r.method() + " " + r.url());
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

/**
 * 前置闸门：巡检报告与平替写库都在 admin scope 上，匿名会被 Next 代理挡成 401
 * （HUB_ROUTE_FORBIDDEN）。不先确认登录态就把列表空了算缺陷，是本轮最需要防的假红灯。
 */
await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
/**
 * 登录不能只「点一下按钮」就当前置成立：dev 冷编译时这一屏还是静态 DOM，
 * onClick 尚未绑定，点击不发任何请求（实测日志里连 POST /api/auth/callback 都没有），
 * 于是后面的 admin 代理全成 401，看起来像功能坏了。这里以「会话里真的有了管理员」为唯一判据，
 * 点不动就重点，等 hydration 追上。
 */
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
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1000);
let gate = { status: 0, body: "" };
for (let attempt = 0; attempt < 5; attempt += 1) {
  gate = await page
    .evaluate(async () => {
      const r = await fetch("/api/hub/admin/audit/report", { headers: { "content-type": "application/json" } });
      return { status: r.status, body: (await r.text()).slice(0, 200) };
    })
    .catch((err) => ({ status: 0, body: String(err).slice(0, 160) }));
  if (gate.status === 200) break;
  await page.waitForTimeout(2000);
}
if (gate.status !== 200) {
  console.log("前置不成立：admin 代理仍不可达，跳过 UI 断言。", JSON.stringify(gate));
  await browser.close();
  process.exit(3);
}
record("G-0 登录态与 admin 代理前置成立", true, { status: gate.status });

// 打开超级控制台：用组件自己注册的事件，不靠坐标点击（坐标点击在本机 in-app 浏览器不可靠）。
// dev 首次访问要即时编译 spotlight 那一份 chunk，所以「派事件 + 等输入框」做成重试循环，
// 而不是只派一次然后 20 秒超时——监听器可能还没挂上，也可能还在编译。
const combobox = '[role="combobox"][aria-label="全局超级搜索与系统指令"]';
{
  const deadline = Date.now() + 150_000;
  let up = false;
  while (Date.now() < deadline && !up) {
    await page.evaluate(() => window.dispatchEvent(new Event("open-spotlight"))).catch(() => {});
    up = await page.waitForSelector(combobox, { timeout: 5_000 }).then(() => true, () => false);
  }
  if (!up) throw new Error("spotlight 呼不出：150 秒内既没编译好也没挂上监听");
}
await page.fill(combobox, ">audit");
await page.waitForTimeout(500);
await page.keyboard.press("Enter");

await page.waitForSelector('[role="dialog"][aria-label*="站点健康自治巡检"]', { timeout: 90000 });
const dialog = '[role="dialog"][aria-label*="站点健康自治巡检"]';
await page.waitForTimeout(1200); // 等报告拉完

const issueCard = `${dialog} div:has(> div > div > div > div > span:text-is("${BROKEN_TITLE}"))`;
const hasIssue = (await page.locator(dialog).innerText()).includes(BROKEN_TITLE);
record("G0 报告里有待治愈站点", hasIssue, { brokenTitle: BROKEN_TITLE });

// 点「AI 平替推荐」（限定在异常卡片那一段，页面上可能有多枚同名按钮时取第一条）
await page.locator(dialog).getByRole("button", { name: "AI 平替推荐" }).first().click();
/**
 * 不能点完就立刻读：请求是异步的，读早了拿到的是报告自带的「建议替换」——
 * 那一份没有实测档位（徽章全是「未实测」），会把这轮验证测成一片假红。
 * 以「实测读数：」出现为这一轮结果落地的判据。
 */
const probeArrived = await page
  .waitForFunction((dlg) => document.querySelector(dlg)?.innerText.includes("实测读数："), dialog, { timeout: 90_000 })
  .then(() => true, () => false);
record("G1.5 本轮实测结果已渲染（等异步响应落地）", probeArrived, {});
const listText = await page.locator(dialog).innerText();
record("G1 候选列表出现", listText.includes("候选平替方案："), {});
record("G2 实测读数出现在列表上", listText.includes("实测读数："), {
  probeLine: (listText.match(/实测读数：[^\n]*/) || [""])[0],
});
record("G3 口径声明随读数渲染", /慢 ≠ 死|本机网络实测/.test(listText), {
  caveat: (listText.match(/可达性为[^\n]*/) || [""])[0].slice(0, 120),
});

/** 逐条候选卡片的渲染证据 */
const cards = await page.evaluate((dlg) => {
  const root = document.querySelector(dlg);
  const btns = [...root.querySelectorAll("button")].filter((b) => b.textContent.includes("一键平替"));
  return btns.map((btn) => {
    const card = btn.parentElement?.parentElement;
    const badge = card?.querySelector('span[class*="rounded-full"]');
    const notes = [...(card?.querySelectorAll('[role="note"]') || [])].map((n) => n.textContent?.trim());
    const text = card?.innerText || "";
    return {
      title: card?.querySelector("div.font-medium")?.textContent?.trim(),
      href: card?.querySelector("a")?.getAttribute("href"),
      badge: badge?.textContent?.trim(),
      disabled: btn.disabled,
      notes,
      hasEvidence: text.includes("实测依据："),
      evidence: (text.match(/实测依据：[^\n]*/) || [""])[0],
      sourceLine: text.includes("来源：站内同类目兜底")
        ? "catalog"
        : /可信度 \d+/.test(text)
          ? (text.match(/可信度 \d+（[^）]*）/) || [""])[0]
          : "",
    };
  });
}, dialog);
record("G4 三条候选都带档位徽章", cards.length === 3 && cards.every((c) => c.badge && c.badge.length > 0), {
  badges: cards.map((c) => c.badge),
  titles: cards.map((c) => c.title),
});
record("G5 每条候选带可点开的 URL 与实测依据", cards.every((c) => /^https?:\/\//.test(c.href || "") && c.hasEvidence), {
  hrefs: cards.map((c) => c.href),
});

if (MODE === "llm") {
  // 排序必须按实测档位，而不是模型给的顺序（模型顺序是 稳替/慢站/已下线，档位恰好同序时靠徽章证明）
  record("S1 档位顺序=实测档位降序", JSON.stringify(cards.map((c) => c.badge)) === JSON.stringify(["实测可达", "没测准", "实测不可用"]), {
    badges: cards.map((c) => c.badge),
  });
  record("S2 「实测不可用」禁止一键采纳", cards[2]?.disabled === true, { title: cards[2]?.title, notes: cards[2]?.notes });
  record("S3 「没测准」仍可采纳但带人工复核提示", cards[1]?.disabled === false && (cards[1]?.notes || []).join("").includes("慢 ≠ 死"), {
    notes: cards[1]?.notes,
  });
  record("S4 拦截理由写在卡片上而不是只变灰", (cards[2]?.notes || []).join("").includes("已禁止直接采纳"), {
    notes: cards[2]?.notes,
  });
  record("S5 可信度是分解值", /可达性 100/.test(cards[0]?.sourceLine || ""), { confidence: cards[0]?.sourceLine });
} else {
  record("S1 兜底来源如实标注", cards.every((c) => c.sourceLine === "catalog" || /可信度/.test(c.sourceLine)), {
    sourceLines: cards.map((c) => c.sourceLine),
  });
  record("S2 「疑似停放页」禁止一键采纳", cards.some((c) => c.badge === "疑似停放页/空壳" && c.disabled === true), {
    badges: cards.map((c) => c.badge),
    disabled: cards.map((c) => c.disabled),
  });
  record("S3 「被挡住」允许采纳但要求人工确认", cards.some((c) => c.badge === "被挡住，内容未验证" && c.disabled === false), {
    badges: cards.map((c) => c.badge),
  });
  record("S4 没有模型参与时如实说明", listText.includes("本次没有模型参与") && listText.includes("未经模型筛选"), {
    notice: (listText.match(/本次没有模型参与[^\n]*/) || [""])[0].slice(0, 160),
  });
}

// 负向对照：真的去点那枚被禁用的按钮（DOM 层 click，不走 Playwright 的可点击性判定）
const beforeApply = applyCalls.length;
const deadIdx = cards.findIndex((c) => c.disabled);
if (deadIdx >= 0) {
  await page.evaluate(
    ({ dlg, idx }) => {
      const root = document.querySelector(dlg);
      const btns = [...root.querySelectorAll("button")].filter((b) => b.textContent.includes("一键平替"));
      btns[idx].click();
      btns[idx].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    { dlg: dialog, idx: deadIdx },
  );
  await page.waitForTimeout(1200);
  record("N1 点击不可采纳候选不产生写库请求", applyCalls.length === beforeApply, {
    target: cards[deadIdx].title,
    applyCalls,
  });
}

// 正向对照：实测可达的那条应该还能采纳（证明「拦得住」不是把整条链路禁死）
const okIdx = cards.findIndex((c) => !c.disabled && c.badge !== undefined);
if (okIdx >= 0) {
  await page.locator(dialog).getByRole("button", { name: "一键平替" }).nth(okIdx).click();
  await page.waitForTimeout(2500);
  record("P1 实测可达候选仍可一键采纳", applyCalls.length > beforeApply, { applyCalls });
  const afterText = await page.locator(dialog).innerText();
  record("P2 采纳后该条从待治愈列表消失", !afterText.includes(BROKEN_TITLE), {
    stillThere: afterText.includes(BROKEN_TITLE),
  });
}

record("Z1 无 console error", consoleErrors.length === 0, { consoleErrors: consoleErrors.slice(0, 5) });
record("Z2 浏览器没有替候选 URL 发过请求", outbound.every((u) => !u.includes("ai4b-demo.example")), {
  outboundCount: outbound.length,
  outbound: outbound.slice(0, 5),
});

await page.screenshot({ path: resolve(OUT, `modal-${MODE}.png`), fullPage: false }).catch((e) => console.log("screenshot skipped: " + e.message));
writeFileSync(resolve(OUT, `browser-evidence-${MODE}.json`), JSON.stringify({ mode: MODE, rows, cards, applyCalls, outbound, consoleErrors }, null, 2), "utf8");

const failed = rows.filter((r) => !r.pass);
console.log(`\n== ${MODE}: ${rows.length - failed.length}/${rows.length} 通过 ==`);
if (failed.length) {
  console.log(failed.map((f) => `FAIL ${f.id} ${JSON.stringify(f.detail).slice(0, 200)}`).join("\n"));
}
await browser.close();
process.exit(failed.length ? 1 : 0);
