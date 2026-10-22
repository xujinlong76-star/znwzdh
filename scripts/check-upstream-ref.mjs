/**
 * 上游底座 ref 一致性校验（升级建议：构建可复现）。
 *
 * 校验四处"上游 commit"声明同源且彼此相等：
 *   1. scripts/vendor-web.mjs 的 DEFAULT_REF（本地 / CI vendor 的默认来源）
 *   2. docker/Dockerfile.web 的 ARG NAVSPHERE_REF 默认值（镜像构建来源）
 *   3. apps/web-overlay/UPSTREAM.md 记录的 Upstream commit（人工事实源）
 *   4. docker/docker-compose.yml 里 web 服务的 build arg 默认值
 * 若 apps/web/UPSTREAM.md 已生成（vendor 之后），再额外校验它记录的 commit 未漂移。
 *
 * 第 4 处是后加的：compose 曾经写 `${NAVSPHERE_REF:-main}`，默认值直接覆盖掉镜像里的
 * pin，于是"按 --profile web 构建"这条最常用的路径拉的是**会动的 main 分支**，
 * 前三处一致也没用（同一个标签的镜像每次构建内容不同）。
 *
 * 升级底座的正确顺序：显式传 ref 跑 vendor → 回归通过 → 把新 sha 同时写回上面 1/2/3/4。
 * 只改一处会让本脚本失败，正是它存在的意义：防止"本地和镜像拉的不是同一份上游"。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SHA_RE = /\b[0-9a-f]{40}\b/;

function firstSha(file, pick) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  if (pick) {
    // 只认这一处声明，且必须是 sha —— 写成 main/分支名时返回 null，
    // 让下面"未找到 40 位 commit"那条硬失败把它拦下
    const m = text.match(pick);
    return m && m[1] && SHA_RE.test(m[1]) ? m[1] : null;
  }
  const m = text.match(SHA_RE);
  return m ? m[0] : null;
}

const sources = [
  { name: "scripts/vendor-web.mjs (DEFAULT_REF)", file: join(ROOT, "scripts", "vendor-web.mjs"), sha: null },
  { name: "docker/Dockerfile.web (ARG NAVSPHERE_REF)", file: join(ROOT, "docker", "Dockerfile.web"), sha: null },
  { name: "apps/web-overlay/UPSTREAM.md", file: join(ROOT, "apps", "web-overlay", "UPSTREAM.md"), sha: null },
  {
    name: "docker/docker-compose.yml (web build arg NAVSPHERE_REF)",
    file: join(ROOT, "docker", "docker-compose.yml"),
    pick: /NAVSPHERE_REF:\s*\$\{NAVSPHERE_REF:-([^}]*)\}/,
    sha: null,
  },
];
for (const s of sources) s.sha = firstSha(s.file, s.pick);

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
    console.error("修复：把新 sha 同时写回 scripts/vendor-web.mjs、docker/Dockerfile.web、apps/web-overlay/UPSTREAM.md、docker/docker-compose.yml");
    bad = true;
  } else {
    console.log("[upstream-ref] " + sources.length + " 处声明一致：" + sources[0].sha);
  }
}

// 已 vendor 的情况下校验实际产物未漂移（apps/web 是 gitignore 的生成物，可不存在）
const vendored = join(ROOT, "apps", "web", "UPSTREAM.md");
if (existsSync(vendored)) {
  const sha = firstSha(vendored);
  const want = sources[0]?.sha;
  if (!sha) {
    // 原先走 else 分支打印「产物未漂移：null」并放行：vendored 记录一旦被删或改写走样，
    // 这道门禁就自动变绿——正是它该拦的那种情况
    console.error("[upstream-ref] apps/web/UPSTREAM.md 存在但没有 40 位 commit 记录（需重新 vendor）");
    bad = true;
  } else if (want && sha !== want) {
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
