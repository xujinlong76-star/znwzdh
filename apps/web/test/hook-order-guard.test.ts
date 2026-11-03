/**
 * Hook 顺序守卫：hook 调用不许出现在组件的「前置 return」之后。
 *
 * 真实缺陷（CustomCategoryWidget，2026-11-03）：那张「中枢分类精选站点」卡在
 * catalog 处于 loading / error 时直接 return，而新增的类目内检索把
 * `const displayedSites = useMemo(...)` 写在了两个 return 后面 ——
 * 首帧只跑到第 13 个 hook，类目数据一到那一帧多出第 14 个，React 直接抛
 *
 *   React has detected a change in the order of Hooks called by CustomCategoryWidget
 *   14. undefined → useMemo
 *
 * dev 是红色告警，prod 是 Invariant 崩溃（整卡落进错误边界）。修法只有一条：
 * 所有 hook 一律待在 early return 之前。
 *
 * 为什么不用 ESLint 兜：实测 eslint-config-next + eslint-plugin-react-hooks 对
 * **那个文件**不报 `react-hooks/rules-of-hooks`，而把同样的写法抽成最小复现文件
 * 就会报「React Hook "useMemo" is called conditionally ... Did you accidentally
 * call a React Hook after an early return?」——lint 在这里给了假绿灯。所以这里用
 * TS AST 自己扫：顶层「能提前离开函数的语句」之后再出现 hook 调用语句即失败。
 *
 * 判据刻意保守：只认顶层 if（其分支里有 return）与顶层 return / throw，
 * 不猜 switch、try/catch，也不进入嵌套函数体（嵌套函数里的 return 不影响外层顺序）。
 * 宁可漏报也不误报——误报会顶死全仓 pre-commit，那样这个守卫反而会被删掉。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** overlay 的 src 是事实源；从镜像（apps/web/test）跑时同样落到 overlay 上 */
function overlaySrc(): string {
  const candidates = [resolve(HERE, "..", "..", "web-overlay", "src"), resolve(HERE, "..", "src")];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 源码目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const HOOK_NAME = /^use[A-Z0-9]/;

/** 只认 React hook 形态的调用：useXxx(...) / React.useXxx(...) */
function hookNameOf(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (ts.isIdentifier(callee) && HOOK_NAME.test(callee.text)) return callee.text;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "React" &&
    HOOK_NAME.test(callee.name.text)
  ) {
    return "React." + callee.name.text;
  }
  return null;
}

/** 语句本身是不是一次 hook 调用（const x = useMemo(...) / useXxx(...)） */
function hookOfStatement(stmt: ts.Statement): string | null {
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (decl.initializer) {
        const name = hookNameOf(decl.initializer);
        if (name) return name;
      }
    }
    return null;
  }
  if (ts.isExpressionStatement(stmt)) return hookNameOf(stmt.expression);
  return null;
}

/** 这条语句是否可能让函数在这次渲染里提前结束 */
function canLeaveFunction(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  if (!ts.isIfStatement(stmt)) return false;
  const branchLeaves = (node: ts.Node): boolean => {
    let found = false;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) {
        found = true;
        return;
      }
      // 嵌套函数/箭头里的 return 只是它自己的出口，不算外层提前结束
      if (ts.isFunctionLike(n)) return;
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  };
  return branchLeaves(stmt.thenStatement) || (stmt.elseStatement ? branchLeaves(stmt.elseStatement) : false);
}

export interface HookOrderViolation {
  file: string;
  /** 组件 / 自定义 hook 名 */
  owner: string;
  hook: string;
  /** 1 基行号 */
  line: number;
}

/** 扫一段源码：返回「hook 位于前置 return 之后」的位置 */
export function findHooksAfterEarlyReturn(fileName: string, source: string): HookOrderViolation[] {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: HookOrderViolation[] = [];

  const scanFunction = (fn: ts.FunctionLikeDeclaration, owner: string) => {
    const body = fn.body;
    if (!body || !ts.isBlock(body)) return;
    let sawEarlyExit = false;
    for (const stmt of body.statements) {
      const hook = hookOfStatement(stmt);
      if (hook && sawEarlyExit) {
        out.push({
          file: fileName,
          owner,
          hook,
          line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1,
        });
      }
      if (canLeaveFunction(stmt)) sawEarlyExit = true;
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) scanFunction(node, name);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const name = node.name.text;
        if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) scanFunction(init, name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** 递归收集 .ts/.tsx（跳过 .d.ts） */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectSources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("hook 不许写在 early return 之后", () => {
  const buggy = `'use client'
import { useMemo, useState } from 'react'

export function Card() {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; items: string[] }>({ kind: 'loading' })
  const [q] = useState('')

  if (state.kind === 'loading') {
    return <div>loading</div>
  }

  if (state.kind === 'error') {
    return <div>failed</div>
  }

  const shown = useMemo(() => state.items.filter((s) => s.includes(q)), [state, q])

  return <div onClick={() => setState({ kind: 'loading' })}>{shown.length}</div>
}
`;

  const fixed = buggy.replace(
    `  if (state.kind === 'loading') {`,
    `  const shown = useMemo(() => state.items.filter((s) => s.includes(q)), [state, q])

  if (state.kind === 'loading') {`,
  ).replace(
    `  const shown = useMemo(() => state.items.filter((s) => s.includes(q)), [state, q])

  return <div onClick`,
    `  return <div onClick`,
  );

  it("正样本：useMemo 在两个 early return 之后 → 必须报出来（否则守卫是空的）", () => {
    const hits = findHooksAfterEarlyReturn("buggy.tsx", buggy);
    expect(hits).toEqual([{ file: "buggy.tsx", owner: "Card", hook: "useMemo", line: 16 }]);
  });

  it("负样本：hook 挪到 return 之前 → 不再报", () => {
    expect(findHooksAfterEarlyReturn("fixed.tsx", fixed)).toEqual([]);
  });

  it("不误报：没有 return 的 if、以及嵌套函数里的 hook 都不算违规", () => {
    const src = `'use client'
import { useCallback, useMemo, useState } from 'react'

export function Panel() {
  const [n] = useState(0)
  if (n > 0) {
    console.log('positive')
  }
  const label = useMemo(() => String(n), [n])
  const fire = useCallback(() => {
    if (!n) return
    console.log('nested return is not an outer exit')
  }, [n])
  return <div onClick={fire}>{label}</div>
}
`;
    expect(findHooksAfterEarlyReturn("safe.tsx", src)).toEqual([]);
  });

  it("真实源码（apps/web-overlay/src）零违规，且扫描面必须是活的", () => {
    const src = overlaySrc();
    const files = collectSources(src);
    // 非空性：glob 坏掉时 files 会变空，那样「零违规」毫无意义
    expect(files.length).toBeGreaterThan(600);

    const violations: string[] = [];
    for (const file of files) {
      for (const hit of findHooksAfterEarlyReturn(file, readFileSync(file, "utf8"))) {
        violations.push(`${hit.file.replace(/\\/g, "/").split("/src/").pop()}:${hit.line} ${hit.owner} → ${hit.hook}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
