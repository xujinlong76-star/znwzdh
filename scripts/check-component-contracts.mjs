#!/usr/bin/env node
/**
 * 组件 props 契约检查（零依赖静态分析）。
 *
 * 为什么不用 RTL：仓库当前没有 `@testing-library/react` / `jsdom`，`vitest` 的
 * environment 是 node。引入它们要改依赖与锁文件，属于独立决策；而本轮要挡的
 * 问题（改了 props 名、调用方没跟着改）本质是**静态可判**的。
 *
 * 判据两条：
 *   1. 调用点传了 `XProps` 里没声明的属性 → 多半是改名后漏改调用方；
 *   2. 必填属性（无 `?`）在所有调用点都没传 → 要么是死字段，要么调用方漏传。
 *
 * 局限（必须说清）：正则解析不是 AST，跨行/动态展开（`{...props}`）会跳过；
 * 含展开的调用点整条忽略，避免误报。真值以 `tsc` 为准，这里只做**早期预警**。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps/web-overlay/src");
const AS_JSON = process.argv.includes("--json");

/** 解析 `export interface XProps { ... }` → { 属性名: 是否必填 } */
export function parsePropsInterface(source, componentName) {
  const re = new RegExp(`export\\s+interface\\s+${componentName}Props\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const m = source.match(re);
  if (!m) return null;
  const props = new Map();
  for (const raw of m[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    const pm = line.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:/);
    if (pm) props.set(pm[1], !pm[2]);
  }
  return props;
}

/** 从一段 JSX 属性文本里取属性名（跳过展开、注释） */
export function parseJsxProps(attrText) {
  if (attrText.includes("{...")) return null; // 含展开：整条跳过，避免误报
  const names = new Set();
  let depth = 0;
  let quote = null;
  let i = 0;
  while (i < attrText.length) {
    const ch = attrText[i];
    if (quote) {
      if (ch === quote && attrText[i - 1] !== "\\") quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      i++;
      continue;
    }
    // 只有深度 0 的标识符才是属性名；深度 >0 是回调体，里面的 `if`/`return` 不是属性
    if (depth === 0 && /[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < attrText.length && /[\w$]/.test(attrText[j])) j++;
      const ident = attrText.slice(i, j);
      const after = attrText[j];
      if (after === "=" || after === undefined || /\s/.test(after)) names.add(ident);
      i = j;
      continue;
    }
    i++;
  }
  return names;
}


/**
 * 扫描 `<Name ...>` 的属性文本。
 *
 * 不能用 `<${name}([^>]*)>`：JSX 属性里常有 `=>`（事件回调），`>` 会让正则提前
 * 截断，导致「明明传了 onCancel 却报没传」——首版 97 条误报全来自这里。
 * 这里按**花括号配平 + 引号状态**走到真正的标签结束符。
 */
export function scanJsxAttributes(text, name) {
  const out = [];
  const re = new RegExp(`<${name}(?=[\\s/>])`, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    let attrs = "";
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        attrs += ch;
        if (ch === quote && text[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        attrs += ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
      attrs += ch;
    }
    out.push({ attrs, index: m.index });
  }
  return out;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const files = walk(SRC);
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  // 1) 收集组件与 props 声明
  const components = new Map(); // 组件名 → { file, props: Map }
  for (const [file, text] of sources) {
    const re = /export\s+function\s+([A-Z][\w]*)\s*\(/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const props = parsePropsInterface(text, m[1]);
      if (props) components.set(m[1], { file, props });
    }
  }

  // 2) 扫描所有调用点
  const usage = new Map(); // 组件名 → [{ file, line, passed:Set }]
  for (const [file, text] of sources) {
    for (const [name] of components) {
      for (const { attrs, index } of scanJsxAttributes(text, name)) {
        const passed = parseJsxProps(attrs);
        const line = text.slice(0, index).split("\n").length;
        if (!usage.has(name)) usage.set(name, []);
        // passed=null 表示含 {...spread}：这条调用点无法静态求值，
        // 记成 spread 以便后续抑制「必填未传」的误报
        usage.get(name).push({ file: relative(ROOT, file).replace(/\\/g, "/"), line, passed, spread: passed === null });
      }
    }
  }

  // 3) 判据
  const problems = [];
  for (const [name, { props }] of components) {
    const allSites = usage.get(name) ?? [];
    if (allSites.length === 0) continue; // 未被调用（可能是页面级组件），不做判断
    const sites = allSites.filter((s) => !s.spread);
    const hasSpread = allSites.some((s) => s.spread);

    for (const site of sites) {
      for (const p of site.passed) {
        if (p === "key" || p === "ref" || p === "children") continue;
        if (!props.has(p)) {
          problems.push({
            kind: "undeclared-prop",
            component: name,
            prop: p,
            file: site.file,
            line: site.line,
            hint: `${name}Props 未声明「${p}」，检查是否改名后漏改调用方`,
          });
        }
      }
    }

    // 有 spread 调用点时无法判断「必填是否被传」，整条判据跳过（宁可漏报不误报）
    if (hasSpread) continue;
    const passedAnywhere = new Set(sites.flatMap((s) => [...s.passed]));
    for (const [prop, required] of props) {
      if (!required || prop === "children") continue;
      if (!passedAnywhere.has(prop)) {
        problems.push({
          kind: "required-never-passed",
          component: name,
          prop,
          file: relative(ROOT, components.get(name).file).replace(/\\/g, "/"),
          line: null,
          hint: `${name}Props.${prop} 是必填，但 ${sites.length} 个调用点都没传`,
        });
      }
    }
  }

  if (problems.length === 0) {
    if (AS_JSON) console.log(JSON.stringify({ components: components.size, problems: [] }, null, 2));
    else console.log(`✅ 组件契约：${components.size} 个组件的 props 与调用点一致`);
    return;
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ components: components.size, problems }, null, 2));
  } else {
    console.error(`❌ 组件契约：${problems.length} 处不一致`);
    for (const p of problems) {
      const where = p.line ? `${p.file}:${p.line}` : p.file;
      console.error(`   [${p.kind}] ${where}  ${p.hint}`);
    }
    console.error("\n   注：含 `{...spread}` 的调用点会被跳过（正则无法求值展开）。");
  }
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) main();
