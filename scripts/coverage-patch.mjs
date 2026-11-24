/**
 * Patch line coverage helpers. Git diff parsing is deliberately isolated so it can
 * be tested without invoking git or running the full coverage suite.
 */
const SOURCE_PATH = /^(?:apps\/api\/src\/|packages\/[^/]+\/src\/)/;

export function parseAddedSourceLines(diffText) {
  const changed = new Map();
  let file = null;
  let newLine = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file || !SOURCE_PATH.test(file)) continue;
    if (line.startsWith("+")) {
      const set = changed.get(file) ?? new Set();
      set.add(newLine);
      changed.set(file, set);
      newLine++;
    } else if (line.startsWith(" ")) {
      newLine++;
    }
  }
  return changed;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function findCoverageEntry(coverage, relativePath) {
  const target = normalizePath(relativePath);
  for (const [key, value] of Object.entries(coverage)) {
    const candidate = normalizePath(key);
    if (candidate === target || candidate.endsWith("/" + target)) return value;
  }
  return null;
}

/**
 * Counts only executable changed lines present in Istanbul's line map.
 * Missing coverage entries are treated as uncovered rather than silently skipped.
 */
export function evaluatePatchCoverage(diffText, coverage, minExecutableLines = 10) {
  const changed = parseAddedSourceLines(diffText);
  let total = 0;
  let covered = 0;
  const files = [];
  for (const [file, lines] of changed) {
    const entry = findCoverageEntry(coverage, file);
    let fileTotal = 0;
    let fileCovered = 0;
    for (const line of lines) {
      const count = entry?.l?.[String(line)];
      if (!entry) {
        fileTotal++;
        continue;
      }
      if (count === undefined) continue;
      fileTotal++;
      if (typeof count === "number" && count > 0) fileCovered++;
    }
    total += fileTotal;
    covered += fileCovered;
    files.push({ file, addedLines: lines.size, executableLines: fileTotal, coveredLines: fileCovered, coverageEntryMissing: !entry });
  }
  return {
    total,
    covered,
    percent: total === 0 ? 100 : (covered / total) * 100,
    skipped: total < minExecutableLines,
    minExecutableLines,
    files,
  };
}
