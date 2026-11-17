#!/usr/bin/env node
/**
 * a11y-token-changed：pre-push 补位闸门（U-33 根因，2026-11-17）。
 *
 * 为什么需要它：a11y-token-contrast 是「全树扫描型」守卫——它用 walkSources 递归读
 * 整个 apps/web-overlay/src，而本地所有增量关口（pre-commit 选测、pre-push 七闸门、
 * verify 默认档）都是「按改动文件 / 按名单」选检查的。扫描型守卫没有增量等价物，
 * 只能等全量测试或 CI。批 C（3c200978）在 plugin-taps-modal.tsx 里新增
 * bg-destructive/10，pre-commit 选测结构性漏选（模块图无边、词根够不着、
 * GLOBAL_GATE_TESTS 只有两枚 a11y 门禁），pre-push 七枚闸门里没有任何源码文本
 * 扫描类闸门，于是带着红守卫直接上了 main——这是「改动未同步配套守卫」的第五次
 * 出现（U-15/U-16/U-19 同构）。本闸门把该守卫的 5 条冷区禁令左移到推送前，
 * 只扫本次推送改动的 overlay 源码文件，实测 <1s（核心 grep 扫描 7 个改动文件
 * 0.056s，见方案 ~/workspace/goals/efficiency-goal/hidden_files/u33-prepush-gap-2026-11-17-1722.md）。
 *
 * 口径（与仓库既有闸门一致）：
 *   - 只读 HEAD 的提交内容（git show），不读工作区：推出去的是提交，多会话并行时
 *     别人的未提交改动既不该挡我的推送，也不该把我的推送判成绿（core-mirrors /
 *     test-mirror-pairs / mock-hygiene 同款教训）。
 *   - 基线语义：只拦「相对基线新引入」的违例，基线上已有的只警告放行——避免把历史
 *     存量算到本次推送头上，逼人用 NAVHUB_SKIP_PREPUSH 整条绕过。
 *   - 豁免清单不硬编码：每次从守卫文件（HEAD 里的
 *     apps/web-overlay/test/a11y-token-contrast.test.ts）解析 WIP_HOT_EXEMPT，
 *     清单收敛后两边自动同步收敛。
 *   - 5 条禁令的正则与守卫原文逐字一致，由 scripts/check-a11y-token-changed.test.ts
 *     （元测试）钉住：守卫改了禁令、脚本没同步时元测试先红。守卫断言本身一行不改。
 *
 * 用法：
 *   node scripts/check-a11y-token-changed.mjs [--baseline <git-ref>]
 *   不传 --baseline 时取 HEAD 与 @{upstream} 的 merge-base；拿不到上游时退回空树
 *   （全量严格判红——未知比较对象时收紧不放宽，与 test-mirror-pairs 同语义）。
 * 退出码：0 = 通过（或只有基线已继承的违例）；1 = 本次推送新引入冷区违例；
 *         2 = 跑不起来（守卫文件不在 HEAD 里、git 失败等，不是「没查就算过」）。
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 守卫事实源（overlay 侧为正本；apps/web/test 是 vendor 镜像，兜底用）。 */
export const GUARD_REL = "apps/web-overlay/test/a11y-token-contrast.test.ts";
export const GUARD_FALLBACK_REL = "apps/web/test/a11y-token-contrast.test.ts";
export const OVERLAY_SRC_PREFIX = "apps/web-overlay/src/";
/** 空树：拿不到基线时与它求 diff = 全量严格判红。 */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * 5 条冷区禁令。正则与守卫 a11y-token-contrast.test.ts 里的原文逐字一致
 * （border-input :333、text-muted-foreground/N :452、徽章旧配方 :467-482、
 * text-destructive :499、bg-destructive/10 :510；行号以守卫文件为准，元测试
 * 按正则原文比对，不按行号钉）。
 */
export const PATTERNS = [
  { id: "border-input", re: /\bborder-input\b/g, fix: "改为 border-border-strong" },
  {
    id: "text-muted-foreground/N",
    re: /text-muted-foreground\/\d+/g,
    fix: "改为 text-muted-foreground（去掉透明度变体）",
  },
  {
    id: "badge-recipe",
    re: null,
    fix: "改为 text-*-700（徽章 = bg-*-500/10 + text-*-700）",
  },
  {
    id: "text-destructive",
    re: /text-destructive(?!-foreground|-text)/g,
    fix: "改为 text-destructive-text",
  },
  { id: "bg-destructive/10", re: /bg-destructive\/10\b/g, fix: "改为 bg-destructive/15（配 text-destructive-text）" },
];

/** 徽章旧配方里的三条正则：与守卫 badgeRecipeHits()（:467-482）原文逐字一致。 */
export const BADGE_ADJACENT_RE = /\bbg-([a-z]+)-500\/10\s+text-\1-600\b/g;
export const BADGE_QUOTE_RE = /(['"`])([^'"`\n]*?)\1/g;
export const BADGE_INNER_RE = /\bbg-([a-z]+)-500\/10\b/g;

export function countMatches(src, re) {
  return [...src.matchAll(new RegExp(re.source, "g"))].map((m) => m[0]);
}

/** 守卫 badgeRecipeHits() 原样移植：相邻共现 + 同一引号类串内的非相邻共现。 */
export function badgeRecipeHits(src) {
  const hits = countMatches(src, BADGE_ADJACENT_RE);
  for (const m of src.matchAll(new RegExp(BADGE_QUOTE_RE.source, "g"))) {
    const inner = m[2];
    for (const b of inner.matchAll(new RegExp(BADGE_INNER_RE.source, "g"))) {
      const fam = b[1];
      if (new RegExp(`\\btext-${fam}-600\\b`).test(inner)) {
        hits.push(`bg-${fam}-500/10 + text-${fam}-600`);
      }
    }
  }
  return hits;
}

/** 对一段源码跑全部 5 条禁令，返回有命中的条目（id / fix / hits）。 */
export function patternHits(src) {
  const out = [];
  for (const p of PATTERNS) {
    const hits = p.id === "badge-recipe" ? badgeRecipeHits(src) : countMatches(src, p.re);
    if (hits.length > 0) out.push({ id: p.id, fix: p.fix, hits });
  }
  return out;
}

/**
 * 从守卫源码解析 WIP_HOT_EXEMPT 清单（与守卫同一份来源，不硬编码）。
 * 找不到清单定义时抛错——解析不到 ≠ 没有豁免，静默当成「无豁免」会误拦。
 */
export function parseExempt(guardSource) {
  const m = String(guardSource ?? "").match(/const WIP_HOT_EXEMPT: string\[\] = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error("守卫文件里找不到 WIP_HOT_EXEMPT 清单定义");
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}

/**
 * 纯函数：从 diff 文件清单里挑出本次要扫的 overlay 源码文件
 *（apps/web-overlay/src 下的 .ts/.tsx，扣掉豁免清单内的相对路径）。
 */
export function changedSourceFiles(diffPaths, exempt) {
  return diffPaths
    .filter((p) => p.startsWith(OVERLAY_SRC_PREFIX) && /\.(ts|tsx)$/.test(p))
    .map((p) => p.slice(OVERLAY_SRC_PREFIX.length))
    .filter((rel) => !exempt.has(rel));
}

/**
 * 纯函数：对一批文件算「本次新引入」（fresh）与「基线已继承」（inherited）的违例。
 * files: [{ rel, head: string | null, base: string | null }]；
 * head 为 null = 本次删掉的文件，无内容可扫；base 为 null = 基线里没有（新文件）。
 * 计数口径：同一文件同一禁令，HEAD 命中数 − 基线命中数 = 新引入数（其余为继承）。
 */
export function assessFiles(files) {
  const fresh = [];
  const inherited = [];
  for (const f of files) {
    if (f.head === null) continue;
    const headHits = patternHits(f.head);
    const baseHits = f.base === null ? [] : patternHits(f.base);
    for (const h of headHits) {
      const baseCount = baseHits.find((b) => b.id === h.id)?.hits.length ?? 0;
      const freshCount = Math.max(0, h.hits.length - baseCount);
      const inheritedCount = h.hits.length - freshCount;
      if (freshCount > 0) fresh.push({ rel: f.rel, id: h.id, count: freshCount, fix: h.fix });
      if (inheritedCount > 0) inherited.push({ rel: f.rel, id: h.id, count: inheritedCount });
    }
  }
  return { fresh, inherited };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** 读某个提交上的文件内容；文件在该提交里不存在时返回 null（不是失败）。 */
function showBlob(ref, path) {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

function upstreamBaseline() {
  try {
    const out = git(["merge-base", "HEAD", "@{upstream}"]).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

function changedPaths(baseline) {
  return git(["diff", "--name-only", baseline, "HEAD", "--", OVERLAY_SRC_PREFIX])
    .split("\n")
    .filter(Boolean);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--baseline" && argv[i + 1]) {
      out.baseline = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`未知参数 ${argv[i]}（用法：node scripts/check-a11y-token-changed.mjs [--baseline <git-ref>]）`);
    }
  }
  return out;
}

function main(argv) {
  const started = Date.now();
  const { baseline: flagBaseline } = parseArgs(argv);
  let baseline = flagBaseline ?? upstreamBaseline();
  if (baseline === undefined || baseline === null) {
    console.log("[a11y-token-changed] 拿不到上游 merge-base，退回空树全量严格判红");
    baseline = EMPTY_TREE;
  }
  const guardSource = showBlob("HEAD", GUARD_REL) ?? showBlob("HEAD", GUARD_FALLBACK_REL);
  if (guardSource === null) {
    throw new Error(`守卫文件 ${GUARD_REL} 不在 HEAD 里，跑不起来（不是「没查就算过」）`);
  }
  const exempt = parseExempt(guardSource);
  const rels = changedSourceFiles(changedPaths(baseline), exempt);
  const files = rels.map((rel) => ({
    rel,
    head: showBlob("HEAD", OVERLAY_SRC_PREFIX + rel),
    base: showBlob(baseline, OVERLAY_SRC_PREFIX + rel),
  }));
  const { fresh, inherited } = assessFiles(files);
  const elapsed = Date.now() - started;

  if (inherited.length > 0) {
    console.log(
      "[a11y-token-changed] ⚠️ 以下违例在基线上就已存在，不是本次推送引入的，放行：" +
        inherited.map((v) => `${v.rel}（${v.id} ${v.count} 处）`).join(" / "),
    );
  }
  if (fresh.length > 0) {
    console.error(
      "[a11y-token-changed] 本次推送新引入冷区 a11y token 违例（与守卫 a11y-token-contrast.test.ts 同款禁令，" +
        elapsed +
        "ms）：" +
        fresh.map((v) => `\n  - ${v.rel}（${v.id} ${v.count} 处）：${v.fix}`).join(""),
    );
    console.error("[a11y-token-changed] 修复：按上面提示改类名；豁免只认守卫 WIP_HOT_EXEMPT 显式清单（禁止通配）。");
    return 1;
  }
  console.log(
    `[a11y-token-changed] 通过：扫了 ${files.length} 个改动文件，0 处新引入违例（${elapsed}ms）`,
  );
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error("[a11y-token-changed] " + (error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
