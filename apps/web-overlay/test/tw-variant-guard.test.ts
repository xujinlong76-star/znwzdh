import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Tailwind 4.1.12 变体名为数字开头时（2xl:) 一律不生成候选，
 * 无论 --breakpoint-2xl 是否定义（已实测 pinned 版本）。
 * 全仓禁止再写 2xl: 类；宽屏断点用 min-[1536px]:**! 之类任意值写法
 * （任意断点排序在命名断点之前，必须带 ! 才能压过 xl:）。
 */
function overlaySources(): Array<{ file: string; text: string }> {
  const root = join(HERE, "..", "..", "web-overlay", "src");
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) out.push({ file: p, text: readFileSync(p, "utf8") });
    }
  };
  walk(root);
  return out;
}

describe("Tailwind 变体守卫：禁用死断点 2xl:", () => {
  it("源码中不再出现 2xl: 类（该变体在 4.1.12 恒不生成）", () => {
    const offenders: string[] = [];
    for (const { file, text } of overlaySources()) {
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/(^|[\s"'`{])2xl:[a-z[]/.test(line)) {
          offenders.push(`${file.replace(/\\/g, "/")}:${i + 1}: ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
