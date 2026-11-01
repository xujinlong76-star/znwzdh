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

// ---------- 豁免清单（显式列举，禁止通配放行） ----------
// 语义统一为「WIP 热区待释放」：并行会话（auth/search/video/backup）占有的文件，
// 冷区清扫不落笔。WIP 收敛后应逐条清退本表，让门禁回到全量零容忍。
// packages/store/**、apps/api/**、.github/** 不在 overlay/src 扫描面内，无需登记。
const WIP_HOT_EXEMPT: string[] = [
  // —— 任务单热区（navigation-card / navigation-content / search-palette / app/{search,auth,favorites}）——
  // 2026-11-02 热区清账：navigation-card / search-palette / search-results / signin / favorites /
  // category-quick-jump-bar / quick-access-tray / universal-bookmark-modal 已清零，豁免已清退，
  // 由冷区禁令全量接管（回潮即红）。navigation-content 复核无违例，一并清退。
  "app/search/page.tsx", // WIP 热区待释放
  "app/auth/layout.tsx", // WIP 热区待释放
  "app/auth/forgot-password/page.tsx", // WIP 热区待释放
  "app/auth/reset-password/page.tsx", // WIP 热区待释放
  "app/auth/signup/page.tsx", // WIP 热区待释放
  "app/auth/verify-email/page.tsx", // WIP 热区待释放
  // —— 并行会话 WIP 快照（2026-11-02，git 脏文件里的违例文件）——
  "components/user-center/local-data-manager.tsx", // 2026-11-02 22:45 并行会话活跃写入（me/data 新组件），只报告不改
  "app/admin/data/restore/page.tsx", // WIP 热区待释放
  "app/admin/jobs/page.tsx", // WIP 热区待释放
  "app/admin/taxonomy/page.tsx", // WIP 热区待释放
  "app/admin/videos/[id]/categories/[categoryId]/items/page.tsx", // WIP 热区待释放
  "app/admin/videos/[id]/items/page.tsx", // WIP 热区待释放
  "app/admin/videos/components/HarvestModal.tsx", // WIP 热区待释放
  "app/admin/videos/components/VideoCategoryCard.tsx", // WIP 热区待释放
  "app/admin/videos/page.tsx", // WIP 热区待释放
  "app/category/[slug]/category-board.tsx", // WIP 热区待释放
  "app/collections/[slug]/collection-detail-view.tsx", // WIP 热区待释放
  "app/hot/hot-view.tsx", // WIP 热区待释放
  "components/ai/llm-daily-cost-chart.tsx", // WIP 热区待释放
  "components/bookmark-importer.tsx", // WIP 热区待释放
  "components/category-index-filterable-list.tsx", // WIP 热区待释放
  "components/category-site-filter-bar.tsx", // WIP 热区待释放
  "components/navigation-category-section.tsx", // WIP 热区待释放
  "components/p2p/p2p-airdrop-modal.tsx", // WIP 热区待释放
  "components/quick-tools-drawer.tsx", // WIP 热区待释放
  "components/reader/site-archive-reader-modal.tsx", // WIP 热区待释放
  "components/search/spotlight-modal.tsx", // WIP 热区待释放
  "components/site-detail-view.tsx", // WIP 热区待释放
  "components/site-peek-dialog.tsx", // WIP 热区待释放
  "components/sites-directory-filterable-grid.tsx", // WIP 热区待释放
  "components/tag-cloud.tsx", // WIP 热区待释放
  "components/tag-results-board.tsx", // WIP 热区待释放
  "components/video-auto-harvest-dialog.tsx", // WIP 热区待释放
  "components/video-card.tsx", // WIP 热区待释放
  "components/video-content.tsx", // WIP 热区待释放
  "components/video-player-page.tsx", // WIP 热区待释放
  "components/workspace/workspace-switcher.tsx", // WIP 热区待释放
];
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
    const inputLine = src.split("\n").find((l) => l.includes("pl-9") && l.includes("rounded-xl"));
    expect(inputLine, "未找到搜索输入框 className 行").toBeTruthy();
    expect(
      inputLine!,
      "搜索框边界需 border-border-strong（防 border-border/N 透明度变体绕开 border-input 禁令）",
    ).toContain("border-border-strong");
    expect(inputLine!, "搜索框边界不得回退 border-border/N").not.toMatch(/border-border\/\d/);
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
  }, 60_000);
});
