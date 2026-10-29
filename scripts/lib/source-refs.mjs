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

/**
 * 仓库根相对的顶层目录：路径字面量以此开头才算「指向仓库里的某个文件」，
 * 否则是包名、URL、临时目录里的假路径。
 *
 * `.github/`、`docker/`、`docs/` 这三类**非代码**目标是 2026-10-29 补进来的盲区：
 * 它们没有代码后缀，于是「改 CI 接线」在两道门禁眼里都等于没改——
 *   · 选测：`scripts/check-ci-gate.test.ts` 真读 `.github/workflows/ci.yml`，改 ci.yml 却不选它；
 *   · 提交原子性：只提交那个测试、把 ci.yml 的改动留在工作区，本地绿、CI 检出提交树红。
 * 同一件事在两处各判一次，所以表只放这里。
 *
 * 一处定义四处用（选测的抽取正则 / 选测的「仓库相对 vs overlay 相对」判定 /
 * 回放的可见集 / 提交原子性的依赖抽取）：分两处写迟早只加一半——这是同日实测到的失效方式。
 */
export const REPO_RELATIVE_PREFIXES = ["apps", "packages", "scripts", "types", "e2e", ".github", "docker", "docs"];

/** 字面量里的目录名转成正则片段（`.github` 的点必须转义） */
export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 路径字面量的「仓库根相对」判定：以表内某项 + `/` 开头 */
export function isRepoRelativePath(p) {
  const s = String(p).replace(/\\/g, "/");
  return REPO_RELATIVE_PREFIXES.some((prefix) => s.startsWith(prefix + "/"));
}

/**
 * 正则字面量的前导字符：出现在这些字符之后，`/` 才是「正则开头」而不是除号。
 * 判据保守：只认明确的表达式开头位置；认不出就按除号处理（最坏是没识别到正则，
 * 不会把普通代码当成正则吞掉）。
 */
const REGEX_PRECEDERS = new Set([..."(=:[,!&|?{};+-*%~^<>"]);

/**
 * 从 `start` 处的 `/` 起找同行闭合的 `/`（跳过转义与字符类里的 `/`）。
 * 找不到返回 -1——模板里出现跨行「正则」时宁可当除号。
 */
function regexLiteralEnd(source, start) {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "\n") return -1;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i;
  }
  return -1;
}

/** 去掉块注释与行注释（保留换行，行号不变）；字符串、正则字面量原样保留 */
export function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | single | double | template
  // 上一个非空白字符：用来判断 `/` 是正则还是除号。正则里常含引号/反引号，
  // 不认出来就会把它当成字符串起点，此后整段代码（含注释）都不再被剥离——
  // 原子性门禁因此把文档注释里的示例路径读成真实依赖（2026-10-29 实际踩到）。
  let last = "";
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
      if (ch === "/" && (last === "" || REGEX_PRECEDERS.has(last))) {
        const end = regexLiteralEnd(source, i);
        if (end !== -1) {
          let j = end + 1;
          while (j < n && /[a-z]/i.test(source[j])) j += 1;
          out += source.slice(i, j);
          last = source[j - 1] ?? "/";
          i = j;
          continue;
        }
      }
      if (ch === "'") {
        state = "single";
        out += ch;
        last = ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        state = "double";
        out += ch;
        last = ch;
        i += 1;
        continue;
      }
      if (ch === "`") {
        state = "template";
        out += ch;
        last = ch;
        i += 1;
        continue;
      }
      out += ch;
      if (!/\s/.test(ch)) last = ch;
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
      last = ch;
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

/**
 * 工作区包别名：`@navhub/store` → `packages/store/src`。
 *
 * 谁需要共享它：模块图（test-impact）与提交原子性（commit-atomicity）都要解析
 * 跨包 import。各写一份的后果是 2026-10-29 的事故漏检——路由 `from "@navhub/store"`，
 * 原子性门禁只认相对路径与 `@/`，依赖整条边解析不到，脏文件自然看不见。
 *
 * `@/` 不在这里：它随「文件属于哪棵树」（overlay / vendored web）而变，由调用方补。
 */
export const WORKSPACE_ALIAS_ROOTS = {
  "@navhub/core": "packages/core/src",
  "@navhub/ai": "packages/ai/src",
  "@navhub/mcp": "packages/mcp/src",
  "@navhub/store": "packages/store/src",
};

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
