/**
 * core → 前端运行时镜像的纯逻辑（sync-core-mirrors.mjs 的核心，抽成模块以便单测）。
 *
 * 背景：apps/web 是独立安装的 vendored 底座（package.json 里没有任何 @navhub/* 依赖），
 * 无法 import workspace 包，因此 packages/core 的纯算法必须在
 * apps/web-overlay/src/lib/ 保留一份运行时副本。历史上这份副本靠"手工同步"，
 * 结果 13 个文件里 9 个已经悄悄漂移（knowledge-graph 前端缺 computeGraphCentrality、
 * visual-fingerprint 缺 colorDistance、dynamic-tool-synthesizer 缺 IP 编码防护）。
 *
 * 本模块把"手工同步"变成"受控生成 + 字节级校验"：
 *   - 事实源：packages/core/src/<name>.ts
 *   - 生成物：apps/web-overlay/src/lib/<name>.ts 与 apps/web/src/lib/<name>.ts
 *   - 校验：剥掉生成横幅后，两侧必须逐字节一致（CRLF 归一后）
 *
 * 只放纯逻辑（无 process.exit、无副作用 I/O 之外的东西），I/O 由脚本负责。
 * 读 git 提交内容的闸门（scripts/check-core-mirrors.mjs）只能查 overlay 这条腿，
 * 因为 apps/web/src 整棵树被 gitignore——见 planSync 的 `legs`。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** 横幅起止标记：parity 比对时剥除，与 plugin-manifest 的 parity-ignore 同款思路 */
export const PARITY_START = "// @core-mirror:parity-ignore-start";
export const PARITY_END = "// @core-mirror:parity-ignore-end";

export const OVERLAY_LIB = "apps/web-overlay/src/lib";
export const WEB_LIB = "apps/web/src/lib";

/**
 * 生成镜像文件的头部横幅。
 * @param {string} sourceRel 相对仓库根的事实源路径（posix）
 */
export function buildBanner(sourceRel) {
  return [
    PARITY_START,
    "// 本文件由 scripts/sync-core-mirrors.mjs 自动生成，请勿手工编辑。",
    `// 事实源：${sourceRel}`,
    "// 同步命令：node scripts/sync-core-mirrors.mjs",
    "// 一致性守门：node scripts/sync-core-mirrors.mjs --check（CI 可加）",
    PARITY_END,
    "",
  ].join("\n");
}

/** 剥掉生成横幅（含标记行本身），用于 parity 比对 */
export function stripBanner(text) {
  const s = text.indexOf(PARITY_START);
  const e = text.indexOf(PARITY_END);
  if (s === -1 || e === -1) return text;
  // 横幅后紧跟的换行也一并剥掉，否则比对时多一个前导空行
  return text.slice(e + PARITY_END.length).replace(/^\r?\n+/, "");
}

/** CRLF -> LF，并去掉首尾多余空行（跨平台换行不算漂移） */
export function normalize(text) {
  return text.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

/** 事实源正文 -> 镜像文件完整内容 */
export function composeMirror(sourceText, sourceRel) {
  return buildBanner(sourceRel) + sourceText.replace(/\r\n/g, "\n");
}

/** 清单条目 -> 事实源相对路径 */
export function sourcePathOf(entry) {
  return entry.source ?? `packages/core/src/${entry.name}.ts`;
}

/** 清单条目 -> overlay 目标相对路径 */
export function overlayPathOf(entry) {
  return entry.target ?? `${OVERLAY_LIB}/${entry.name}.ts`;
}

/** 清单条目 -> apps/web 目标相对路径（vendor 镜像，overlay 路径的平行替换） */
export function webPathOf(entry) {
  return overlayPathOf(entry).replace("apps/web-overlay/", "apps/web/");
}

/**
 * 逐条目计算「应该写成什么 / 现在是否已一致」。
 * @param {object[]} entries core-mirrors.json 的 verbatim 数组
 * @param {object} io
 * @param {(p: string) => boolean} io.exists
 * @param {(p: string) => string} io.read
 * @param {object} [opts]
 * @param {("overlay"|"web")[]} [opts.legs] 只查这些生成腿。
 *   默认两条都查（写盘/工作区校验的正确口径）。读 git ref 的闸门必须传
 *   `["overlay"]`：`apps/web/src` 整棵树被 gitignore（`.gitignore:45`），
 *   提交里根本不存在这条腿，按默认口径查会永远报「web 缺失」——那是假红灯。
 */
export function planSync(entries, io = { exists: existsSync, read: readFileSync }, opts = {}) {
  const legs = opts.legs ?? ["overlay", "web"];
  return entries.map((entry) => {
    const source = sourcePathOf(entry);
    const overlay = overlayPathOf(entry);
    const web = webPathOf(entry);
    const plan = { name: entry.name, source, overlay, web, status: "write", reasons: [] };

    if (!io.exists(source)) {
      plan.status = "missing-source";
      plan.reasons.push(`事实源不存在：${source}`);
      return plan;
    }
    const sourceText = io.read(source);
    if (normalize(sourceText).trim() === "") {
      plan.status = "empty-source";
      plan.reasons.push(`事实源为空：${source}`);
      return plan;
    }
    const expected = normalize(composeMirror(sourceText, source));

    for (const [label, rel] of [["overlay", overlay], ["web", web]]) {
      if (!legs.includes(label)) continue;
      if (!io.exists(rel)) {
        plan.reasons.push(`${label} 缺失：${rel}`);
      } else if (normalize(stripBanner(io.read(rel))) !== normalize(sourceText)) {
        plan.reasons.push(`${label} 与事实源不一致：${rel}`);
      }
    }
    if (plan.reasons.length === 0) plan.status = "ok";
    plan.expected = expected;
    return plan;
  });
}

/**
 * 校验模式：返回失败清单（为空即全部一致）。
 * @param {object[]} entries
 * @param {object} io
 * @param {object} [opts] 透传给 planSync（`legs`）
 */
export function checkMirrors(entries, io = { exists: existsSync, read: readFileSync }, opts = {}) {
  const plans = planSync(entries, io, opts);
  const failures = plans.filter((p) => p.status !== "ok");
  return { ok: failures.length === 0, plans, failures };
}

/**
 * 读清单并按 mode 分组。
 * @param {string} manifestJson
 */
export function parseManifest(manifestJson) {
  const manifest = JSON.parse(manifestJson);
  return {
    verbatim: manifest.verbatim ?? [],
    adapter: manifest.adapter ?? [],
    external: manifest.external ?? [],
  };
}

/** 把仓库根相对路径拼成绝对路径 */
export function abs(root, rel) {
  return join(root, rel);
}
