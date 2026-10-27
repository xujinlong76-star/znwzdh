#!/usr/bin/env node
/**
 * 依赖边界门禁：把「谁能 import 谁」从口头约定变成可执行规则。
 *
 * 为什么需要（2026-10-27 真实事故）：`apps/web-overlay/src/lib/health-panel-state.ts`
 * 直接 `export … from "@navhub/core"`。overlay 是 vendored 底座的源真相，
 * 生产镜像只拷贝它、不带 packages/*，于是 tsc / next build / 镜像构建三处同时
 * TS2307。这类越界在本地可能「碰巧能解析」（根 node_modules 有链接），
 * 只有在干净检出或镜像里才炸——正是最该用静态规则挡住的一类。
 *
 * 规则表刻意写得像数据而不是代码：新增一条边界只加一行，评审时看得见。
 * 例外只有一种：测试目录（`**​/test/**`）允许跨包读源码——测试跑在仓库里，
 * 不在镜像里，越界不会造成运行时问题。
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { extractSpecifiers, normalizePath, resolveSpecifier } from "./lib/source-refs.mjs";

const ROOT = process.cwd();
const AS_JSON = process.argv.includes("--json");
const SOURCE_RE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

/**
 * 规则表。`from` 是路径前缀；`deny` 里：
 *   package —— 说明符以该前缀开头（包名）
 *   path    —— 解析后的仓库相对路径以该前缀开头
 */
const RULES = [
  {
    id: "vendored-no-workspace-pkg",
    from: "apps/web-overlay/src/",
    deny: [{ kind: "package", value: "@navhub/", reason: "vendored 底座不能依赖 workspace 包（生产镜像只含 overlay）" }],
  },
  {
    id: "no-reverse-dependency",
    from: "packages/",
    deny: [{ kind: "path", value: "apps/", reason: "packages 不得反向依赖 apps（分层单向）" }],
  },
  {
    id: "api-no-frontend",
    from: "apps/api/",
    deny: [
      { kind: "path", value: "apps/web-overlay/", reason: "后端不得依赖前端源码" },
      { kind: "path", value: "apps/web/", reason: "后端不得依赖前端源码" },
    ],
  },
  {
    id: "scripts-no-app-src",
    from: "scripts/",
    deny: [{ kind: "path", value: "apps/web-overlay/src/", reason: "脚本只应消费公开入口，不直接抓前端内部模块" }],
  },
];

/**
 * 显式例外：每条都必须写清理由，并在运行输出里回显。
 * 例外是「评审时看得见的技术债」，不是「规则可以绕过」。
 */
const EXCEPTIONS = [
  {
    file: "scripts/seo-scale-bench.mts",
    rule: "scripts-no-app-src",
    spec: "../apps/web-overlay/src/lib/seo/thresholds.ts",
    reason: "压测必须与线上用同一组 SEO 阈值，否则量出来的规模没有意义；阈值模块是纯常量，无运行时依赖",
  },
];

function isExcepted(v) {
  return EXCEPTIONS.some((e) => e.file === v.file && e.rule === v.rule && e.spec === v.spec);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function trackedSources() {
  const raw = git(["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
  return raw.split("\0").filter((f) => f && SOURCE_RE.test(f)).map(normalizePath);
}

function readHead(file) {
  return git(["show", `HEAD:${file}`]);
}

function existsAsFile(relPath) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) return false;
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function aliasRootsFor(file) {
  if (file.startsWith("apps/web-overlay/")) return { "@/": "apps/web-overlay/src" };
  if (file.startsWith("apps/web/")) return { "@/": "apps/web/src" };
  return {};
}

/** 测试目录允许跨包读源码：它们不在镜像里运行 */
function isTestFile(file) {
  return /(^|\/)test\//.test(file) || /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(file);
}

function main() {
  const files = trackedSources();
  const violations = [];

  for (const file of files) {
    if (isTestFile(file)) continue;
    const rules = RULES.filter((r) => file.startsWith(r.from));
    if (rules.length === 0) continue;

    let text;
    try {
      text = readHead(file);
    } catch {
      continue;
    }

    for (const { spec, line } of extractSpecifiers(text)) {
      const resolved = resolveSpecifier(file, spec, { aliasRoots: aliasRootsFor(file), exists: existsAsFile });
      for (const rule of rules) {
        for (const deny of rule.deny) {
          const hit =
            deny.kind === "package" ? spec.startsWith(deny.value) : Boolean(resolved && resolved.startsWith(deny.value));
          if (hit) violations.push({ file, line, spec, resolved: resolved ?? "", rule: rule.id, reason: deny.reason });
        }
      }
    }
  }

  const excepted = violations.filter(isExcepted);
  const real = violations.filter((v) => !isExcepted(v));
  violations.length = 0;
  violations.push(...real);

  if (violations.length > 0) {
    if (AS_JSON) {
      console.log(JSON.stringify({ violations }, null, 2));
    } else {
      console.error(`❌ 依赖边界：${violations.length} 处越界`);
      for (const v of violations) {
        console.error(`   ${v.file}:${v.line}  →  ${v.spec}`);
        console.error(`      规则 ${v.rule}：${v.reason}`);
      }
      console.error("\n   若确实需要跨层，请把该文件移到 test/ 下，或在规则表里登记带理由的例外。");
    }
    process.exit(1);
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ scanned: files.length, violations: [] }, null, 2));
  } else {
    console.log(`✅ 依赖边界：扫描 ${files.length} 个源文件，${RULES.length} 条规则全部满足。`);
    if (excepted.length > 0) {
      console.log(`   显式例外 ${excepted.length} 条（评审可见）：`);
      for (const e of EXCEPTIONS) console.log(`     · ${e.file} — ${e.reason}`);
    }
  }
}

main();
