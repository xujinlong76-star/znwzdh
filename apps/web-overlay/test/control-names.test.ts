/**
 * 只有图标的控件必须带着名字。
 *
 * 真实缺陷：`size="icon"` 的按钮里只有一枚图标，没有文字。读屏软件会把它们念成
 * 一个光秃秃的「按钮」——用户不知道点下去会发生什么。改动前全仓有 14 个这样的控件：
 *
 *  - 三个排版弹窗的右上角关闭按钮（<X />）；
 *  - /graph 的放大 / 缩小 / 重置视图；
 *  - /videos 与播放器的「返回主页 / 返回视频中心」（`<Link>` 里包着图标按钮，
 *    链接本身也没有名字）；
 *  - 视频列表页的移动端「打开菜单」；
 *  - 站点速览弹窗里「访问该站点」的外链按钮；
 *  - 管理端资源页的「清除已选图片」。
 *
 * 顺带修正一处中英混排：视频页的返回链接原本是 `aria-label="Back to Home"`。
 *
 * 判定规则（这也是本测试要永久守住的东西）：`size="icon"` 的按钮必须满足其一 ——
 *   1. 标签上直接写了 `aria-label` / `aria-labelledby` / `title`；
 *   2. 按钮体内有 `sr-only` 文本；
 *   3. 它被一个**自带名字的** `<Link>` / `<a>` 包着（链接才是被聚焦与播报的元素）；
 *   4. 它是 `asChild` 按钮，名字写在它内部那个 `<Link>` / `<a>` 上
 *      （推荐的链接按钮写法：`<Button asChild size="icon"><Link aria-label="热度榜">…`）。
 *
 * 第 3 与第 4 条是同一件事的两种排布：**可访问名必须来自某个真实承载交互的元素**。
 * 曾经只有第 3 条，因为过去的写法就是 `<Link><Button/></Link>`；那种写法属于
 * 「嵌套可交互元素」（`nested-interactive.test.ts` 现在禁止），改成 `asChild` 之后
 * 名字从「外层链接」变成了「内层链接」，规则 4 就是为它补的 —— 不能因为搬家
 * 就把这条守卫绕过去。
 *
 * 扫描用的 `>>` 判定是**按花括号配平**找标签结尾的：`onClick={() => …}` 里那个 `>`
 * 属于箭头函数，简单正则会在那里截断，把「有 title」的按钮误判成没名字。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

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

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listSources(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

/** 从 from 开始找到花括号配平后的标签结尾 `>` */
function endOfTag(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** 该下标处的按钮是否被一个自带名字的 <Link>/<a> 包着 */
function insideNamedLink(src: string, index: number): boolean {
  const before = src.slice(0, index);
  const linkAt = before.lastIndexOf("<Link");
  const anchorAt = before.lastIndexOf("<a ");
  const start = Math.max(linkAt, anchorAt);
  if (start === -1) return false;
  const segment = src.slice(start, index);
  // 已经闭合说明不在里面
  if (segment.includes("</Link>") || segment.includes("</a>")) return false;
  const tagEnd = endOfTag(src, start + 1);
  if (tagEnd === -1) return false;
  const attrs = src.slice(start, tagEnd);
  return /aria-label=|aria-labelledby=|title=/.test(attrs);
}

function unnamedIconButtons(): string[] {
  const offenders: string[] = [];
  for (const rel of listSources(join(ROOT, "src"))) {
    const src = overlaySource(rel);
    const re = /<Button\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const tagEnd = endOfTag(src, m.index + "<Button".length);
      if (tagEnd === -1) continue;
      const attrs = src.slice(m.index + "<Button".length, tagEnd);
      if (!/size=["']icon["']/.test(attrs)) continue;
      if (/aria-label=|aria-labelledby=|title=/.test(attrs)) continue;
      const selfClosing = /\/\s*$/.test(attrs);
      let body = "";
      if (!selfClosing) {
        const close = src.indexOf("</Button>", tagEnd);
        body = close === -1 ? "" : src.slice(tagEnd + 1, close);
      }
      if (/sr-only/.test(body)) continue;
      // asChild：可访问名写在内层 <Link> / <a> 上（推荐写法）
      if (/\basChild\b/.test(attrs) && /<(Link|a)\b[^>]*(aria-label=|aria-labelledby=|title=)/.test(body)) continue;
      if (insideNamedLink(src, m.index)) continue;
      offenders.push(`${rel}:${src.slice(0, m.index).split(/\r?\n/).length}`);
    }
  }
  return offenders;
}

describe("只有图标的控件必须带着名字", () => {
  it("扫描本身有效（否则空数组会假装通过）", () => {
    const all = listSources(join(ROOT, "src"))
      .map((rel) => overlaySource(rel))
      .join("\n");
    expect((all.match(/size=["']icon["']/g) || []).length).toBeGreaterThan(40);
  });

  it("每个 size=\"icon\" 按钮都有 aria-label / title / sr-only / 带名字的外层链接", () => {
    expect(unnamedIconButtons()).toEqual([]);
  });

  it("规则 4（asChild + 内层具名链接）确实在被使用 —— 否则它只是纸面条文", () => {
    let count = 0;
    for (const rel of listSources(join(ROOT, "src"))) {
      const src = overlaySource(rel);
      const re = /<Button\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const tagEnd = endOfTag(src, m.index + "<Button".length);
        if (tagEnd === -1) continue;
        const attrs = src.slice(m.index, tagEnd);
        if (!/\basChild\b/.test(attrs)) continue;
        if (!/size=["']icon["']/.test(attrs)) continue;
        const close = src.indexOf("</Button>", tagEnd);
        const body = close === -1 ? "" : src.slice(tagEnd + 1, close);
        if (/<(Link|a)\b[^>]*(aria-label=|aria-labelledby=|title=)/.test(body)) count++;
      }
    }
    // 至少这 6 处图标按钮（导航栏的热度榜 / GitHub 仓库、视频页与播放器页各 2 处）
    // 靠规则 4 才算「有名字」；如果规则 4 被删掉，它们会立刻被规则 1-3 判为无名。
    expect(count).toBeGreaterThanOrEqual(6);
  });
});

describe("改动过的那批控件（防止回退）", () => {
  it.each([
    "src/components/modular/module-library-modal.tsx",
    "src/components/modular/template-modal.tsx",
    "src/components/modular/widget-config-modal.tsx",
  ])("%s 的关闭按钮有名字", (rel) => {
    const src = overlaySource(rel);
    expect(src).toMatch(/aria-label="关闭"/);
    expect(src).toContain("onClick={onClose}");
  });

  it("图谱缩放按钮都有名字", () => {
    const src = overlaySource("src/components/ecosystem-graph.tsx");
    for (const label of ["放大", "缩小", "重置视图"]) {
      expect(src).toContain(`aria-label="${label}"`);
    }
  });

  it("视频页返回链接是中文名（原来叫 Back to Home）", () => {
    const src = overlaySource("src/components/video-content.tsx");
    expect(src).toContain('aria-label="返回主页"');
    expect(src).not.toContain("Back to Home");
    expect(src).toContain('aria-label="打开菜单"');
  });

  it("播放器页的两个图标链接都有名字", () => {
    const src = overlaySource("src/components/video-player-page.tsx");
    expect(src).toContain('aria-label="返回主页"');
    expect(src).toContain('aria-label="返回视频中心"');
  });

  it("速览弹窗的外链按钮与管理端清除图片按钮都有名字", () => {
    expect(overlaySource("src/components/site-peek-dialog.tsx")).toContain('aria-label="访问该站点"');
    expect(overlaySource("src/app/admin/resources/page.tsx")).toContain('aria-label="清除已选图片"');
  });
});
