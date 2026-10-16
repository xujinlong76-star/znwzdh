/**
 * 上游底座 ref 一致性校验（升级建议：构建可复现）。
 *
 * 校验三处"上游 commit"声明同源且彼此相等：
 *   1. scripts/vendor-web.mjs 的 DEFAULT_REF（本地 / CI vendor 的默认来源）
 *   2. docker/Dockerfile.web 的 ARG NAVSPHERE_REF 默认值（镜像构建来源）
 *   3. apps/web-overlay/UPSTREAM.md 记录的 Upstream commit（人工事实源）
 * 若 apps/web/UPSTREAM.md 已生成（vendor 之后），再额外校验它记录的 commit 未漂移。
 *
 * 升级底座的正确顺序：显式传 ref 跑 vendor → 回归通过 → 把新 sha 同时写回上面 1/2/3。
 * 只改一处会让本脚本失败，正是它存在的意义：防止"本地和镜像拉的不是同一份上游"。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SHA_RE = /\b[0-9a-f]{40}\b/;

function firstSha(file) {
  if (!existsSync(file)) return null;
  const m = readFileSync(file, "utf8").match(SHA_RE);
  return m ? m[0] : null;
}

const sources = [
  { name: "scripts/vendor-web.mjs (DEFAULT_REF)", file: join(ROOT, "scripts", "vendor-web.mjs"), sha: null },
  { name: "docker/Dockerfile.web (ARG NAVSPHERE_REF)", file: join(ROOT, "docker", "Dockerfile.web"), sha: null },
  { name: "apps/web-overlay/UPSTREAM.md", file: join(ROOT, "apps", "web-overlay", "UPSTREAM.md"), sha: null },
];
for (const s of sources) s.sha = firstSha(s.file);

let bad = false;
for (const s of sources) {
  if (!s.sha) {
    console.error("[upstream-ref] 未找到 40 位 commit: " + s.name);
    bad = true;
  }
}
if (!bad) {
  const uniq = new Set(sources.map((s) => s.sha));
  if (uniq.size !== 1) {
    console.error("[upstream-ref] 上游 commit 声明不一致：");
    for (const s of sources) console.error("  - " + s.sha + "  " + s.name);
    console.error("修复：把新 sha 同时写回 scripts/vendor-web.mjs、docker/Dockerfile.web、apps/web-overlay/UPSTREAM.md");
    bad = true;
  } else {
    console.log("[upstream-ref] 三处声明一致：" + sources[0].sha);
  }
}

// 已 vendor 的情况下校验实际产物未漂移（apps/web 是 gitignore 的生成物，可不存在）
const vendored = join(ROOT, "apps", "web", "UPSTREAM.md");
if (existsSync(vendored)) {
  const sha = firstSha(vendored);
  const want = sources[0]?.sha;
  if (sha && want && sha !== want) {
    console.error("[upstream-ref] apps/web/UPSTREAM.md 记录的 commit 与声明不一致：" + sha + " != " + want + "（需重新 vendor）");
    bad = true;
  } else {
    console.log("[upstream-ref] 已 vendored 产物未漂移：" + sha);
  }
} else {
  console.log("[upstream-ref] apps/web 未 vendor，跳过产物比对");
}

if (bad) {
  console.error("❌ [upstream-ref] 校验失败");
  process.exit(1);
}
console.log("✅ [upstream-ref] 上游 ref 一致性校验通过");
