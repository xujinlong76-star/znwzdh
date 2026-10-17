/**
 * 「减弱动态效果」：系统偏好必须真的被听见。
 *
 * 真实缺陷（改动前）：全站**没有任何** prefers-reduced-motion 处理。
 * 卡片悬停的位移动画、depth-card 的阴影过渡、animate-pulse、抽屉与弹窗的滑入滑出
 * 对前庭功能敏感的用户一律强制播放；侧边栏与键盘导航还会调用
 * `scrollIntoView({ behavior: 'smooth' })` —— JS 显式传的 behavior 会压过样式表，
 * 这段滚动动画用户关不掉。
 *
 * 这里锁三件事：
 *   1. 偏好读取的口径（读不到 ≠ 要求减弱，不能凭空去掉动效）；
 *   2. 样式表的关键声明（尤其是 0.01ms 而不是 0：0 会让 transitionend 不再触发）；
 *   3. 加载顺序与调用点（CSS 必须排在 globals.css 之后；两处滚动不得再硬编码）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REDUCED_MOTION_QUERY,
  preferredScrollBehavior,
  prefersReducedMotion,
  type MotionQueryMatcher,
} from "../src/lib/motion";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const alwaysReduced: MotionQueryMatcher = () => ({ matches: true });
const neverReduced: MotionQueryMatcher = () => ({ matches: false });

describe("prefersReducedMotion：读不到偏好，就不能假装读到了", () => {
  it("媒体查询是标准写法（手滑写错 = 整个功能静默失效）", () => {
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });

  it("node / 老浏览器没有 matchMedia → false，且不抛错", () => {
    expect(typeof window).toBe("undefined");
    expect(prefersReducedMotion()).toBe(false);
  });

  it("系统要求减弱 → true；没要求 → false", () => {
    expect(prefersReducedMotion(alwaysReduced)).toBe(true);
    expect(prefersReducedMotion(neverReduced)).toBe(false);
  });

  it("查询失败 / 返回空值 → 按「未要求」处理（默认保持动效，不是默认关掉）", () => {
    expect(prefersReducedMotion(() => null)).toBe(false);
    expect(prefersReducedMotion(() => undefined)).toBe(false);
    expect(
      prefersReducedMotion(() => {
        throw new Error("unsupported media query");
      }),
    ).toBe(false);
  });
});

describe("preferredScrollBehavior：JS 传参的滚动也要照顾偏好", () => {
  it("要求减弱 → 'auto'（直接落位，不滚一段）", () => {
    expect(preferredScrollBehavior(alwaysReduced)).toBe("auto");
  });

  it("未要求 / 读不到 → 'smooth'（保持原有体验）", () => {
    expect(preferredScrollBehavior(neverReduced)).toBe("smooth");
    expect(preferredScrollBehavior(() => null)).toBe("smooth");
    expect(preferredScrollBehavior()).toBe("smooth");
  });
});

describe("源码守卫：样式表与调用点都不能退回硬编码", () => {
  it("只有 reduce 分支才生效，且动效是「瞬完」而不是「归零」", () => {
    const css = overlaySource("src/styles/reduced-motion.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important");
    expect(css).toContain("transition-duration: 0.01ms !important");
    expect(css).toContain("animation-iteration-count: 1 !important");
    // 平滑滚动也是动效
    expect(css).toContain("scroll-behavior: auto !important");
    // 绝不能写成 0：duration 为 0 时 transitionend / animationend 不再派发，
    // 抽屉与 Toast 会卡在「等动画结束」
    expect(css).not.toContain("duration: 0 !important");
  });

  it("在 layout 里排在 globals.css 之后加载（否则覆盖不到动效定义）", () => {
    const layout = overlaySource("src/app/layout.tsx");
    const globals = layout.indexOf("@/styles/globals.css");
    const reduced = layout.indexOf("@/styles/reduced-motion.css");
    expect(globals).toBeGreaterThan(-1);
    expect(reduced).toBeGreaterThan(globals);
  });

  it("侧边栏跳分类与键盘导航跟随都不再硬编码 'smooth'", () => {
    for (const rel of ["src/components/sidebar.tsx", "src/lib/use-keyboard-navigator.ts"]) {
      const src = overlaySource(rel);
      expect(src).toContain("preferredScrollBehavior()");
      expect(src).not.toMatch(/scrollIntoView\(\{\s*behavior:\s*'smooth'/);
    }
  });
});
