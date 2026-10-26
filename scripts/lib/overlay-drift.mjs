/**
 * 覆盖层 / vendored 底座的漂移比对（check-web-overlay.mjs 的核心逻辑，抽成模块以便单测）。
 *
 * 为什么值得单测：这个检查是 overlay ↔ apps/web 唯一的一致性闸门，
 * 一旦它自己悄悄"变宽松"（比如排除规则写错、CRLF 归一化失效、反向候选被误判成失败），
 * 漂移就会静默进仓库，然后在 vendor / 镜像构建时丢掉自研改动（真实事故：apps/web 的
 * React 19 / TS 5.9 手改被上游 tarball 覆盖，CI frozen-lockfile 全红）。
 *
 * 这里只放纯逻辑（无 process.exit、无 git、无网络），由脚本负责 I/O 之外的判断。
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

// ---- 排除规则：与 scripts/sync-web-overlay.mjs 的 isExcluded() 保持一致 ----
// （不能直接 import 它：sync 脚本顶层就会下载上游 tarball 有副作用。
//  改了那边的规则，记得同步改这里。）
// 不进 overlay 的目录/文件（构建产物、第三方资产、依赖、生成文件）
const EXCLUDE = new Set(["node_modules", "dist", "out", "coverage"]);
const EXCLUDE_PREFIX = ["public/assets/images/logos/", "public/fonts/"];
const EXCLUDE_SUFFIX = [".tsbuildinfo", ".log", ".err", "build-log.txt"];

/** 该相对路径是否不参与镜像比对（构建产物 / 生成文件 / 第三方资产） */
export function isExcluded(rel) {
  const norm = rel.replaceAll("\\", "/");
  if (norm.startsWith(".vendor")) return true;
  if (norm.includes("debug-sync") || norm.endsWith("build-log.txt")) return true;
  const segments = norm.split("/");
  for (const seg of segments) {
    // .next*（含 .next-pwa2 等验证产物）、.fe.* 等隐藏生成物
    if (seg.startsWith(".next") || seg.startsWith(".fe.") || seg === ".turbo" || seg === ".cache") return true;
  }
  for (const d of EXCLUDE) if (segments.includes(d)) return true;
  for (const p of EXCLUDE_PREFIX) if (norm.startsWith(p)) return true;
  for (const s of EXCLUDE_SUFFIX) if (norm.endsWith(s)) return true;
  if (norm === "next-env.d.ts") return true; // next 生成文件
  if (norm === "UPSTREAM.md") return true; // vendor-web 生成的元数据（每次带时间戳/commit，不参与镜像比对）
  return false;
}

/** 二进制判定：前 8KB 含 NUL 字节即按二进制处理 */
export function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 文本归一化：CRLF -> LF 后比较（跨平台换行不算漂移） */
export function normText(buf) {
  return buf.toString("utf8").replace(/\r\n/g, "\n");
}

/** 内容一致：二进制比 sha256，文本比 CRLF 归一后的字符串 */
export function sameContent(a, b) {
  if (isBinary(a) || isBinary(b)) return sha256(a) === sha256(b);
  return normText(a) === normText(b);
}

/**
 * 构建期会被就地改写的配置文件（相对 overlay/target 的路径）。
 *
 * 为什么 tsconfig.json 要特殊处理：apps/web/tsconfig.json 是 gitignored 的 vendored 副本，
 * next dev / next build 会往它的 include 数组里追加「本次 DIST_DIR 对应的类型目录」。
 * 本轮实测（2026-10-27 02:05）：overlay 侧 include 的最后一项是 .next-e2e 的 dev/types，
 * apps/web 侧多出 4 项——.next-verify87 与 .next-uibuild6 各自的 types 与 dev/types，
 * 都是其它会话用 NEXT_DIST_DIR 跑构建留下的；外加 include 这一行的缩进也被改写。
 *
 * 这不是源码漂移，但 scripts/verify.mjs:86 跑的是整树比对且不认「局部」：
 * 只要本地跑过一次带自定义 DIST_DIR 的构建，pnpm verify 就永远是红的，
 * 而长红的闸门真正的代价是逼人 --fix 覆盖别人的工作树、或者干脆跳过门禁。
 *
 * 归一只做两件有界的事，其余差异一律照旧算漂移：
 *   1) 丢弃 include 里指向 `.next*` 的生成项（与 isExcluded 对路径段的口径一致：
 *      .next / .next-e2e / .next-verify87 这类目录本身就不进镜像比对）；
 *   2) 折叠空白（Next 重写时会改缩进、也会在删除项后留下换行差异）。
 * 注释本身仍然参与比对，所以「改了 compilerOptions / 改了非生成项 / 改了注释」都会被抓出来。
 */
const BUILD_INJECTED_CONFIGS = new Set(["tsconfig.json"]);

/** 该路径是否属于「构建会就地改写」的配置文件 */
export function isBuildInjectedConfig(rel) {
  return BUILD_INJECTED_CONFIGS.has(rel.replaceAll("\\", "/"));
}

/** 指向 .next* 生成目录的字符串项（数组里独占一项，可跨行） */
const GENERATED_ENTRY_WITH_COMMA = /"\.next[^"]*"\s*,/g;
const GENERATED_ENTRY_TRAILING = /,?\s*"\.next[^"]*"/;
const GENERATED_ENTRY_SOLO = /\[\s*"\.next[^"]*"\s*\]/g;

/**
 * @param {string} rel 相对 overlay 的 posix 路径
 * @param {Buffer|string} buf 文件内容
 * @returns {string|null} 归一后的文本；null 表示该文件不做归一（按严格文本比对）
 */
export function normBuildInjectedConfig(rel, buf) {
  if (!isBuildInjectedConfig(rel)) return null;
  let text = normText(buf);
  // 反复删除「带尾随逗号的生成项」直到不动点，处理连续多项的情况
  for (let prev; prev !== text; ) {
    prev = text;
    text = text.replace(GENERATED_ENTRY_WITH_COMMA, "");
  }
  text = text.replace(GENERATED_ENTRY_SOLO, "[]");
  // 数组最后一项是生成项：连同它前面的逗号一起去掉
  while (GENERATED_ENTRY_TRAILING.test(text)) {
    text = text.replace(GENERATED_ENTRY_TRAILING, "");
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 递归列出目录里的文件（相对 base 的 posix 路径），跳过排除规则命中的项。
 * @param {string} dir
 * @param {{base?: string, exclude?: (rel: string) => boolean}} [options]
 */
export function walkTree(dir, options = {}) {
  const base = options.base ?? dir;
  const exclude = options.exclude ?? isExcluded;
  const out = [];
  const rec = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      const rel = relative(base, p).replaceAll("\\", "/");
      if (exclude(rel)) continue;
      if (entry.isDirectory()) rec(p);
      else out.push(rel);
    }
  };
  rec(dir);
  return out.sort();
}

/**
 * 正向（严格）：overlay 的每个文件在 target 里必须存在且内容一致。
 * 反向（告警）：target 里有、overlay 里没有的文件（可能是"忘了同步的自研文件"，
 * 也可能"与上游一致无需进 overlay"，不联网无法区分，所以只列候选）。
 *
 * @param {object} args
 * @param {string} args.overlayDir
 * @param {string} args.targetDir
 * @param {string[]} [args.docFiles=["README.md"]] 不参与镜像的文档
 * @param {Function} [args.readFile=readFileSync]
 */
export function diffOverlay({ overlayDir, targetDir, docFiles = ["README.md"], readFile = readFileSync }) {
  const docSet = new Set(docFiles);
  const overlayFiles = walkTree(overlayDir).filter((rel) => !docSet.has(rel));

  const missing = [];
  const drifted = [];
  for (const rel of overlayFiles) {
    const targetPath = join(targetDir, rel);
    if (!existsSync(targetPath)) {
      missing.push(rel);
      continue;
    }
    const a = readFile(join(overlayDir, rel));
    const b = readFile(targetPath);
    const binary = isBinary(a) || isBinary(b);
    const left = binary ? null : normBuildInjectedConfig(rel, a);
    const right = binary ? null : normBuildInjectedConfig(rel, b);
    const same = binary ? sha256(a) === sha256(b) : (left ?? normText(a)) === (right ?? normText(b));
    if (!same) {
      drifted.push({
        rel,
        kind: binary
          ? `二进制不一致（sha256 overlay=${sha256(a).slice(0, 12)}… web=${sha256(b).slice(0, 12)}…）`
          : left === null
            ? "文本内容漂移（已做 CRLF 归一，仍不一致）"
            : "文本内容漂移（已归一构建生成项与空白，仍不一致）",
      });
    }
  }

  const overlaySet = new Set(overlayFiles);
  const targetFiles = existsSync(targetDir) ? walkTree(targetDir) : [];
  const reverseCandidates = targetFiles.filter((rel) => !docSet.has(rel) && !overlaySet.has(rel));

  return { overlayFiles, missing, drifted, reverseCandidates };
}

/**
 * 硬化：被 git 跟踪的 apps/web 文件（= 自研，见 .gitignore 白名单）必须出现在 overlay 里，
 * 否则重新 vendor / 构建镜像时会被上游覆盖丢失。
 * @param {string[]} trackedRelPaths 相对 apps/web 的 posix 路径
 * @param {Iterable<string>} overlayRelPaths
 */
export function findOwnedOrphans(trackedRelPaths, overlayRelPaths) {
  const known = new Set(overlayRelPaths);
  return trackedRelPaths
    .filter((rel) => rel && rel !== "UPSTREAM.md" && !isExcluded(rel))
    .filter((rel) => !known.has(rel));
}
