/**
 * 生成 apps/web 镜像（apps/web-overlay -> apps/web）。
 *
 * apps/web 现在是一个 GENERATED 产物，不再是手维护的双胞胎。
 * 跑 `pnpm mirror:web`（即本脚本）即可从唯一事实源 apps/web-overlay 重新生成，
 * check-web-overlay 的前向（overlay -> web 严格）漂移会被自动修复，闸门因此自愈
 * （见根 package.json 的 `check:overlay`：先本脚本再 check）。
 *
 * 语义：把 overlay 整棵树「合并式」拷贝进 apps/web —— overlay 的每个非排除文件逐文件
 * 覆盖 web 的同名文件；web 里「overlay 没有、属于上游底座（vendor 产物）」的文件
 * 一律保留，也不会删除 web 的任何文件。这样 apps/web 始终是「上游底座 + overlay 覆盖层」
 * 的可运行整体，且对 overlay 内容的拷贝是幂等的（跑两次无 diff）。
 *
 * 为什么是「合并式」而不是「清空重建」：apps/web 里那 300+ 个非 overlay 文件是上游
 * NavSphere 底座（next/react/字体/css…），它们本就是 vendor 进来的、不进 overlay，
 * 也不能由 overlay 派生；它们只能由 Docker / vendor-web 重新拉底座得到。把它们删掉会让
 * apps/web 变成不可运行的空壳。合并式拷贝只动「overlay 该管的那部分」，闸门只校验这部分，
 * 因此既自愈漂移、又不破坏本地可运行性，且对 overlay 内容严格 byte-identical。
 *
 * 排除规则（与 check-web-overlay / overlay-drift 一致，避免两边口径分裂）：
 *   - overlay-drift 的 isExcluded：node_modules / .next / dist / .turbo / .cache / coverage /
 *     build-log / .vendor / next-env.d.ts / UPSTREAM.md / upstream-baseline.json / 字体与 logo 等
 *   - 额外防御性排除：.git（overlay 不应含，但保险）
 * 上游衍生、不在 overlay 的文件（apps/web-overlay/upstream-baseline.json 登记的那些）天然
 * 不在 overlay 树里，不会被本脚本触及，继续由 apps/web 的原 vendor 底座保留。
 *
 * 用法：
 *   node scripts/generate-web-mirror.mjs                              # 默认：overlay -> apps/web
 *   node scripts/generate-web-mirror.mjs --source <dir> --target <dir> # 测试 / 隔离用
 */
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkTree, isExcluded } from "./lib/overlay-drift.mjs";

const ROOT = resolve(".");
const DEFAULT_SOURCE = join(ROOT, "apps", "web-overlay");
const DEFAULT_TARGET = join(ROOT, "apps", "web");

function parseArgs(argv) {
  let source = DEFAULT_SOURCE;
  let target = DEFAULT_TARGET;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") source = resolve(argv[++i]);
    else if (argv[i] === "--target") target = resolve(argv[++i]);
  }
  return { source, target };
}

/** overlay 相对路径是否跳过（不进镜像）。在 isExcluded 之上加 .git 防御。 */
function isMirrorExcluded(rel) {
  const norm = rel.replaceAll("\\", "/");
  if (norm === ".git" || norm.startsWith(".git/")) return true;
  return isExcluded(norm);
}


function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 从 source（默认 apps/web-overlay）合并式生成 target（默认 apps/web）。
 *
 * 逐文件把 overlay 的非排除文件覆盖进 web；不删除 web 里的任何其它文件。
 * 幂等：第二次运行对第一次的结果不产生任何内容差异。
 * 写入带重试（Windows Defender / OneDrive filter 偶发以 errno 0 打断 copyFileSync）。
 *
 * @param {{source?: string, target?: string, deadlineMs?: number}} [opts]
 * @returns {{copied: number, skipped: number, errors: string[]}}
 */
export function generateMirror({ source = DEFAULT_SOURCE, target = DEFAULT_TARGET, deadlineMs = 20_000 } = {}) {
  if (!statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("overlay 源目录不存在: " + source);
  }
  const rels = walkTree(source, { exclude: isMirrorExcluded });
  let copied = 0;
  const errors = [];
  for (const rel of rels) {
    const from = join(source, rel);
    const to = join(target, rel);
    // walkTree 里标为目录的项不应出现，但保险起见跳过非文件
    if (!statSync(from, { throwIfNoEntry: false })?.isFile()) continue;
    try {
      mkdirSync(dirname(to), { recursive: true });
      copyWithRetry(from, to, deadlineMs);
      copied++;
    } catch (e) {
      errors.push(rel + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }
  return { copied, skipped: rels.length - copied, errors };
}

/** 单文件覆盖写，遇瞬时写入失败重试（兜底：删目标再 cp）。 */
function copyWithRetry(from, to, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let attempt = 0;
  for (;;) {
    try {
      copyFileSync(from, to);
      return;
    } catch (e) {
      attempt++;
      const fallbackOk = (() => {
        try {
          rmSync(to, { force: true, recursive: true });
          copyFileSync(from, to);
          return true;
        } catch {
          return false;
        }
      })();
      if (fallbackOk) return;
      if (Date.now() >= deadline) throw e;
      defaultSleep(Math.min(2000, 200 * attempt));
    }
  }
}

// 直接 `node scripts/generate-web-mirror.mjs` 运行时执行；被测试 import 时不触发。
const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { source, target } = parseArgs(process.argv.slice(2));
  console.log(`[mirror:web] 生成镜像：${relative(ROOT, source)} -> ${relative(ROOT, target)}`);
  const { copied, errors } = generateMirror({ source, target });
  if (errors.length > 0) {
    for (const e of errors) console.error("[mirror:web] 写入失败: " + e);
    console.error(`[mirror:web] 失败：${errors.length} 个文件写入出错`);
    process.exit(1);
  }
  console.log(`[mirror:web] OK：写入 ${copied} 个文件（overlay -> web 合并式镜像，幂等）`);
  process.exit(0);
}
