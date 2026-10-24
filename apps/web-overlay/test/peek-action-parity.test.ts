/**
 * 速览弹窗必须是卡片操作的「等价入口」。
 *
 * 2026-10-24 卡片改为单一 Tab 入口后，置顶 / 收藏按钮退出了 Tab 序列
 * （只能靠方向键进入操作区）。对只用读屏浏览模式的用户而言，弹窗里必须有
 * 同样的动作，否则这些功能对他们等于不存在。这里锁住：
 *   1. 弹窗支持 categoryId / 置顶回调 / 关闭时焦点归还；
 *   2. 首页记录打开前的焦点并还原；
 *   3. 页面级渲染唯一的键盘说明元素，卡片通过 aria-describedby 指向它。
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

describe("速览弹窗：卡片操作的等价入口", () => {
  const dialog = overlaySource("src/components/site-peek-dialog.tsx");
  const home = overlaySource("src/components/navigation-content.tsx");

  it("弹窗支持分类上下文、置顶回调与焦点归还", () => {
    expect(dialog).toContain("categoryId?: string");
    expect(dialog).toContain("onTogglePinInCategory?: (siteId: string) => void");
    expect(dialog).toContain("onCloseAutoFocus?: (event: Event) => void");
    expect(dialog).toContain("onCloseAutoFocus={onCloseAutoFocus}");
  });

  it("弹窗里渲染了置顶与收藏动作", () => {
    expect(dialog).toContain("aria-pressed={isPinnedInCategory}");
    expect(dialog).toContain("<FavoriteButton");
  });

  it("首页记录打开前的焦点并在关闭后还原", () => {
    expect(home).toContain("peekReturnFocusRef");
    expect(home).toContain("restorePeekFocus");
    expect(home).toContain("onCloseAutoFocus={() => restorePeekFocus()}");
  });

  it("键盘说明在页面级只渲染一份，卡片通过 aria-describedby 引用", () => {
    expect(home).toContain('id="navhub-card-keyboard-hint"');
    expect(home).toContain('keyboardHintId="navhub-card-keyboard-hint"');
    // 卡片本体不带提示文案，避免 1000 张卡重复渲染
    expect(overlaySource("src/components/navigation-card.tsx")).not.toContain(
      "右方向键进入卡片操作区",
    );
  });
});
