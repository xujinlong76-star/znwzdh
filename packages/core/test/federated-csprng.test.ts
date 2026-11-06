/**
 * 联邦推荐 LDP 随机源回归（2026-11-06 深扫 P2-14）。
 *
 * sampleLaplace 旧实现用 Math.random（V8 xorshift128+，状态可观测/可预测），
 * 用于本地差分隐私会削弱「个体不可重构」保证。现改用 globalThis.crypto.getRandomValues（CSPRNG）。
 * 本测试钉住：① 源码不再用 Math.random；② 同输入两次输出不同；③ 均值≈0（无偏）；
 * ④ 方差≈2b²（Laplace 理论方差）；⑤ core 与前端镜像逐字节一致。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleLaplace } from "../src/federated-recommendation.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_SRC = readFileSync(resolve(ROOT, "src/federated-recommendation.ts"), "utf8");
const OVERLAY_SRC = readFileSync(
  resolve(ROOT, "../../apps/web-overlay/src/lib/federated-recommendation.ts"),
  "utf8"
);

describe("sampleLaplace 使用 CSPRNG", () => {
  it("源码不再使用 Math.random", () => {
    // 允许注释里提到 Math.random（说明为何不用），但代码行不能有调用
    const code = CORE_SRC.split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/Math\.random\s*\(/);
    expect(code).toContain("getRandomValues");
  });

  it("同参数两次调用输出不同（非确定性）", () => {
    const a = Array.from({ length: 8 }, () => sampleLaplace(1));
    const b = Array.from({ length: 8 }, () => sampleLaplace(1));
    expect(a.join()).not.toBe(b.join());
  });

  it("均值接近 0（Laplace 无偏）", () => {
    const n = 4000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sampleLaplace(1);
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });

  it("方差接近 2b²（b=1 时约 2，容差 35%）", () => {
    const n = 4000;
    const xs = Array.from({ length: n }, () => sampleLaplace(1));
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    const varr = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    expect(varr).toBeGreaterThan(2 * 0.65);
    expect(varr).toBeLessThan(2 * 1.35);
  });

  it("b<=0 直接返回 0（边界不变）", () => {
    expect(sampleLaplace(0)).toBe(0);
    expect(sampleLaplace(-1)).toBe(0);
  });

  it("core 与前端 overlay 镜像一致（parity-ignore  banner 除外）", () => {
    const stripBanner = (s: string) =>
      s.replace(/^\/\/ @core-mirror:parity-ignore-start[\s\S]*?parity-ignore-end\n/, "").trim();
    expect(stripBanner(OVERLAY_SRC)).toBe(stripBanner(CORE_SRC));
  });
});
