/**
 * 热区 a11y 清账 codemod（一次性，执行后随提交删除或保留于 scripts/tmp-*）
 *
 * 规则（与 a11y-token-contrast 门禁配方一致）：
 *  1) text-<color>-600 → text-<color>-700（浅色档，dark: 变体不动）
 *  2) text-muted-foreground/{40,50,60,70,80,90} → text-muted-foreground（禁透明度变体）
 *  3) text-destructive（不含 -foreground）→ text-destructive-text
 *  4) bg-destructive/10 → bg-destructive/15（错误条底）
 *  5) navigation-card：focus-within:opacity-100 → +pointer-coarse:opacity-100（触屏可见）
 *  6) search-palette：搜索框 border-border/70 → border-border-strong（堵 1.2:1 盲区）
 *
 * 只改 class 字符串，行尾保持原样（Node 不做换行转换）；运行前请确认目标文件无并行编辑。
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "apps/web-overlay/src/components/navigation-card.tsx",
  "apps/web-overlay/src/app/favorites/page.tsx",
  "apps/web-overlay/src/components/search-palette.tsx",
  "apps/web-overlay/src/app/search/search-results.tsx",
  "apps/web-overlay/src/app/auth/signin/page.tsx",
  "apps/web-overlay/src/components/category-quick-jump-bar.tsx",
  "apps/web-overlay/src/components/quick-access-tray.tsx",
  "apps/web-overlay/src/components/user-center/universal-bookmark-modal.tsx",
];

const COLOR_RE = /text-(amber|emerald|rose|sky|blue|indigo|purple|violet|cyan|teal|lime|orange|pink|fuchsia)-600/g;
const MUTED_RE = /text-muted-foreground\/(?:40|50|60|70|80|90)/g;
const DESTRUCTIVE_RE = /text-destructive(?!-)/g;
const DESTRUCTIVE_BG_RE = /bg-destructive\/10(?!\d)/g;

let grand = 0;
for (const f of FILES) {
  const before = readFileSync(f, "utf8");
  let s = before;
  let n = 0;
  s = s.replace(COLOR_RE, (_m, c) => { n++; return `text-${c}-700`; });
  s = s.replace(MUTED_RE, () => { n++; return "text-muted-foreground"; });
  s = s.replace(DESTRUCTIVE_RE, () => { n++; return "text-destructive-text"; });
  s = s.replace(DESTRUCTIVE_BG_RE, () => { n++; return "bg-destructive/15"; });
  if (f.endsWith("navigation-card.tsx")) {
    const hits = s.split("focus-within:opacity-100").length - 1;
    s = s.replaceAll("focus-within:opacity-100", "focus-within:opacity-100 pointer-coarse:opacity-100");
    n += hits;
  }
  if (f.endsWith("search-palette.tsx")) {
    const target = "rounded-xl border border-border/70 hover:border-border";
    if (s.includes(target)) {
      s = s.replace(target, "rounded-xl border border-border-strong hover:border-border-strong");
      n++;
    } else {
      console.warn("[warn] search-palette 搜索框边框目标串未命中，请人工复核");
    }
  }
  if (s !== before) writeFileSync(f, s, "utf8");
  console.log(`${f}: ${n} 处`);
  grand += n;
}
console.log(`[total] ${grand} 处替换`);
