/**
 * `check-no-explicit-any.mjs` 的用例。
 *
 * 这枚守卫的口径是「按文件基线、只减不增」：存量 any 不清，但新文件出现 any、
 * 或既有文件条数回增必须拦下。这里钉住三件最容易退化成空转的事：
 *   1) 计数口径与 eslint no-explicit-any 一致（字符串里的 "any" 不算）；
 *   2) 新增文件 / 回增判红，条数下降只提示不判红；
 *   3) 守卫真的接进了 pre-commit 且在门禁清单里登记——脚本存在但没接线等于没做。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countAny, evaluate } from './check-no-explicit-any.mjs';

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'scripts', 'check-no-explicit-any.mjs');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows 上偶发 EBUSY：临时目录留给系统清理，不影响断言
    }
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'navhub-any-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'apps', 'web-overlay', 'src'), { recursive: true });
  return dir;
}

function writeSource(root: string, rel: string, body: string): void {
  const abs = join(root, 'apps', 'web-overlay', 'src', rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

function run(root: string, args: string[] = []): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('countAny 计数口径', () => {
  it('数类型位置的 any，不数字符串与变量名', () => {
    const source = [
      'const a: any = 1;',
      'const b = value as any;',
      'const c = <any>value;',
      'const d: any[] = [];',
      'const e: Record<string, any> = {};',
      'const f = "any";',
      'const anyLike = 1;',
      'const g: unknown = 1;',
    ].join('\n');
    expect(countAny(source, 'x.ts')).toBe(5);
    // tsx 用 JSX 解析，`<any>value` 不是类型断言；只数真实类型位置。
    expect(countAny('export const C = (x: unknown) => <div>{x as any}</div>;', 'x.tsx')).toBe(1);
  });
});

describe('evaluate 对照口径', () => {
  it('回增判 violation、新文件判 addition、下降判 improvement', () => {
    const result = evaluate(
      new Map([
        ['a.ts', 3],
        ['b.tsx', 1],
        ['c.ts', 1],
      ]),
      { 'a.ts': 1, 'b.tsx': 1, 'gone.ts': 2 },
    );
    expect(result.violations).toEqual([{ file: 'a.ts', base: 1, count: 3 }]);
    expect(result.additions).toEqual([{ file: 'c.ts', count: 1 }]);
    expect(result.improvements).toEqual([]);
    expect(result.stale).toEqual([{ file: 'gone.ts', base: 2 }]);

    expect(evaluate(new Map([['a.ts', 1]]), { 'a.ts': 2 }).improvements).toEqual([{ file: 'a.ts', base: 2, count: 1 }]);
    // staged（partial）模式只看暂存集：没出现在扫描集里不等于清零
    expect(evaluate(new Map(), { 'a.ts': 2 }, { partial: true }).stale).toEqual([]);
  });
});

describe('命令行行为', () => {
  it('基线内通过；回增与新增文件判红；下降只提示', () => {
    const root = tempRoot();
    writeSource(root, 'a.ts', 'export const a: any = 1;\n');
    writeSource(root, 'b.ts', 'export const b: string = "any";\n');

    const first = run(root, ['--update-baseline']);
    expect(first.code).toBe(0);

    const baseline = JSON.parse(readFileSync(join(root, 'scripts', 'no-explicit-any-baseline.json'), 'utf8'));
    expect(baseline.total).toBe(1);
    expect(Object.keys(baseline.files)).toEqual(['apps/web-overlay/src/a.ts']);

    expect(run(root).code).toBe(0);

    writeSource(root, 'a.ts', 'export const a: any = 1;\nexport const b: any = 2;\n');
    const grew = run(root);
    expect(grew.code).toBe(1);
    expect(grew.out).toContain('回增');

    writeSource(root, 'new-file.ts', 'export function f(x: any) {}\n');
    const added = run(root);
    expect(added.code).toBe(1);
    expect(added.out).toContain('新增');

    writeSource(root, 'new-file.ts', 'export function f(x: unknown) {}\n');
    writeSource(root, 'a.ts', 'export const a: string = "ok";\n');
    const shrunk = run(root);
    expect(shrunk.code).toBe(0);
    expect(shrunk.out).toContain('已清零');
  });

  it('基线文件缺失按取证失败处理（不得退化成通过）', () => {
    const root = tempRoot();
    writeSource(root, 'a.ts', 'export const a: string = "ok";\n');
    const r = run(root);
    expect(r.code).toBe(2);
    expect(r.out).toContain('基线文件不存在');
  });
});

describe('接线', () => {
  it('已接进 pre-commit 且在门禁清单登记了本测试', () => {
    const hooks = readFileSync(resolve(ROOT, 'scripts', 'install-git-hooks.mjs'), 'utf8');
    expect(hooks).toContain('node scripts/check-no-explicit-any.mjs --staged');

    const registry = JSON.parse(readFileSync(resolve(ROOT, 'scripts', 'gates.json'), 'utf8'));
    const gate = registry.gates.find((g: { name: string }) => g.name === 'no-explicit-any');
    expect(gate).toBeDefined();
    expect(gate.test).toBe('scripts/check-no-explicit-any.test.ts');
    // 清单里的脚本/参数必须与钩子模板一致，check-gates-registry 才认得出这条接线。
    expect(gate.script).toBe('scripts/check-no-explicit-any.mjs');
    expect(gate.args).toBe('--staged');
  });
});
