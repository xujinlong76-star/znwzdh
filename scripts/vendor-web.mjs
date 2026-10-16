
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, cpSync, copyFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(".");
const TARGET = join(ROOT, "apps", "web");
const REF = process.argv[2] || "main";
const API = { "User-Agent": "navhub" };

console.log("[vendor] ref=" + REF);

// 1) upstream revision
let sha = "unknown";
try {
  const r = await fetch("https://api.github.com/repos/tianyaxiang/NavSphere/commits/" + REF, { headers: API });
  if (r.ok) sha = (await r.json()).sha;
} catch { /* offline ok */ }
console.log("[vendor] upstream sha=" + sha);

// 2) download tarball
const url = "https://codeload.github.com/tianyaxiang/NavSphere/tar.gz/refs/heads/" + REF;
console.log("[vendor] downloading " + url);
let res;
for (let i = 0; i < 3; i++) {
  try {
    res = await fetch(url, { headers: API, signal: AbortSignal.timeout(60000) });
    if (res.ok) break;
  } catch (e) {
    if (i === 2) { console.error("[vendor] download failed", e); process.exit(1); }
  }
  await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
}
if (!res || !res.ok) { console.error("[vendor] download failed HTTP " + (res?.status || "error")); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
const tgz = join(ROOT, ".vendor-ns.tgz");
writeFileSync(tgz, buf);
console.log("[vendor] downloaded " + (buf.length / 1024).toFixed(0) + " KB");

// 3) extract to a staging dir
const stage = join(ROOT, ".vendor-stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
execFileSync("tar", ["-xzf", tgz, "-C", stage], { stdio: "inherit" });
const inner = readdirSync(stage).map((d) => join(stage, d)).find((p) => {
  try { return readdirSync(p).length > 0; } catch { return false; }
});
if (!inner) { console.error("[vendor] nothing extracted"); process.exit(1); }

// 4) preserve NavHub-owned files: the whole overlay is applied AFTER the
//    upstream copy, so overlay always wins (single source of truth).
const OVERLAY = join(ROOT, "apps", "web-overlay");
if (!existsSync(OVERLAY)) {
  console.error("[vendor] overlay not found: " + OVERLAY);
  process.exit(1);
}

// 5) copy upstream over the target
// 注意：不用 cpSync(src, dst, { recursive: true }) 一次性拷目录——
// 在部分 Windows 环境下递归 cpSync 会 EIO（Access is denied），而单文件
// cpSync 正常；这里复用与 overlay 相同的逐文件 walkAndCopy，可靠且跨平台。
// 另：先删掉本地生成的 node_modules/.next（pnpm 的 junction 会让任何
// 覆盖式拷贝失败；上游 tarball 本来就没有这两个目录）。
for (const generated of ["node_modules", ".next"]) {
  const p = join(TARGET, generated);
  if (existsSync(p)) {
    console.log("[vendor] removing stale " + generated);
    rmSync(p, { recursive: true, force: true });
  }
}
function walkAndCopy(srcDir, dstDir, counter) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const s = join(srcDir, entry.name);
    const d = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      walkAndCopy(s, d, counter);
    } else if (entry.isSymbolicLink()) {
      // 上游 tarball 理论上不含符号链接；真遇到时走 cpSync 原样复制链接本身
      cpSync(s, d, { force: true });
      if (counter) counter.count++;
    } else {
      // 覆盖写优先用 copyFileSync（截断写入，不走 unlink）。
      // Windows 上 cpSync({ force: true }) 的 unlink 路径会被 Defender/OneDrive
      //  filter 驱动干扰，报 errno 0 的怪异错误；copyFileSync 无此问题。
      // 仍失败（如目标是目录等极端情况）再回退到删后拷。
      const deadline = Date.now() + 20_000;
      let attempt = 0;
      for (;;) {
        try {
          if (attempt > 0) console.log("[vendor] retry copy " + entry.name + " (attempt " + (attempt + 1) + ")");
          copyFileSync(s, d);
          break;
        } catch (e) {
          attempt++;
          const fallbackOk = (() => {
            try {
              rmSync(d, { force: true, recursive: true });
              cpSync(s, d, { force: true });
              return true;
            } catch { return false; }
          })();
          if (fallbackOk) break;
          if (Date.now() >= deadline) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(2000, 200 * attempt));
        }
      }
      if (counter) counter.count++;
    }
  }
}
const upstreamCounter = { count: 0 };
walkAndCopy(inner, TARGET, upstreamCounter);
console.log("[vendor] copied upstream: " + upstreamCounter.count + " files");

// 6) apply NavHub overlay (storage seam + all self-built pages/components)
const overlayCounter = { count: 0 };
walkAndCopy(OVERLAY, TARGET, overlayCounter);
console.log("[vendor] applied overlay: " + overlayCounter.count + " files");

// 7) write UPSTREAM.md
writeFileSync(join(TARGET, "UPSTREAM.md"), [
  "# NavSphere upstream",
  "",
  "This directory is derived from [NavSphere](https://github.com/tianyaxiang/NavSphere) (MIT licensed).",
  "",
  "- Upstream ref: " + REF,
  "- Upstream commit: " + sha,
  "- Vendored at: " + new Date().toISOString(),
  "- Re-vendor: node scripts/vendor-web.mjs",
  "",
  "NavHub-owned files live in apps/web-overlay/ (applied on top of upstream):",
  "- src/lib/storage-adapter.ts -- storage seam (github | http | sqlite)",
  "- src/lib/github.ts -- facade keeping upstream's two-function signature",
  "- src/lib/navhub-api.ts, src/lib/identity.ts, src/hooks/useFavorites.ts",
  "- src/components/search-palette.tsx, favorite-button.tsx, ...",
  "- src/app/tags|hot|favorites|site/[id]|admin/jobs|admin/stats pages",
  "",
].join("\n"), "utf8");

rmSync(tgz, { force: true });
rmSync(stage, { recursive: true, force: true });

const files = readdirSync(TARGET);
console.log("[vendor] done. apps/web entries: " + files.length);
console.log("[vendor] " + files.slice(0, 18).join(", "));
