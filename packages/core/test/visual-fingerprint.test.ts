/**
 * visual-fingerprint.ts 覆盖：颜色换算、WCAG 对比度、色彩距离、
 * 调色板视觉指纹的情绪/评级/和谐度全分支。
 */
import { describe, expect, it } from "vitest";
import {
  analyzeColorPalette,
  analyzeVisualFingerprint,
  calculateContrastRatio,
  colorDistance,
  getRelativeLuminance,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
} from "../src/visual-fingerprint.ts";

describe("hexToRgb / rgbToHex / rgbToHsl", () => {
  it("6 位与 3 位 hex 互转；无 # 前缀也可", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb("00ff00")).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
  });

  it("非法 hex 返回黑；rgbToHex 钳制越界并四舍五入", () => {
    expect(hexToRgb("zzz")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("")).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbToHex({ r: 300, g: -5, b: 128 })).toBe("#ff0080");
    expect(rgbToHex({ r: 254.6, g: 0, b: 0 })).toBe("#ff0000");
  });

  it("rgbToHsl：红/绿/蓝/灰的色相与饱和度", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 });
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50 });
  });
});

describe("getRelativeLuminance / calculateContrastRatio / colorDistance", () => {
  it("黑 0 白 1；黑白对比度 21；同色对比度 1", () => {
    expect(getRelativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(getRelativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(calculateContrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBe(21);
    expect(calculateContrastRatio({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 })).toBe(1);
    // 顺序无关：前景/背景互换结果相同
    expect(
      calculateContrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }),
    ).toBe(21);
  });

  it("colorDistance：同色 0，黑白为 sqrt(3*255²)", () => {
    expect(colorDistance({ r: 1, g: 2, b: 3 }, { r: 1, g: 2, b: 3 })).toBe(0);
    expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(
      Math.sqrt(3 * 255 * 255),
      5,
    );
    expect(colorDistance({ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 0 })).toBe(255);
  });
});

describe("analyzeVisualFingerprint", () => {
  it("默认深色底+浅色字：AAA 级，和谐度 100（AAA +15，相似色相 +10）", () => {
    const report = analyzeVisualFingerprint(["#3b82f6", "#10b981"]);
    expect(report.wcagPassLevel).toBe("AAA");
    expect(report.wcagContrastRatio).toBeGreaterThanOrEqual(7);
    expect(report.harmonyScore).toBe(100);
    expect(report.recommendations).toEqual([]);
  });

  it("空调色板用默认双色兜底", () => {
    const report = analyzeVisualFingerprint([]);
    expect(report.dominantColors).toEqual(["#3b82f6", "#10b981"]);
  });

  it("情绪分支：cyberpunk / matrix / ocean / warm / vibrant / minimalist", () => {
    // 青 + 品红霓虹
    expect(analyzeVisualFingerprint(["#00ffff", "#ff00ff"]).detectedMood).toBe("cyberpunk");
    // 深绿矩阵（平均亮度 < 45）
    expect(analyzeVisualFingerprint(["#006400"]).detectedMood).toBe("matrix");
    // 高饱和海洋蓝
    expect(analyzeVisualFingerprint(["#0066ff"]).detectedMood).toBe("ocean");
    // 高饱和暖橙
    expect(analyzeVisualFingerprint(["#ff8800"]).detectedMood).toBe("warm");
    // 高饱和红：不属于前四类，饱和度 ≥75 → vibrant
    expect(analyzeVisualFingerprint(["#ff0000"]).detectedMood).toBe("vibrant");
    // 低饱和灰 → minimalist
    expect(analyzeVisualFingerprint(["#808080"]).detectedMood).toBe("minimalist");
  });

  it("AA 级：对比度 4.5–7 之间时 +10 分", () => {
    const report = analyzeVisualFingerprint(["#808080"], "#ffffff", "#767676");
    expect(report.wcagPassLevel).toBe("AA");
    expect(report.wcagContrastRatio).toBeGreaterThanOrEqual(4.5);
    expect(report.wcagContrastRatio).toBeLessThan(7);
    expect(report.harmonyScore).toBe(85);
  });

  it("Fail 级：对比度不足时 -25 分并给出建议", () => {
    const report = analyzeVisualFingerprint(["#808080"], "#ffffff", "#eeeeee");
    expect(report.wcagPassLevel).toBe("Fail");
    expect(report.harmonyScore).toBe(50);
    expect(report.recommendations.some((r) => r.includes("文本对比度不足"))).toBe(true);
  });

  it("色相分散度：互补色 +5，相似色 +10", () => {
    // 红(0°) 与品红(300°)：色相差 300 > 240 → +5（默认对比度 AAA +15）
    const complementary = analyzeVisualFingerprint(["#ff0000", "#ff00ff"]);
    expect(complementary.harmonyScore).toBe(95);
    // 红(0°) 与橙红(16°)：色相差 < 60 → +10
    const analogous = analyzeVisualFingerprint(["#ff0000", "#ff4400"]);
    expect(analogous.harmonyScore).toBe(100);
    // 单色：无色相分散度分支
    const single = analyzeVisualFingerprint(["#ff0000"]);
    expect(single.harmonyScore).toBe(90);
  });

  it("高饱和高亮度并存时提示视觉疲劳", () => {
    const report = analyzeVisualFingerprint(["#ffc0c0"]);
    expect(report.averageSaturation).toBeGreaterThan(85);
    expect(report.averageLuminance).toBeGreaterThan(85);
    expect(report.recommendations.some((r) => r.includes("视觉疲劳"))).toBe(true);
  });

  it("analyzeColorPalette 是同义别名（注意前景/背景参数顺序）", () => {
    const direct = analyzeVisualFingerprint(["#ff0000"], "#0f172a", "#ffffff");
    const alias = analyzeColorPalette(["#ff0000"], "#ffffff", "#0f172a");
    expect(alias).toEqual(direct);
  });
});
