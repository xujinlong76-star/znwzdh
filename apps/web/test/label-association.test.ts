/**
 * 「标签紧挨着控件」时，标签必须和控件真正关联（`htmlFor` ↔ `id`）。
 *
 * 只加 `aria-label` 能解决「读屏念不出这是啥」，但解决不了另一件事：
 *
 *   <label className="...">新类目名称</label>
 *   <Input value={newTitle} />              // 点了「新类目名称」这几个字，什么都没发生
 *
 * 视觉上它是一个标签，DOM 里却和控件毫无关系 —— 鼠标/手指点它不会聚焦输入框，
 * 读屏也不会把这段文字当成控件的名字。修法是两端接上：
 *
 *   <label htmlFor="category-new-title">新类目名称</label>
 *   <Input id="category-new-title" value={newTitle} />
 *
 * 判定范围（刻意收得很窄，避免误报）：
 *   只看「`</label>` 之后紧跟的就是控件本体」的标签。
 *   - 标签里已经包着控件 → 天然关联，跳过；
 *   - 后面先是 `<div>` / `<p>` / `<Button>` 之类的容器或分组标题 → 跳过
 *     （例如「最大权限」这种下面跟的是整组单选，不是单个控件）；
 *   - 后面是 `{条件 && ...}` 这类表达式 → 跳过（保守起见不做判断）。
 *
 * 本次压掉 21 处（8 个文件），顺带删掉这些控件上重复的 `aria-label`，
 * 让「可见文字」成为唯一的名字来源（避免两边措辞不一致）。
 * 其余控件在 #66 里已有 `aria-label`，不受影响。
 *
 * 本测试把规则钉死在 **0 处违规**（没有白名单），并自带反向用例。
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

const CONTROL_TAGS = new Set(["Input", "input", "Textarea", "textarea", "select", "SelectTrigger"]);

/** 从 `from` 起找当前标签的结尾 `>`（跳过字符串、模板串与花括号表达式） */
function endOfTag(src: string, from: number): number {
  let i = from;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      let depth = 1;
      i++;
      let inner: string | null = null;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (inner) {
          if (c === inner) inner = null;
        } else if (c === '"' || c === "'" || c === "`") inner = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      continue;
    } else if (ch === ">") {
      return i;
    }
    i++;
  }
  return -1;
}

/** `</label>` 之后第一个有意义的东西是什么（跳过空白与 {...} 注释/表达式） */
function afterLabel(src: string, from: number): { kind: "expression" | "tag" | "other"; name?: string } {
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "{") {
      let depth = 1;
      i++;
      let quote: string | null = null;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      return { kind: "expression" };
    }
    if (ch === "<") {
      const m = /^<([A-Za-z][A-Za-z0-9]*)/.exec(src.slice(i));
      if (!m) return { kind: "other" };
      return { kind: "tag", name: m[1] };
    }
    return { kind: "other" };
  }
  return { kind: "other" };
}

interface Offender {
  index: number;
  text: string;
}

function unassociatedLabels(src: string): Offender[] {
  const out: Offender[] = [];
  const re = /<label\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const openEnd = endOfTag(src, m.index + 6);
    if (openEnd === -1) continue;
    const openTag = src.slice(m.index, openEnd);
    if (/\bhtmlFor=/.test(openTag)) continue;

    const closeRel = src.slice(openEnd).search(/<\/label>/);
    if (closeRel === -1) continue;
    const closeAbs = openEnd + closeRel;

    // 标签里就包着控件 → 天然关联
    const inner = src.slice(openEnd, closeAbs);
    if (/<(Input|input|Textarea|textarea|select|SelectTrigger)\b/.test(inner)) continue;

    // 标签后面紧跟的是不是控件本体
    const next = afterLabel(src, closeAbs + "</label>".length);
    if (next.kind !== "tag" || !next.name || !CONTROL_TAGS.has(next.name)) continue;

    out.push({ index: m.index, text: src.slice(m.index, Math.min(closeAbs + 8, m.index + 120)).replace(/\s+/g, " ") });
  }
  return out;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split(/\r?\n/).length;

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
  it("抓得住：标签后面紧跟控件、却没关联", () => {
    const bad = ['const X = () => (', "  <>", '    <label className="x">分类名称</label>', "    <Input value={a} />", "  </>", ")"].join("\n");
    const hits = unassociatedLabels(bad);
    expect(hits).toHaveLength(1);
  });

  it("抓得住：下拉框与文本域也算", () => {
    expect(unassociatedLabels('<label>有效期</label>\n<select value={a} onChange={f} />')).toHaveLength(1);
    expect(unassociatedLabels('<label>备注</label>\n<Textarea value={a} />')).toHaveLength(1);
    expect(unassociatedLabels('<label>分类</label>\n<SelectTrigger><SelectValue /></SelectTrigger>')).toHaveLength(1);
  });

  it("不误报：已经用 htmlFor 关联好了", () => {
    const good = ['const X = () => (', "  <>", '    <label htmlFor="cat">分类名称</label>', '    <Input id="cat" value={a} />', "  </>", ")"].join("\n");
    expect(unassociatedLabels(good)).toHaveLength(0);
  });

  it("不误报：控件就包在标签里面", () => {
    const wrapped = ['const X = () => (', '  <label className="flex">', "    启用", "    <input type=\"checkbox\" checked />", "  </label>", ")"].join("\n");
    expect(unassociatedLabels(wrapped)).toHaveLength(0);
  });

  it("不误报：中间隔着容器（分组标题 / 换行布局）", () => {
    const grouped = ['const X = () => (', "  <>", '    <label className="x">最大权限</label>', '    <div className="grid">', "      <Input value={a} />", "    </div>", "  </>", ")"].join("\n");
    expect(unassociatedLabels(grouped)).toHaveLength(0);
  });

  it("不误报：最后是条件表达式", () => {
    const conditional = ['const X = () => (', "  <>", "    <label>{schema.label}</label>", "    {schema.type === 'text' && (", "      <Input value={a} />", "    )}", "  </>", ")"].join("\n");
    expect(unassociatedLabels(conditional)).toHaveLength(0);
  });

  it("不误报：标签后面是段落或按钮", () => {
    expect(unassociatedLabels('<label className="x">有效期限</label>\n<p className="hint">…</p>\n<select value={a} />')).toHaveLength(0);
    expect(unassociatedLabels('<label className="x">选择文件</label>\n<Button onClick={f}>选择</Button>\n<input type="file" />')).toHaveLength(0);
  });
});

describe("「标签紧挨着控件」时都要真正关联", () => {
  const files = allTsx(join(ROOT, "src"));

  it("确实扫到了源码（不是扫了空目录）", () => {
    expect(files.length).toBeGreaterThan(80);
    const all = files.map((f) => f.replace(/\\/g, "/")).join("\n");
    expect(all).toContain("/app/admin/tokens/page.tsx");
    expect(all).toContain("/components/home-diy-toolbar.tsx");
  });

  it("这条规则确实被用上了（防止有人删掉标签来让测试通过）", () => {
    let count = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      count += (src.match(/\bhtmlFor=/g) || []).length;
    }
    expect(count).toBeGreaterThanOrEqual(22);
  });

  it("0 处「标签紧挨着控件却没关联」", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const v of unassociatedLabels(src)) {
        problems.push(`${relative(ROOT, f).replace(/\\/g, "/")}:${lineOf(src, v.index)}  ${v.text}`);
      }
    }
    expect(
      problems,
      "这些标签紧挨着控件却没有 htmlFor 关联（点标签不会聚焦控件）：\n" + problems.join("\n")
    ).toHaveLength(0);
  });
});
