/**
 * 源码引用解析（被「提交完整性」「依赖边界」「客户端模块图」三个门禁共用）。
 *
 * 为什么单独抽：三处门禁都需要回答同一个问题——「这一行到底引用了哪个文件」。
 * 各自写一份正则，迟早出现「一个认得出 `export … from`、另一个只认 `import`」，
 * 于是同一个漏网文件只被其中一道门禁看见。
 *
 * 解析口径刻意保守：
 *   - 只认**静态**说明符（import / export … from / require / import()）；
 *   - 先剥注释，避免把注释里的示例路径当成真实引用；
 *   - 不做 TypeScript 语法树：门禁要能在毫秒级跑在 pre-commit 里，正则足够，
 *     代价是极少数跨行/拼接写法识别不到——这类写法在仓库内不存在，
 *     真出现时由 typecheck 兜底（模块解析失败会报错）。
 */

/** 去掉块注释与行注释（保留换行，行号不变）；字符串原样保留 */
export function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | single | double | template
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = "single";
        out += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        state = "double";
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "`") {
        state = "template";
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += ch;
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
      if (ch === "\n") out += "\n";
      i += 1;
      continue;
    }
    // 字符串内部：只关心转义与结束符
    if (ch === "\\") {
      out += ch + (next ?? "");
      i += 2;
      continue;
    }
    if (
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`")
    ) {
      state = "code";
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 遮掉模板字符串（反引号）内容：保留行数与列宽，字符换成空格。
 *
 * 为什么要单独一步：`extractSpecifiers` 认单引号/双引号里的说明符是**正确**的
 * （`import("x")`、`next/dynamic` 靠它），但示例代码常写成模板串，里面那句
 * `import { createServer } from 'node:http'` 会被当真引用抓到。
 * 真实例子：`video-ocr-code-extractor-dialog.tsx` 的 OCR 演示文案。
 *
 * 只遮反引号，不遮单/双引号——否则动态 import 的边全丢，模块图就不完整了。
 * 注释、字符串、模板串之间的边界与 `stripComments` 用同一套状态机口径。
 */
export function maskTemplateLiterals(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | single | double | template
  const blank = (ch) => (ch === "\n" ? "\n" : " ");
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === "`") {
        state = "template";
        out += " ";
        i += 1;
        continue;
      }
      if (ch === "'" || ch === '"') state = ch === "'" ? "single" : "double";
      out += ch;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") state = "code";
      out += ch;
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        out += ch + next;
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (state === "single" || state === "double") {
      if (ch === "\\") {
        out += ch + (next ?? "");
        i += 2;
        continue;
      }
      if (ch === "'" && state === "single") state = "code";
      if (ch === '"' && state === "double") state = "code";
      out += ch;
      i += 1;
      continue;
    }
    // template：整段（含 ${…}）遮成空格，只保留换行以对齐行号
    if (ch === "\\") {
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "`") {
      state = "code";
      out += " ";
      i += 1;
      continue;
    }
    out += blank(ch);
    i += 1;
  }
  return out;
}

const SPEC_PATTERNS = [
  // import x from "y" / import {a} from "y" / import "y"
  /(?:^|[\s;{(])import\s+(?:[^'"();]+?\s+from\s+)?["']([^"']+)["']/g,
  // export {a} from "y" / export * from "y"
  /(?:^|[\s;}])export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
  // require("y")
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  // import("y")
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** 抽取文件中全部静态引用：[{ spec, line }]，行号从 1 开始 */
export function extractSpecifiers(source) {
  const code = stripComments(source);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const found = new Map(); // `${line}:${spec}` 去重
  for (const re of SPEC_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      const offset = m.index + m[0].lastIndexOf(spec);
      found.set(`${lineOf(offset)}:${spec}`, { spec, line: lineOf(offset) });
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line || a.spec.localeCompare(b.spec));
}

/** package.json 的 scripts 里 `node scripts/xxx.mjs` 这类引用 */
export function extractScriptRefs(scripts) {
  const refs = [];
  for (const [name, cmd] of Object.entries(scripts ?? {})) {
    if (typeof cmd !== "string") continue;
    const re = /\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*((?:\.\/)?[\w./-]+\.(?:mjs|cjs|js|ts))/g;
    let m;
    while ((m = re.exec(cmd)) !== null) refs.push({ script: name, spec: m[1] });
  }
  return refs;
}

const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx", ".json"];

/** 把说明符解析成仓库内的绝对路径；解析不到或指向包名时返回 null */
export function resolveSpecifier(fromFile, spec, { aliasRoots = {}, exists }) {
  if (!spec || spec.startsWith("node:") || spec.startsWith("http:") || spec.startsWith("https:")) return null;
  let base = null;
  if (spec.startsWith(".")) {
    base = joinPath(dirnameOf(fromFile), spec);
  } else {
    for (const [prefix, root] of Object.entries(aliasRoots)) {
      if (spec === prefix || spec.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) {
        base = joinPath(root, spec.slice(prefix.length));
        break;
      }
    }
  }
  if (!base) return null;
  for (const ext of EXTENSIONS) {
    const candidate = normalizePath(base + ext);
    if (exists(candidate)) return candidate;
  }
  for (const ext of EXTENSIONS.slice(1)) {
    const candidate = normalizePath(joinPath(base, "index" + ext));
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** 极简路径工具：避免在 Windows 上引入 path.win32 差异（门禁输出统一用 /） */
export function normalizePath(p) {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}
export function dirnameOf(p) {
  const norm = normalizePath(p);
  const idx = norm.lastIndexOf("/");
  return idx < 0 ? "." : norm.slice(0, idx);
}
export function joinPath(a, b) {
  const left = normalizePath(a).replace(/\/+$/, "");
  const right = normalizePath(b).replace(/^\/+/, "");
  const parts = [];
  for (const seg of (left + "/" + right).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
