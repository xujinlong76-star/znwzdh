/**
 * 浏览器端推测性意图解析引擎 (Browser-side Speculative Intent Engine)
 *
 * 针对浏览器环境优化，无需 Node.js Buffer，支持 0-RTT 原地解码/计算/色彩呈现。
 */

export type SpeculativeIntentType =
  | 'base64_decode'
  | 'base64_encode'
  | 'timestamp'
  | 'color'
  | 'math'
  | 'json_format'
  | 'url_decode'
  | 'hash_detect'
  | 'ip_detect';

export interface SpeculativeIntentResult {
  type: SpeculativeIntentType;
  title: string;
  subtitle: string;
  previewValue: string;
  actionLabel: string;
  copyValue?: string;
  details?: Record<string, string>;
}

function b64DecodeUnicode(str: string): string {
  try {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return atob(str);
  }
}

function b64EncodeUnicode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function tryParseBase64(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicitDecode = trimmed.startsWith('b64:') || trimmed.startsWith('base64:');
  const explicitEncode = trimmed.startsWith('b64e:') || trimmed.startsWith('base64e:');

  if (explicitEncode) {
    const raw = trimmed.replace(/^(b64e:|base64e:)\s*/, '');
    if (!raw) return null;
    try {
      const encoded = b64EncodeUnicode(raw);
      return {
        type: 'base64_encode',
        title: 'Base64 快速编码',
        subtitle: `原始字符: ${raw.slice(0, 30)}${raw.length > 30 ? '...' : ''}`,
        previewValue: encoded,
        actionLabel: '复制编码结果',
        copyValue: encoded,
      };
    } catch {
      return null;
    }
  }

  const candidate = explicitDecode
    ? trimmed.replace(/^(b64:|base64:)\s*/, '')
    : trimmed;

  if (!explicitDecode) {
    if (candidate.length < 8) return null;
    if (/^\d+$/.test(candidate)) return null;
    if (!/^[A-Za-z0-9+/=_-]+$/.test(candidate)) return null;
  }

  try {
    const decoded = b64DecodeUnicode(candidate);
    const isPrintable = /^[\x20-\x7E\r\n\t\u4e00-\u9fa5]+$/.test(decoded);
    const reEncoded = b64EncodeUnicode(decoded);
    const isNormalized = candidate.replace(/=+$/, '') === reEncoded.replace(/=+$/, '');

    if ((explicitDecode || (isPrintable && isNormalized)) && decoded.length > 0) {
      return {
        type: 'base64_decode',
        title: 'Base64 0-RTT 解码',
        subtitle: `解码长度: ${decoded.length} 字符`,
        previewValue: decoded,
        actionLabel: '复制解码内容',
        copyValue: decoded,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function tryParseTimestamp(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicit = trimmed.startsWith('ts:') || trimmed.startsWith('time:');
  const numStr = explicit ? trimmed.replace(/^(ts:|time:)\s*/, '') : trimmed;

  if (!/^\d{10}(\d{3})?$/.test(numStr)) return null;

  const num = Number.parseInt(numStr, 10);
  if (Number.isNaN(num)) return null;

  const ms = numStr.length === 10 ? num * 1000 : num;
  const date = new Date(ms);

  if (date.getFullYear() < 2000 || date.getFullYear() > 2050) return null;

  const iso = date.toISOString();
  const local = date.toLocaleString('zh-CN', { hour12: false });
  const diffSec = Math.round((Date.now() - ms) / 1000);
  let relative = '';
  if (Math.abs(diffSec) < 60) relative = '刚刚';
  else if (Math.abs(diffSec) < 3600) relative = `${Math.floor(Math.abs(diffSec) / 60)} 分钟${diffSec > 0 ? '前' : '后'}`;
  else if (Math.abs(diffSec) < 86400) relative = `${Math.floor(Math.abs(diffSec) / 3600)} 小时${diffSec > 0 ? '前' : '后'}`;
  else relative = `${Math.floor(Math.abs(diffSec) / 86400)} 天${diffSec > 0 ? '前' : '后'}`;

  return {
    type: 'timestamp',
    title: 'Unix 时间戳即刻解析',
    subtitle: `${numStr.length === 10 ? '秒级' : '毫秒级'}时间戳 · ${relative}`,
    previewValue: `${local} (${iso})`,
    actionLabel: '复制 ISO 时间',
    copyValue: iso,
    details: {
      '本地时间': local,
      'UTC 时间': iso,
      '相对时间': relative,
      'Unix 秒': Math.floor(ms / 1000).toString(),
      'Unix 毫秒': ms.toString(),
    },
  };
}

function tryParseColor(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const fullHex = `#${hex.toUpperCase()}`;
    const rgbStr = `rgb(${r}, ${g}, ${b})`;

    return {
      type: 'color',
      title: '颜色即刻调色板',
      subtitle: `${fullHex} · ${rgbStr}`,
      previewValue: fullHex,
      actionLabel: '复制 HEX 色值',
      copyValue: fullHex,
      details: {
        HEX: fullHex,
        RGB: rgbStr,
      },
    };
  }

  const rgbMatch = trimmed.match(/^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([\d.]+))?\)$/i);
  if (rgbMatch) {
    const r = Math.min(255, Number.parseInt(rgbMatch[1], 10));
    const g = Math.min(255, Number.parseInt(rgbMatch[2], 10));
    const b = Math.min(255, Number.parseInt(rgbMatch[3], 10));
    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
    return {
      type: 'color',
      title: 'RGB 色彩速览',
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

function tryParseMath(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (!/[+\-*/%^]/.test(trimmed)) return null;
  if (!/^[\d\s+\-*/%^().]+$/.test(trimmed)) return null;
  if (/^\d+(\.\d+)+$/.test(trimmed)) return null;

  try {
    const sanitized = trimmed.replace(/\^/g, '**');
    if (/[a-zA-Z_$]/.test(sanitized)) return null;
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

function tryParseJson(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}')) && !(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return null;
  }
  if (trimmed.length < 5) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const pretty = JSON.stringify(parsed, null, 2);
    const isArray = Array.isArray(parsed);
    const count = isArray ? parsed.length : Object.keys(parsed).length;

    return {
      type: 'json_format',
      title: 'JSON 语法验证与美化',
      subtitle: `有效 JSON · ${isArray ? `${count} 项数组` : `${count} 个属性键`}`,
      previewValue: pretty.length > 120 ? pretty.slice(0, 120) + '...' : pretty,
      actionLabel: '复制美化 JSON',
      copyValue: pretty,
    };
  } catch {
    return null;
  }
}

function tryParseUrlEncoding(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (trimmed.startsWith('urle:')) {
    const raw = trimmed.slice(5).trim();
    if (!raw) return null;
    const encoded = encodeURIComponent(raw);
    return {
      type: 'url_decode',
      title: 'URL 快速编码',
      subtitle: `原始字符: ${raw.slice(0, 30)}`,
      previewValue: encoded,
      actionLabel: '复制编码结果',
      copyValue: encoded,
    };
  }

  if (trimmed.includes('%') && /%[0-9a-fA-F]{2}/.test(trimmed)) {
    try {
      const decoded = decodeURIComponent(trimmed);
      if (decoded !== trimmed) {
        return {
          type: 'url_decode',
          title: 'URL 字符即刻解码',
          subtitle: '检测到 URL 百分比编码',
          previewValue: decoded,
          actionLabel: '复制解码内容',
          copyValue: decoded,
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

function tryDetectHash(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return null;

  let hashType = '';
  if (trimmed.length === 32) hashType = 'MD5 (128-bit)';
  else if (trimmed.length === 40) hashType = 'SHA-1 (160-bit)';
  else if (trimmed.length === 64) hashType = 'SHA-256 (256-bit)';
  else if (trimmed.length === 128) hashType = 'SHA-512 (512-bit)';
  else return null;

  return {
    type: 'hash_detect',
    title: `${hashType} 哈希指纹识别`,
    subtitle: `长度: ${trimmed.length} 位十六进制字符`,
    previewValue: trimmed.toLowerCase(),
    actionLabel: '复制标准哈希',
    copyValue: trimmed.toLowerCase(),
  };
}

function tryDetectIp(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = trimmed.match(ipv4);
  if (match && match[1] && match[2] && match[3] && match[4]) {
    const p0 = Number(match[1]);
    const p1 = Number(match[2]);
    const p2 = Number(match[3]);
    const p3 = Number(match[4]);
    const parts = [p0, p1, p2, p3];
    if (parts.every((p) => p >= 0 && p <= 255)) {
      const isPrivate =
        p0 === 10 ||
        (p0 === 172 && p1 >= 16 && p1 <= 31) ||
        (p0 === 192 && p1 === 168) ||
        p0 === 127;
      return {
        type: 'ip_detect',
        title: 'IPv4 地址识别',
        subtitle: isPrivate ? '私有网络 / 本地保留地址 (LAN/Loopback)' : '公网 IP 目标地址',
        previewValue: trimmed,
        actionLabel: '复制 IP 地址',
        copyValue: trimmed,
      };
    }
  }
  return null;
}

export function parseSpeculativeIntent(input: string): SpeculativeIntentResult | null {
  if (!input || input.trim().length === 0) return null;
  const q = input.trim();

  return (
    tryParseColor(q) ||
    tryParseMath(q) ||
    tryParseTimestamp(q) ||
    tryParseJson(q) ||
    tryParseBase64(q) ||
    tryParseUrlEncoding(q) ||
    tryDetectHash(q) ||
    tryDetectIp(q)
  );
}
