import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("用户中心设置摘要：单选 pill 可见焦点 + 方向键", () => {
  const view = overlaySource("src/app/me/me-view.tsx");
  const ring =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const count = (needle: string) => view.split(needle).length - 1;

  it("两组单选 pill 与两个「知道了」按钮都有可见焦点环", () => {
    expect(view).toContain(
      "'rounded-md py-1 text-center text-xs font-medium transition-all " + ring + "'",
    );
    expect(view).toContain(
      "'rounded-lg border py-1 text-center text-[11px] font-medium transition-all " + ring + "'",
    );
    expect(
      count(
        'className="text-[11px] underline underline-offset-2 opacity-80 hover:opacity-100 ' +
          ring +
          '"',
      ),
    ).toBe(2);
    // 搜索引擎下拉不再用 focus:ring-1，统一为 focus-visible:ring-2
    expect(view).not.toContain("focus:ring-1 focus:ring-ring");
    expect(view).toContain("focus:border-primary " + ring + " disabled:opacity-50");
    // 6 处焦点环：0-RTT 开关 + 密度 pill + 保留周期 pill + 下拉 + 「知道了」×2
    expect(count("focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")).toBe(6);
  });

  it("两组 radiogroup 都是 roving tabindex，整组只有一个 Tab 停靠点", () => {
    expect(count('role="radiogroup"')).toBe(2);
    expect(count("tabIndex={active ? 0 : -1}")).toBe(2);
    expect(view).not.toContain("tabIndex={0}");
  });

  it("两组 radiogroup 都支持方向键 / Home / End 移动并选中", () => {
    expect(count("onKeyDown={moveRadioSelection}")).toBe(2);
    expect(view).toContain("function moveRadioSelection(event: KeyboardEvent<HTMLDivElement>)");
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
      expect(view).toContain(`event.key === '${key}'`);
    }
    expect(view).toContain("'[role=\"radio\"]:not([disabled])'");
    expect(view).toContain("event.preventDefault()");
    expect(view).toContain("target.focus()");
    expect(view).toContain("target.click()");
  });
});
