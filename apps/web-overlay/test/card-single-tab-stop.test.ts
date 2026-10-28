/**
 * 站点卡片键盘模型：整卡一个 Tab 停留点。
 *
 * 真实缺陷（改动前）：卡片根节点 tabIndex=0，加上主链接、置顶、速览、
 * 工作台、收藏五个按钮，一张卡 6 个停留点。首页 1000+ 卡片 ≈ 6000 次 Tab，
 * 键盘用户实际到不了页尾。
 *
 * 现行模型（WAI-ARIA 复合控件）：主链接是唯一 Tab 停留点；→ 进入操作区，
 * 操作区内 ←/→ 切换、Esc 返回主链接。这里锁住接线，防止重构退回旧模型。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("站点卡片：单一 Tab 入口 + 方向键操作区", () => {
  const card = overlaySource("src/components/navigation-card.tsx");

  it("卡片根节点不再进入 Tab 序列", () => {
    expect(card).not.toContain("tabIndex={0}");
  });

  it("主链接承载 Space 速览与 → 进入操作区", () => {
    expect(card).toContain("ref={linkRef}");
    expect(card).toContain("onKeyDown={handleKeyDown}");
    expect(card).toContain("e.key === 'ArrowRight'");
    expect(card).toContain("[data-card-action]");
  });

  it("操作区支持 ←/→ 与 Esc 回到主链接", () => {
    expect(card).toContain("handleActionsKeyDown");
    expect(card).toContain("e.key === 'ArrowLeft'");
    expect(card).toContain("e.key === 'Escape'");
    expect(card).toContain("linkRef.current?.focus()");
  });

  it("操作按钮全部退出 Tab 序列（三个变体 × 置顶/速览/工作台 + 共用详情入口）", () => {
    const marked = card.match(/data-card-action=""/g) ?? [];
    // 9 个内联按钮 + detailAction() 里那 1 个共用详情入口
    expect(marked.length).toBe(10);
    // 详情入口必须真的被三个变体各用一次，否则有一种密度无法用键盘进入站点详情
    expect((card.match(/detailAction\(/g) ?? []).length).toBe(3);
    // 收藏按钮走组件参数，三处都必须显式传入
    const favs = card.match(/cardAction/g) ?? [];
    expect(favs.length).toBe(3);
  });

  it("主链接声明快捷键与操作说明（读屏用户能发现方向键入口）", () => {
    expect(card).toContain('aria-keyshortcuts="Space ArrowRight"');
    expect(card).toContain("aria-describedby={keyboardHintId}");
  });

  it("收藏按钮组件支持退出 Tab 序列并标记为卡片操作", () => {
    const fav = overlaySource("src/components/favorite-button.tsx");
    expect(fav).toContain("tabIndex?: number");
    expect(fav).toContain("cardAction?: boolean");
    expect(fav).toContain("data-card-action={cardAction ? '' : undefined}");
  });
});
