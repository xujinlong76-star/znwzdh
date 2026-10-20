/**
 * Speculative Intent Pre-execution Engine (推测意图 0-RTT 原地预执行引擎)
 *
 * 核心设计目标：
 * 当用户在搜索框输入特定技术文本时（Base64、时间戳、RGB/HEX颜色、算术表达式、JSON、URL编码、哈希等），
 * 系统不再仅仅返回外链结果，而是在 0 毫秒内原地预执行并生成即时计算结果（Micro-Widget）。
 */

import { evaluateArithmeticExpression } from './arithmetic'

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
  | 'ip_detect'
  | 'regex'
  | 'semver'
  | 'http_status';

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
  // 表达式长度上限：防止长串每击键解析一次阻塞主线程（DoS 面）
  if (trimmed.length > 256) return null;
  // 必须包含至少一个算术运算符，且仅包含数字、小数点、括号、运算符与空白
  if (!/[+\-*/%^]/.test(trimmed)) return null;
  if (!/^[\d\s+\-*/%^().]+$/.test(trimmed)) return null;

  // 避免将类似版本号或单一负数判断为算式
  if (/^\d+(\.\d+)+$/.test(trimmed)) return null;

  const result = evaluateArithmeticExpression(trimmed);
  if (result === null) return null;

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

/**
 * 1. 正则表达式即时匹配与捕获组速览 (Regex Sandbox)
 */
function tryParseRegex(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  let pattern = '';
  let flags = '';
  let testText = '';

  const explicit = trimmed.match(/^(?:regex|regexp):\s*(.+)$/i);
  if (explicit) {
    const rest = explicit[1]!.trim();
    const slashMatch = rest.match(/^\/((?:\\\/|[^\/])+)\/([gimsuy]*)(?:\s+(.*))?$/);
    if (slashMatch) {
      pattern = slashMatch[1]!;
      flags = slashMatch[2] || '';
      testText = slashMatch[3] || '';
    } else {
      const quoteMatch = rest.match(/^"([^"]+)"(?:\s+(.*))?$/) || rest.match(/^'([^']+)'(?:\s+(.*))?$/);
      if (quoteMatch) {
        pattern = quoteMatch[1]!;
        testText = quoteMatch[2] || '';
      } else {
        const spaceIdx = rest.indexOf(' ');
        if (spaceIdx > 0) {
          pattern = rest.slice(0, spaceIdx);
          testText = rest.slice(spaceIdx + 1).trim();
        } else {
          pattern = rest;
        }
      }
    }
  } else {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
      return null;
    }
    const slashMatch = trimmed.match(/^\/((?:\\\/|[^\/])+)\/([gimsuy]*)(?:\s+(.*))?$/);
    if (!slashMatch) return null;
    pattern = slashMatch[1]!;
    flags = slashMatch[2] || '';
    testText = slashMatch[3] || '';
  }

  if (!pattern) return null;

  try {
    const rx = new RegExp(pattern, flags);
    let captureCount = 0;
    try {
      const emptyExec = new RegExp(pattern + '|', flags).exec('');
      captureCount = emptyExec ? emptyExec.length - 1 : 0;
    } catch {
      // 容错降级
    }

    if (testText) {
      const match = rx.exec(testText);
      const isMatch = match !== null;
      const matchedStr = isMatch ? match[0] : '';
      const groups = isMatch ? match.slice(1) : [];
      const namedGroups = (isMatch && match.groups) ? match.groups : null;

      let preview = '';
      if (isMatch) {
        preview = `✅ 匹配成功: "${matchedStr}"`;
        if (groups.length > 0) {
          preview += '\n捕获组:\n' + groups.map((g, i) => `  Group ${i + 1}: "${g ?? ''}"`).join('\n');
        }
        if (namedGroups && Object.keys(namedGroups).length > 0) {
          preview += '\n命名组:\n' + Object.entries(namedGroups).map(([k, v]) => `  ${k}: "${v ?? ''}"`).join('\n');
        }
      } else {
        preview = `❌ 未匹配到任何内容\n模式: /${pattern}/${flags}\n目标文本: "${testText}"`;
      }

      return {
        type: 'regex',
        title: isMatch ? `RegExp 匹配成功 (${groups.length} 捕获组)` : 'RegExp 未命中目标文本',
        subtitle: `模式: /${pattern}/${flags} | 目标: "${testText.slice(0, 30)}${testText.length > 30 ? '...' : ''}"`,
        previewValue: preview,
        actionLabel: '复制匹配结果',
        copyValue: isMatch ? matchedStr : preview,
        details: {
          '模式': `/${pattern}/${flags}`,
          '测试文本': testText,
          '判定': isMatch ? '✅ 匹配成功' : '❌ 未命中',
          '捕获组数': String(captureCount),
        },
      };
    } else {
      const preview = `模式: /${pattern}/${flags}\n语法检查: 合法\n捕获组数量: ${captureCount}\n提示: 在正则后输入空格和测试字符串即可原地测试匹配`;
      return {
        type: 'regex',
        title: 'RegExp 正则表达式语法有效',
        subtitle: `模式: /${pattern}/${flags} (${captureCount} 捕获组)`,
        previewValue: preview,
        actionLabel: '复制正则模式',
        copyValue: `/${pattern}/${flags}`,
        details: {
          '模式': `/${pattern}/${flags}`,
          '修饰符': flags || '(无)',
          '语法状态': '合法',
          '捕获组数': String(captureCount),
        },
      };
    }
  } catch (err) {
    if (explicit) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        type: 'regex',
        title: 'RegExp 正则表达式语法错误',
        subtitle: `模式: ${pattern}`,
        previewValue: `语法错误: ${msg}`,
        actionLabel: '复制错误详情',
        copyValue: msg,
        details: {
          '模式': pattern,
          '语法状态': '❌ 语法错误',
        },
      };
    }
    return null;
  }
}

/**
 * 2. 语义化版本解析与兼容性对比 (Semver Comparator)
 */
interface SemverParsed {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

function parseSemver(v: string): SemverParsed | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    raw: v.trim(),
    major: parseInt(m[1]!, 10),
    minor: parseInt(m[2]!, 10),
    patch: parseInt(m[3]!, 10),
    prerelease: m[4],
    build: m[5],
  };
}

function compareSemver(a: SemverParsed, b: SemverParsed): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  return 0;
}

function satisfiesCaret(range: SemverParsed, target: SemverParsed): boolean {
  if (range.major === 0) {
    if (range.minor === 0) {
      return target.major === 0 && target.minor === 0 && target.patch === range.patch;
    }
    return target.major === 0 && target.minor === range.minor && target.patch >= range.patch;
  }
  return target.major === range.major && (target.minor > range.minor || (target.minor === range.minor && target.patch >= range.patch));
}

function satisfiesTilde(range: SemverParsed, target: SemverParsed): boolean {
  return target.major === range.major && target.minor === range.minor && target.patch >= range.patch;
}

function tryParseSemver(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicit = trimmed.match(/^(?:semver|version|ver):\s*(.+)$/i);
  const content = explicit ? explicit[1]!.trim() : trimmed;

  const vsMatch = content.match(/^([\^~>=<]*\s*v?\d+\.\d+\.\d+(?:-[^\s]+)?)\s+(?:vs|与|对比|to)\s+(v?\d+\.\d+\.\d+(?:-[^\s]+)?)$/i);
  if (vsMatch) {
    const leftRaw = vsMatch[1]!.trim();
    const rightRaw = vsMatch[2]!.trim();
    const targetParsed = parseSemver(rightRaw);
    if (!targetParsed) return null;

    if (leftRaw.startsWith('^')) {
      const baseParsed = parseSemver(leftRaw.slice(1));
      if (!baseParsed) return null;
      const satisfies = satisfiesCaret(baseParsed, targetParsed);
      const preview = `范围: ${leftRaw} (兼容 ${baseParsed.major}.x)\n目标版本: ${rightRaw}\n判定: ${satisfies ? '✅ 满足兼容范围 (Satisfies)' : '❌ 不兼容 (Out of Range)'}`;
      return {
        type: 'semver',
        title: `Semver 范围兼容判定: ${satisfies ? '✅ 满足' : '❌ 不兼容'}`,
        subtitle: `${leftRaw} vs ${rightRaw}`,
        previewValue: preview,
        actionLabel: '复制兼容结果',
        copyValue: satisfies ? 'true' : 'false',
        details: {
          '范围': leftRaw,
          '目标版本': rightRaw,
          '兼容结论': satisfies ? '兼容 (Satisfies)' : '超出范围',
        },
      };
    }

    if (leftRaw.startsWith('~')) {
      const baseParsed = parseSemver(leftRaw.slice(1));
      if (!baseParsed) return null;
      const satisfies = satisfiesTilde(baseParsed, targetParsed);
      const preview = `范围: ${leftRaw} (补丁兼容 ${baseParsed.major}.${baseParsed.minor}.x)\n目标版本: ${rightRaw}\n判定: ${satisfies ? '✅ 满足兼容范围' : '❌ 不兼容'}`;
      return {
        type: 'semver',
        title: `Semver 范围兼容判定: ${satisfies ? '✅ 满足' : '❌ 不兼容'}`,
        subtitle: `${leftRaw} vs ${rightRaw}`,
        previewValue: preview,
        actionLabel: '复制兼容结果',
        copyValue: satisfies ? 'true' : 'false',
        details: {
          '范围': leftRaw,
          '目标版本': rightRaw,
          '兼容结论': satisfies ? '兼容' : '超出范围',
        },
      };
    }

    const baseParsed = parseSemver(leftRaw);
    if (!baseParsed) return null;
    const cmp = compareSemver(baseParsed, targetParsed);
    let bumpKind = '相同版本 (Identical)';
    if (baseParsed.major !== targetParsed.major) bumpKind = '破坏性大版本变更 (Major)';
    else if (baseParsed.minor !== targetParsed.minor) bumpKind = '向后兼容功能增强 (Minor)';
    else if (baseParsed.patch !== targetParsed.patch) bumpKind = '向后兼容缺陷修复 (Patch)';
    else if (baseParsed.prerelease !== targetParsed.prerelease) bumpKind = '预发布标识变更 (Prerelease)';

    const relation = cmp < 0 ? '< (低到高升级)' : cmp > 0 ? '> (版本回退降级)' : '= (完全一致)';
    const preview = `${baseParsed.raw} ${relation} ${targetParsed.raw}\n差异级别: ${bumpKind}`;

    return {
      type: 'semver',
      title: `Semver 版本对比: ${bumpKind}`,
      subtitle: `${baseParsed.raw} 对比 ${targetParsed.raw}`,
      previewValue: preview,
      actionLabel: '复制对比摘要',
      copyValue: `${baseParsed.raw} ${cmp < 0 ? '<' : cmp > 0 ? '>' : '='} ${targetParsed.raw} (${bumpKind})`,
      details: {
        '基准版本': baseParsed.raw,
        '对比版本': targetParsed.raw,
        '对比关系': relation,
        '变更级别': bumpKind,
      },
    };
  }

  const single = parseSemver(content);
  if (!single && !explicit) return null;
  if (!single) return null;

  const preview = `主版本 (Major): ${single.major}\n次版本 (Minor): ${single.minor}\n补丁版本 (Patch): ${single.patch}${single.prerelease ? `\n预发布 (Prerelease): ${single.prerelease}` : ''}${single.build ? `\n构建元数据 (Build): ${single.build}` : ''}`;

  return {
    type: 'semver',
    title: `Semver 语义化版本: v${single.major}.${single.minor}.${single.patch}`,
    subtitle: `版本结构规范: Major=${single.major}, Minor=${single.minor}, Patch=${single.patch}`,
    previewValue: preview,
    actionLabel: '复制标准化版本',
    copyValue: `v${single.major}.${single.minor}.${single.patch}${single.prerelease ? `-${single.prerelease}` : ''}`,
    details: {
      'Major (重大破坏)': String(single.major),
      'Minor (特性增强)': String(single.minor),
      'Patch (补丁修复)': String(single.patch),
      'Prerelease': single.prerelease || '无 (正式发布版)',
    },
  };
}

/**
 * 3. HTTP 状态码标准字典与故障排查速查 (HTTP Status Encyclopedia)
 */
interface HttpStatusDef {
  code: number;
  phrase: string;
  nameCn: string;
  meaning: string;
  resolution: string;
}

const HTTP_STATUS_DICT: Record<number, HttpStatusDef> = {
  100: { code: 100, phrase: "Continue", nameCn: "继续", meaning: "客户端应继续其请求，服务器已收到第一部分", resolution: "通常在 Expect: 100-continue 握手由 HTTP 客户端自动处理" },
  101: { code: 101, phrase: "Switching Protocols", nameCn: "协议切换", meaning: "服务器同意按照 Upgrade 请求头切换协议（如 WebSocket）", resolution: "检查 WebSocket 握手或 HTTP/2 升级配置" },
  200: { code: 200, phrase: "OK", nameCn: "成功", meaning: "请求已成功处理，通常返回所请求的资源", resolution: "正常响应，无需干预" },
  201: { code: 201, phrase: "Created", nameCn: "已创建", meaning: "请求成功且服务器已创建了新资源（常见于 POST）", resolution: "通过 Location 头或响应体验证新资源 ID" },
  202: { code: 202, phrase: "Accepted", nameCn: "已接受", meaning: "服务器已接受请求但尚未处理完毕（异步任务）", resolution: "轮询任务 ID 或监听 webhook 异步通知" },
  204: { code: 204, phrase: "No Content", nameCn: "无内容", meaning: "请求成功，但响应报文不包含实体主体（常见于 DELETE/PUT）", resolution: "客户端不应尝试解析 JSON 响应体" },
  301: { code: 301, phrase: "Moved Permanently", nameCn: "永久重定向", meaning: "目标资源已被永久分配了新的 URI", resolution: "更新客户端/书签指向新地址；SEO 权重会传递至新地址" },
  302: { code: 302, phrase: "Found", nameCn: "临时重定向", meaning: "目标资源临时位于不同的 URI", resolution: "客户端应继续使用原有 URI 发起未来请求" },
  304: { code: 304, phrase: "Not Modified", nameCn: "未修改", meaning: "资源未改变，可直接使用客户端本地缓存（协商缓存）", resolution: "结合 If-None-Match (ETag) / If-Modified-Since 使用" },
  307: { code: 307, phrase: "Temporary Redirect", nameCn: "临时重定向（严格）", meaning: "临时重定向，且不允许客户端改变 HTTP 请求方法", resolution: "POST 请求重定向后必须继续保持 POST 方法" },
  308: { code: 308, phrase: "Permanent Redirect", nameCn: "永久重定向（严格）", meaning: "永久重定向，且不允许改变请求方法", resolution: "更新原地址；客户端需保持原始 HTTP 方法" },
  400: { code: 400, phrase: "Bad Request", nameCn: "错误请求", meaning: "服务器无法理解请求（语法无效、参数校验失败、请求体畸形）", resolution: "检查请求 JSON 格式、必填字段与类型校验错误详情" },
  401: { code: 401, phrase: "Unauthorized", nameCn: "未授权", meaning: "请求需要身份验证（缺 Token、Token 过期或格式无效）", resolution: "提供有效的 Authorization: Bearer <token> 或重新登录" },
  403: { code: 403, phrase: "Forbidden", nameCn: "拒绝访问", meaning: "服务器理解请求但拒绝执行（无对应 scope/角色/权限）", resolution: "检查凭据的 scopes 权限范围（read/write/admin）或 IP 白名单" },
  404: { code: 404, phrase: "Not Found", nameCn: "未找到", meaning: "服务器找不到请求的资源或对应路由端点不存在", resolution: "核对请求 URL 拼写、路由前缀；必要时尝试 Wayback 时间机器快照" },
  405: { code: 405, phrase: "Method Not Allowed", nameCn: "方法不被允许", meaning: "该资源不支持当前 HTTP 请求动词（如 GET 访问了 POST 端点）", resolution: "查看响应头 Allow，核对 API 文档规定的请求方法" },
  408: { code: 408, phrase: "Request Timeout", nameCn: "请求超时", meaning: "服务器在等待客户端发送完整请求时发生超时", resolution: "排查客户端网络链路延迟或上传大文件体连接过慢问题" },
  409: { code: 409, phrase: "Conflict", nameCn: "冲突", meaning: "请求与服务器当前状态冲突（如主键唯一约束冲突、状态并发冲突）", resolution: "检查是否重复提交已有唯一键（如同一 URL 或重名项）" },
  410: { code: 410, phrase: "Gone", nameCn: "资源已永久删除", meaning: "资源已被永久移除且不再有重定向地址", resolution: "从客户端移除该链接；搜索引擎会立即移除收录" },
  413: { code: 413, phrase: "Payload Too Large", nameCn: "请求体过大", meaning: "请求体体积超出服务器配置的处理上限", resolution: "调大反向代理 client_max_body_size 或分片分批上传" },
  415: { code: 415, phrase: "Unsupported Media Type", nameCn: "不支持的媒体类型", meaning: "服务器不支持请求实体的内容编码或 Content-Type", resolution: "设置规范的 Content-Type: application/json 或对应 MIME" },
  418: { code: 418, phrase: "I'm a teapot", nameCn: "我是一个茶壶", meaning: "RFC 2324 愚人节彩蛋：任何尝试用茶壶冲泡咖啡的请求都会被拒绝", resolution: "极客经典彩蛋；不可用于实际生产错误处理" },
  422: { code: 422, phrase: "Unprocessable Entity", nameCn: "无法处理的实体", meaning: "请求语法正确但语义有误（如字段类型或业务规则校验未通过）", resolution: "根据响应体的 detail.issues 逐项修正业务参数约束" },
  429: { code: 429, phrase: "Too Many Requests", nameCn: "请求过多 (限流)", meaning: "客户端在短时间内发送了过多请求，已触发限流策略", resolution: "读取 Retry-After 头延时重试；降低调用频率或申请提升配额" },
  451: { code: 451, phrase: "Unavailable For Legal Reasons", nameCn: "因法律原因不可用", meaning: "由于政府法令或版权审查要求导致资源无法访问", resolution: "致敬科幻小说《华氏451度》；涉及合规阻断" },
  500: { code: 500, phrase: "Internal Server Error", nameCn: "服务器内部错误", meaning: "服务器遇到了未预料的情况，导致无法完成请求", resolution: "检查服务端运行时错误日志与未捕获异常堆栈" },
  501: { code: 501, phrase: "Not Implemented", nameCn: "未实现", meaning: "服务器不支持当前请求所要求的功能（如未支持的 HTTP 动词）", resolution: "核对服务功能规范，改用已被支持的特性" },
  502: { code: 502, phrase: "Bad Gateway", nameCn: "错误网关", meaning: "反向代理（如 Nginx）向上游服务尝试发起请求时收到无效响应", resolution: "检查上游应用进程是否存活、监听端口是否正确、连接池是否耗尽" },
  503: { code: 503, phrase: "Service Unavailable", nameCn: "服务不可用", meaning: "服务器当前无法处理请求（因临时超载或正在停机维护）", resolution: "通常为临时状态，关注 Retry-After 头稍后重试；排查系统负载" },
  504: { code: 504, phrase: "Gateway Timeout", nameCn: "网关超时", meaning: "反向代理在规定时间内未能从上游服务器接收到响应", resolution: "排查上游慢查询、密集计算或调大 proxy_read_timeout" },
  505: { code: 505, phrase: "HTTP Version Not Supported", nameCn: "HTTP 版本不受支持", meaning: "服务器不支持请求中使用的 HTTP 协议主要版本", resolution: "切换客户端 HTTP/1.1 或 HTTP/2 协议协商" },
  521: { code: 521, phrase: "Web Server Is Down", nameCn: "源服务器停机 (Cloudflare)", meaning: "Cloudflare 边缘节点无法与源站建立 TCP 连接", resolution: "检查源站服务器防火墙、Web 守护进程 (Nginx/Node) 状态" },
  522: { code: 522, phrase: "Connection Timed Out", nameCn: "源站连接超时 (Cloudflare)", meaning: "Cloudflare 与源站的 TCP 握手发生超时", resolution: "排查源站网络丢包、防火墙拦截 Cloudflare IP 段或主机宕机" },
  524: { code: 524, phrase: "A Timeout Occurred", nameCn: "源站处理超时 (Cloudflare)", meaning: "TCP 已连接但源站 100 秒内未返回 HTTP 响应数据", resolution: "将长时间耗时操作改为后台异步任务，或调高响应超时配额" },
};

function tryParseHttpStatus(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  let codeNum: number | null = null;

  const explicitMatch = trimmed.match(/^(?:http|status|code|httpstatus|httpcode|状态码)\s*:?\s*(\d{3})$/i)
    || trimmed.match(/^(\d{3})\s*(?:status|http|状态码)$/i);

  if (explicitMatch) {
    codeNum = parseInt(explicitMatch[1]!, 10);
  } else if (/^\d{3}$/.test(trimmed)) {
    const candidate = parseInt(trimmed, 10);
    if (candidate in HTTP_STATUS_DICT) {
      codeNum = candidate;
    }
  }

  if (codeNum === null || !(codeNum in HTTP_STATUS_DICT)) return null;

  const def = HTTP_STATUS_DICT[codeNum]!;
  let category = '';
  if (codeNum >= 100 && codeNum < 200) category = '1xx 信息响应 (Informational)';
  else if (codeNum >= 200 && codeNum < 300) category = '2xx 成功 (Successful)';
  else if (codeNum >= 300 && codeNum < 400) category = '3xx 重定向 (Redirection)';
  else if (codeNum >= 400 && codeNum < 500) category = '4xx 客户端错误 (Client Error)';
  else if (codeNum >= 500 && codeNum < 600) category = '5xx 服务端错误 (Server Error)';

  const preview = `HTTP ${def.code} ${def.phrase} (${def.nameCn})\n\n分类: ${category}\n含义: ${def.meaning}\n\n常见排查与处理建议:\n${def.resolution}`;

  return {
    type: 'http_status',
    title: `HTTP ${def.code} ${def.phrase} (${def.nameCn})`,
    subtitle: `${category} | ${def.meaning}`,
    previewValue: preview,
    actionLabel: '复制状态说明',
    copyValue: `HTTP ${def.code} ${def.phrase} (${def.nameCn}): ${def.meaning}`,
    details: {
      '状态码': String(def.code),
      '标准短语': def.phrase,
      '中文名': def.nameCn,
      '分类': category,
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
    tryParseHttpStatus(q) ||
    tryParseSemver(q) ||
    tryParseRegex(q) ||
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
