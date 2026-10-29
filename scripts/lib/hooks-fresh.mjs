/**
 * 钩子生成物的新鲜度校验（纯逻辑，CLI 在 scripts/check-hooks-fresh.mjs）。
 *
 * 为什么需要：pre-commit / pre-push 的正文是 `scripts/install-git-hooks.mjs` 里的模板串，
 * 生成到 `.git/hooks/` 下（不在版本库里）。改了模板却忘记重装，本机跑的一直是旧钩子——
 * 新加的检查看起来「已经上了」，其实一次都没执行过。2026-10-29 实测：改完模板必须手动
 * 重装，否则选测测试跑的是旧生成物，全绿也不代表模板生效。
 *
 * 做法：安装时写一份清单（.git/hooks/.navhub-hooks.json），记录**模板源**与**四个生成物**
 * 的 sha256。判定只看两件事：
 *   1. 模板源的 hash 与清单不一致 ⇒ 模板改了没重装；
 *   2. 任一生成物的 hash 与清单不一致 ⇒ 钩子被手改过（或装的是别的版本）。
 * 不比较「重新渲染的结果」——那需要把安装脚本拆成可导入的渲染函数，成本与收益不成比例；
 * hash 足够回答「本机跑的是不是这份模板的产物」。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MANIFEST_VERSION = 1;
export const MANIFEST_NAME = ".navhub-hooks.json";

/** 安装脚本生成的四个文件；顺序用于输出 */
export const HOOK_FILES = ["pre-commit", "pre-push", "navhub-precommit-tests.mjs", "navhub-hook-node.sh"];

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * 生成清单（安装时调用）。
 * `source` 只记仓库相对路径——.git 下的文件不该出现本机绝对路径。
 */
export function buildManifest({ hooksDir, sourcePath, now = new Date() }) {
  const files = {};
  for (const name of HOOK_FILES) {
    const path = join(hooksDir, name);
    files[name] = existsSync(path) ? sha256File(path) : null;
  }
  return {
    version: MANIFEST_VERSION,
    source: "scripts/install-git-hooks.mjs",
    sourceSha256: existsSync(sourcePath) ? sha256File(sourcePath) : null,
    files,
    installedAt: new Date(now).toISOString(),
  };
}

/**
 * 对照本机钩子与清单。
 * @returns {{problems:string[], manifestPath:string}}
 */
export function checkFresh({ hooksDir, sourcePath, manifestPath = join(hooksDir, MANIFEST_NAME) }) {
  if (!existsSync(manifestPath)) {
    return {
      problems: [
        `缺少安装清单 ${MANIFEST_NAME} —— 钩子不是当前安装脚本生成的，无法判断是否与模板同源`,
      ],
      manifestPath,
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { problems: [`安装清单解析不了：${error.message}`], manifestPath };
  }

  const problems = [];
  if (manifest.version !== MANIFEST_VERSION) {
    problems.push(`清单 version 应为 ${MANIFEST_VERSION}，实际 ${manifest.version}`);
  }
  if (!existsSync(sourcePath)) {
    problems.push(`模板源不存在：${sourcePath}`);
    return { problems, manifestPath };
  }
  if (manifest.sourceSha256 !== sha256File(sourcePath)) {
    problems.push(
      "模板源 scripts/install-git-hooks.mjs 已改动，但本机钩子还是旧的 —— " +
        "跑 node scripts/install-git-hooks.mjs 重装后再提交",
    );
  }
  for (const name of HOOK_FILES) {
    const path = join(hooksDir, name);
    if (!existsSync(path)) {
      problems.push(`钩子文件缺失：${name}（重装：node scripts/install-git-hooks.mjs）`);
      continue;
    }
    if (manifest.files?.[name] !== sha256File(path)) {
      problems.push(`钩子文件与安装时不一致：${name}（手改无效，会被下次重装覆盖）`);
    }
  }
  return { problems, manifestPath };
}

/**
 * 镜像 prepare 阶段能不能跑起来：install-git-hooks.mjs 的**相对 import 闭包**
 * 必须全被 Dockerfile 的 COPY 覆盖。
 *
 * 为什么需要：Dockerfile.api / .web 都只 COPY 了 install-git-hooks.mjs 单个文件，
 * 靠根 package.json 的 prepare 在镜像里执行它。给它加一个 `./lib/x.mjs` 的 import，
 * 本机全绿，docker build 却在 install 阶段 ERR_MODULE_NOT_FOUND —— 2026-10-29 就这么红过
 * （9460971c 引入 ./lib/hooks-fresh.mjs，docker-smoke 的「构建 API 镜像」直接失败）。
 */
export const PREPARE_ENTRY = "scripts/install-git-hooks.mjs";

/** 镜像 prepare 依赖的 Dockerfile；有哪个判哪个（不存在的跳过） */
export const PREPARE_DOCKERFILES = ["docker/Dockerfile.api", "docker/Dockerfile.web"];

const RELATIVE_IMPORT_RE =
  /(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;

/** 抽出源码里的相对 import 说明符（静态 import / re-export / 动态 import()） */
export function relativeImports(source) {
  const out = new Set();
  for (const match of String(source).matchAll(RELATIVE_IMPORT_RE)) out.add(match[1]);
  return [...out];
}

/** 从入口沿相对 import 递归；路径统一成正斜杠的仓库相对形式 */
export function importClosure({ entry, readFile, exists, resolvePath = (from, spec) => join(dirname(from), spec) }) {
  const files = new Set();
  const missing = new Set();
  const queue = [entry.replace(/\\/g, "/")];
  while (queue.length > 0) {
    const file = queue.shift();
    if (files.has(file) || missing.has(file)) continue;
    let text;
    try {
      text = readFile(file);
    } catch {
      missing.add(file);
      continue;
    }
    files.add(file);
    for (const spec of relativeImports(text)) {
      const target = resolvePath(file, spec).replace(/\\/g, "/");
      if (!exists(target)) missing.add(target);
      else if (!files.has(target)) queue.push(target);
    }
  }
  return { files: [...files].sort(), missing: [...missing].sort() };
}

/** Dockerfile 里 COPY 的**源**路径（去掉 --from/--chown 之类的 flag 与末尾斜杠） */
export function copiedSources(dockerfileText) {
  const out = [];
  for (const raw of String(dockerfileText).split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line)) continue;
    const tokens = line
      .split(/\s+/)
      .slice(1)
      .filter((token) => !token.startsWith("--"));
    if (tokens.length < 2) continue;
    for (const src of tokens.slice(0, -1)) {
      out.push(src.replace(/^\.\//, "").replace(/\/+$/, ""));
    }
  }
  return out;
}

/**
 * 对照检查：闭包里的每个文件都要被某个 COPY 源覆盖（整目录 COPY 也算）。
 * Dockerfile 不存在时返回 skipped —— 调用方据此决定是否打印。
 */
export function prepareClosureProblems({ dockerfilePath, entry, readFile, exists }) {
  let text;
  try {
    text = readFile(dockerfilePath);
  } catch {
    return { problems: [], skipped: true, files: [] };
  }
  const copies = copiedSources(text);
  const closes = copies.some((src) => src === "");
  const { files, missing } = importClosure({ entry, readFile, exists });
  const problems = [];
  for (const file of missing) {
    problems.push(`${PREPARE_ENTRY} 的相对 import 解析不到：${file}`);
  }
  for (const file of files) {
    const covered = closes || copies.some((src) => file === src || file.startsWith(`${src}/`));
    if (!covered) {
      problems.push(
        `${dockerfilePath} 没把 ${file} 拷进镜像 —— prepare 阶段会 ERR_MODULE_NOT_FOUND（补一行 COPY ${file}）`,
      );
    }
  }
  return { problems, skipped: false, files };
}

