
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

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

// 4) preserve NavHub-owned files
mkdirSync(join(TARGET, "src", "lib"), { recursive: true });
const adapter = join(TARGET, "src", "lib", "storage-adapter.ts");
const adapterBackup = existsSync(adapter) ? readFileSync(adapter) : null;

// 5) copy upstream over the target
cpSync(inner, TARGET, { recursive: true, force: true });

// 6) restore NavHub-owned files
if (adapterBackup) writeFileSync(adapter, adapterBackup);
console.log("[vendor] restored src/lib/storage-adapter.ts");

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
  "NavHub-owned files (do not overwrite from upstream):",
  "- src/lib/storage-adapter.ts -- storage seam (github | http | sqlite)",
  "",
].join("\n"), "utf8");

rmSync(tgz, { force: true });
rmSync(stage, { recursive: true, force: true });

const files = readdirSync(TARGET);
console.log("[vendor] done. apps/web entries: " + files.length);
console.log("[vendor] " + files.slice(0, 18).join(", "));
