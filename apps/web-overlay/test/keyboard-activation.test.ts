/**
 * 卡片能不能用键盘打开 + 外站能不能反过来操控我们的标签页。
 *
 * 两个真实缺陷：
 *
 * 1. **视频卡片完全没有可聚焦元素**。`VideoCard` 的根节点是一个
 *    `<div onClick={handleCardClick}>`，整张卡片里没有一个 `<a>` / `<button>` /
 *    `tabIndex`，`/videos` 上所有卡片对键盘与读屏用户**完全不可操作**。
 *    同类问题还有首页展板的折叠胶囊、Base64 结果框（点击复制）—— 都只有鼠标能用。
 *
 * 2. **部分 `window.open` 没带 noopener**。导航站打开的是用户提交的第三方站点，
 *    没有 noopener 时新页面拿到 `window.opener`，可以反过来把我们的标签页跳到钓鱼页
 *    （reverse tabnabbing）。代码里多数调用点已经写了 `'noopener,noreferrer'`，
 *    这里把剩下的补齐并**全仓扫描**防止回归。
 *
 * 已知未覆盖（见 PR 说明，不是无声忽略）：导航卡片的健康徽标
 * （位于卡片链接内部，嵌套 button 属于非法 HTML）、拓扑图节点、
 * 算法实验台画布节点、管理端表格行与选项行。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 递归收集 overlay src 下所有源码文件（相对根目录、统一 / 分隔） */
function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

/** 取 `window.open(` 的完整实参文本（按括号配平，避免被内层函数调用的 ) 截断） */
function callArgs(text: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(openParen + 1, i);
    }
  }
  return text.slice(openParen + 1);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

describe("外站打开方式：noopener 不能漏", () => {
  it("全仓每个 window.open 都带 noopener（外站不能反向跳转我们的标签页）", () => {
    const offenders: string[] = [];
    const sources = listSources(join(ROOT, "src"));
    for (const rel of sources) {
      const text = overlaySource(rel);
      const re = /window\.open\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        // 跳过注释里的示例（例如解释为什么必须带 noopener）
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        const lineText = text.slice(lineStart, text.indexOf("\n", m.index));
        if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) continue;
        const args = callArgs(text, m.index + "window.open".length);
        if (!args.includes("noopener")) offenders.push(`${rel}:${lineOf(text, m.index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("扫描确实扫到了调用点（正则写错导致空跑时要立刻发现）", () => {
    const all = listSources(join(ROOT, "src"))
      .map((rel) => overlaySource(rel))
      .join("\n");
    expect((all.match(/window\.open\(/g) || []).length).toBeGreaterThan(5);
  });
});

describe("点击即操作的元素必须是真按钮", () => {
  it("视频卡片根节点是 <button type=\"button\">，不再是 div onClick", () => {
    const text = overlaySource("src/components/video-card.tsx");
    expect(text).toContain("onClick={handleCardClick}");
    expect(text).toMatch(/<button\s+type="button"/);
    expect(text).toContain("</button>");
    // 回归保护：不能再退回「整张卡是不可聚焦的 div」
    expect(/<div[^>]*onClick=\{handleCardClick\}/.test(text)).toBe(false);
    // 按钮默认居中对齐，卡片文字必须显式左对齐
    expect(text).toContain("text-left");
  });

  it("视频弹窗的读屏描述是中文（原来是 Playing video:）", () => {
    const text = overlaySource("src/components/video-card.tsx");
    expect(text).toContain("正在播放：");
    expect(text).not.toContain("Playing video:");
  });

  it("首页展板的折叠胶囊是 <button>，键盘也能展开", () => {
    const text = overlaySource("src/components/home-hero-deck.tsx");
    expect(text).toMatch(/<button\s+type="button"\s+onClick=\{toggleHeroDeckCollapsed\}/);
    expect(/<div\s+onClick=\{toggleHeroDeckCollapsed\}/.test(text)).toBe(false);
  });

  it("Base64 结果框是 <button>，键盘也能复制", () => {
    const text = overlaySource("src/components/modular/modules/quick-tools-widget.tsx");
    expect(text).toMatch(/<button\s+type="button"\s+onClick=\{\(\) => handleCopy\(b64Output\)\}/);
    expect(/<div\s+onClick=\{\(\) => handleCopy\(b64Output\)\}/.test(text)).toBe(false);
  });

  it("视频卡片打开外链时也走 noopener（不是只改 window.open 的其它调用点）", () => {
    const text = overlaySource("src/components/video-card.tsx");
    expect(text).toContain("window.open(item.href, '_blank', 'noopener,noreferrer')");
  });
});
