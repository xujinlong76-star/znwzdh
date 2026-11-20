// Reference implementation of 04-command-palette §1.2 (palette-pinyin.ts).
// PURPOSE: independent re-check harness for W8. It is NOT product code and does
// not ship in the bundle. In segment 2 the same scripts run against W5's real
// `palette-pinyin.ts` (via --impl) and diff the two; any divergence is reported,
// not silently patched over.
//
// Faithful to §1.2 except two documented assumptions (flagged for the W5 cross-check):
//  A1. Keys are lowercased. §1.2 lowercases the query but never says to lowercase
//      the keys; without it a Latin title such as "ChatGPT" (pyFull "ChatGPT")
//      never matches the lowercased query "chatgpt". Lowercasing is clearly the
//      intent; if W5 implements it differently the P-b Latin-title table will show it.
//  A2. polyphonic readings are de-toned by NFD stripping of diacritics + ü→u
//      (lü→lu). §1.2 says "每项再过 toneType:'none' 去调" but pinyin-pro has no
//      "strip tone from an arbitrary string" API; NFD-strip is the closest
//      mechanical equivalent. 'ü' handling (nü vs nv vs nu) is the known edge.
import { resolvePinyinPro } from './lib.mjs';

export const PINYIN_FIXES = {}; // W5 owns the real list; reference starts empty by design.

function detone(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ü/g, 'u');
}

/** Build a pinyin-pro adapter bound to one loaded module (injected for testability). */
export function makePinyinImpl(pinyinPro, customFixes = PINYIN_FIXES) {
  const { pinyin, customPinyin } = pinyinPro;

  function applyCustomPinyinFixes() {
    for (const [word, py] of Object.entries(customFixes)) {
      try { customPinyin(word, py); } catch (e) { console.warn(`customPinyin(${word}) failed: ${e.message}`); }
    }
  }

  // options.segmentit: 1 | 2 (default 2 in pinyin-pro 3.29.5). Exposed so P-e can
  // run the segmentit 1 vs 2 对照 without touching the scoring code.
  function buildPinyinKeys(title, opts = {}) {
    const seg = opts.segmentit;
    const base = seg === undefined ? {} : { segmentit: seg };
    const pyFull = pinyin(title, { toneType: 'none', type: 'array', ...base }).join('').toLowerCase();
    const pyFirst = pinyin(title, { pattern: 'first', toneType: 'none', type: 'array', ...base }).join('').toLowerCase();
    const polyphonic = [...new Set(
      pinyin(title, { type: 'all', ...base })
        .flatMap((c) => c.polyphonic || [])
        .map((s) => detone(s).toLowerCase()),
    )];
    return { pyFull, pyFirst, polyphonic };
  }

  function isLatinQuery(query) {
    return /^[a-z0-9 ]+$/.test(query.trim().toLowerCase());
  }

  function tokenScore(token, keys) {
    if (token === keys.pyFull || token === keys.pyFirst) return 1.0;
    let best = 0;
    if (keys.pyFull.startsWith(token)) best = Math.max(best, 0.9);
    else if (keys.pyFull.includes(token)) best = Math.max(best, 0.7);
    if (keys.pyFirst.startsWith(token)) best = Math.max(best, 0.8);
    else if (keys.pyFirst.includes(token)) best = Math.max(best, 0.6);
    for (const p of keys.polyphonic) {
      if (p.startsWith(token)) best = Math.max(best, 0.85);
      else if (p.includes(token)) best = Math.max(best, 0.65);
    }
    return best;
  }

  function matchPinyin(query, keys) {
    if (!isLatinQuery(query)) return 0;
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 0;
    let score = 1;
    for (const t of tokens) {
      const s = tokenScore(t, keys);
      if (s === 0) return 0;
      score *= s;
    }
    return score;
  }

  return { buildPinyinKeys, matchPinyin, isLatinQuery, applyCustomPinyinFixes, detone };
}

/** Default instance bound to the resolved pinyin-pro (for the CLI scripts). */
export function defaultImpl(explicitPath) {
  const { mod, from } = resolvePinyinPro(explicitPath);
  return { ...makePinyinImpl(mod), resolvedFrom: from, version: mod?.version || 'unknown' };
}
