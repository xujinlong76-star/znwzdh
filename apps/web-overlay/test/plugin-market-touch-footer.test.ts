/**
 * P2-9 桌面触屏触摸目标 + P2-16 页脚底部安全区守卫（静态存在性）。
 *
 * P2-9：K8 规则原只在 <640px 生效，桌面触屏用户仍点 32px 按钮；Radix Dialog
 * 经 Portal 挂到 document.body，在 .market-touch 包裹范围之外，弹窗按钮
 * 更无保护。本文件钉死：K8 媒体查询扩到触屏、弹窗作用域兜底、安装弹窗
 * 6 个操作按钮显式 min-h-11。
 * P2-16：390px 滚到底时页脚版权行被底栏与猫头遮挡。本文件钉死：市场 layout
 * 底部安全区垫层、页脚三段底垫未被动过、猫滚到底收起放宽到 ≤1023px、
 * P1-1 收起核心（位移量取、用户唤回、守门）一字未动。
 *
 * 2026-11-26 全站收起推广：P1-1 原只在 /marketplace 窄屏生效，但主线 CI
 * #1777 证实同一缺陷遍及全站——首页与 /hot 首屏猫盖住卡片收藏按钮
 * （390/1024/1366 三档），390px 滚到底压住页脚链接行。收起规则推广到
 * 全站全宽度（syncMarketPark → syncAutoPark），顶部收起不再只限窄屏，
 * “平板跳回顶部放回圆标”分支随之失效删除；页脚移动端底垫 7rem→9rem
 * （11-22 的 116px 浮坞叠层模型少算了猫带顶沿 128px）。位移实时量取、
 * 用户唤回、守门机制一字未动，仍由本文件钉死。
 *
 * 纯字符串断言，不引业务模块、无 vi.mock，不触发 mock-hygiene 清理要求。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) =>
    p.replace(/\\/g, "/").includes("/web-overlay/") || p.replace(/\\/g, "/").endsWith("/web-overlay");
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

function readOverlay(rel: string): string {
  return readFileSync(join(overlayRoot(), "src", rel), "utf8");
}

function readPublic(rel: string): string {
  return readFileSync(join(overlayRoot(), "public", rel), "utf8");
}

describe("P2-9 K8 规则扩展到桌面触屏", () => {
  it("globals.css 的 K8 媒体查询含 pointer: coarse 与 any-pointer: coarse", () => {
    const css = readOverlay("styles/globals.css");
    expect(css).toContain("@media (max-width: 639px), (pointer: coarse), (any-pointer: coarse)");
    expect(css).toContain("(pointer: coarse)");
    expect(css).toContain("(any-pointer: coarse)");
  });

  it("触屏块内仍有 .market-touch 全套选择器与 2.75rem 下限、checkbox/radio 豁免", () => {
    const css = readOverlay("styles/globals.css");
    const at = css.indexOf("@media (max-width: 639px), (pointer: coarse), (any-pointer: coarse)");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("[data-sonner-toast]"));
    for (const sel of [
      ".market-touch button",
      ".market-touch a[href]",
      ".market-touch select",
      ".market-touch [role='button']",
      ".market-touch [role='tab']",
      ".market-touch [role='menuitem']",
    ]) {
      expect(block, "触屏块缺选择器 " + sel).toContain(sel);
    }
    expect(block).toContain("min-height: 2.75rem");
    expect(block).toContain("min-width: 2.75rem");
    expect(block).toContain("input:not([type='checkbox']):not([type='radio'])");
  });

  it("鼠标-only 桌面不受影响：K8 选择器只出现在触屏媒体块内，无裸顶层规则", () => {
    const css = readOverlay("styles/globals.css");
    // 裸顶层规则会写成行首 ".market-touch button {"（无 @media 前缀）；本实现没有
    expect(css).not.toMatch(/^\.market-touch button \{/m);
    // 唯一的 ".market-touch button" 出现在 @media 行之后
    const mediaAt = css.indexOf("@media (max-width: 639px), (pointer: coarse), (any-pointer: coarse)");
    const selAt = css.indexOf(".market-touch button");
    expect(mediaAt).toBeGreaterThan(-1);
    expect(selAt).toBeGreaterThan(mediaAt);
  });
});

describe("P2-9 弹窗按钮保护（Radix Portal 逃出 .market-touch）", () => {
  it("globals.css 用 [role='dialog'] 与 [role='alertdialog'] 兜底弹窗内可点元素", () => {
    const css = readOverlay("styles/globals.css");
    const at = css.indexOf("@media (max-width: 639px), (pointer: coarse), (any-pointer: coarse)");
    const block = css.slice(at, css.indexOf("[data-sonner-toast]"));
    for (const sel of [
      "[role='dialog'] button",
      "[role='dialog'] a[href]",
      "[role='dialog'] select",
      "[role='alertdialog'] button",
    ]) {
      expect(block, "触屏块缺弹窗选择器 " + sel).toContain(sel);
    }
  });

  it("安装弹窗 6 个操作按钮显式 min-h-11：取消/立即安装、仍要安装/返回修改、全选/全不选", () => {
    const src = readOverlay("components/plugins/plugin-install-modal.tsx");
    const hits = src.split("min-h-11").length - 1;
    expect(hits).toBeGreaterThanOrEqual(6);
    for (const label of ["取消", "立即安装", "仍要安装", "返回修改", "全选", "全不选"]) {
      expect(src, "安装弹窗缺按钮 " + label).toContain(label);
    }
    // 全选/全不选原是无内边距小字按钮（约 16–20px 高），必须带上 min-h-11 才达标；
    // “全选”首次出现是文件头注释，按 onClick 锚定真正的按钮再断言
    const selAllAt = src.indexOf("setSelectedUrls(new Set(rawSites.map((s) => s.url)))");
    expect(selAllAt).toBeGreaterThan(-1);
    const selAllBlock = src.slice(selAllAt, selAllAt + 400);
    expect(selAllBlock).toContain("min-h-11");
    expect(selAllBlock).toContain("全选");
  });
});

describe("P2-16 市场页底部安全区", () => {
  it("市场 layout 在页脚之下垫 5rem（含安全区），≥640px 不垫", () => {
    const src = readOverlay("app/marketplace/layout.tsx");
    expect(src).toContain("market-touch");
    expect(src).toContain('pb-[calc(5rem+env(safe-area-inset-bottom,0px))]');
    expect(src).toContain("sm:pb-0");
  });

  it("页脚底垫已抬升避开右下浮坞：<640 留 9rem、≥640 留 6rem（2026-11-26 修正 11-22 值）", () => {
    const src = readOverlay("components/footer.tsx");
    // 11-22 的 7rem 按浮坞叠层（猫+回顶钮≈116px）算，但猫是独立 fixed 元素，
    // 移动端猫带顶沿 = bottom 88px + 猫高 40px = 128px，7rem=112px 仍短 16px，
    // 390x844 滚到底实测仍压住页脚链接行；9rem=144px 留 16px 余量。
    // 平板/桌面猫带顶沿 160px、文本止于 96px，本就清开，6rem 不动。
    expect(src).toContain("pb-[calc(9rem+env(safe-area-inset-bottom,0px))]");
    expect(src).toContain("min-[640px]:max-[1024px]:pb-[calc(6rem+env(safe-area-inset-bottom,0px))]");
    expect(src).toContain("lg:pb-[calc(6rem+env(safe-area-inset-bottom,0px))]");
  });
});

describe("P2-16 猫挂件页脚避让（2026-11-26：收起推广到全站）", () => {
  it("滚到底收起放宽到 ≤1023px：isFooterParkViewport 与 641–1023px 收起位移规则都在", () => {
    const js = readPublic("xiaomaomao/xiaomaomao.js");
    expect(js).toContain("function isFooterParkViewport()");
    expect(js).toContain("max-width: 1023px");
    expect(js).toContain(
      "'@media (min-width:641px) and (max-width:1023px){#xiaomaomao.xm-parked{transform:translateX(var(--xm-park-x,calc(100vw + 12px)))}}'",
    );
    expect(js).toContain("nearPageBottom() && isFooterParkViewport()");
  });

  it("全站收起核心：顶部全宽收起、位移实时量取、用户唤回与守门都在（2026-11-26 由 P1-1 推广）", () => {
    const js = readPublic("xiaomaomao/xiaomaomao.js");
    // 顶部收起不再只限窄屏：首页//hot 首屏卡片收藏按钮在 390/1024/1366 三档
    // 都会被猫盖住；滚到底收起仍只在 ≤1023px（P2-16 页脚避让范围）。
    expect(js).toContain("y <= 30 || (nearPageBottom() && isFooterParkViewport())");
    expect(js).toContain("function nearPageBottom()");
    expect(js).toContain("function syncAutoPark()");
    expect(js).toContain("root.style.setProperty('--xm-park-x'");
    expect(js).toContain("userUnparked");
    expect(js).toContain("function parkBlocked()");
    // Q1 竞态修复（关过渡、强制回流、重算位移）仍在
    expect(js).toContain("void root.offsetWidth");
  });

  it("已删除的窄屏限定：顶部收起不再只限窄屏、平板回顶分支已失效（2026-11-26）", () => {
    const js = readPublic("xiaomaomao/xiaomaomao.js");
    // 顶部收起推广到全宽度后，旧的窄屏限定条件与“平板跳回顶部放回圆标”
    // 分支都已失效：回到顶部现在重新收起，与进页一致。钉死它们不在场，
    // 防止有人把旧条件悄悄恢复回来。
    expect(js).not.toContain("(y <= 30 && isNarrowViewport())");
    expect(js).not.toContain("y <= 30 && !isNarrowViewport() && autoParked");
    expect(js).not.toContain("function syncMarketPark()");
  });
});
