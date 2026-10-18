/**
 * 表单控件必须有**可访问名**：`aria-label` / `aria-labelledby`，或被真实关联的 `<label>`。
 *
 * 只有 `placeholder` 不算名字。这是这个仓库里最普遍的一处无障碍缺口：
 *
 *   <Input placeholder="搜索站点..." />        // 读屏只念「编辑框」，不知道搜什么
 *
 * placeholder 是**视觉提示**：它在输入第一个字符后就消失了，而且不吃「标题/描述」这类
 * 语义。屏幕阅读器用户进到表单里，听到一串「编辑框、编辑框、下拉框」，无法判断该填什么。
 *
 * 判定：一个控件「有名字」当且仅当满足其一 ——
 *   1. 标签上写了 `aria-label` / `aria-labelledby`；
 *   2. 被 `<label>` / `<Label>` 元素包着；
 *   3. 有 `id`，且同文件里有 `htmlFor="同一个 id"` 关联的标签；
 *   4. 落在 shadcn 表单上下文里（`<FormField>` 通过 context 注入 id/描述），
 *      或用了 `{...field}` / `{...props}` 这类属性透传；
 *   5. 是**装饰性**控件（`aria-hidden="true"`，例如笔记里那两枚「只读复刻」的待办勾选框，
 *      语义已经由紧邻的文字承载）。
 *
 * 这次改动给 80+ 个控件补了名字，来源分三类（都在 PR 里说明了）：
 *   - 字面 placeholder 本身就是描述 → 直接取用（去掉「例如：」「…」这类装饰）；
 *   - placeholder 是**示例**（"ai-starter"）或旁边有可见文字 → 取旁边那行文字；
 *   - 只读输出框（"结果输出…"）→ 按它输出的内容命名。
 *
 * 本测试把规则钉死在 **0 处违规**（没有白名单），并自带反向用例保证扫描器不是空跑。
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

const CONTROL_RE = /<(Input|input|Textarea|textarea|SelectTrigger|select)\b/g;

interface Offender {
  tag: string;
  index: number;
}

function unnamedControls(src: string): Offender[] {
  const out: Offender[] = [];
  const re = new RegExp(CONTROL_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1];
    const tagEnd = endOfTag(src, m.index + name.length + 1);
    if (tagEnd === -1) continue;
    const attrs = src.slice(m.index, tagEnd);

    if (/aria-label=|aria-labelledby=|aria-hidden=/.test(attrs)) continue;
    if (/\{\.\.\.(field|props|register)/.test(attrs)) continue;

    // shadcn 表单：<FormField> 会通过 context 给控件接上 id 与描述
    const before = src.slice(0, m.index);
    const openFormField = before.lastIndexOf("<FormField");
    if (openFormField !== -1 && openFormField > before.lastIndexOf("</FormField>")) continue;

    // 被 <label> / <Label> 包着
    const lastLabel = Math.max(before.lastIndexOf("<label"), before.lastIndexOf("<Label"));
    if (lastLabel !== -1) {
      const openEnd = endOfTag(src, lastLabel + 6);
      const closeIdx = src.slice(lastLabel).search(/<\/(label|Label)>/);
      if (openEnd !== -1 && openEnd < m.index && (closeIdx === -1 || lastLabel + closeIdx > m.index)) continue;
    }

    // id + htmlFor 配对
    const idm = attrs.match(/\bid=("([^"]+)"|'([^']+)')/);
    if (idm) {
      const id = idm[2] || idm[3];
      if (id && (src.includes(`htmlFor="${id}"`) || src.includes(`htmlFor='${id}'`))) continue;
    }
    if (/\bid=\{/.test(attrs) && /htmlFor=\{/.test(src)) continue;

    out.push({ tag: name, index: m.index });
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
  it("抓得住：只有 placeholder 的输入框", () => {
    const bad = 'export const X = () => <Input placeholder="搜索站点..." />';
    const hits = unnamedControls(bad);
    expect(hits).toHaveLength(1);
    expect(hits[0].tag).toBe("Input");
  });

  it("抓得住：没有名字的下拉与文本域", () => {
    expect(unnamedControls('const X = () => <select value={a} onChange={f} />')).toHaveLength(1);
    expect(unnamedControls('const X = () => <textarea value={a} onChange={f} />')).toHaveLength(1);
    expect(unnamedControls('<SelectTrigger className="w-40"><SelectValue /></SelectTrigger>')).toHaveLength(1);
  });

  it("不误报：aria-label / aria-labelledby / aria-hidden", () => {
    expect(unnamedControls('<Input aria-label="搜索站点" />')).toHaveLength(0);
    expect(unnamedControls('<Input aria-labelledby="t" />')).toHaveLength(0);
    expect(unnamedControls('<input aria-hidden="true" type="checkbox" readOnly />')).toHaveLength(0);
  });

  it("不误报：被 label 包着 / id 与 htmlFor 配对 / FormField 上下文", () => {
    const wrapped = ["const X = () => (", '  <label>', "    站点名称", "    <input value={a} />", "  </label>", ")"].join("\n");
    expect(unnamedControls(wrapped)).toHaveLength(0);

    const paired = ['const X = () => (', "  <>", '    <Label htmlFor="site-name">站点名称</Label>', '    <Input id="site-name" value={a} />', "  </>", ")"].join("\n");
    expect(unnamedControls(paired)).toHaveLength(0);

    const shadcnForm = [
      "const X = () => (",
      '  <FormField name="site" render={() => (',
      "    <FormItem>",
      "      <FormLabel>站点名称</FormLabel>",
      "      <FormControl>",
      "        <Input value={a} />",
      "      </FormControl>",
      "    </FormItem>",
      "  )} />",
      ")",
    ].join("\n");
    expect(unnamedControls(shadcnForm)).toHaveLength(0);
  });
});

describe("全仓库的表单控件都得有可访问名", () => {
  const files = allTsx(join(ROOT, "src"));

  it("确实扫到了源码（不是扫了空目录）", () => {
    expect(files.length).toBeGreaterThan(80);
    const all = files.map((f) => f.replace(/\\/g, "/")).join("\n");
    expect(all).toContain("/app/admin/sitelist/page.tsx");
    expect(all).toContain("/components/quick-tools-drawer.tsx");
  });

  it("规则确实被大量使用（防止有人删控件来「通过」测试）", () => {
    let named = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const re = new RegExp(CONTROL_RE.source, "g");
      let m: RegExpExecArray | null;
      let total = 0;
      while ((m = re.exec(src))) total++;
      named += total - unnamedControls(src).length;
    }
    expect(named).toBeGreaterThanOrEqual(85);
  });

  it("0 处没有可访问名的控件", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const v of unnamedControls(src)) {
        problems.push(`${relative(ROOT, f).replace(/\\/g, "/")}:${lineOf(src, v.index)}  <${v.tag}>`);
      }
    }
    expect(
      problems,
      "这些控件没有可访问名（placeholder 不算），请补 aria-label 或与 <label> 关联：\n" + problems.join("\n")
    ).toHaveLength(0);
  });
});
