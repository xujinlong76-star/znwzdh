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
 *    这里把剩下的补齐并**全仓扫描**防止回归。补齐的方式是收敛到
 *    `safeWindowOpen`：features 由闸门硬编码，调用方传不进去。
 *
 * 后续：#53 让拓扑图节点变成可聚焦的 role="button"（见 graph-keyboard.test.ts），
 * 这一版把「管理端表格行与选项行」也补齐。补完之后全仓只剩两处「只有鼠标」的写法，
 * 都不是哑口，而是有键盘等价入口 —— 文末的全仓扫描会连着证据一起断言，
 * 免得这两条白名单变成一纸空文。
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

  it("视频卡片打开外链走 safeWindowOpen，noopener 由闸门硬编码（调用方没有旋钮）", () => {
    const text = overlaySource("src/components/video-card.tsx");
    expect(text).toContain("safeWindowOpen(item.href)");
    expect(text).not.toContain("window.open(");
    const guard = overlaySource("src/lib/safe-url.ts");
    expect(guard).toContain("window.open(target, '_blank', 'noopener,noreferrer')");
    // 保护必须是结构性的：helper 不接 features 参数，调用方传不进「少写一个 noopener」的串，
    // 三十个调用点也就不需要逐个复查。
    expect(guard).toMatch(/export function safeWindowOpen\(\s*value\?: string \| null\s*\)/);
  });
});

/** 非交互标签：挂上 onClick 就等于「只有鼠标能用」，除非另有键盘入口 */
const NON_CONTROL_TAGS = [
  "div", "span", "li", "tr", "td", "section", "article", "header", "footer",
  "p", "pre", "h3", "h4", "svg", "g", "rect", "circle", "path",
];

/** 剥注释但保留行列位置：块注释里的反面示例不能算数，行号还得报得准 */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

/**
 * 取出一整个 JSX 开始标签（按括号/引号配平）。
 * 不能用 `/<div[^>]*>/` 那种写法：属性里既有 `=>` 也有字符串里的 `>`。
 */
function openingTags(source: string, name: string): Array<{ text: string; index: number }> {
  const out: Array<{ text: string; index: number }> = [];
  const needle = "<" + name;
  let i = source.indexOf(needle);
  while (i !== -1) {
    const after = source[i + needle.length];
    if (after === undefined || /[\s>/]/.test(after)) {
      let depth = 0;
      let quote: string | null = null;
      let j = i;
      for (; j < source.length; j++) {
        const ch = source[j];
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
          continue;
        }
        if (ch === "{") {
          depth++;
          continue;
        }
        if (ch === "}") {
          depth--;
          continue;
        }
        if (ch === ">" && depth === 0) {
          j++;
          break;
        }
      }
      out.push({ text: source.slice(i, j), index: i });
      i = source.indexOf(needle, j);
    } else {
      i = source.indexOf(needle, i + needle.length);
    }
  }
  return out;
}

/** 纯 stopPropagation：不是「点击即操作」，只是挡住外层容器的点击 */
function isPropagationGuard(tag: string): boolean {
  return /onClick=\{\(?\s*\w+\s*\)?\s*=>\s*\{?\s*\w+\.stopPropagation\(\)\s*;?\s*\}?\s*\}/.test(tag);
}

/** 标签自带键盘支持（可聚焦 / 有按键处理 / 有语义角色） */
function hasKeyboardSupport(tag: string): boolean {
  return /\btabIndex=|\bonKeyDown=|\bonKeyPress=|\bonKeyUp=|\brole=/.test(tag);
}

interface MouseOnlyAllowlistEntry {
  file: string;
  /** 这条白名单要挡住的写法。用它反向确认「白名单没过期」 */
  marker: RegExp;
  /** 键盘等价入口必须真的还在，否则白名单就成了一纸空文 */
  evidence: string[];
  why: string;
}

/**
 * 仍然只用鼠标的写法。每一条都得说清「键盘用户怎么做到同一件事」，
 * 并把那份证据写成断言 —— 证据消失时测试必须失败，而不是继续放行。
 */
const MOUSE_ONLY_ALLOWLIST: MouseOnlyAllowlistEntry[] = [
  {
    file: "src/app/admin/audit/page.tsx",
    marker: /<tr[\s\S]*?cursor-pointer/,
    evidence: ["aria-expanded={expanded === it.id}", 'type="button"', "toggleExpanded(it.id)"],
    why:
      "整行的 onClick 只方便鼠标；展开/收起的键盘入口是「详情」单元格里的 " +
      '真按钮（<button type="button" aria-expanded>）。',
  },
  {
    file: "src/components/algorithm-lab.tsx",
    marker: /setSelectedTech\(/,
    evidence: ["TECH_NODES.map((node) => (", "onClick={() => setSelectedTech(node.id)}"],
    why:
      "庞加莱圆盘上的投影点（TECH_NODES.map((n) => … setSelectedTech(n.id))）重复了" +
      "同一块区域上方那一排 <Button>（TECH_NODES.map((node) => … setSelectedTech(node.id))），" +
      "键盘用户走那排按钮即可切换节点。",
  },
  {
    file: "src/components/navigation-card.tsx",
    marker: /onPeek\?\.\(item\)/,
    evidence: ["tabIndex={0}", "e.code === 'Space'", "onPeek?.(item)", 'title="速览与行动"'],
    why:
      "「快照自愈」徽标在卡片链接内部（<a> 里嵌 <button> 属于非法 HTML）；" +
      "它的动作有键盘入口：卡片根节点 tabIndex={0} + handleKeyDown 的 Space→onPeek，" +
      "以及同卡片里的 <Button title=\"速览与行动\">。",
  },
  {
    file: "src/components/ui/overlay.tsx",
    marker: /aria-hidden="true"[\s\S]*?onClick=\{handleClose\}/,
    evidence: [
      "document.addEventListener('keydown', onKeyDown, true)",
      "if (e.key === 'Escape')",
      "entry.close()",
      "role: 'dialog'",
    ],
    why:
      "遮罩「点空白处关闭」只服务鼠标；键盘等价入口是这个 hook 自己装的：" +
      "浮层打开时在 document 捕获阶段监听 keydown，Esc 走 entry.close() 关掉最上层浮层，" +
      "面板带 role='dialog' + tabIndex=-1 供读屏与焦点定位。遮罩 aria-hidden，本就不在辅助树里。",
  },
  // Spotlight 的三种结果行以前靠白名单说明「键盘走 ↑/↓ + Enter」。
  // 现在它们是真列表语义（role=option + aria-selected + 搜索框的 aria-activedescendant），
  // 不再是「只有鼠标」的写法，改由文末的 describe 直接断言这套接线。
];

describe("全仓扫描：能点的地方键盘也要能到", () => {
  const sources = listSources(join(ROOT, "src"));

  interface Hit {
    file: string;
    line: number;
    tag: string;
    /** 完整开始标签：白名单的 marker 要在这里匹配（摘要会被截断） */
    full: string;
    snippet: string;
  }

  const hits: Hit[] = [];
  for (const rel of sources) {
    const text = stripComments(overlaySource(rel));
    for (const name of NON_CONTROL_TAGS) {
      for (const tag of openingTags(text, name)) {
        if (!/\bonClick\b/.test(tag.text)) continue;
        if (hasKeyboardSupport(tag.text) || isPropagationGuard(tag.text)) continue;
        hits.push({
          file: rel,
          line: lineOf(text, tag.index),
          tag: name,
          full: tag.text,
          snippet: tag.text.replace(/\s+/g, " ").slice(0, 120),
        });
      }
    }
  }

  it("扫描确实扫到了东西（正则写错导致空跑时要立刻发现）", () => {
    expect(sources.length).toBeGreaterThan(60);
    expect(hits.length).toBeGreaterThan(5);
  });

  it("每一处都必须在白名单里说明「键盘怎么做同一件事」", () => {
    const unexplained = hits.filter(
      (hit) => !MOUSE_ONLY_ALLOWLIST.some((entry) => entry.file === hit.file && entry.marker.test(hit.full)),
    );
    const report = unexplained.map((hit) => `${hit.file}:${hit.line} <${hit.tag}> ${hit.snippet}`);
    expect(report, "这些地方只有鼠标能点，且没有登记原因：\n" + report.join("\n")).toEqual([]);
  });

  it("白名单没有过期（每条都还对应一处真实命中）", () => {
    const stale = MOUSE_ONLY_ALLOWLIST.filter(
      (entry) => !hits.some((hit) => hit.file === entry.file && entry.marker.test(hit.full)),
    ).map((entry) => entry.file);
    expect(stale, `这些文件已经不再需要白名单了：${stale.join(", ")}`).toEqual([]);
  });

  it("白名单里的键盘等价入口必须真的还在（否则就是空头支票）", () => {
    const broken: string[] = [];
    for (const entry of MOUSE_ONLY_ALLOWLIST) {
      const text = stripComments(overlaySource(entry.file));
      for (const snippet of entry.evidence) {
        if (!text.includes(snippet)) broken.push(`${entry.file} 缺少证据：${snippet}`);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });
});

describe("这一版补齐的管理端两处", () => {
  it("审计行：详情单元格是真按钮，行点击不再是唯一入口", () => {
    const text = overlaySource("src/app/admin/audit/page.tsx");
    expect(text).toMatch(/<button\s+type="button"\s+aria-expanded=\{expanded === it\.id\}/);
    expect(text).toContain("toggleExpanded(it.id)");
    expect(text).toContain("sr-only");
    // 行点击与按钮共用同一份逻辑（不是各自内联一份）
    expect(text).toMatch(/const toggleExpanded = \(id: number\) =>/);
    expect(text).toContain("setExpanded((prev) => (prev === id ? null : id))");
    // 回归保护：不能再退回「整行只有 onClick」
    expect(/onClick=\{\(\) => setExpanded\(expanded === it\.id/.test(text)).toBe(false);
  });

  it("分面选项：真按钮 + aria-pressed，键盘也能选中且能读出选中态", () => {
    const text = overlaySource("src/app/admin/facets/page.tsx");
    expect(text).toMatch(/<button[\s\S]{0,200}?aria-pressed=\{isSelected\}/);
    expect(text).toContain('type="button"');
    // 回归保护：不能再退回不可聚焦的 <div onClick>
    expect(/<div\s+key=\{opt\.value\}\s+onClick=/.test(text)).toBe(false);
    expect(text).toContain("focus-visible:ring-2");
  });

  it("导航卡片紧凑模式的操作行：键盘聚焦时可见（否则聚焦到看不见的按钮）", () => {
    const text = overlaySource("src/components/navigation-card.tsx");
    const rows = text.match(/sm:group-hover:opacity-100/g) || [];
    const focused = text.match(/focus-within:opacity-100/g) || [];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // 每一处 hover 才显形的地方，都必须同时支持 focus-within
    expect(focused.length).toBe(rows.length);
  });
});

describe("超级控制台（Spotlight）：对话框语义与「当前行」的申报", () => {
  const text = overlaySource("src/components/search/spotlight-modal.tsx");

  it("浮层走公共原语：遮罩是兄弟节点，面板带 role=dialog 与初始焦点交接", () => {
    expect(text).toContain("useOverlayBehavior");
    expect(text).toMatch(/\{\.\.\.containerProps\}/);
    expect(text).toMatch(/\{\.\.\.scrimProps\}\s+className="absolute inset-0/);
    // 焦点交给原语（rAF 里落地），自己再 setTimeout 抢焦点只会互相覆盖
    expect(text).not.toContain("setTimeout(() => inputRef.current?.focus()");
    expect(text).toMatch(/initialFocusRef: inputRef/);
    // Esc 的唯一实现留在原语里，本文件不再叠一份
    expect(text).not.toMatch(/e\.key === 'Escape' && open/);
  });

  it("↑/↓ 选中的行用 aria-activedescendant 申报：三套列表共用一份扁平编号", () => {
    expect(text).toMatch(/const optionIdOf = \(index: number\) => `spotlight-option-\$\{index\}`/);
    expect(text).toMatch(/aria-activedescendant=\{activeOptionId\}/);
    expect(text).toMatch(/role="combobox"/);
    // 三个列表各自有 id，且 aria-controls 指向「当前选中行所在的那个」
    for (const id of ["spotlight-cmd-listbox", "spotlight-site-listbox", "spotlight-plugin-listbox"]) {
      expect(text).toContain(`id="${id}"`);
    }
    expect(text).toMatch(/aria-controls=\{hasListbox \? listboxId : undefined\}/);
    // 行的 id 与 aria-selected 三处齐全，编号方案与 selectedIndex 一致
    expect(text).toMatch(/id=\{optionIdOf\(idx\)\}\s+role="option"\s+aria-selected=\{isSelected\}/);
    expect(text).toMatch(/id=\{optionIdOf\(itemIndex\)\}\s+role="option"\s+aria-selected=\{isSelected\}/);
    expect((text.match(/role="option"/g) || []).length).toBe(3);
    // 极客工具面板没有可选行，此时不能声称控制着某个列表
    expect(text).toMatch(/const hasListbox = totalItemCount > 0 && !\(isCommandMode && isGeekToolActive\)/);
  });

  it("结果行里 hover 才显形的快捷动作，键盘聚焦时同样显形", () => {
    const hidden = text.match(/sm:group-hover:opacity-100/g) || [];
    const revealed = text.match(/sm:group-focus-within:opacity-100/g) || [];
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    expect(revealed.length).toBe(hidden.length);
  });
});
