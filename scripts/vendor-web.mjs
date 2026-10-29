
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative } from "node:path";
import { walkAndCopy, pruneGeneratedDirs } from "./lib/walk-copy.mjs";

const ROOT = resolve(".");
const TARGET = join(ROOT, "apps", "web");
/**
 * 上游底座默认固定到具体 commit（升级建议 P0/近期项：构建可复现）。
 *
 * 以前默认 `main`：上游一push，同一个仓库标签就会产出不同的 apps/web，
 * Docker 与 CI 的产物不可复现，且上游坏提交会直接打挂我们的门禁。
 * 现在默认取 apps/web-overlay/UPSTREAM.md 记录的 commit；需要升级底座时：
 *   1. 显式传 ref 跑一次：node scripts/vendor-web.mjs <新 sha>
 *   2. 回归通过后把新 sha 写回 UPSTREAM.md（与 check-upstream-ref.mjs 的校验同源）
 * codeload 的 /tar.gz/<ref> 对 branch / tag / sha 都有效，因此下面的 URL 不再拼 refs/heads/。
 */
const DEFAULT_REF = "6ba74fab9f86aa6ba4e276c002128a8f5a0acc0a";
const REF = process.argv[2] || process.env.NAVSPHERE_REF || DEFAULT_REF;
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
// 缓存文件按 ref 命名：升级底座（换 sha）时不会误用旧 ref 的缓存；
// 只有不可变 ref（40 位 sha）才允许复用缓存，分支/tag 情况一律重新下载。
const url = "https://codeload.github.com/tianyaxiang/NavSphere/tar.gz/" + REF;
const refKey = REF.replace(/[^0-9a-zA-Z._-]/g, "").slice(0, 16) || "default";
const tgz = join(ROOT, ".vendor-ns-" + refKey + ".tgz");
const immutableRef = /^[0-9a-f]{40}$/i.test(REF);

async function downloadTarball() {
  console.log("[vendor] downloading " + url);
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: API, signal: AbortSignal.timeout(60000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(tgz, buf);
        console.log("[vendor] downloaded " + (buf.length / 1024).toFixed(0) + " KB");
        return;
      }
      console.warn("[vendor] HTTP " + res.status + " (attempt " + (i + 1) + "/3)");
    } catch (e) {
      if (i === 2) {
        // fetch 失败（本机代理/证书链问题）时回退到系统 curl：
        // Windows 的 Schannel 需要 --ssl-no-revoke 跳过吊销检查，Linux/macOS 不认识该参数
        const curl = process.platform === "win32" ? "curl.exe" : "curl";
        const curlArgs = ["-L", "--fail", "-o", tgz, url];
        if (process.platform === "win32") curlArgs.splice(1, 0, "--ssl-no-revoke");
        console.warn("[vendor] fetch failed (" + e.message + "), falling back to " + curl);
        try {
          execFileSync(curl, curlArgs, { stdio: "inherit" });
          return;
        } catch (curlErr) {
          console.error("[vendor] download failed via fetch and curl", curlErr);
          process.exit(1);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  console.error("[vendor] download failed after 3 attempts");
  process.exit(1);
}

let reusedCache = false;
if (immutableRef && existsSync(tgz)) {
  try {
    const size = statSync(tgz).size;
    if (size > 100 * 1024) {
      console.log("[vendor] reusing cached " + tgz + " (" + (size / 1024).toFixed(0) + " KB)");
      reusedCache = true;
    }
  } catch { /* 读不到当作无缓存 */ }
}
if (!reusedCache) await downloadTarball();

// 3) extract to a staging dir（缓存损坏时删掉重下一次，只自愈一次）
const stage = join(ROOT, ".vendor-stage");
for (let attempt = 0; ; attempt++) {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  try {
    execFileSync("tar", ["-xzf", tgz, "-C", stage], { stdio: "inherit" });
    break;
  } catch (e) {
    if (attempt >= 1) {
      console.error("[vendor] tarball extract failed: " + e);
      process.exit(1);
    }
    console.warn("[vendor] cached tarball unusable; re-downloading once");
    rmSync(tgz, { force: true });
    await downloadTarball();
  }
}
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

// 4b) NavHub 自有文件清单：git 跟踪的 apps/web/*（即 overlay + package.json /
// next.config.js 等手改文件）。上游 tarball 会覆盖这些同名文件——历史上曾把
// React 19 的 package.json 打回上游的 React 18，导致 CI frozen-lockfile 全红。
// 因此上游拷贝时跳过它们（overlay 步骤随后仍会覆盖 overlay 拥有的文件）。
// UPSTREAM.md 除外：它是本脚本每次生成的来源记录，必须重写。
// 注意：如果目标位置不存在该文件则仍正常拷贝（全新目录 / Docker 构建不受影响）。
let ownedRelPaths = new Set();
try {
  const tracked = execFileSync("git", ["ls-files", "--", "apps/web"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split("\n").map((s) => s.trim()).filter(Boolean);
  for (const t of tracked) {
    if (t === "apps/web/UPSTREAM.md") continue;
    if (t.startsWith("apps/web/")) ownedRelPaths.add(t.slice("apps/web/".length));
  }
  console.log("[vendor] preserving " + ownedRelPaths.size + " NavHub-owned tracked files");
} catch {
  // 无 .git 时回退（Docker 构建上下文默认排除 .git）：用 overlay 文件列表 +
  // 已知的根级手改文件推导。目标目录初始为空时跳过逻辑自然不生效。
  console.log("[vendor] no git history; deriving owned-file list from overlay");
  const walk = (dir, base) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, base);
      else ownedRelPaths.add(relative(base, p).split("\\").join("/"));
    }
  };
  walk(OVERLAY, TARGET);
  ownedRelPaths.add("package.json");
  ownedRelPaths.add("next.config.js");
  ownedRelPaths.delete("UPSTREAM.md");
}

// 5) copy upstream over the target
// 注意：不用 cpSync(src, dst, { recursive: true }) 一次性拷目录——
// 在部分 Windows 环境下递归 cpSync 会 EIO（Access is denied），而单文件
// cpSync 正常；这里复用与 overlay 相同的逐文件 walkAndCopy，可靠且跨平台。
// 另：walkAndCopy 本身按名字跳过 node_modules / .next，因此只清构建缓存 .next，
// 不动 node_modules（CI 的 install 早于 vendor，删了就没有任何东西再装回来）。
pruneGeneratedDirs(TARGET, { log: console.log });
const upstreamCounter = { count: 0 };
walkAndCopy(inner, TARGET, { targetRoot: TARGET, skipRel: ownedRelPaths, counter: upstreamCounter, log: console.log });
console.log("[vendor] copied upstream: " + upstreamCounter.count + " files");

// 6) apply NavHub overlay (storage seam + all self-built pages/components)
const overlayCounter = { count: 0 };
walkAndCopy(OVERLAY, TARGET, { targetRoot: TARGET, counter: overlayCounter, log: console.log });
console.log("[vendor] applied overlay: " + overlayCounter.count + " files");

// 6b) prune obsolete/redundant upstream artifacts (Cloudflare/docker duplicates, unused docs)
// src/middleware.ts：Next 16 起 middleware 更名为 proxy（运行时固定 nodejs），overlay 的
// 事实源已是 src/proxy.ts；上游 tarball 仍带 middleware.ts，且 overlay 不再 own 它，
// 不修剪会让 vendored 产物里 middleware/proxy 并存（Next 16 直接报错）。
// .eslintrc.json：ESLint 已迁扁平配置（eslint.config.mjs，见 next-lint-to-eslint-cli
// codemod），上游的 eslintrc 属陈旧格式；ESLint 9+ 本身不读它，修剪只为避免歧义。
for (const rel of [
  "_worker.js",
  "wrangler.toml",
  "vercel.json",
  "pnpm-lock.yaml",
  "README-CN.md",
  "README-EN.md",
  "doc",
  "docker",
  "docs",
  "functions",
  "src/middleware.ts",
  ".eslintrc.json",
]) {
  const p = join(TARGET, rel);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

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
