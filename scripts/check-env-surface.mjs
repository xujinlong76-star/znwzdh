#!/usr/bin/env node
/**
 * 配置面登记棘轮（C-2）：防止「代码读了 env，但 .env.example / compose / config 都没登记」。
 *
 * 背景（后端 agent P2-4）：src 中 30+ 处直接 process.env.NAVHUB_*，抽查 15 个变量仅 3 个进
 * .env.example；已有 compose-env-parity.test.ts 防「.env 写了但 compose 没透传」，防不住
 * 「代码读了但文档/门禁没登记」。运维按 .env.example 配置后容器里永远取默认值。
 *
 * 设计口径（与 gen-docs-metrics --check 同款）：这是**棘轮**不是「一次性判红」。
 *   - 当前实测 35 个变量，其中 24 个未进 .env.example，登记在 scripts/env-surface.json
 *     的 knownUnregistered → 允许存在，但**新出现的未登记变量**判红；
 *   - 若某个 knownUnregistered 变量已被补进登记面，会提示「可移出基线」（只降不升）；
 *   - 已登记变量消失不判红（删代码是正常演进）。
 *
 * 用法：
 *   node scripts/check-env-surface.mjs            # 校验（默认）
 *   node scripts/check-env-surface.mjs --update  # 把当前差集写入基线（补齐文档后用）
 *   node scripts/check-env-surface.mjs --json    # 机器可读
 * 退出码：0 通过；1 出现新未登记变量；2 清单/形状非法。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CFG = resolve(ROOT, "scripts/env-surface.json");
const argv = process.argv.slice(2);
const NL = String.fromCharCode(10);
const P = "[env-surface] ";

if (!existsSync(CFG)) { console.error(P + "找不到 scripts/env-surface.json"); process.exit(2); }
let cfg;
try { cfg = JSON.parse(readFileSync(CFG, "utf8")); }
catch (e) { console.error(P + "清单解析失败：" + e.message); process.exit(2); }
if (!Array.isArray(cfg.scan) || !Array.isArray(cfg.knownUnregistered)) { console.error(P + "形状非法"); process.exit(2); }

const registeredText = (cfg.registeredIn ?? []).map((p) => {
  const f = resolve(ROOT, p);
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}).join(NL);

const found = new Map();
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".ts")) {
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/process\.env\.(NAVHUB_[A-Z0-9_]+)/g)) {
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(relative(ROOT, p).replaceAll("\\", "/"));
      }
    }
  }
};
for (const d of cfg.scan) { const full = resolve(ROOT, d); if (existsSync(full) && statSync(full).isDirectory()) walk(full); }

const all = [...found.keys()].sort();
const unregistered = all.filter((n) => !registeredText.includes(n));
const known = new Set(cfg.knownUnregistered);
const brandNew = unregistered.filter((n) => !known.has(n));
const nowRegistered = [...known].filter((n) => registeredText.includes(n));

if (argv.includes("--update")) {
  cfg.knownUnregistered = unregistered;
  cfg.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(CFG, JSON.stringify(cfg, null, 2) + NL, "utf8");
  console.log(P + "已刷新基线：" + unregistered.length + " 个未登记变量");
  process.exit(0);
}
if (argv.includes("--json")) {
  console.log(JSON.stringify({ total: all.length, unregistered, brandNew, nowRegistered }, null, 2));
}
if (brandNew.length) {
  for (const n of brandNew) console.error(P + "❌ 新增未登记变量 " + n + "（读取点：" + [...found.get(n)].join(", ") + "）");
  console.error(P + "请把变量补进 .env.example / docker/docker-compose.yml / AppConfig，或跑 --update 纳入基线");
  process.exit(1);
}
if (nowRegistered.length) {
  console.log(P + "提示：以下变量已补进登记面，可从 knownUnregistered 移出（跑 --update）：" + nowRegistered.join("、"));
}
console.log(P + "✅ " + all.length + " 个变量、" + unregistered.length + " 个历史未登记（均在基线内）、新增未登记 0");
process.exit(0);
