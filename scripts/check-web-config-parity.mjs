#!/usr/bin/env node
/**
 * check-web-config-parity —— 「哪一份前端配置是唯一事实源」的机器可判定断言。
 *
 * 背景（2026-11-07 九维评审 1-2 / 5-1）：
 *   apps/web 是 apps/web-overlay 合并式覆写出来的 GENERATED 派生镜像
 *   （scripts/generate-web-mirror.mjs:3-16），但两份 next.config.js / package.json /
 *   tsconfig.json 都是物理文件，且存在四条构建路径：
 *     1) 宿主机 dev:web / 未重跑 vendor 的本地 pnpm build  → 读 apps/web/*
 *     2) pnpm verify:web（先 vendor-web.mjs）              → 读 overlay 覆写后的副本
 *     3) CI test-web（ci.yml:236 vendor → :243-256 门禁）  → 读 overlay 覆写后的副本
 *     4) Docker（Dockerfile.web:57 COPY apps/web-overlay/） → 读 overlay 覆写后的副本
 *   docs/CSP-ROLLOUT.md:4 声明「代码事实源 = apps/web-overlay/next.config.js」，
 *   只对路径 2/3/4 成立；路径 1 若未刷新就会落后，改 CSP / ignoreBuildErrors
 *   会在两份文件里各漂移一次，而现有门禁没有任何一条能发现它。
 *
 * 本脚本做**只读**内容比对：逐文件算 sha256，不一致即 EXIT=1。
 * 这是单源化改造最低成本、可回退的第一步；不写盘、不联网、不改任何配置。
 *
 * 用法：在仓库根运行（与 config.ts / verify.mjs 的 CWD 约定一致）
 *   node scripts/check-web-config-parity.mjs
 *   node scripts/check-web-config-parity.mjs --json
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const WEB = join(ROOT, "apps", "web");
const OVERLAY = join(ROOT, "apps", "web-overlay");

// 只对「构建期会被实际读取」的配置文件做全等断言。
// 源码目录不在此列：apps/web/src 本就是 gitignore 的生成物（仅 10 个文件入库），
// 由 scripts/check-web-overlay.mjs 按 overlay→web 方向单独校验。
const FILES = ["next.config.js", "package.json", "tsconfig.json"];

const digest = (abs) => createHash("sha256").update(readFileSync(abs)).digest("hex");
const asJson = process.argv.includes("--json");

const rows = [];
for (const name of FILES) {
  const a = join(WEB, name);
  const b = join(OVERLAY, name);
  if (!existsSync(a) || !existsSync(b)) {
    rows.push({ file: name, status: "missing", a: existsSync(a), b: existsSync(b) });
    continue;
  }
  const ha = digest(a);
  const hb = digest(b);
  rows.push({ file: name, status: ha === hb ? "equal" : "drift", web: ha.slice(0, 12), overlay: hb.slice(0, 12) });
}

if (asJson) {
  console.log(JSON.stringify({ root: ROOT, rows }, null, 2));
  process.exit(rows.some((r) => r.status !== "equal") ? 1 : 0);
}

let bad = 0;
for (const r of rows) {
  if (r.status === "equal") {
    console.log(`[config-parity] ✓ ${r.file}  sha256=${r.web}…（两端一致）`);
  } else if (r.status === "missing") {
    console.error(`[config-parity] ✗ ${r.file}  缺失：apps/web=${r.a} / apps/web-overlay=${r.b}`);
    bad += 1;
  } else {
    console.error(`[config-parity] ✗ ${r.file}  漂移：apps/web=${r.web}… ≠ apps/web-overlay=${r.overlay}…`);
    bad += 1;
  }
}

if (bad) {
  console.error(`[config-parity] ❌ ${bad}/${FILES.length} 份配置漂移。`);
  console.error("[config-parity] 修法：先确认哪一侧是事实源，再跑 node scripts/generate-web-mirror.mjs 回移；");
  console.error("[config-parity] 不要手改 apps/web/next.config.js —— 它会在下次 vendor/mirror 时被覆写。");
  process.exit(1);
}
console.log(`[config-parity] ✅ ${FILES.length}/${FILES.length} 份配置一致（四条构建路径可判定）`);
process.exit(0);
