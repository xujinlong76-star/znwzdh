/**
 * RSC / Client 边界守卫。
 *
 * 真实缺陷（本次整站 500 的根因）：`app/layout.tsx` 是服务端组件，它 import 的
 * `lib/density-bootstrap.ts` 又 import 了 `lib/user-preferences.ts`，而后者的第一行代码是
 * `import { useSyncExternalStore } from 'react'`。Next 的判定是「把依赖 useSyncExternalStore
 * 的模块导进了 React Server Component」，报错点是那个 react import，而不是 layout——
 * 结果不只是首页，连 `/api/*` 全部 500（dev 下整棵服务端图共用一次编译）。
 *
 * 这类错误的特征：**编译器报错点离真正的边很远**，人肉找不到。所以这里把服务端可达图
 * 走一遍，直接指出「哪个服务端模块最终 import 了 React hook」。
 * 判据只看两条，避免误报：
 *  - 文件顶部（注释之后）有 'use client' / 'use server' 的，视为边界，不再向下走；
 *  - 入口取 `src/app/**` 下没有客户端指令的文件（页面 / 布局 / 路由处理器）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "src");

/** Next 会对「服务端模块 import 客户端专用 API」报错的这些 hook */
const CLIENT_HOOKS =
  /\b(?:useSyncExternalStore|useState|useEffect|useLayoutEffect|useReducer|useCallback|useRef|useMemo|useTransition|useDeferredValue|useOptimistic|startTransition)\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(SRC);

/** 去掉块注释与行注释后取前几行：'use client' 必须在真实代码之前，注释里的示例不算指令 */
function strippedHead(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .slice(0, 400);
}

function isClientBoundary(source: string): boolean {
  const head = strippedHead(source);
  return /^\s*['"]use (client|server)['"]/.test(head);
}

/** 文件里从 'react' 真实导入的客户端专用 API（跨行 import 也算，注释已剔除） */
function clientHookNames(code: string): string[] {
  const found = new Set<string>()
  for (const m of code.matchAll(/import\s+([^;]*?)\s+from\s*['"]react['"]/g)) {
    const clause = m[1]
    if (/^\s*type\s/.test(clause)) continue
    for (const hook of clause.matchAll(new RegExp(`\\b(${CLIENT_HOOKS.source})\\b`, "g"))) {
      found.add(hook[1])
    }
  }
  return [...found]
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  if (existsSync(base) && statSync(base).isFile()) return base;
  return null;
}

function importsOf(code: string): string[] {
  const specs: string[] = [];
  for (const m of code.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of code.matchAll(/import\(['"]([^'"]+)['"]\)/g)) specs.push(m[1]);
  return specs;
}

/** 服务端入口：src/app 下没有 'use client' 的文件（页面、布局、路由处理器） */
const serverEntries = allFiles.filter((file) => {
  if (!file.startsWith(resolve(SRC, "app"))) return false;
  if (/[\\/]components[\\/]/.test(file)) return false;
  return !isClientBoundary(readFileSync(file, "utf8"));
});

describe("服务端可达图里不许出现 React 客户端 hook", () => {
  it("能枚举到 app 目录的服务端入口（守测试自己）", () => {
    expect(serverEntries.length).toBeGreaterThan(5);
    expect(serverEntries.some((f) => f.endsWith("layout.tsx"))).toBe(true);
  });

  it("从任服务端入口出发，遇到 'use client' 就收住；否则不许摸到 react hook", () => {
    const violations: string[] = [];
    for (const entry of serverEntries) {
      const seen = new Set<string>([entry]);
      const stack: Array<{ file: string; trail: string[] }> = [{ file: entry, trail: [relative(SRC, entry)] }];
      while (stack.length) {
        const { file, trail } = stack.pop()!;
        const code = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        const hits = clientHookNames(code);
        if (hits.length) {
          violations.push(`${trail.join(" -> ")} 从 react 导入了客户端 API：${hits.join(", ")}`);
          continue;
        }
        for (const spec of importsOf(code)) {
          const next = resolveSpecifier(file, spec);
          if (!next || seen.has(next)) continue;
          // 客户端边界：Next 在这里切断服务端图，不再往下算
          if (isClientBoundary(readFileSync(next, "utf8"))) continue;
          seen.add(next);
          stack.push({ file: next, trail: [...trail, relative(SRC, next)] });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("首屏密度引导只依赖纯模块（回归：它曾经 import 了 user-preferences）", () => {
    const bootstrap = readFileSync(resolve(SRC, "lib", "density-bootstrap.ts"), "utf8");
    const code = bootstrap.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("from './user-preferences'");
    expect(code).toContain("from './content-density'");
    expect(code).not.toMatch(/from ['"]react['"]/);
    const contentDensity = readFileSync(resolve(SRC, "lib", "content-density.ts"), "utf8");
    expect(contentDensity).not.toMatch(/from ['"]react['"]/);
    expect(contentDensity).toContain("CARD_DENSITY_TO_CONTENT");
  });

  it("偏好层仍然是客户端模块，但不许把纯映射复制成第二份", () => {
    const prefs = readFileSync(resolve(SRC, "lib", "user-preferences.ts"), "utf8");
    expect(prefs).toContain("from 'react'");
    expect(prefs).toContain("} from './content-density'");
    // 映射表只许住在一个文件里：两份表就会有一份悄悄漂移
    expect(prefs).not.toMatch(/comfortable:\s*'comfortable',\s*\n\s*compact:\s*'dense'/);
  });
});
