import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F1 可访问性 Token 对比度回归门禁（2026-11-02）。
 *
 * 锁两层东西（风格照抄 a11y-contrast.test.ts 的「锁源码意图」与
 * tw-source-coverage.test.ts 的「产物级检查」先例）：
 *   1. token 值本身必须满足 WCAG AA —— 解析 globals.css 的 HSL token，
 *      现场计算相对亮度/对比度，数值一改坏这里立刻红；
 *   2. 修好的类名配方不得回潮 —— 冷区源码里透明度变体 / 徽章旧配方 /
 *      危险文字旧类名全部按「显式豁免清单」机制拦截（禁止通配放行）。
 *
 * 产物检查说明：无需先跑 next build。第 8 项用与 next build 相同的引擎
 * （@tailwindcss/postcss + oxide）现场编译 apps/web/src/styles/globals.css，
 * 等价于构建期产物（实测约 1~2 秒）。这正是 @source 剪枝陷阱的守卫：
 * 类名在源码里写了但没进扫描集，产物里就不会有。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// 测试执行面是 apps/web/test（vendor 镜像）；事实源是 apps/web-overlay。
// 与 a11y-contrast.test.ts 同款解析：只认 /web-overlay/ 路径，避免读到镜像副本。
function overlayPath(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return hit;
}
const OVERLAY_SRC = resolve(overlayPath("src/styles/globals.css"), "..", "..");
const GLOBALS = overlayPath("src/styles/globals.css");
// 运行镜像 apps/web（与 apps/web-overlay 平级）；产物检查编译它的 styles 事实副本
const WEB = resolve(OVERLAY_SRC, "..", "..", "web");
const WEB_GLOBALS = join(WEB, "src", "styles", "globals.css");

// ---------- WCAG 相对亮度 / 对比度（sRGB，标准公式） ----------
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}
function lin(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** 前景以 alpha 合成到底色上（错误条底色 /15 这类配方必须合成后再算） */
function over(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number],
): [number, number, number] {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as [number, number, number];
}
function hex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}
const WHITE: [number, number, number] = [1, 1, 1];

// ---------- globals.css 块解析 ----------
function blockBody(css: string, openRe: RegExp, label: string): string {
  const m = openRe.exec(css);
  if (!m) throw new Error("globals.css 里找不到 " + label + " 块");
  const open = css.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(label + " 块花括号不闭合");
}
function parseVars(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}
function parseHslRaw(name: string, raw: string | undefined): [number, number, number] {
  if (!raw) throw new Error("token 缺失 --" + name);
  const m = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(raw.trim());
  if (!m) throw new Error("--" + name + " 不是 HSL 三元组: " + raw);
  return [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
}
function hslOf(vars: Map<string, string>, name: string): [number, number, number] {
  return parseHslRaw(name, vars.get(name));
}
function ratio(vars: Map<string, string>, fgName: string, bg: [number, number, number]): { ratio: number; hex: string } {
  const rgb = hslToRgb(...hslOf(vars, fgName));
  return { ratio: contrast(rgb, bg), hex: hex(rgb) };
}

const css = readFileSync(GLOBALS, "utf8");
const rootVars = parseVars(blockBody(css, /:root\s*\{/, ":root"));
const darkVars = parseVars(blockBody(css, /\.dark\s*\{/, ".dark"));
function accentVars(name: string): Map<string, string> {
  return parseVars(
    blockBody(css, new RegExp(`:root\\[data-accent="${name}"\\][^{]*\\{`), `accent=${name}`),
  );
}
const ACCENTS = ["default", "violet", "emerald", "amber", "rose"] as const;

// ---------- 豁免清单（2026-11-22 全量清退至 0 豁免） ----------
// 原 34 个 WIP 热区文件（navigation-category-section / spotlight-modal / site-detail-view /
// site-peek-dialog / bookmark-importer / video-card / video-content / admin/* / auth/* 等）
// 的 text-muted-foreground/NN、border-input、bg-*-500/10+text-*-600、bg-destructive/10
// 已全部修复收敛，全仓 overlay/src 进入零豁免 WCAG AA 强制门禁。
const WIP_HOT_EXEMPT: string[] = [];
const EXEMPT = new Set(WIP_HOT_EXEMPT);

// ---------- 冷区源码扫描 ----------
function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkSources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
function coldViolations(find: (src: string) => string[]): string[] {
  const bad: string[] = [];
  for (const file of walkSources(OVERLAY_SRC)) {
    const rel = relative(OVERLAY_SRC, file).replaceAll("\\", "/");
    if (EXEMPT.has(rel)) continue;
    const hits = find(readFileSync(file, "utf8"));
    if (hits.length > 0) bad.push(`${rel}（${hits.length} 处）`);
  }
  return bad;
}
function countMatches(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[0]);
}

// ============================================================
// 1. accent × 模式：primary + primary-foreground ≥ 4.5:1
// ============================================================
describe("primary 与 primary-foreground（四种 accent × 浅深两模式）", () => {
  for (const accent of ACCENTS) {
    for (const mode of ["浅", "深"] as const) {
      it(`${mode}色 · ${accent}：按钮底与前景 ≥4.5:1`, () => {
        const base = mode === "浅" ? rootVars : darkVars;
        const over_ = accent === "default" ? new Map<string, string>() : accentVars(accent);
        const pick = (name: string) => parseHslRaw(name, over_.get(name) ?? base.get(name) ?? rootVars.get(name));
        const bg = hslToRgb(...pick("primary"));
        const fg = hslToRgb(...pick("primary-foreground"));
        const r = contrast(fg, bg);
        expect(
          r,
          `${mode}色 accent=${accent}：primary ${hex(bg)} vs primary-foreground ${hex(fg)} = ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

// ============================================================
// 2. --ring 对 --background ≥ 3:1（键盘焦点可见性）
// ============================================================
describe("--ring 焦点环（对 --background ≥3:1）", () => {
  for (const mode of ["浅", "深"] as const) {
    it(`${mode}色模式焦点环 ≥3:1`, () => {
      const vars = mode === "浅" ? rootVars : darkVars;
      const bg = hslToRgb(...hslOf(vars, "background"));
      const { ratio: r, hex: hx } = ratio(vars, "ring", bg);
      expect(r, `--ring ${hx} vs --background ${hex(bg)} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }
});

// ============================================================
// 2b. 四种 accent 的 --ring 同样 ≥3:1（accent 块会覆盖 --ring，
//     amber 旧值对白仅 2.14:1——F1 补丁把 ring 与 primary 拆开调）
// ============================================================
describe("accent 焦点环（violet/emerald/amber/rose 各自的 --ring ≥3:1）", () => {
  for (const accent of ["violet", "emerald", "amber", "rose"] as const) {
    for (const mode of ["浅", "深"] as const) {
      it(`${mode}色 · ${accent} 的 ring ≥3:1`, () => {
        const base = mode === "浅" ? rootVars : darkVars;
        const over_ = accentVars(accent);
        const raw = over_.get("ring") ?? base.get("ring");
        const ring = hslToRgb(...parseHslRaw("ring", raw));
        const bg = hslToRgb(...hslOf(base, "background"));
        const r = contrast(ring, bg);
        expect(
          r,
          `${mode}色 accent=${accent} --ring ${hex(ring)} vs --background ${hex(bg)} = ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

// ============================================================
// 3. 危险文字：.dark --destructive-text ≥4.5:1；浅色错误条新配方 ≥4.5:1
// ============================================================
describe("危险文字 token（--destructive-text）", () => {
  it("深色：--destructive-text 对 --background ≥4.5:1（修 1.98:1 旧故障）", () => {
    const bg = hslToRgb(...hslOf(darkVars, "background"));
    const { ratio: r, hex: hx } = ratio(darkVars, "destructive-text", bg);
    expect(r, `dark --destructive-text ${hx} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("浅色错误条新配方：destructive-text 在白底与 destructive/15 条底上都 ≥4.5:1", () => {
    const text = hslToRgb(...hslOf(rootVars, "destructive-text"));
    const dest = hslToRgb(...hslOf(rootVars, "destructive"));
    const onWhite = contrast(text, WHITE);
    expect(onWhite, `对白 ${onWhite.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    const strip = over(dest, 0.15, WHITE);
    const onStrip = contrast(text, strip);
    expect(
      onStrip,
      `文字 ${hex(text)} 对 bg-destructive/15（合成 ${hex(strip)}）= ${onStrip.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("两个模式的 --destructive-text 都已定义（危险文字统一走该 token）", () => {
    expect(rootVars.has("destructive-text")).toBe(true);
    expect(darkVars.has("destructive-text")).toBe(true);
    // 作按钮底色的 --destructive 语义不动
    expect(rootVars.has("destructive")).toBe(true);
    expect(darkVars.has("destructive")).toBe(true);
  });
});

// ============================================================
// 4. --border-strong 对 --background ≥ 3:1（控件边界）
// ============================================================
describe("--border-strong 控件边界（对 --background ≥3:1）", () => {
  for (const mode of ["浅", "深"] as const) {
    it(`${mode}色模式控件边界 ≥3:1`, () => {
      const vars = mode === "浅" ? rootVars : darkVars;
      const bg = hslToRgb(...hslOf(vars, "background"));
      const { ratio: r, hex: hx } = ratio(vars, "border-strong", bg);
      expect(
        r,
        `--border-strong ${hx} vs --background ${hex(bg)} = ${r.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    });
  }
});

// ============================================================
// 4b. 表单控件边界类 = border-border-strong（input/textarea/select/…）
//     （border-input 对白仅 ~1.2:1，不足 WCAG 1.4.11 的 3:1）
// ============================================================
describe("表单控件边界（border-border-strong，禁 border-input）", () => {
  const CONTROL_FILES = [
    "src/components/ui/input.tsx",
    "src/components/ui/textarea.tsx",
    "src/components/ui/search-input.tsx",
    "src/registry/new-york/ui/input.tsx",
    "src/registry/new-york/ui/textarea.tsx",
    "src/registry/new-york/ui/select.tsx",
    "src/registry/new-york/ui/input-otp.tsx",
    "src/registry/new-york/ui/checkbox.tsx",
    "src/registry/new-york/ui/toggle.tsx",
  ];
  it("两套实现（components/ui 与 registry/new-york/ui）的控件边界都用 border-border-strong", () => {
    for (const rel of CONTROL_FILES) {
      const src = readFileSync(overlayPath(rel), "utf8");
      expect(src, rel + " 应含 border-border-strong").toContain("border-border-strong");
      expect(src, rel + " 不得残留 border-input").not.toMatch(/\bborder-input\b/);
    }
  });
  it("冷区源码不再用 border-input（含内联控件）", () => {
    const bad = coldViolations((src) => countMatches(src, /\bborder-input\b/g));
    expect(
      bad,
      `以下冷区文件仍用 border-input（控件边界对白仅 ~1.2:1）：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n改为 border-border-strong。豁免只认 WIP_HOT_EXEMPT 显式清单。`,
    ).toEqual([]);
  });
  it("搜索面板输入框（原 border-border/70 盲区，实测 ≈1.2:1）必须用 border-border-strong", () => {
    const src = readFileSync(overlayPath("src/components/search-palette.tsx"), "utf8");
    // header-scroll-refactor-1222：输入框改 Flex 内布局后，边框从 Input 本体移到
    // 外层 flex 容器（focus-within:ring-2 的那一行）；对比度要求不变，仍锁该行。
    const inputLine = src.split("\n").find((l) => l.includes("focus-within:ring-2") && l.includes("rounded-xl"));
    expect(inputLine, "未找到搜索框外层容器 className 行").toBeTruthy();
    expect(
      inputLine!,
      "搜索框边界需 border-border-strong（防 border-border/N 透明度变体绕开 border-input 禁令）",
    ).toContain("border-border-strong");
    expect(inputLine!, "搜索框边界不得回退 border-border/N").not.toMatch(/border-border\/\d/);
  });
});

// ============================================================
// 4c. 深色下 0-RTT 开关（P0-5）：关态轨道填充 --muted 对深色背景仅 ~1.34:1，
//     轨道必须靠 --border-strong（深色 3.17:1）显形；开态轨道 --primary
//     在默认深色（19.05:1）与 ocean/sky/latte 三皮肤（4.95/4.44/5.75:1）下均可见。
//     注：深色 --border-strong 对背景 ≥3:1 已由 4. 双模式断言锁定，此处不再重复。
// ============================================================
describe("深色下 0-RTT 开关（P0-5）", () => {
  const darkBg = hslToRgb(...hslOf(darkVars, "background"));
  const DARK_SKINS = ["ocean", "sky", "latte"] as const;

  it("回归：关态填充 --muted 对深色背景 < 3:1，单靠填充看不见轨道（实测 1.34:1）", () => {
    const { ratio: r, hex: hx } = ratio(darkVars, "muted", darkBg);
    expect(
      r,
      "--muted " + hx + " vs --background " + hex(darkBg) + " = " + r.toFixed(2) + ":1",
    ).toBeLessThan(3);
  });

  it("默认深色开态轨道 --primary 对背景 ≥3:1", () => {
    const { ratio: r, hex: hx } = ratio(darkVars, "primary", darkBg);
    expect(
      r,
      "--primary " + hx + " vs --background " + hex(darkBg) + " = " + r.toFixed(2) + ":1",
    ).toBeGreaterThanOrEqual(3);
  });

  it("三皮肤开态轨道 --primary 对深色背景均 ≥3:1（ocean/sky/latte）", () => {
    for (const name of DARK_SKINS) {
      const { ratio: r, hex: hx } = ratio(accentVars(name), "primary", darkBg);
      expect(
        r,
        "accent=" + name + " --primary " + hx + " vs --background " + hex(darkBg) + " = " + r.toFixed(2) + ":1",
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("白滑块对关态轨道 --muted ≥3:1", () => {
    const mutedRgb = hslToRgb(...hslOf(darkVars, "muted"));
    const r = contrast(WHITE, mutedRgb);
    expect(
      r,
      "white vs --muted " + hex(mutedRgb) + " = " + r.toFixed(2) + ":1",
    ).toBeGreaterThanOrEqual(3);
  });

  it("白滑块对三皮肤开态轨道 --primary 均 ≥3:1（ocean/sky/latte）", () => {
    for (const name of DARK_SKINS) {
      const primaryRgb = hslToRgb(...hslOf(accentVars(name), "primary"));
      const r = contrast(WHITE, primaryRgb);
      expect(
        r,
        "white vs accent=" + name + " --primary " + hex(primaryRgb) + " = " + r.toFixed(2) + ":1",
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("开关标签 --foreground 对深色背景 ≥4.5:1", () => {
    const { ratio: r, hex: hx } = ratio(darkVars, "foreground", darkBg);
    expect(
      r,
      "--foreground " + hx + " vs --background " + hex(darkBg) + " = " + r.toFixed(2) + ":1",
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("开关描述 --muted-foreground 对深色背景 ≥4.5:1", () => {
    const { ratio: r, hex: hx } = ratio(darkVars, "muted-foreground", darkBg);
    expect(
      r,
      "--muted-foreground " + hx + " vs --background " + hex(darkBg) + " = " + r.toFixed(2) + ":1",
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("0-RTT 开关轨道必须用 border-border-strong（不得回退 border-transparent）", () => {
    const src = readFileSync(overlayPath("src/app/me/me-view.tsx"), "utf8");
    expect(src).toContain('role="switch"');
    expect(
      src,
      "开关轨道（h-6 w-11）边界需 border-border-strong（深色下 muted 填充仅 1.34:1）",
    ).toContain("h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-border-strong");
    expect(src, "开关轨道边界不得回退 border-transparent").not.toContain("border-transparent");
  });
});

// ============================================================
// 5. --muted-foreground（浅色）对白 ≥4.5:1
// ============================================================
describe("--muted-foreground 次要文本", () => {
  it("浅色对白 ≥4.5:1", () => {
    const { ratio: r, hex: hx } = ratio(rootVars, "muted-foreground", WHITE);
    expect(r, `--muted-foreground ${hx} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

// ============================================================
// 6. 冷区禁令：text-muted-foreground/[0-9]+ 透明度变体为 0
// ============================================================
describe("透明度变体禁令（muted-foreground）", () => {
  it("冷区源码不再有 text-muted-foreground/N 透明度变体", () => {
    const bad = coldViolations((src) =>
      countMatches(src, /text-muted-foreground\/\d+/g),
    );
    expect(
      bad,
      `以下冷区文件仍有 text-muted-foreground/NN 透明度变体（叠透明度必跌破 AA）：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n改为 text-muted-foreground。豁免只认 WIP_HOT_EXEMPT 显式清单（禁止通配）。`,
    ).toEqual([]);
  });
});

// ============================================================
// 7. 冷区禁令：bg-*-500/10 text-*-600 徽章旧配方为 0
// ============================================================
function badgeRecipeHits(src: string): string[] {
  const hits = countMatches(src, /\bbg-([a-z]+)-500\/10\s+text-\1-600\b/g);
  // 同一引号类串内的非相邻共现（如中间插了 border 类）
  for (const m of src.matchAll(/(['"`])([^'"`\n]*?)\1/g)) {
    const inner = m[2];
    for (const b of inner.matchAll(/\bbg-([a-z]+)-500\/10\b/g)) {
      const fam = b[1];
      if (new RegExp(`\\btext-${fam}-600\\b`).test(inner)) {
        hits.push(`bg-${fam}-500/10 + text-${fam}-600`);
      }
    }
  }
  return hits;
}
describe("徽章配方统一（bg-*-500/10 + text-*-700）", () => {
  it("冷区源码不再有 bg-…-500/10 text-…-600 旧配方", () => {
    const bad = coldViolations(badgeRecipeHits);
    expect(
      bad,
      `以下冷区文件仍是旧徽章配方（text-*-600 在 /10 底上实测不足 AA）：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n改为 text-*-700（徽章 = bg-*-500/10 + text-*-700）。豁免只认 WIP_HOT_EXEMPT 显式清单。`,
    ).toEqual([]);
  });
});

// ============================================================
// 3b. 危险文字类名锁源：冷区 text-destructive / bg-destructive/10 为 0
//     （浅色错误条配方 = text-destructive-text + bg-destructive/15 的反向锁）
// ============================================================
describe("危险文字配方（text-destructive-text + bg-destructive/15）", () => {
  it("冷区源码危险文字不再用 text-destructive 旧类名", () => {
    const bad = coldViolations((src) =>
      countMatches(src, /text-destructive(?!-foreground|-text)/g),
    );
    expect(
      bad,
      `以下冷区文件的危险文字仍用 text-destructive（深色下会解析成暗红按钮底，实测 1.98:1）：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n改为 text-destructive-text。豁免只认 WIP_HOT_EXEMPT 显式清单。`,
    ).toEqual([]);
  });

  it("冷区源码错误条底色不再用 bg-destructive/10（提档 /15）", () => {
    const bad = coldViolations((src) => countMatches(src, /bg-destructive\/10\b/g));
    expect(
      bad,
      `以下冷区文件的错误条底色仍是 bg-destructive/10：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n改为 bg-destructive/15（配 text-destructive-text）。豁免只认 WIP_HOT_EXEMPT 显式清单。`,
    ).toEqual([]);
  });
});

// ============================================================
// 8. 产物检查：构建口径的 CSS 里必须出现 border-strong 相关类
//    （Tailwind v4 @source 剪枝陷阱守卫）
// ============================================================
describe("构建产物 CSS 含 border-strong 相关类（@source 剪枝守卫）", () => {
  it("现场编译产物包含 .border-border-strong 与 --border-strong", async () => {
    if (!existsSync(WEB_GLOBALS)) {
      // 未 vendor 时跳过（与 tw-source-coverage 同口径；CI 的 vitest 前已 vendor）
      console.warn("[a11y-token] apps/web 未 vendor，跳过产物检查");
      return;
    }
    const req = createRequire(import.meta.url);
    const pluginEntry = req.resolve("@tailwindcss/postcss");
    const fromPlugin = createRequire(pluginEntry);
    // postcss 优先从执行面解析，失败则从插件自带依赖解析（pnpm 嵌套布局）
    let postcss: (plugins: unknown[]) => {
      process: (css: string, opts: { from: string }) => Promise<{ css: string }>;
    };
    try {
      postcss = req("postcss");
    } catch {
      postcss = fromPlugin("postcss");
    }
    const tailwindPlugin = fromPlugin("@tailwindcss/postcss") as (opts: {
      base: string;
    }) => unknown;
    const base = join(WEB, "src", "styles");
    const from = WEB_GLOBALS;
    const input = readFileSync(from, "utf8");
    // 与 next build 的 PostCSS 步骤同引擎（@tailwindcss/postcss + oxide 扫描）
    const result = await postcss([tailwindPlugin({ base })]).process(input, { from });

    const out = result.css;
    expect(out.length, "产物 CSS 不应为空").toBeGreaterThan(1000);
    expect(
      out,
      "产物里没有 .border-border-strong —— input/描边按钮/checkbox 的 3:1 边界会静默丢失。" +
        "典型原因：使用方源码没进 globals.css 的 @source 扫描集（剪枝陷阱），或 @theme 缺 --color-border-strong。",
    ).toMatch(/\.border-border-strong\b/);
    expect(out, "产物里应保留 --border-strong 自定义属性").toContain("--border-strong");
    // 附带锁：ring 与危险文字 token 都编进了产物
    expect(out).toContain("--color-ring");
    expect(out).toContain("destructive-text");
    // 附带锁（UX #8 方案 B）：链接文字 token 与 text-link 类都编进了产物
    expect(out).toContain("--color-link");
    expect(
      out,
      "产物里没有 .text-link —— 链接文字 token 未生效。" +
        "典型原因：@theme 缺 --color-link，或没有源码使用 text-link 类（剪枝）。",
    ).toMatch(/\.text-link\b/);
  }, 60_000);
});

// ============================================================
// 9. 链接文字 token（--link，UX #8 方案 B，2026-11-15）
//    --primary 作按钮底与作链接文字是两个方向的对比度：7 皮肤 × 浅深
//    14 格里 8 格不过 AA（amber 浅仅 2.14:1）。链接文字改走 --link，
//    每皮肤每模式单独取值（已达标格沿用 --primary 原值，只调 L 保色相），
//    目标 ≥5.0:1（硬门禁仍为 4.5:1）。深色档在 .dark[data-accent] 块里，
//    因上方 [data-accent] 块不分浅深。
// ============================================================
const LINK_ACCENTS = ["default", "violet", "emerald", "amber", "rose", "ocean", "sky", "system-blue", "latte"] as const;

function darkAccentVars(name: string): Map<string, string> {
  return parseVars(
    blockBody(css, new RegExp(`\\.dark\\[data-accent="${name}"\\][^{]*\\{`), `dark accent=${name}`),
  );
}

describe("链接文字 token（--link 对 --background）", () => {
  function linkOf(accent: (typeof LINK_ACCENTS)[number], mode: "浅" | "深"): { raw: string; bg: [number, number, number] } {
    const base = mode === "浅" ? rootVars : darkVars;
    if (accent === "default") {
      return { raw: base.get("link")!, bg: hslToRgb(...hslOf(base, "background")) };
    }
    const over_ = mode === "浅" ? accentVars(accent) : darkAccentVars(accent);
    const raw = over_.get("link") ?? base.get("link")!;
    return { raw, bg: hslToRgb(...hslOf(base, "background")) };
  }

  for (const accent of LINK_ACCENTS) {
    for (const mode of ["浅", "深"] as const) {
      it(`${mode}色 · ${accent}：--link 对背景 ≥4.5:1（硬门禁）`, () => {
        const { raw, bg } = linkOf(accent, mode);
        const fg = hslToRgb(...parseHslRaw("link", raw));
        const r = contrast(fg, bg);
        expect(
          r,
          `${mode}色 accent=${accent} --link ${hex(fg)} vs --background ${hex(bg)} = ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
      it(`${mode}色 · ${accent}：--link 对背景 ≥5.0:1（方案目标，防取整漂移）`, () => {
        const { raw, bg } = linkOf(accent, mode);
        const fg = hslToRgb(...parseHslRaw("link", raw));
        const r = contrast(fg, bg);
        expect(
          r,
          `${mode}色 accent=${accent} --link ${hex(fg)} = ${r.toFixed(2)}:1，未达方案目标 5.0:1。` +
            `可放宽到硬门禁 4.5:1，但须在方案文档里说明理由，不得无声漂移。`,
        ).toBeGreaterThanOrEqual(5);
      });
    }
  }

  it(":root / .dark / 7 个 accent 块（浅深）都定义了 --link", () => {
    expect(rootVars.has("link")).toBe(true);
    expect(darkVars.has("link")).toBe(true);
    for (const accent of LINK_ACCENTS) {
      if (accent === "default") continue;
      expect(accentVars(accent).has("link"), `浅色 accent=${accent} 缺 --link`).toBe(true);
      expect(darkAccentVars(accent).has("link"), `深色 accent=${accent} 缺 --link`).toBe(true);
    }
  });

  it("@theme 映射了 --color-link（类名 text-link 的来源）", () => {
    expect(css).toContain("--color-link: hsl(var(--link));");
  });

  it("主题白名单 THEME_COLOR_VARS 含 '--link'（插件主题可覆盖它）", () => {
    const manifest = readFileSync(overlayPath("src/lib/plugins/plugin-manifest.ts"), "utf8");
    const m = /THEME_COLOR_VARS = \[([\s\S]*?)\] as const/.exec(manifest);
    expect(m, "plugin-manifest.ts 里找不到 THEME_COLOR_VARS").toBeTruthy();
    expect(m![1]).toContain("'--link'");
  });
});

// ============================================================
// 10. 迁移面硬锁（第一批）：brief / hot 的链接文字不得再用 text-primary。
//     不在锁内（方案残留，另立项）：徽章 bg-primary/10 + text-primary
//     （如 hot-view 204 行）与装饰图标（如 brief 174 行 Sparkles），
//     故此处只锁已迁的链接用法，不做全文件通配断言。
//     drama 页当前本就没有 text-primary 链接（用 zinc 色系），锁住不回潮。
// ============================================================
describe("迁移面硬锁（第一批：brief / hot 链接文字走 text-link）", () => {
  it("brief/page.tsx：已迁的 5 处链接用法不再用 text-primary", () => {
    const src = readFileSync(overlayPath("src/app/brief/page.tsx"), "utf8");
    expect(src, "站内搜图标按钮 hover 态须走 text-link").not.toContain("hover:text-primary");
    expect(src, "链接文字须走 text-link").not.toContain("text-primary hover:underline");
    expect(src).toContain("text-xs text-link hover:underline");
    expect(src).toContain('className="text-link hover:underline"');
    expect(src).toContain("hover:text-link");
  });

  it("站点卡片（SiteCard grid）标题 hover 态走 text-link（站内详情链）", () => {
    // 2026-11-25 阶段 B：热榜卡片标题收进 SiteCard 原语，hover 配色的断言随解剖
    // 迁移到原语源码；hot-view 侧只钉「确实走原语、且不再自绘标题 hover」。
    const src = readFileSync(overlayPath("src/components/site-card.tsx"), "utf8");
    expect(src).toContain("group-hover:text-link");
    const hot = readFileSync(overlayPath("src/app/hot/hot-view.tsx"), "utf8");
    expect(hot).toContain("<SiteCard");
    expect(hot, "卡片标题 hover 态不得残留 group-hover:text-primary").not.toContain("group-hover:text-primary");
  });

  it("drama 页：无 text-primary（当前本就干净，锁住不回潮）", () => {
    for (const rel of ["src/components/drama-content.tsx", "src/components/home-drama-cinema.tsx"]) {
      const src = readFileSync(overlayPath(rel), "utf8");
      expect(src, `${rel} 不得引入 text-primary`).not.toContain("text-primary");
    }
  });
});

// ============================================================
// 11. 浅色可读性扫荡（升级 #11，2026-11-15）：正文不得用 text-amber-600 /
//     text-emerald-600。实测白底：amber-600 3.19:1、emerald-600 3.77:1，
//     均不足 AA 4.5:1；-700 档为 5.02:1 / 5.48:1。例外只有大字展示
//     （≥24px，或 ≥18.66px 加粗，即 text-xl/2xl/3xl… + font-bold 系，
//     3:1 档即可）：7 处大字统计数字保留 -600，其余 216 处已升 -700。
//     另：-700 在深色底仅 3.96:1 / 3.63:1，故每个 -700 须在同一 class 串
//     里带 dark: 伴生（-300/-400/-500 均 ≥4.5:1），缺伴生即红。
//     （扫荡实测 223 处 / 89 文件，与简报 223 处一致；无 dark: 变体的
//     -600 为 0 处——深色 -600 本就达标（6.24/5.28:1），守卫仍把 dark:
//     链排除在外，防将来有人把 dark:text-*-600 改成 -700。瞬时值一律
//     以测试同款 sRGB 公式为准，见文件头部的 luminance/contrast。）
// ============================================================
const AMBER_EMERALD_600 = /\btext-(amber|emerald)-600\b/g;

/** token 前的变体链（如 dark: / hover: / dark:hover:），空串表示无变体 */
function variantChainBefore(seg: string, start: number): string {
  let i = start;
  while (i > 0 && /[a-zA-Z0-9:-]/.test(seg[i - 1])) i--;
  return seg.slice(i, start);
}

function isLargeDisplay(seg: string): boolean {
  const big = /\btext-(xl|2xl|3xl|4xl|5xl)\b/.test(seg);
  const bold = /\bfont-(bold|semibold|black|extrabold)\b/.test(seg);
  return big && bold;
}

/** 把一行拆成 class 片段：行内单/双引号串 + 反引号顶层文本（${...} 抹掉）。
    逐行扫而不用整文件匹配——整文件反引号字面量在 V8 下会被回溯拖慢
    （本机实测一次全树扫描可超数分钟），逐行与整文件等价：当前树上
    7 处大字保留项与 0 违规在两种扫法下结果一致（见 /tmp/a11y-sweep-guard-check.py）。
    注意：跨行 class 串的大字尺寸须与颜色同行，否则会被误报。 */
function classPiecesOfLine(line: string): string[] {
  const pieces: string[] = [];
  for (const m of line.matchAll(/(['"])(?:\\.|(?!\1).)*?\1/g)) pieces.push(m[0]);
  if (line.includes("`")) {
    pieces.push(line.split("`", 2)[1].replace(/\$\{[^}]*\}/g, " "));
  }
  return pieces;
}

function amberEmerald600Violations(): string[] {
  const bad: string[] = [];
  for (const file of walkSources(OVERLAY_SRC)) {
    const rel = relative(OVERLAY_SRC, file).replaceAll("\\", "/");
    const src = readFileSync(file, "utf8");
    for (const line of src.split("\n")) {
      for (const piece of classPiecesOfLine(line)) {
        for (const tok of piece.matchAll(AMBER_EMERALD_600)) {
          if (variantChainBefore(piece, tok.index!).startsWith("dark:")) continue;
          if (isLargeDisplay(piece)) continue; // 大字展示例外（3:1 档）
          bad.push(`${rel}：${piece.trim().slice(0, 120)}`);
          break; // 每串只报一次
        }
      }
    }
  }
  return [...new Set(bad)];
}

function missingDarkCompanions(): string[] {
  const bad: string[] = [];
  const TOK700 = /(hover:)?text-(amber|emerald)-700\b/g;
  for (const file of walkSources(OVERLAY_SRC)) {
    const rel = relative(OVERLAY_SRC, file).replaceAll("\\", "/");
    const src = readFileSync(file, "utf8");
    for (const line of src.split("\n")) {
      for (const piece of classPiecesOfLine(line)) {
        for (const tok of piece.matchAll(TOK700)) {
          const hover = tok[1] ?? "";
          const fam = tok[2];
          const want = `dark:${hover}text-${fam}-`;
          const ok =
            piece.includes(`${want}300`) || piece.includes(`${want}400`) || piece.includes(`${want}500`);
          if (!ok) bad.push(`${rel}：${piece.trim().slice(0, 120)}`);
        }
      }
    }
  }
  return [...new Set(bad)];
}

describe("浅色可读性扫荡 #11（amber/emerald 正文 -600 → -700）", () => {
  it("正文 class 里不再有 text-amber-600 / text-emerald-600（大字展示例外）", () => {
    const bad = amberEmerald600Violations();
    expect(
      bad,
      `以下正文 class 仍用 -600（白底 3.19/3.77:1，不足 AA 4.5:1）：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n改为 -700（5.02/5.48:1）。例外只认大字展示（同一串里 text-xl/2xl/3xl… + font-bold 系）；dark: 变体不在此禁令内。`,
    ).toEqual([]);
  });

  it("7 处大字展示保留 -600（text-xl/2xl/3xl + font-bold，3:1 档）", () => {
    const src700 = countMatches(readFileSync(overlayPath("src/app/admin/jobs/page.tsx"), "utf8"), AMBER_EMERALD_600);
    expect(src700.length, "jobs 统计数字两处大字应保留 -600").toBe(2);
    const all = amberEmerald600Violations();
    expect(all.length, "除 7 处大字外不得再有 -600（守卫已把大字例外排除在外）").toBe(0);
  });

  it("每个 text-amber-700 / emerald-700 都带 dark: 伴生（深色 -700 仅 3.96/3.63:1）", () => {
    const bad = missingDarkCompanions();
    expect(
      bad,
      `以下 -700 缺 dark: 伴生（深色底会跌到 3.96/3.63:1）：\n` +
        bad.map((f) => "  - " + f).join("\n") +
        `\n在同一 class 串里补 dark:text-{amber,emerald}-{300,400,500}（或 dark:hover:）。`,
    ).toEqual([]);
  });
});

// ============================================================
// 12. 浅色可读性扫荡（升级 #14，2026-11-15）：追剧清单 / 星图弹窗的
//     text-zinc-400 正文（白底 2.56:1）升 zinc-500（4.83:1）。
//     清单页 3 处已修（删除按钮、同步备注、“没有安排”），星图弹窗
//     文本用法 4 处已修（路径起止、站点 A/B 标签、空态提示）+ 搜索/清空
//     2 个图标顺手统一。星图弹窗只剩 3 处纯图标 zinc-400（关闭按钮、
//     箭头分隔、ArrowRight），图标 3:1 档可留，本测试只锁文本用法。
// ============================================================
describe("浅色可读性扫荡 #14（追剧清单 / 星图弹窗 zinc-400 正文 → zinc-500）", () => {
  function lightZinc400Lines(src: string): string[] {
    return src
      .split("\n")
      .map((l, i) => ({ line: l, n: i + 1 }))
      .filter(({ line }) => {
        for (const m of line.matchAll(/\btext-zinc-400\b/g)) {
          if (!variantChainBefore(line, m.index!).startsWith("dark:")) return true;
        }
        return false;
      })
      .map(({ line, n }) => `${n}: ${line.trim().slice(0, 140)}`);
  }

  it("追剧清单页不再有浅色 text-zinc-400（3 处已修：删钮、同步备注、“没有安排”）", () => {
    const src = readFileSync(overlayPath("src/app/me/watchlist/page.tsx"), "utf8");
    const bad = lightZinc400Lines(src);
    expect(bad, `追剧清单页仍有浅色 text-zinc-400（白底 2.56:1）：\n${bad.join("\n")}\n改为 text-zinc-500（4.83:1）并按邻行补 dark:text-zinc-400。`).toEqual([]);
  });

  it("星图弹窗：text-zinc-400 不得出现在带文本字号的行（只剩 3 处纯图标）", () => {
    const src = readFileSync(overlayPath("src/components/graph/knowledge-star-map-modal.tsx"), "utf8");
    const bad = lightZinc400Lines(src).filter((l) => /text-(xs|sm|base|\[1[01]px\])/.test(l));
    expect(
      bad,
      `星图弹窗仍有文本字号行的浅色 text-zinc-400：\n${bad.join("\n")}\n改为 text-zinc-500（并按邻行补 dark:text-zinc-400）。纯图标行（关闭按钮/箭头分隔/ArrowRight）不在此限。`,
    ).toEqual([]);
    expect(
      lightZinc400Lines(src).length,
      "星图弹窗浅色 text-zinc-400 应恰为 3 处纯图标用法（关闭按钮、箭头分隔、ArrowRight）；多出来说明有新文本用法未修。",
    ).toBe(3);
  });
});
