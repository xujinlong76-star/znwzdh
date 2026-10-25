/**
 * `scripts/guard-recipes.json` 的静态校验（**不真跑配方**）。
 *
 * 配方会腐烂，而且腐烂的方式很安静：
 *   · 源码重构后 `from` 片段不存在了 → 那条配方永远「找不到片段」，等同于没有；
 *   · `from` 变成多处出现 → 无法确定替换哪一处；
 *   · 文件改名/删除 → 整条失效；
 *   · 手滑写成 `test` 不存在的路径 → 跑起来必然「无法归因」。
 *
 * 真跑一次要 30 秒以上（每条都要起 vitest），所以这里只做**秒级静态检查**：
 * `npm run verify:guards` 负责跑，这个测试负责「配方本身还能用」。
 *
 * 两条检查的分工要清楚：静态检查能发现「配方失效」，发现不了「守卫失效」
 * （后者只有真改坏一次才知道）。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RECIPES_PATH = resolve(ROOT, "scripts", "guard-recipes.json");

interface Recipe {
  name?: string;
  why?: string;
  /** "append" 表示「往文件末尾加一行」；缺省是「替换 from → to」 */
  mode?: "append";
  /** append 模式下要追加的那一行（必须自包含，不加新 import） */
  content?: string;
  file?: string;
  from?: string;
  to?: string;
  test?: string;
  cmd?: string;
  grep?: string;
  expectOutput?: string;
  afterRestore?: string;
}

const parsed = JSON.parse(readFileSync(RECIPES_PATH, "utf8")) as { recipes?: Recipe[] };
const recipes = parsed.recipes ?? [];

describe("配方文件结构", () => {
  it("至少有一条配方（空清单等于没有反证机制）", () => {
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThan(0);
  });

  it("每条配方都有必填字段与可读的 name", () => {
    for (const [i, r] of recipes.entries()) {
      expect(r.name, `第 ${i + 1} 条缺 name`).toBeTruthy();
      // name 要能一眼看出守的是什么，不是 "recipe-1"
      expect(String(r.name).length, `第 ${i + 1} 条的 name 太短`).toBeGreaterThan(6);
      expect(r.file, `${r.name} 缺 file`).toBeTruthy();
      if (r.mode === "append") {
        // 新增型破坏：不需要 from/to，但必须有 content
        expect(r.content, `${r.name} 是 append 模式但缺 content`).toBeTruthy();
      } else {
        expect(r.from, `${r.name} 缺 from（非 append 模式必须给 from/to）`).toBeTruthy();
        expect(typeof r.to, `${r.name} 缺 to（可以是空串，但不能 undefined）`).toBe("string");
      }
      // 至少要能跑：要么给 test，要么给 cmd
      expect(Boolean(r.test) || Boolean(r.cmd), `${r.name} 既没有 test 也没有 cmd`).toBe(true);
    }
  });

  it("name 不重复（否则 --all 的汇总里分不清是哪条挂了）", () => {
    const names = recipes.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("配方仍指向存在的代码（这条不跑测试，只查文件与片段）", () => {
  it.each(recipes.map((r, i) => [r.name ?? `#${i + 1}`, r] as const))(
    "%s：file 存在，from 恰好出现一次",
    (_name, r) => {
      const file = resolve(ROOT, String(r.file));
      expect(existsSync(file), `源文件不存在：${r.file}`).toBe(true);
      if (r.mode === "append") {
        // append 模式只要求「目标文件里还没有这段内容」——否则追加会变成重复
        // （那段内容本来就在的话，测试可能仍然通过，于是「守卫有效」会被误判）
        const text = readFileSync(file, "utf8");
        expect(text.includes(String(r.content)), `${r.file} 里已存在 append 内容，会重复追加`).toBe(false);
        return;
      }
      const text = readFileSync(file, "utf8");
      const count = text.split(String(r.from)).length - 1;
      expect(count, `--from 在 ${r.file} 里出现 ${count} 次（必须恰好 1 次）`).toBe(1);
    },
  );

  it.each(recipes.map((r, i) => [r.name ?? `#${i + 1}`, r] as const))(
    "%s：test 文件存在",
    (_name, r) => {
      if (!r.test) return; // 用 --cmd 的配方没有 test
      expect(existsSync(resolve(ROOT, String(r.test))), `测试文件不存在：${r.test}`).toBe(true);
    },
  );

  it.each(recipes.map((r, i) => [r.name ?? `#${i + 1}`, r] as const))(
    "%s：expectOutput 存在且不含明显的截断风险",
    (_name, r) => {
      expect(r.expectOutput, `${r.name} 缺 expectOutput —— 没有它「红了」无法归因`).toBeTruthy();
      // vitest 会截断长消息（实测 `...backup-restore-job.test…'`）。
      // 经验阈值：超过 40 字符的串很可能被截断，导致永远匹配不上。
      expect(String(r.expectOutput).length, `${r.name} 的 expectOutput 过长，可能被 vitest 截断`).toBeLessThan(41);
    },
  );
});
