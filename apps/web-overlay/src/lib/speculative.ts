/**
 * Speculative Intent Pre-execution Engine (推测意图 0-RTT 原地预执行引擎)
 *
 * 核心设计目标：
 * 当用户在搜索框输入特定技术文本时（Base64、时间戳、RGB/HEX颜色、算术表达式、JSON、URL编码、哈希等），
 * 系统不再仅仅返回外链结果，而是在 0 毫秒内原地预执行并生成即时计算结果（Micro-Widget）。
 */

export type SpeculativeIntentType =
  | 'cron'
  | 'jwt'
  | 'curl_to_fetch'
  | 'base64_decode'
  | 'base64_encode'
  | 'timestamp'
  | 'color'
  | 'math'
  | 'json_format'
  | 'url_decode'
  | 'hash_detect'
  | 'ip_detect';

/** 浏览器端推测性意图解析 */
export interface SpeculativeIntentResult {
  type: SpeculativeIntentType;
  title: string;
  subtitle: string;
  previewValue: string;
  actionLabel: string;
  copyValue?: string;
  details?: Record<string, string>;
}

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
function tryParseBase64(input: string): SpeculativeIntentResult | null {
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

    if ((explicitDecode || (isPrintable && isNormalizedBase64)) && decoded.length > 0) {
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
 * 时间戳意图解析（支持秒级 10 位与毫秒级 13 位）
 */
function tryParseTimestamp(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicit = trimmed.startsWith('ts:') || trimmed.startsWith('time:');
  const numStr = explicit ? trimmed.replace(/^(ts:|time:)\s*/, '') : trimmed;

  if (!/^\d{10}(\d{3})?$/.test(numStr)) return null;

  const num = Number.parseInt(numStr, 10);
  if (Number.isNaN(num)) return null;

  const ms = numStr.length === 10 ? num * 1000 : num;
  const date = new Date(ms);

  // 合理性区间：2000 年至 2050 年之间
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
    title: 'Unix 时间戳转换',
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

/**
 * 颜色意图解析 (HEX, RGB, HSL)
 */
function tryParseColor(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();

  // HEX 匹配
  const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch && hexMatch[1]) {
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
      title: '颜色即刻速览',
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

/**
 * 纯算术表达式求值（安全计算，杜绝 unsafe eval）
 */
function tryParseMath(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
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
 * JSON 快速校验与美化
 */
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
 * URL 编码/解码
 */
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

/**
 * 哈希特征识别
 */
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
    subtitle: `字符长度: ${trimmed.length} 位十六进制`,
    previewValue: trimmed.toLowerCase(),
    actionLabel: '复制标准哈希',
    copyValue: trimmed.toLowerCase(),
  };
}

/**
 * IP 地址识别
 */
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


/**
 * 主入口：推测性意图解析
 */

/**
 * Cron 表达式解析与自然语言解释
 */
function tryParseCron(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return null;

  // 基础 Cron 字符集校验
  const validChars = /^[0-9\*\/\,\-]+$/;
  if (!parts.every(p => validChars.test(p))) return null;

  const [min, hour, dom, mon, dow] = parts;
  let explanation = '定时执行任务: ';
  if (min === '*' && hour === '*') {
    explanation = '每分钟执行一次';
  } else if (min?.startsWith('*/')) {
    const step = min.slice(2);
    explanation = `每隔 ${step} 分钟执行一次`;
  } else if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') {
    explanation = '每天午夜 00:00 执行一次';
  } else if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    explanation = `每天 ${hour}:00 执行一次`;
  } else if (dow !== '*' && dom === '*') {
    explanation = `每周特定工作日/周末执行 (星期: ${dow})`;
  } else {
    explanation = `计划表达式: [分:${min} 时:${hour} 日:${dom} 月:${mon} 周:${dow}]`;
  }

  return {
    type: 'cron',
    title: 'Cron 定时任务表达式',
    subtitle: explanation,
    previewValue: trimmed,
    actionLabel: '复制 Cron 语法',
    copyValue: trimmed,
    details: {
      '标准格式': trimmed,
      '语义释义': explanation,
      '分/时/日/月/周': parts.slice(0, 5).join(' | '),
    },
  };
}

/**
 * JWT 离线解码与过期时间分析
 */
function tryParseJwt(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('eyJ') || !trimmed.includes('.')) return null;

  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;

  try {
    const decodeB64Url = (str: string) => {
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(b64, 'base64').toString('utf-8');
      }
      return decodeURIComponent(escape(atob(b64)));
    };

    const header = JSON.parse(decodeB64Url(parts[0] || ''));
    const payload = JSON.parse(decodeB64Url(parts[1] || ''));

    let status = '有效';
    let expireInfo = '未设置过期时间';
    if (payload.exp && typeof payload.exp === 'number') {
      const expDate = new Date(payload.exp * 1000);
      const now = Date.now();
      if (expDate.getTime() < now) {
        status = '⚠️ 已过期';
        expireInfo = `于 ${expDate.toLocaleString()} 过期`;
      } else {
        const diffMins = Math.round((expDate.getTime() - now) / 60000);
        status = '✅ 有效期内';
        expireInfo = `将于 ${expDate.toLocaleString()} 过期 (约 ${diffMins} 分钟后)`;
      }
    }

    return {
      type: 'jwt',
      title: `JWT 结构反序列化 (${status})`,
      subtitle: `算法: ${header.alg || '未知'} | 签发者/主题: ${payload.iss || payload.sub || '缺省'}`,
      previewValue: JSON.stringify(payload, null, 2),
      actionLabel: '复制 Payload 详情',
      copyValue: JSON.stringify(payload, null, 2),
      details: {
        '算法': String(header.alg || 'none'),
        '状态': status,
        '到期时间': expireInfo,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Curl 语句转 Fetch 脚本生成器
 */
function tryParseCurl(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('curl ') && !trimmed.startsWith('curl.exe ')) return null;

  // 简易 URL 匹配
  const urlMatch = trimmed.match(/https?:\/\/[^\s"']+/);
  if (!urlMatch) return null;
  const targetUrl = urlMatch[0];

  const methodMatch = trimmed.match(/-X\s+([A-Z]+)/i);
  const method = methodMatch ? (methodMatch[1] || 'GET').toUpperCase() : (trimmed.includes('-d ') || trimmed.includes('--data') ? 'POST' : 'GET');

  const generatedFetch = `fetch("${targetUrl}", {\n  method: "${method}",\n  headers: { "Content-Type": "application/json" }\n})`;

  return {
    type: 'curl_to_fetch',
    title: 'Curl 转 Fetch 代码生成',
    subtitle: `目标: ${method} ${targetUrl}`,
    previewValue: generatedFetch,
    actionLabel: '复制代码',
    copyValue: generatedFetch,
    details: {
      '请求方法': method,
      '目标地址': targetUrl,
    },
  };
}

export function parseSpeculativeIntent(input: string): SpeculativeIntentResult | null {
  if (!input || input.trim().length === 0) return null;
  const q = input.trim();

  // 优先级逐层匹配
  return (
    tryParseCron(q) ||
    tryParseJwt(q) ||
    tryParseCurl(q) ||
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
