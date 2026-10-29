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
import { join } from "node:path";

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
