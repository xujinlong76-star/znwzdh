/**
 * 可交互元素不许嵌套：**`<Link>` 里套 `<Button>`（或反过来）**。
 *
 * 这是 shadcn 生态里常见的一个失误。链接要「长得像按钮」时有两种写法：
 *
 *   1. 错的：`<Link href="/x"><Button>去 X</Button></Link>`
 *      —— `<a>` 里嵌 `<button>`：HTML 非法，读屏会念两遍
 *         （「链接 去 X 按钮」），键盘 tab 也容易落到里层那个上；
 *   2. 对的：`<Button asChild><Link href="/x">去 X</Link></Button>`
 *      —— `asChild` 让 Button 把样式交给 `<Link>`，页面上只有一个可交互元素。
 *
 * 这个仓库里两种写法都出现过（同一个文件里甚至有对照），所以本测试直接把
 * 「错的那种」钉在日常检查里：**全仓库 0 处**。
 *
 * 扫描器只认「直接子节点」：
 *   - `<Button asChild>` 包 `<Link>` → 合法，跳过；
 *   - `<Link>` 包图标/文本 → 合法，跳过；
 *   - `<Link>` 与 `<Button>` 之间有其它元素 → 不是直接嵌套，跳过（`<a>` 里包
 *     `<span><button>` 这种深层嵌套另有 lint 管，不在本测试范围）。
 *
 * 测试自带反向用例（non-vacuity）：把一段「错的」代码喂给同一个扫描器，
 * 必须被抓出来 —— 否则这个守卫只是在空跑。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

interface Tag {
  name: string;
  attrs: string;
  start: number;
  end: number;
}

/** 粗粒度 JSX 开标签读取：够用即可（找 <Link>/<a>/<Button> 的直接子节点关系） */
function readTags(src: string): Tag[] {
  const tags: Tag[] = [];
  const re = /<(Link|a|Button)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let quote: string | null = null;
    let attrs = "";
    while (i < src.length) {
      const ch = src[i];
      if (quote) {
        attrs += ch;
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        attrs += ch;
      } else if (ch === "{") {
        // 属性里的表达式：跳过大括号（含字符串里的 }）
        let depth = 1;
        attrs += ch;
        i++;
        let inner: string | null = null;
        while (i < src.length && depth > 0) {
          const c = src[i];
          if (inner) {
            if (c === inner) inner = null;
          } else if (c === '"' || c === "'" || c === "`") {
            inner = c;
          } else if (c === "{") depth++;
          else if (c === "}") depth--;
          attrs += c;
          i++;
        }
        continue;
      } else if (ch === ">") {
        break;
      } else {
        attrs += ch;
      }
      i++;
    }
    tags.push({ name: m[1], attrs, start: m.index, end: i + 1 });
  }
  return tags;
}

interface Violation {
  tag: string;
  child: string;
  index: number;
}

/** 找出「直接子节点是可交互元素」的嵌套（JSX 注释不算内容） */
function findNestedInteractive(src: string): Violation[] {
  const out: Violation[] = [];
  const tags = readTags(src);
  for (let k = 0; k < tags.length - 1; k++) {
    const t = tags[k];
    const next = tags[k + 1];
    const between = src.slice(t.end, next.start);
    // 只允许空白与 JSX 注释
    if (!/^\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)*$/.test(between)) continue;
    const linkParent = t.name === "Link" || t.name === "a";
    const buttonParent = t.name === "Button" && !/\basChild\b/.test(t.attrs);
    const childButton = next.name === "Button";
    const childLink = next.name === "Link" || next.name === "a";
    if ((linkParent && childButton) || (buttonParent && childLink)) {
      out.push({ tag: t.name, child: next.name, index: t.start });
    }
  }
  return out;
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split(/\r?\n/).length;
}

function allTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...allTsx(full));
    else if (e.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("扫描器本身是对的（否则守卫只是空跑）", () => {
  it("抓得住反例：Link 套 Button", () => {
    const bad = [
      'export function X() {',
      '  return (',
      '    <Link href="/a">',
      '      <Button variant="ghost">去 A</Button>',
      '    </Link>',
      '  )',
      '}',
    ].join("\n");
    const hits = findNestedInteractive(bad);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ tag: "Link", child: "Button" });
  });

  it("抓得住反例：Button（无 asChild）套 Link", () => {
    const bad = [
      'export function X() {',
      '  return (',
      '    <Button variant="ghost">',
      '      <Link href="/a">去 A</Link>',
      '    </Button>',
      '  )',
      '}',
    ].join("\n");
    expect(findNestedInteractive(bad)).toHaveLength(1);
  });

  it("不误报：Button asChild 包 Link 是推荐写法", () => {
    const good = [
      'export function X() {',
      '  return (',
      '    <Button asChild variant="ghost" size="sm" className="text-xs">',
      '      <Link href="/a">去 A</Link>',
      '    </Button>',
      '  )',
      '}',
    ].join("\n");
    expect(findNestedInteractive(good)).toHaveLength(0);
  });

  it("不误报：Link 里放图标/文本，或中间隔着别的元素", () => {
    const good = [
      'export function X() {',
      '  return (',
      '    <>',
      '      <Link href="/a">',
      '        <Flame className="h-4 w-4" />',
      '      </Link>',
      '      <Link href="/b">',
      '        <span>',
      '          <Button>深层不算直接嵌套</Button>',
      '        </span>',
      '      </Link>',
      '    </>',
      '  )',
      '}',
    ].join("\n");
    expect(findNestedInteractive(good)).toHaveLength(0);
  });

  it("不误报：Link 与 Button 之间只有 JSX 注释", () => {
    const mixed = [
      'export function X() {',
      '  return (',
      '    <Button',
      '      asChild',
      '    >',
      '      {/* 注释不该影响判定 */}',
      '      <Link href="/a">去 A</Link>',
      '    </Button>',
      '  )',
      '}',
    ].join("\n");
    expect(findNestedInteractive(mixed)).toHaveLength(0);
  });
});

describe("全仓库不许再有嵌套可交互元素", () => {
  const files = allTsx(join(ROOT, "src"));

  it("确实扫到了源码（不是扫了空目录）", () => {
    expect(files.length).toBeGreaterThan(80);
    const sample = files.map((f) => f.replace(/\\/g, "/")).join("\n");
    expect(sample).toContain("/components/navigation-content.tsx");
    expect(sample).toContain("/app/admin/sitelist/page.tsx");
  });

  it("推荐写法确实在用（防止有人把链接按钮删光来「通过」测试）", () => {
    let asChild = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      asChild += (src.match(/\basChild\b/g) || []).length;
    }
    expect(asChild).toBeGreaterThanOrEqual(14);
  });

  it("0 处 <Link>/<a> 直接包 <Button>，0 处 <Button>（无 asChild）直接包 <Link>/<a>", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const v of findNestedInteractive(src)) {
        problems.push(
          `${relative(ROOT, f).replace(/\\/g, "/")}:${lineOf(src, v.index)}  [${v.tag} > ${v.child}]`
        );
      }
    }
    expect(problems, "嵌套可交互元素（应用 Button asChild 或把链接改成普通按钮）：\n" + problems.join("\n")).toHaveLength(0);
  });
});
