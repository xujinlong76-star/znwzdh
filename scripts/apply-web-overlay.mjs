/**
 * 将 apps/web-overlay 覆盖层文件精确写入 apps/web。
 * 使用 writeFileSync(dest, readFileSync(src)) 避免 Windows 上 cpSync 产生的 unlink 锁。
 *
 * 与相邻工具的分工（详见 scripts/check-web-overlay.mjs 头部注释）：
 *   - 本脚本：**无差别**覆盖全部 overlay 文件，用于「漂移判定本身存疑」时的兜底。
 *   - scripts/check-web-overlay.mjs --fix / scripts/sync-overlay-drift.mjs：
 *     只写「有差异 / 缺失」的文件（快、且会先打印差异清单），日常修漂移优先用它们。
 *   - scripts/sync-web-overlay.mjs：联网拉上游 tarball 重建 apps/web（刷新上游底座时才用）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { isExcluded } from './lib/overlay-drift.mjs';

const ROOT = resolve('.');
const OVERLAY = join(ROOT, 'apps', 'web-overlay');
const TARGET = join(ROOT, 'apps', 'web');

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(OVERLAY, full);
    if (isExcluded(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      result.push(...walk(full));
    } else {
      result.push(rel);
    }
  }
  return result;
}

const files = walk(OVERLAY);
let copied = 0;
for (const rel of files) {
  const src = join(OVERLAY, rel);
  const dest = join(TARGET, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
  copied++;
}

console.log(`[apply] 已将 ${copied} 个 overlay 文件完全同步到 apps/web。`);
