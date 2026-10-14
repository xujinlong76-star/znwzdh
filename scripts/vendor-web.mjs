
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, cpSync, readdirSync } from "node:fs";
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
const res = await fetch(url, { headers: API });
if (!res.ok) { console.error("[vendor] download failed HTTP " + res.status); process.exit(1); }
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
cpSync(inner, TARGET, { recursive: true, force: true });

// 6) apply NavHub overlay (storage seam + all self-built pages/components)
const overlayFiles = [];
(function walkAndCopy(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const s = join(srcDir, entry.name);
    const d = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      walkAndCopy(s, d);
    } else {
      cpSync(s, d, { force: true });
      overlayFiles.push(entry.name);
    }
  }
})(OVERLAY, TARGET);
console.log("[vendor] applied overlay: " + overlayFiles.length + " files");

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
