/**
 * 计算/取值族检测器：算术表达式求值、颜色（HEX/RGB）速览。
 */
import type { SpeculativeIntentResult } from './types.ts'

/**
 * 纯算术表达式求值（安全计算，杜绝 unsafe eval）
 */
export function tryParseMath(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  // 长度上限：防止 10KB 长串每击键编译一次 DoS；且需 CSP 允许 unsafe-eval，否则 Function 会抛错（已 catch）
  if (trimmed.length > 200) return null;
  // 必须包含至少一个算术运算符，且仅包含数字、小数点、括号、运算符与空白
  if (!/[+\-*/%^]/.test(trimmed)) return null;
  if (!/^[\d\s+\-*/%^().]+$/.test(trimmed)) return null;

  // 避免将类似版本号或单一负数判断为算式
  if (/^\d+(\.\d+)+$/.test(trimmed)) return null;

  try {
    // 将 ^ 转换为 **
    const sanitized = trimmed.replace(/\^/g, '**');

    // 严密 Token 校验，避免任意代码执行
    if (/[a-zA-Z_$]/.test(sanitized)) return null;

    // 安全求值 (Function 严格只接受返回值表达式)
    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();

    if (typeof result === 'number' && Number.isFinite(result)) {
      const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(4).replace(/\.?0+$/, '');
      return {
        type: 'math',
        title: '算术即刻计算',
        subtitle: `${trimmed} =`,
        previewValue: formatted,
        actionLabel: '复制计算结果',
        copyValue: formatted,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 颜色意图解析 (HEX, RGB, HSL)
 */
export function tryParseColor(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();

  // HEX 匹配：裸 3 位 hex（如 abc/fff）误触发太多短查询，要求 # 前缀或长度>=6
  const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch && hexMatch[1]) {
    const rawHex = hexMatch[1];
    if (!trimmed.startsWith('#') && rawHex.length === 3) return null;
    let hex = rawHex;
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    // 8 位 HEX 的 alpha 直接展示，不静默丢弃
    const alpha = hex.length === 8 ? hex.slice(6, 8) : null;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const fullHex = `#${hex.toUpperCase()}`;
    const rgbStr = `rgb(${r}, ${g}, ${b})`;

    return {
      type: 'color',
      title: '颜色即刻速览',
      subtitle: `${fullHex} · ${rgbStr}${alpha ? ` · alpha ${alpha}` : ''}`,
      previewValue: fullHex,
      actionLabel: '复制 HEX 色值',
      copyValue: fullHex,
      details: {
        HEX: fullHex,
        RGB: rgbStr,
        ...(alpha ? { Alpha: alpha } : {}),
      },
    };
  }

  // RGB 匹配
  const rgbMatch = trimmed.match(/^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([\d.]+))?\)$/i);
  if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = Math.min(255, Number.parseInt(rgbMatch[1], 10));
    const g = Math.min(255, Number.parseInt(rgbMatch[2], 10));
    const b = Math.min(255, Number.parseInt(rgbMatch[3], 10));
    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
    return {
      type: 'color',
      title: 'RGB 颜色速览',
      subtitle: `${hex} · rgb(${r}, ${g}, ${b})`,
      previewValue: hex,
      actionLabel: '复制 HEX 色值',
      copyValue: hex,
      details: {
        HEX: hex,
        RGB: `rgb(${r}, ${g}, ${b})`,
      },
    };
  }

  return null;
}
