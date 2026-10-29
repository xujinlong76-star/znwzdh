/**
 * [AI-4c] 被富化的「目标站」：本地静态页，零外网。
 *
 * /rich：标题 + description + icon 齐全；
 * /bare：只有 <title>，没有 description、没有 icon（用来验证 missing 行禁用与原因展示）。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_SITE_PORT || 8923);

const RICH = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8" />
<title>AI4C 富化演示站</title>
<meta name="description" content="页面自己的描述：用于验证页面抓取来源与人工改写。" />
<link rel="icon" href="/favicon.ico" />
</head><body>
<h1>AI4C 富化演示站</h1>
<p>developer tools demo page</p>
</body></html>`;

const BARE = `<!doctype html>
<html><head><meta charset="utf-8" /><title>AI4C Bare Site</title></head>
<body><p>bare page without description or icon</p></body></html>`;

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/favicon.ico")) {
    // 1x1 透明 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    res.writeHead(200, { "content-type": "image/png" });
    res.end(png);
    return;
  }
  const html = url.startsWith("/bare") ? BARE : RICH;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(PORT, "127.0.0.1", () => console.log(`[stub-site] listening on 127.0.0.1:${PORT}`));
