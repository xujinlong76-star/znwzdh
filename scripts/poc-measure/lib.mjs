// Shared helpers for Batch 1 / 04-command-palette PoC measurement (W8).
// Pure Node, no dependencies. Run with: node <script>.mjs [flags]
// pinyin-pro is resolved by the caller (see ref-pinyin.mjs / resolvePinyinPro).
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

/** Flatten navigation.json -> [{ id, title, href, category }] (all site items). */
export function loadTitles(navPath) {
  const nav = JSON.parse(readFileSync(navPath, 'utf8'));
  const items = [];
  (function walk(cats, path) {
    for (const c of cats || []) {
      for (const it of c.items || []) {
        items.push({ id: it.id, title: it.title, href: it.href || '', category: `${path}/${c.title}` });
      }
      walk(c.subCategories, `${path}/${c.title}`);
    }
  })(nav.navigationItems, '');
  return items;
}

export const isChineseTitle = (t) => /[\u4e00-\u9fff]/.test(t);

/** Deterministic PRNG (mulberry32) so every对照 run is reproducible. */
export function rng(seed = 20261120) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolve pinyin-pro. Order: explicit path > PINYIN_PRO_PATH env > this worktree's
 *  node_modules (after `pnpm install`) > base clone's warm pnpm store copy (read-only
 *  fallback used for smoke tests before W5 lands the dependency).
 *  Throws with a clear message when nothing resolves (do NOT silently stub it). */
export function resolvePinyinPro(explicitPath) {
  const candidates = [
    explicitPath || null,
    process.env.PINYIN_PRO_PATH || null,
  ];
  for (const c of candidates) {
    if (!c) continue;
    try { return { mod: createRequire(import.meta.url)(c), from: c }; } catch { /* try next */ }
  }
  try {
    const req = createRequire(resolve(process.cwd(), 'apps/web-overlay/package.json'));
    return { mod: req('pinyin-pro'), from: 'worktree node_modules (apps/web-overlay)' };
  } catch { /* fall through */ }
  const fallback = '/home/hatch/workspace/znwzdh-batch1/node_modules/.pnpm/pinyin-pro@3.29.5/node_modules/pinyin-pro';
  try { return { mod: createRequire(import.meta.url)(fallback), from: `fallback ${fallback}` }; }
  catch (e) { throw new Error(`pinyin-pro 未解析到。传 --pinyin-pro <path>，或设 PINYIN_PRO_PATH，或先在 worktree 跑 pnpm install。最后错误: ${e.message}`); }
}

/** Write a JSON report next to the script output path; creates parent dirs.
 *  Writes to a temp file then renames (never truncates an existing good
 *  report on failure), retries up to 5 times with backoff: this sandbox
 *  intermittently rejects writes with EPERM (observed 2026-11-20: identical
 *  writeJson calls succeed at 11:01 and fail at 11:02 with no content/size
 *  pattern; a plain node write seconds later succeeds). On final failure the
 *  caller must surface the JSON on stdout instead of silently losing it. */
export function writeJson(outPath, obj) {
  const dir = dirname(resolve(outPath));
  mkdirSync(dir, { recursive: true });
  const data = JSON.stringify(obj, null, 2) + '\n';
  const tmp = `${outPath}.tmp-${process.pid}`;
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      writeFileSync(tmp, data, 'utf8');
      renameSync(tmp, outPath);
      return outPath;
    } catch (e) {
      lastErr = e;
      try { unlinkSync(tmp); } catch { /* already gone */ }
      if (attempt < 5) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt);
    }
  }
  throw lastErr;
}

/** writeJson, but if the sandbox still refuses after retries, dump the full
 *  report to stdout and mark exit code 1 — numbers must never be silently lost. */
export function writeJsonOrStdout(outPath, obj) {
  try {
    return writeJson(outPath, obj);
  } catch (e) {
    console.error(`[writeJson] FAILED after retries (${e.code}): ${outPath} — dumping report to stdout`);
    console.log(JSON.stringify(obj, null, 2));
    process.exitCode = 1;
    return null;
  }
}

/** Minimal flag parser: --key value / --key=value / --flag (boolean). */
export function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v !== undefined ? v : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}
