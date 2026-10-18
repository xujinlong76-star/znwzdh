// @core-mirror:parity-ignore-start
// 本文件由 scripts/sync-core-mirrors.mjs 自动生成，请勿手工编辑。
// 事实源：packages/core/src/visual-fingerprint.ts
// 同步命令：node scripts/sync-core-mirrors.mjs
// 一致性守门：node scripts/sync-core-mirrors.mjs --check（CI 可加）
// @core-mirror:parity-ignore-end
/**
 * 视觉指纹分析与美学和谐度引擎 (Visual Fingerprint & Color Harmony)
 *
 * 核心设计目标：
 * 1. 颜色提取与量化分析 (RGB/HSL 转换，亮度与饱和度分布)
 * 2. WCAG 2.1 对比度与可读性评估
 * 3. 视觉情绪与美学风格分类 (cyberpunk, ocean, warm, minimalist, matrix)
 * 4. 调色板和谐度分析 (Color Harmony Scoring & Suggestions)
 */

export interface RgbColor {
  r: number; // 0 ~ 255
  g: number; // 0 ~ 255
  b: number; // 0 ~ 255
}

export interface HslColor {
  h: number; // 0 ~ 360
  s: number; // 0 ~ 100 (%)
  l: number; // 0 ~ 100 (%)
}

export type VisualMood = 'cyberpunk' | 'minimalist' | 'ocean' | 'warm' | 'matrix' | 'vibrant';

export interface ColorHarmonyReport {
  dominantColors: string[];
  averageLuminance: number;
  averageSaturation: number;
  wcagContrastRatio: number; // 前景 vs 背景对比度
  wcagPassLevel: 'AAA' | 'AA' | 'Fail';
  detectedMood: VisualMood;
  harmonyScore: number; // 0 ~ 100
  recommendations: string[];
}

/**
 * 16进制转 RGB
 */
export function hexToRgb(hex: string): RgbColor {
  let cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map((c) => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * RGB 转 16 进制
 */
export function rgbToHex(rgb: RgbColor): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(rgb.r).toString(16).padStart(2, '0');
  const g = clamp(rgb.g).toString(16).padStart(2, '0');
  const b = clamp(rgb.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * RGB 转 HSL
 */
export function rgbToHsl(rgb: RgbColor): HslColor {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / delta + 2) * 60;
        break;
      case b:
        h = ((r - g) / delta + 4) * 60;
        break;
    }
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * 计算相对亮度 (WCAG 2.1 规范)
 */
export function getRelativeLuminance(rgb: RgbColor): number {
  const normalize = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = normalize(rgb.r);
  const g = normalize(rgb.g);
  const b = normalize(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 计算两者之间的对比度 (WCAG 2.1)
 */
export function calculateContrastRatio(foreground: RgbColor, background: RgbColor): number {
  const lum1 = getRelativeLuminance(foreground);
  const lum2 = getRelativeLuminance(background);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * 欧氏色彩距离
 */
export function colorDistance(c1: RgbColor, c2: RgbColor): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 综合评估调色板视觉指纹与和谐度
 */
export function analyzeVisualFingerprint(
  paletteHex: string[],
  backgroundHex = '#0f172a', // 默认深色底
  textHex = '#f8fafc' // 默认浅色字
): ColorHarmonyReport {
  const cleanPalette = paletteHex.length > 0 ? paletteHex : ['#3b82f6', '#10b981'];
  const rgbs = cleanPalette.map(hexToRgb);
  const hsls = rgbs.map(rgbToHsl);

  const avgLum = Math.round(hsls.reduce((acc, c) => acc + c.l, 0) / hsls.length);
  const avgSat = Math.round(hsls.reduce((acc, c) => acc + c.s, 0) / hsls.length);

  // 对比度检测
  const bgRgb = hexToRgb(backgroundHex);
  const textRgb = hexToRgb(textHex);
  const contrast = calculateContrastRatio(textRgb, bgRgb);

  let passLevel: 'AAA' | 'AA' | 'Fail' = 'Fail';
  if (contrast >= 7.0) {
    passLevel = 'AAA';
  } else if (contrast >= 4.5) {
    passLevel = 'AA';
  }

  // 风格情绪检测
  let detectedMood: VisualMood = 'minimalist';
  const hasNeonCyan = hsls.some((h) => h.h >= 170 && h.h <= 200 && h.s >= 70);
  const hasNeonMagenta = hsls.some((h) => (h.h >= 290 || h.h <= 340) && h.s >= 70);
  const hasGreenMatrix = hsls.some((h) => h.h >= 100 && h.h <= 160 && h.s >= 60);
  const hasOceanBlue = hsls.some((h) => h.h >= 180 && h.h <= 240);
  const hasWarmTone = hsls.some((h) => h.h >= 15 && h.h <= 55);

  if (hasNeonCyan && hasNeonMagenta) {
    detectedMood = 'cyberpunk';
  } else if (hasGreenMatrix && avgLum < 45) {
    detectedMood = 'matrix';
  } else if (hasOceanBlue && avgSat >= 50) {
    detectedMood = 'ocean';
  } else if (hasWarmTone && avgSat >= 50) {
    detectedMood = 'warm';
  } else if (avgSat >= 75) {
    detectedMood = 'vibrant';
  } else {
    detectedMood = 'minimalist';
  }

  // 计算和谐度得分
  const recommendations: string[] = [];
  let harmonyScore = 75;

  if (contrast >= 7.0) {
    harmonyScore += 15;
  } else if (contrast >= 4.5) {
    harmonyScore += 10;
  } else {
    harmonyScore -= 25;
    recommendations.push(`文本对比度不足 (${contrast}:1)，未达到 WCAG AA 级标准 (4.5:1)`);
  }

  // 色相分散度检测
  if (hsls.length >= 2) {
    const hues = hsls.map((h) => h.h).sort((a, b) => a - b);
    const maxHueDiff = hues[hues.length - 1]! - hues[0]!;
    if (maxHueDiff > 240) {
      harmonyScore += 5; // 互补色张力
    } else if (maxHueDiff < 60) {
      harmonyScore += 10; // 相似色优雅
    }
  }

  harmonyScore = Math.max(10, Math.min(100, harmonyScore));

  if (avgSat > 85 && avgLum > 85) {
    recommendations.push('高饱和高亮度并存可能造成视觉疲劳，建议引入柔和过渡灰');
  }

  return {
    dominantColors: cleanPalette,
    averageLuminance: avgLum,
    averageSaturation: avgSat,
    wcagContrastRatio: contrast,
    wcagPassLevel: passLevel,
    detectedMood,
    harmonyScore,
    recommendations,
  };
}

export const analyzeColorPalette = (
  palette: string[],
  foregroundHex = '#ffffff',
  backgroundHex = '#0f172a'
): ColorHarmonyReport => analyzeVisualFingerprint(palette, backgroundHex, foregroundHex);
