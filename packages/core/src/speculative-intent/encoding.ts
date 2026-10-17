/**
 * 编码/解码族检测器：Base64、URL 编码、JSON 美化、哈希指纹识别。
 */
import type { SpeculativeIntentResult } from './types.ts'

function safeBase64Encode(raw: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw, 'utf-8').toString('base64');
  }
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(raw);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b !== undefined) binary += String.fromCharCode(b);
    }
    return btoa(binary);
  }
  return btoa(unescape(encodeURIComponent(raw)));
}

function safeBase64Decode(candidate: string): { decoded: string; reEncoded: string } | null {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(candidate, 'base64');
    return {
      decoded: buf.toString('utf-8'),
      reEncoded: buf.toString('base64'),
    };
  }
  try {
    const binary = atob(candidate);
    let decoded = '';
    if (typeof TextDecoder !== 'undefined') {
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      decoded = new TextDecoder().decode(bytes);
    } else {
      decoded = decodeURIComponent(escape(binary));
    }
    return {
      decoded,
      reEncoded: safeBase64Encode(decoded),
    };
  } catch {
    return null;
  }
}

/**
 * 尝试安全解析与解码 Base64 字符串
 */
export function tryParseBase64(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicitDecode = trimmed.startsWith('b64:') || trimmed.startsWith('base64:');
  const explicitEncode = trimmed.startsWith('b64e:') || trimmed.startsWith('base64e:');

  if (explicitEncode) {
    const raw = trimmed.replace(/^(b64e:|base64e:)\s*/, '');
    if (!raw) return null;
    try {
      const encoded = safeBase64Encode(raw);
      return {
        type: 'base64_encode',
        title: 'Base64 快速编码',
        subtitle: `原始文本: ${raw.slice(0, 30)}${raw.length > 30 ? '...' : ''}`,
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

  // 必须满足 Base64 字符集与最小长度（非显式指令需至少8位且非纯数字）
  if (!explicitDecode) {
    if (candidate.length < 8) return null;
    if (/^\d+$/.test(candidate)) return null; // 排除纯数字时间戳/端口
    if (!/^[A-Za-z0-9+/=_-]+$/.test(candidate)) return null;
  }

  try {
    const res = safeBase64Decode(candidate);
    if (!res) return null;
    const { decoded, reEncoded } = res;

    // 检查解码后是否包含有效可打印字符且重编码一致性或显式指令
    const isPrintable = /^[\x20-\x7E\r\n\t\u4e00-\u9fa5]+$/.test(decoded);
    const isNormalizedBase64 = candidate.replace(/=+$/, '') === reEncoded.replace(/=+$/, '');

    // 显式 b64: 前缀仍要求可打印+一致性，防止 b64:!!! 解出垃圾仍返回
    if (((explicitDecode && isPrintable) || (isPrintable && isNormalizedBase64)) && decoded.length > 0) {
      return {
        type: 'base64_decode',
        title: 'Base64 即刻解码',
        subtitle: `字符长度: ${decoded.length} 字节`,
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

/**
 * URL 编码/解码
 */
export function tryParseUrlEncoding(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (trimmed.startsWith('urle:')) {
    const raw = trimmed.slice(5).trim();
    if (!raw) return null;
    // 孤立代理项（粘贴/截断文本可能产生）会让 encodeURIComponent 抛 URIError。
    // 与同文件其它编解码分支保持一致：失败返回 null，不把异常抛给调用方。
    let encoded: string;
    try {
      encoded = encodeURIComponent(raw);
    } catch {
      return null;
    }
    return {
      type: 'url_encode',
      title: 'URL 快速编码',
      subtitle: `原始字符: ${raw.slice(0, 30)}`,
      previewValue: encoded,
      actionLabel: '复制编码结果',
      copyValue: encoded,
    };
  }

  // 普通文本如 100%20deal 误判 URL 解码：要求至少像 URL（带 :// 或以 / 开头或含 =/& 参数形态）
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

/**
 * JSON 快速校验与美化
 */
export function tryParseJson(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (trimmed.length > 10000) return null;
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
      title: 'JSON 格式验证与美化',
      subtitle: `有效 JSON · ${isArray ? `${count} 项数组` : `${count} 个属性键`}`,
      previewValue: pretty.length > 120 ? pretty.slice(0, 120) + '...' : pretty,
      actionLabel: '复制美化 JSON',
      copyValue: pretty,
    };
  } catch {
    return null;
  }
}

/**
 * 哈希特征识别
 */
export function tryDetectHash(input: string): SpeculativeIntentResult | null {
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
    subtitle: `字符长度: ${trimmed.length} 位十六进制`,
    previewValue: trimmed.toLowerCase(),
    actionLabel: '复制标准哈希',
    copyValue: trimmed.toLowerCase(),
  };
}
