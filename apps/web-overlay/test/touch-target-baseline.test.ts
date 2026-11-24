import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F3 移动触控可读性与触达基线（2026-11-02）。
 *
 * 锁四件事（风格照抄 a11y-contrast.test.ts 的「锁源码意图」）：
 *   1. 底栏标签/徽章字号不得回退到 8-10px（触控不可读）；
 *   2. 顶栏图标按钮触达尺寸 ≥44px（h-9/h-8.5/h-8 一律禁止；P1 #10 于
 *      2026-11-13 把 36px 标准升级为 44px，h-11 w-11）；
 *   3. 纯图标按钮必须有 aria-label（asChild 模式允许挂在内层 Link）；
 *   4. footer 装饰分隔符「·」必须 aria-hidden，且移动端表单字号 ≥16px
 *      规则（防 iOS 聚焦缩放）必须存在于 globals.css 的**非分层**区。
 *
 * 非空性证据（2026-11-02）：删掉 footer 任一 aria-hidden → 第 4 项变红；
 * 复原后全绿。锁不是空断言。
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

describe("底栏字号（mobile-nav）", () => {
  it("不再有 8/9/10px 的触控不可读字号", () => {
    const src = overlayFile("src/components/mobile-nav.tsx");
    for (const bad of ["text-[8px]", "text-[9px]", "text-[10px]"]) {
      expect(src, `mobile-nav.tsx 仍有 ${bad}（触控不可读）`).not.toContain(bad);
    }
    // 基线值本身也锁住：标签 12px、徽章 11px
    expect(src).toContain("text-[12px]");
    expect(src).toContain("text-[11px]");
  });

  it("标签行收紧 leading 并禁止换行，防 5 项 flex-1 纵向溢出", () => {
    const src = overlayFile("src/components/mobile-nav.tsx");
    expect(src).toContain("leading-[14px]");
    expect(src).toContain("whitespace-nowrap");
  });
});

describe("顶栏触达尺寸（navigation-toolbar）", () => {
  it("icon 按钮不再使用 h-9/h-8.5/h-8（一律 h-11 = 44px，P1 #10 2026-11-13）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    expect(src, "仍有 h-8 w-8 触达不足").not.toContain("h-8 w-8");
    expect(src, "仍有 h-8.5 w-8.5（34px < 44px）").not.toContain("h-8.5 w-8.5");
    expect(src).not.toContain("sm:h-8.5 sm:w-8.5");
    // P1 #10（2026-11-13）：36px 标准升级为 44px，h-9 w-9 亦属回退
    expect(src, "仍有 h-9 w-9（36px < 44px）").not.toContain("h-9 w-9");
    // 判定记录（2026-11-24）：2026-11-21「顶栏收敛 11→6」方案已被 U-155/C-W7-5/
    // U-382 的「按宽度预算分档显示」取代（360px 行 6 钮 / 390px 行 7 钮 /
    // ≥1536 全量 11 钮；宽度账见 u155-diy-entry-guard.test.ts 与
    // e2e/toolbar-360-overflow.spec.ts）。核心意图不变且继续守住：
    // 「每个 icon 按钮必须 44px」，实际个数同步为 11，防止悄悄塞回小尺寸按钮。
    const h11 = src.split("h-11 w-11").length - 1;
    expect(h11, "11 处 h-11 w-11（按宽度预算分档显示，360px 行 6 钮 / 390px 行 7 钮）").toBe(11);
  });

  it("每个 size=\"icon\" 按钮块内都有 aria-label（asChild 挂内层 Link 也算）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const parts = src.split('size="icon"');
    // 98635cb2 有意把今日中心按钮从纯图标按钮改成带可见文字标签「今日 N 项」的按钮
    // （删 size="icon"，className 保留 h-11 w-11），故 size="icon" 基线 11 → 10；
    // U-155（2026-11-19）外观按钮同理改为带文字标签「DIY 排版」（删 size="icon"，
    // className 保留 h-11 w-11），基线 10 → 9；h-11 w-11 总数仍为 11，见上一项。
    // 判定记录（2026-11-24）：「顶栏收敛 9→5」同上被分档显示方案取代，实际 9 个
    // size="icon" 按钮；逐个必须有 aria-label 的核心意图不变（下面逐块审计）。
    expect(parts.length - 1, "应有 9 个 icon 按钮，逐个带 aria-label").toBe(9);
    for (let i = 1; i < parts.length; i++) {
      // 从 size="icon" 起，到对应 </Button> 为止的块（JSX 块最大 ~40 行）
      const block = parts[i].slice(0, 2000);
      const end = block.indexOf("</Button>");
      const chunk = end >= 0 ? block.slice(0, end) : block;
      expect(chunk, `第 ${i} 个 icon 按钮缺少 aria-label`).toContain("aria-label=");
    }
  });

  it("今日中心行内小窗入口（U-155 设计；取代 2026-11-21 菜单项形态）", () => {
    // 判定记录（2026-11-24）：与 u155-diy-entry-guard「360px 行内应有
    // aria-label=\"打开今日中心小窗\"」直接冲突——u155 是更新的设计
    // （C-W7-5/U-382 宽度账 + e2e toolbar-360-overflow 共同锁定），旧断言按
    // 现行设计对齐。核心意图不变：入口存在 + 受 onOpenTodayCenter 守卫 + 有可读文案。
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    expect(src, "行内应有今日中心小窗入口").toContain('aria-label="打开今日中心小窗"');
    expect(src, "今日中心应受 onOpenTodayCenter 守卫").toContain("onOpenTodayCenter");
    expect(src, "今日中心应有可读说明").toContain("今日 ${todayBadge.todayCount}");
  });

  it("「全选」文本按钮（size=\"sm\"）也是 36px 高（h-9 w-auto，F3 尾项裁决）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const line = src.split("\n").find((l) => l.includes("onSelectAllVisible") || l.includes('h-9 w-auto rounded-lg gap-1.5'));
    // 锁 className 行本身：紧邻 onSelectAllVisible 的尺寸类
    const clsLine = src.split("\n").find((l) => l.includes("h-9 w-auto") && l.includes("gap-1.5"));
    expect(clsLine, "全选按钮应为 h-9 w-auto（36px 高）").toBeTruthy();
    expect(clsLine).not.toContain("h-8");
    expect(line).toBeTruthy();
    expect(src, "全选按钮不得回退 34px").not.toContain('h-8.5 rounded-lg gap-1.5');
  });
});

describe("无障碍细节（footer 分隔符与移动表单字号）", () => {
  it("footer 用语义分组列表而非「·」分隔符（2026-11-21 改版）", () => {
    // 原实现 17 个链接 + 16 个「·」分隔符全塞进一个 flex-wrap，
    // 宽屏下自由折成 3 行、每行长度不均，视觉松垮。
    // 2026-11-21 改为 <nav> + 两个 <ul> 语义分组（核心入口 / 探索与工具），
    // 组内用 gap 排布，不再需要装饰分隔符——「必须 16 个 ·」的断言失去对象。
    //
    // 保留并强化的是**无障碍意图**：不允许出现未 aria-hidden 的装饰字符。
    const src = overlayFile("src/components/footer.tsx");
    const bare = src.match(/<span(?![^>]*aria-hidden)[^>]*>·<\/span>/g);
    expect(bare, "存在未 aria-hidden 的「·」分隔符（读屏会念成无意义字符）").toBeNull();
    // 新结构：语义 nav + 两个分组列表
    expect(src, "页脚导航应用 <nav aria-label> 承载").toContain("aria-label=\"页脚导航\"");
    expect(src, "页脚链接应分成两个 <ul> 组").toContain("<ul");
  });

  it("globals.css 有移动端表单字号 ≥16px 规则（防 iOS 聚焦缩放）", () => {
    const css = overlayFile("src/styles/globals.css");
    expect(css).toMatch(/@media \(max-width: 767px\)/);
    // 规则必须落在非分层区（任何块之外，含 @layer）：未分层声明才能压过 text-xs 等工具类
    const mediaIdx = css.indexOf("@media (max-width: 767px)");
    const before = css.slice(0, mediaIdx);
    let depth = 0;
    for (const ch of before) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(
      depth,
      "移动端字号规则必须写在任何块之外（含 @layer），否则压不过 call-site 的 text-xs（auth/signin 热区）",
    ).toBe(0);
    const media = css.slice(mediaIdx, mediaIdx + 600);
    expect(media).toContain("font-size: 16px");
    expect(media).toMatch(/input/);
    expect(media).toMatch(/textarea/);
    expect(media).toMatch(/select/);
  });

  it("站点卡片操作在触屏（无 hover）时强制可见（卡片悬浮修复，2026-11-20）", () => {
    const src = overlayFile("src/components/navigation-card.tsx");
    const css = overlayFile("src/styles/globals.css");
    // 新机制（卡片悬浮修复 2026-11-20，Playwright 实测依据）：
    //   · 标准/丰富卡：操作栏由右上角药丸移到底部通栏（nav-card-actionbar），
    //     触屏默认可见改走 globals.css 的 @media (hover: none) 未分层规则，
    //     不再用 pointer-coarse:opacity-100；
    //   · 紧凑行：行布局无底部空间，操作簇保留 pointer-coarse:opacity-100，
    //     故全文件仅剩 1 处；
    //   · 收藏星标：三变体全部常驻可见，不再包在 opacity-0 的 hover-reveal
    //     簇里（旧模式非悬浮态点星标无反应，elementFromPoint 落在容器上）。
    const hits = src.split("pointer-coarse:opacity-100").length - 1;
    expect(
      hits,
      "仅紧凑行操作簇保留 pointer-coarse:opacity-100（标准/丰富卡底部操作栏已改走 globals.css 的 @media (hover: none)）",
    ).toBe(1);
    // 底部操作栏确实存在于标准/丰富卡：className 里 "nav-card-actionbar
    // absolute bottom-0" 出现 2 次（两处注释提及不计）。
    const bars = src.split('"nav-card-actionbar absolute bottom-0').length - 1;
    expect(bars, "标准卡与丰富卡各应有一处底部操作栏 nav-card-actionbar").toBe(2);
    // 触屏可见规则必须落在 globals.css 的非分层区（任何块之外，含 @layer）：
    // 未分层声明才能压过卡片内联的 opacity-0 / pointer-events-none。
    // 注意：文件里另有一处 "@media (hover: none) or (pointer: coarse)" 在
    // @layer utilities 内（.nav-card-glow 触屏反馈，:528），indexOf 会先
    // 命中它——须定位到后面带 .nav-card-actionbar 的那一处（:755）。
    const marker = "@media (hover: none)";
    let hoverNoneIdx = -1;
    for (let i = css.indexOf(marker); i !== -1; i = css.indexOf(marker, i + 1)) {
      if (css.slice(i, i + 300).includes(".nav-card-actionbar")) {
        hoverNoneIdx = i;
        break;
      }
    }
    expect(hoverNoneIdx, "globals.css 应有带 .nav-card-actionbar 的 @media (hover: none) 触屏规则").toBeGreaterThan(-1);
    const before = css.slice(0, hoverNoneIdx);
    let depth = 0;
    for (const ch of before) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(
      depth,
      "操作栏触屏可见规则必须写在任何块之外（含 @layer），否则压不过卡片内联的 opacity-0",
    ).toBe(0);
    const media = css.slice(hoverNoneIdx, hoverNoneIdx + 300);
    expect(media).toContain(".nav-card-actionbar");
    expect(media).toContain("opacity: 1");
    expect(media).toContain("pointer-events: auto");
    // 星标不得再包在 opacity-0 的 hover-reveal 簇里：三处星标容器均须是
    // 常驻可见（标准/丰富卡为 absolute top-2 right-2 + pointer-events-none
    // 容器配 pointer-events-auto 按钮；紧凑行为 opacity-100 容器）。
    const starWrappers = src.split("收藏星标（卡片悬浮修复 2026-11-20）").length - 1;
    expect(starWrappers, "三变体的星标注释都应更新为卡片悬浮修复版（常驻可见）").toBe(3);
  });
});
