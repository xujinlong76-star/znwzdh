/**
 * `check-no-raw-palette.mjs` 的用例。
 *
 * 这枚守卫的口径是「按文件基线、只减不增」（与 check-no-explicit-any.mjs 同款）：
 * 存量 raw palette 类不清，但新文件出现、或既有文件条数回增必须拦下。这里钉住
 * 三件最容易退化成空转的事：
 *   1) 计数口径只认字符串字面量——注释/标识符里的类名不算（迁移说明可引用旧类名）；
 *   2) 新增文件 / 回增判红，条数下降只提示不判红；
 *   3) 守卫真的接进了 pre-commit 且在门禁清单里登记——脚本存在但没接线等于没做。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countPalette, countPaletteInText, evaluate } from './check-no-raw-palette.mjs';

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'scripts', 'check-no-raw-palette.mjs');
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
  const dir = mkdtempSync(join(tmpdir(), 'navhub-palette-'));
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

describe('countPalette 计数口径', () => {
  it('数字符串/模板里的 raw palette 类，不数注释与标识符', () => {
    const source = [
      'const a = "bg-emerald-500";',
      'const b = "px-2 text-blue-700 dark:text-blue-400 border-blue-500/20";',
      'const c = `hover:bg-rose-500/20`;',
      'const d = `w-2 ${x} bg-amber-500`;',
      '// 注释里的 bg-emerald-500 不算',
      'const bg_emerald_500 = 1;',
      'const e = "text-muted-foreground";',
      'const f = "bg-success";',
      'const g = "text-gray-700";',
    ].join('\n');
    expect(countPalette(source, 'x.ts')).toBe(1 + 3 + 1 + 1);
    // 纯文本口径（模板 chunk / 属性串都走它）
    expect(countPaletteInText('bg-emerald-500 animate-pulse')).toBe(1);
    expect(countPaletteInText('bg-success text-info-foreground')).toBe(0);
  });

  it('变体前缀与透明度后缀照样命中；灰阶与语义 Token 不命中', () => {
    expect(countPaletteInText('hover:bg-blue-500/20 dark:border-purple-500/25')).toBe(2);
    expect(countPaletteInText('from-emerald-500 to-teal-500')).toBe(2);
    expect(countPaletteInText('border-gray-200 bg-zinc-100 text-slate-500')).toBe(0);
    // 词内不误报（前缀前面是类名字符）
    expect(countPaletteInText('my-bg-blue-500')).toBe(0);
  });

  it('tsx 里 JSX 属性串与三元里的类名串都算', () => {
    const source = [
      'export const C = () => (',
      '  <span className="bg-rose-500" title={ok ? "text-emerald-700" : "bg-amber-500/10"} />',
      ');',
    ].join('\n');
    expect(countPalette(source, 'x.tsx')).toBe(3);
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
  });
});

describe('端到端（--update-baseline → 拦回增/新增 → 认可下降）', () => {
  it('基线建立后只减不增', () => {
    const root = tempRoot();
    writeSource(root, 'a.ts', 'const a = "bg-emerald-500";\n');
    const first = run(root, ['--update-baseline']);
    expect(first.code).toBe(0);
    expect(first.out).toContain('基线已重写');

    const baseline = JSON.parse(readFileSync(join(root, 'scripts', 'no-raw-palette-baseline.json'), 'utf8'));
    expect(baseline.total).toBe(1);
    expect(Object.keys(baseline.files)).toEqual(['apps/web-overlay/src/a.ts']);

    expect(run(root).code).toBe(0);

    writeSource(root, 'a.ts', 'const a = "bg-emerald-500";\nconst b = "text-blue-700";\n');
    const grew = run(root);
    expect(grew.code).toBe(1);
    expect(grew.out).toContain('回增');

    writeSource(root, 'new-file.ts', 'const x = "bg-rose-500";\n');
    const added = run(root);
    expect(added.code).toBe(1);
    expect(added.out).toContain('新增');

    writeSource(root, 'new-file.ts', 'export const ok = "bg-success";\n');
    writeSource(root, 'a.ts', 'export const ok = "bg-success";\n');
    const shrunk = run(root);
    expect(shrunk.code).toBe(0);
    expect(shrunk.out).toContain('已清零');
  });

  it('基线文件缺失按取证失败处理（不得退化成通过）', () => {
    const root = tempRoot();
    writeSource(root, 'a.ts', 'export const ok = "bg-success";\n');
    const r = run(root);
    expect(r.code).toBe(2);
    expect(r.out).toContain('基线文件不存在');
  });
});

describe('接线', () => {
  it('已接进 pre-commit 且在门禁清单登记了本测试', () => {
    const hooks = readFileSync(resolve(ROOT, 'scripts', 'install-git-hooks.mjs'), 'utf8');
    expect(hooks).toContain('node scripts/check-no-raw-palette.mjs --staged');

    const registry = JSON.parse(readFileSync(resolve(ROOT, 'scripts', 'gates.json'), 'utf8'));
    const gate = registry.gates.find((g: { name: string }) => g.name === 'no-raw-palette');
    expect(gate).toBeDefined();
    expect(gate.test).toBe('scripts/check-no-raw-palette.test.ts');
    // 清单里的脚本/参数必须与钩子模板一致，check-gates-registry 才认得出这条接线。
    expect(gate.script).toBe('scripts/check-no-raw-palette.mjs');
    expect(gate.args).toBe('--staged');
  });
});
