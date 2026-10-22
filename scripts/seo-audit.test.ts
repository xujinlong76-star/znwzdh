import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

/**
 * SEO 审计器 CLI 级回归测试（假站点，不起中枢）。
 *
 * 存在的理由是一个具体的谎：2026-10-22 之前 `summary.failed` 被写成
 * `report.issues.length`，于是那轮 1126 页**全部 HTTP 200** 的审计在报告里显示
 * `failed: 1109`。字段名有外部消费者不能改，语义必须改，而改完得有人钉住——
 * 一个口径写错的仪表比没有仪表更危险，因为它让「没问题」和「全是问题」看起来一样。
 *
 * 这里同时钉住三条本轮加的口径：`pagesWithIssues`（有 finding 的页数）、
 * description 重复组数、以及 og:image 的本机地址判定（要比端口，
 * 否则在 localhost:3078 上审计时，产物里烤死的 localhost:3000 会被放行）。
 */

const SCRIPT = resolve("scripts/seo-audit.mjs");

const LONG_DESC = "这条描述故意超过八十个字符，用来验证审计器把长度分布单独记账而不判失败。".repeat(3);

/** 一页一状态：路径 → 该页要触发的缺陷种类 */
const PAGES: Record<string, { title: string; description: string; ogImage?: string; status?: number }> = {
  "/a": { title: "站点目录 第一页", description: "这是被两页共享的一段描述文字，用来触发重复描述。" },
  "/b": { title: "站点目录 第二页", description: "这是被两页共享的一段描述文字，用来触发重复描述。" },
  "/c": { title: "站点目录 第三页", description: "这一页服务器直接返回 500，用来数 HTTP 失败。", status: 500 },
  "/d": {
    title: "站点目录 第四页",
    description: "这一页的分享图指向本机另一个端口，是烤进产物的兜底地址。",
    ogImage: "http://localhost:3000/og-default.png",
  },
  "/e": { title: "站点目录 第五页", description: "太短了" },
  "/f": { title: "站点目录 第六页", description: LONG_DESC },
};

function pageHtml(path: string): string {
  const { title, description, ogImage } = PAGES[path];
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${path}">
<meta property="og:url" content="${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="示例导航">
<meta property="og:locale" content="zh_CN">
<meta property="og:image" content="${ogImage ?? "/og-default.png"}">
<meta name="twitter:card" content="summary_large_image">
</head><body><h1>${title}</h1></body></html>`;
}

function serve(): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      if (url.pathname === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(`User-agent: *\nSitemap: ${origin}/sitemap.xml\n`);
        return;
      }
      if (url.pathname === "/sitemap.xml") {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(
          `<?xml version="1.0"?><urlset>${Object.keys(PAGES)
            .map((p) => `<url><loc>${origin}${p}</loc></url>`)
            .join("")}</urlset>`,
        );
        return;
      }
      if (url.pathname === "/feed.xml") {
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>示例</title></channel></rss>`);
        return;
      }
      // 软 404 探测：伪造的站点详情必须是真 404，否则审计会在「软 404」上多报一条
      if (url.pathname.startsWith("/site/")) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<html><body>not found</body></html>");
        return;
      }
      const page = PAGES[url.pathname];
      if (!page) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<html><body>not found</body></html>");
        return;
      }
      if (page.status && page.status !== 200) {
        res.writeHead(page.status, { "content-type": "text/html" });
        res.end("<html><body>boom</body></html>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(pageHtml(url.pathname));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function runAudit(base: string, extra: string[] = []) {
  const child = spawn(process.execPath, [SCRIPT, `--base=${base}`, "--retries=0", "--json", ...extra], {
    env: { ...process.env, NAVHUB_SITE_URL: "" },
  });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (out += chunk));
  child.stderr.on("data", (chunk: string) => (out += chunk));
  const code = await new Promise<number>((done) => {
    child.once("close", (exitCode) => done(exitCode ?? -1));
    child.once("error", () => done(-1));
  });
  return { code, out };
}

async function audit(extra: string[] = []) {
  const { base, close } = await serve();
  try {
    const { code, out } = await runAudit(base, extra);
    // 只在 --json 下取最后一个 JSON 文档；脚本自身不再往 stdout 打人类可读行。
    const start = out.indexOf("{");
    expect(start, `审计器没有输出 JSON：\n${out}`).toBeGreaterThanOrEqual(0);
    return { code, out, report: JSON.parse(out.slice(start)) };
  } finally {
    await close();
  }
}

describe("seo-audit.mjs 的 summary 口径", () => {
  it("failed 只数 HTTP 失败页，不再等于问题条数", async () => {
    const { report } = await audit();
    expect(report.summary.sitemapUrls).toBe(Object.keys(PAGES).length);
    expect(report.summary.pages).toBe(Object.keys(PAGES).length);
    // 假站点里只有 /c 不是 200
    expect(report.summary.failed).toBe(1);
    // 而问题条数远大于 1（重复描述、本机 og:image、长度分布等）——这正是旧实现
    // 把两者混为一谈时看不出差别的地方。
    expect(report.issues.length).toBeGreaterThan(report.summary.failed);
  });

  it("pagesWithIssues 数的是有 finding 的页，不是 finding 条数", async () => {
    const { report } = await audit();
    // 单页级问题只有 /d（og:image 指向本机 :3000，页面在 :<随机端口>）
    expect(report.summary.pagesWithIssues).toBe(1);
    expect(report.summary.ogMissing).toBe(1);
    const offender = report.results.find((r: { url: string }) => r.url.endsWith("/d"));
    expect(offender.issueKinds).toEqual(expect.arrayContaining(["og"]));
  });

  it("重复 description 单独计组，title 不重复时为 0", async () => {
    const { report } = await audit();
    expect(report.summary.descriptionDuplicateGroups).toBe(1);
    expect(report.summary.titleDuplicateGroups).toBe(0);
    expect(report.issues.map((i: { scope: string }) => i.scope)).toContain("重复 description");
  });

  it("description 长度只记账：过短与超长各 1，且不计入失败", async () => {
    const { report } = await audit();
    expect(report.summary.descriptionTooShort).toBe(1);
    expect(report.summary.descriptionTooLong).toBe(1);
  });

  it("有问题时退出码为 1（CI 可直接判），--no-fail 时仍出报告但为 0", async () => {
    const { code } = await audit();
    expect(code).toBe(1);
    const tolerant = await audit(["--no-fail"]);
    expect(tolerant.code, tolerant.out).toBe(0);
    expect(tolerant.report.issues.length).toBeGreaterThan(0);
  });
});
