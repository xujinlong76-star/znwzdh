import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F3 移动触控可读性与触达基线（2026-11-02）。
 *
 * 锁四件事（风格照抄 a11y-contrast.test.ts 的「锁源码意图」）：
 *   1. 底栏标签/徽章字号不得回退到 8-10px（触控不可读）；
 *   2. 顶栏图标按钮触达尺寸 ≥36px（h-8/w-8 一律禁止）；
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

  it("标签行收紧 leading 并禁止换行，防 4 项 flex-1 纵向溢出", () => {
    const src = overlayFile("src/components/mobile-nav.tsx");
    expect(src).toContain("leading-[14px]");
    expect(src).toContain("whitespace-nowrap");
  });
});

describe("顶栏触达尺寸（navigation-toolbar）", () => {
  it("icon 按钮不再使用 h-8/h-8.5（一律 h-9 = 36px）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    expect(src, "仍有 h-8 w-8 触达不足").not.toContain("h-8 w-8");
    expect(src, "仍有 h-8.5 w-8.5（34px < 36px）").not.toContain("h-8.5 w-8.5");
    expect(src).not.toContain("sm:h-8.5 sm:w-8.5");
    const h9 = src.split("h-9 w-9").length - 1;
    expect(h9, "8 个 icon 按钮应全部是 h-9 w-9").toBe(8);
  });

  it("每个 size=\"icon\" 按钮块内都有 aria-label（asChild 挂内层 Link 也算）", () => {
    const src = overlayFile("src/components/navigation-toolbar.tsx");
    const parts = src.split('size="icon"');
    expect(parts.length - 1, "应有 8 个 icon 按钮").toBe(8);
    for (let i = 1; i < parts.length; i++) {
      // 从 size="icon" 起，到对应 </Button> 为止的块（JSX 块最大 ~40 行）
      const block = parts[i].slice(0, 2000);
      const end = block.indexOf("</Button>");
      const chunk = end >= 0 ? block.slice(0, end) : block;
      expect(chunk, `第 ${i} 个 icon 按钮缺少 aria-label`).toContain("aria-label=");
    }
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
  it("footer 的「·」装饰分隔符全部 aria-hidden", () => {
    const src = overlayFile("src/components/footer.tsx");
    const bare = src.match(/<span(?![^>]*aria-hidden)[^>]*>·<\/span>/g);
    expect(bare, "存在未 aria-hidden 的「·」分隔符（读屏会念成无意义字符）").toBeNull();
    const hidden = src.split('aria-hidden="true">·</span>').length - 1;
    // 15 = 14（25752f31 起）+ 1（每日简报上线新增页脚「每日简报」链接的分隔符）
    expect(hidden, "15 处分隔符都应带 aria-hidden").toBe(15);
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

  it("站点卡片操作在触屏（无 hover）时强制可见（pointer-coarse，V13）", () => {
    const src = overlayFile("src/components/navigation-card.tsx");
    const hits = src.split("pointer-coarse:opacity-100").length - 1;
    expect(
      hits,
      "三处 hover-reveal 操作簇都应带 pointer-coarse:opacity-100——否则触屏用户永远看不到收藏/置顶按钮",
    ).toBe(3);
  });
});
