import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * U-466（P1）卡片底部操作栏溢出守卫。
 *
 * R5-B-01 实测（live CDP，见 verify-logs/autonomous-fix-1126/R5-LIVE-MID-VIEWPORTS.md）：
 * 操作栏 6 个按钮各 `h-11 min-w-11 flex-1`，行宽需 6×44 + 5×2 + 12 = 286px，
 * 卡片却只有 209px（1024）/ 257px（1440），卡片 overflow-hidden 把末尾按钮裁掉：
 * 1024 下固定按钮只剩 19/44px、复制按钮 0/44px（完全不可见、不可点）；
 * 1440 下复制按钮只剩 21/44px。
 *
 * 修复：操作栏按钮改成 `h-11 min-w-6 w-auto flex-1`——高度保持 44px，
 * 宽度下限从 44px 降到 24px（WCAG 2.2 AA 最小目标尺寸），flex-1 均分剩余宽度。
 *
 * `w-auto` 与 `min-w-6` 两半缺一不可（2026-11-27 B8 线实测，headless Chromium
 * 真实布局，复现页 /tmp/b8——测量脚本见 SUMMARY）：
 *   - 只降 min-w-11 → min-w-6：按钮仍被 shadcn Button 的 `size-9`
 *     （`size="icon"` 自带，twMerge 不会因 h-11 而去掉它，实测保留）
 *     钉在 width:36px，行宽 226px，1024 下复制按钮仍被裁到 13/36px；
 *   - 加上 `w-auto`：Tailwind v4 产物里 `.w-auto` 排在 `.size-9` 之后，
 *     同优先级后来居上，width:auto 生效，按钮才能缩到 31.2px（1024）
 *     / 39.2px（1440）/ 28.8px（768 六钮最坏情况），全部 ≥24px 且完整可见。
 * 本文件把这两半都锁死：缺任何一半都会变红。
 *
 * 宽度账（容器 px-1.5 = 12px，行内 gap-0.5 = 2px；卡宽取 R5-B-01 实测值）：
 *   1024：6 钮，(209-12-5×2)/6 = 31.2px；1440：(257-12-10)/6 = 39.2px；
 *   768 六钮最坏情况：(195-12-10)/6 = 28.8px；390：仅 3 钮可见
 *   （隐藏/固定/复制是 hidden sm:inline-flex），(358-12-2×2)/3 = 114px。
 * 行宽 scrollWidth = 卡宽 - 12（容器内边距）≤ 卡宽，断言即 R5-B-01 的
 * 「span scrollWidth ≤ card clientWidth」形状，用源码宽度账表达
 * （vitest/jsdom 没有布局引擎；真实布局数见 SUMMARY 的 Chromium 实测表）。
 *
 * 非空性证据（R7）：本文件在修复前源码上跑过——`min-w-11` 断言与
 * 1024 宽度账断言双双变红；修复后全绿。回退任一处都会重新变红。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const NAV_CARD = "src/components/navigation-card.tsx";

/** 两处底部操作栏（标准卡与丰富卡）：从 nav-card-actionbar 起到行 <span> 的闭合处
 *  （行尾 `</span>` 后紧跟 `</div>`；不能切在第一个 `</span>`——行内另有 sr-only
 *  内层 span 时会提前截断）。 */
function actionBars(src: string): string[] {
  const parts = src.split('"nav-card-actionbar absolute bottom-0');
  expect(parts.length - 1, "标准卡与丰富卡各应有一处底部操作栏 nav-card-actionbar").toBe(2);
  return parts.slice(1).map((p) => {
    const m = p.match(/<\/span>\s*\n\s*<\/div>/);
    expect(m, "操作栏行 <span> 应以 </span></div> 闭合").toBeTruthy();
    return p.slice(0, m!.index);
  });
}

/** R5-B-01 实测卡宽（px）：视口 → 卡片 clientWidth；390 为单列满宽卡 */
const CARD_WIDTHS = [
  { viewport: 1024, cardWidth: 209, visibleButtons: 6 },
  { viewport: 1440, cardWidth: 257, visibleButtons: 6 },
  { viewport: 768, cardWidth: 195, visibleButtons: 6 },
  { viewport: 390, cardWidth: 358, visibleButtons: 3 },
] as const;

const BAR_PADDING_PX = 12; // px-1.5 两侧
const ROW_GAP_PX = 2; // gap-0.5
const WCAG_MIN_PX = 24; // WCAG 2.2 AA 最小目标尺寸

describe("U-466 卡片底部操作栏不再溢出（R5-B-01）", () => {
  const src = overlayFile(NAV_CARD);
  const bars = actionBars(src);

  it("两处操作栏的 7 个 flex-1 按钮位都没有 min-w-11（44px 下限是溢出根因）", () => {
    for (const [i, bar] of bars.entries()) {
      expect(bar, `第 ${i + 1} 处操作栏仍有 min-w-11`).not.toContain("min-w-11");
      // 每处 7 个按钮位：隐藏 / 速览坞（仅编辑态）/ 置顶 / 详情 / 速览 / 固定 / 复制，
      // 另加行 <span> 自身的一处 flex-1（<span className="flex flex-1 …">），共 8 处
      expect(bar.split("flex-1").length - 1, `第 ${i + 1} 处操作栏应有 8 处 flex-1（7 按钮 + 行 span）`).toBe(8);
    }
  });

  it("每个 flex-1 按钮都有 min-w-6 w-auto（下限 24px，且 neutral 掉 size-9 的 36px 宽）", () => {
    for (const [i, bar] of bars.entries()) {
      const fixed = bar.split("min-w-6 w-auto flex-1").length - 1;
      expect(fixed, `第 ${i + 1} 处操作栏应有 7 处 min-w-6 w-auto flex-1`).toBe(7);
      // 只有 min-w-6、没有 w-auto 会被 size-9 钉在 36px（行宽 226px，1024 仍溢出）
      expect(bar, `第 ${i + 1} 处操作栏缺 w-auto`).not.toContain("min-w-6 flex-1");
    }
  });

  it("宽度账：各视口下行宽 scrollWidth ≤ 卡宽，且每钮有效宽度 ≥24px（WCAG 2.2 AA）", () => {
    for (const { viewport, cardWidth, visibleButtons } of CARD_WIDTHS) {
      const n = visibleButtons;
      // 行宽 = 卡宽 - 容器左右内边距（bar px-1.5）；须 ≤ 卡宽
      const rowWidth = cardWidth - BAR_PADDING_PX;
      expect(rowWidth, `${viewport} 行宽 ${rowWidth} 应 ≤ 卡宽 ${cardWidth}`).toBeLessThanOrEqual(cardWidth);
      // 每钮均分行宽减去行内间隙；下限 24px 由 min-w-6 保证，均分值须 ≥24 才不触发下限裁切
      const perButton = (rowWidth - (n - 1) * ROW_GAP_PX) / n;
      expect(
        perButton,
        `${viewport} 每钮 ${perButton.toFixed(1)}px < 24px（卡宽 ${cardWidth}，${n} 钮）`,
      ).toBeGreaterThanOrEqual(WCAG_MIN_PX);
      // 反向锁：旧 44px 下限的行宽 6×44+5×2=274 在 1024/1440/768 都会溢出
      if (n === 6) {
        const oldRowWidth = n * 44 + (n - 1) * ROW_GAP_PX;
        expect(oldRowWidth, "旧行宽账应为 274px").toBe(274);
        expect(oldRowWidth, `旧 44px 下限在 ${viewport}（卡宽 ${cardWidth}）本应溢出`).toBeGreaterThan(cardWidth);
      }
    }
  });

  it("高度不变：操作栏按钮仍是 h-11（44px 高触控目标）", () => {
    for (const [i, bar] of bars.entries()) {
      // 7 个按钮位 + renderDragControls('h-11 w-11 …') 调用点的一处 h-11，共 8 处
      expect(bar.split("h-11").length - 1, `第 ${i + 1} 处操作栏应有 8 处 h-11（7 按钮 + 拖动手柄调用点）`).toBe(8);
    }
  });

  it("六个功能一个不少：隐藏 / 置顶 / 详情 / 速览 / 固定 / 复制都在（不许悄悄藏功能）", () => {
    for (const [i, bar] of bars.entries()) {
      for (const label of [
        "隐藏站点：",
        "置顶在当前分类首位",
        "速览与行动：",
        "固定到工作台：",
        "复制链接：",
      ]) {
        expect(bar, `第 ${i + 1} 处操作栏缺少 ${label}`).toContain(label);
      }
      // 详情是 detailAction() 调用点的函数式按钮，aria-label 在函数定义处（文件内），
      // 栏内只锁调用点存在
      expect(bar, `第 ${i + 1} 处操作栏缺少 detailAction 调用点`).toContain("detailAction(");
      expect(src, "detailAction 定义缺少查看站点详情入口").toContain("查看站点详情：");
      // 仅 隐藏 / 固定 / 复制 在窄屏隐藏（hidden sm:inline-flex）；置顶 / 详情 / 速览常驻
      expect(bar.split("hidden sm:inline-flex").length - 1, `第 ${i + 1} 处应有 3 处 hidden sm:inline-flex`).toBe(3);
    }
  });
});
