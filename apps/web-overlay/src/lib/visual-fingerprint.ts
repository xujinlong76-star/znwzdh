/**
 * 浏览器端视觉指纹与色彩和谐度适配器 (Client-side Visual Fingerprint & Color Harmony)
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface HslColor {
  h: number;
  s: number;
  l: number;
}

export type VisualMood = 'cyberpunk' | 'minimalist' | 'ocean' | 'warm' | 'matrix' | 'vibrant';

export interface ColorHarmonyReport {
  dominantColors: string[];
  averageLuminance: number;
  averageSaturation: number;
  wcagContrastRatio: number;
  wcagPassLevel: 'AAA' | 'AA' | 'Fail';
  detectedMood: VisualMood;
  harmonyScore: number;
  recommendations: string[];
}

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

export function rgbToHex(rgb: RgbColor): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(rgb.r).toString(16).padStart(2, '0');
  const g = clamp(rgb.g).toString(16).padStart(2, '0');
  const b = clamp(rgb.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

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

export function calculateContrastRatio(foreground: RgbColor, background: RgbColor): number {
  const lum1 = getRelativeLuminance(foreground);
  const lum2 = getRelativeLuminance(background);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

export function analyzeVisualFingerprint(
  paletteHex: string[],
  backgroundHex = '#0f172a',
  textHex = '#f8fafc'
): ColorHarmonyReport {
  const cleanPalette = paletteHex.length > 0 ? paletteHex : ['#3b82f6', '#10b981'];
  const rgbs = cleanPalette.map(hexToRgb);
  const hsls = rgbs.map(rgbToHsl);

  const avgLum = Math.round(hsls.reduce((acc, c) => acc + c.l, 0) / hsls.length);
  const avgSat = Math.round(hsls.reduce((acc, c) => acc + c.s, 0) / hsls.length);

  const bgRgb = hexToRgb(backgroundHex);
  const textRgb = hexToRgb(textHex);
  const contrast = calculateContrastRatio(textRgb, bgRgb);

  let passLevel: 'AAA' | 'AA' | 'Fail' = 'Fail';
  if (contrast >= 7.0) {
    passLevel = 'AAA';
  } else if (contrast >= 4.5) {
    passLevel = 'AA';
  }

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

  if (hsls.length >= 2) {
    const hues = hsls.map((h) => h.h).sort((a, b) => a - b);
    const maxHueDiff = hues[hues.length - 1]! - hues[0]!;
    if (maxHueDiff > 240) {
      harmonyScore += 5;
    } else if (maxHueDiff < 60) {
      harmonyScore += 10;
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
