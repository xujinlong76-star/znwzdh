import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 升级第 6 条守卫：全仓不再有裸 `text-destructive` 前景类名。
 *
 * 根因：深色下 `--destructive` 是暗红按钮底（0 62.8% 30.6%），当文字用对深底
 * 只有 1.98:1（globals.css 注释与 a11y-token-contrast 的 token 锁同口径），
 * 图标同理跌破 WCAG 1.4.11 非文本 3:1。文字与图标前景一律走
 * `text-destructive-text`（深色 #F37272，对深底 7.07:1）。
 *
 * 与 a11y-token-contrast 的冷区禁令不同：本测试不认 WIP_HOT_EXEMPT 豁免，
 * 扫全量 overlay 源码。2026-11-15 第 6 条落地时全仓 19 处（13 文件）已
 * 换完，计数归零；此后任何一处回潮即红。`text-destructive-foreground`
 *（按钮内文字，随按钮底色走）与 `text-destructive-text` 不受禁令。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
function overlayPath(rel: string): string {
  const candidates = [
    resolve(HERE, "..", rel),
    resolve(HERE, "..", "..", "web-overlay", rel),
  ];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return hit;
}
const OVERLAY_SRC = resolve(
  overlayPath("src/styles/globals.css"),
  "..",
  "..",
);
const OLD_CLASS = /text-destructive(?!-foreground|-text)/g;

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkSources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("裸 text-destructive 前景类名全仓为 0（升级第 6 条）", () => {
  it("overlay 源码不再有 text-destructive（不含 -text / -foreground 后缀）", () => {
    const bad: string[] = [];
    for (const file of walkSources(OVERLAY_SRC)) {
      const rel = relative(OVERLAY_SRC, file).replaceAll("\\", "/");
      const src = readFileSync(file, "utf8");
      const hits = [...src.matchAll(OLD_CLASS)].length;
      if (hits > 0) bad.push(`${rel}（${hits} 处）`);
    }
    expect(
      bad,
      `以下文件的危险前景仍用 text-destructive（深色下 1.98:1）：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n改为 text-destructive-text。`,
    ).toEqual([]);
  });
});
