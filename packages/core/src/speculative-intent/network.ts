/**
 * 网络族检测器：IPv4 识别、CIDR 子网掩码计算、Curl 转 Fetch、JWT 离线解码。
 */
import type { SpeculativeIntentResult } from './types.ts'

function intToIpv4(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
}

/**
 * IPv4 CIDR 子网划分与地址段即时计算 (e.g., 192.168.1.0/24, 10.0.0.1/16)
 */
export function tryParseCidr(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  const explicit = trimmed.replace(/^cidr:\s*/i, '');
  const m = explicit.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;

  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const prefix = Number(m[5]);
  if (octets.some((o) => o < 0 || o > 255) || prefix < 0 || prefix > 32) return null;

  const ipInt = (((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0);
  const maskInt = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  const wildcardInt = (~maskInt) >>> 0;
  const netInt = (ipInt & maskInt) >>> 0;
  const bcastInt = (netInt | wildcardInt) >>> 0;

  const networkAddr = intToIpv4(netInt);
  const broadcastAddr = intToIpv4(bcastInt);
  const netmask = intToIpv4(maskInt);
  const wildcard = intToIpv4(wildcardInt);

  const totalAddresses = Math.pow(2, 32 - prefix);
  let usableCount = totalAddresses;
  let firstHost = networkAddr;
  let lastHost = broadcastAddr;
  if (prefix <= 30) {
    usableCount = Math.max(0, totalAddresses - 2);
    firstHost = intToIpv4((netInt + 1) >>> 0);
    lastHost = intToIpv4((bcastInt - 1) >>> 0);
  }

  const normalizedCidr = `${networkAddr}/${prefix}`;
  const preview = `网络地址: ${networkAddr}/${prefix}\n子网掩码: ${netmask} (反掩码: ${wildcard})\n广播地址: ${broadcastAddr}\n可用主机: ${firstHost} ~ ${lastHost} (${usableCount.toLocaleString()} 台)`;

  return {
    type: 'cidr',
    title: `CIDR 子网计算: ${normalizedCidr}`,
    subtitle: `掩码 ${netmask} · 可用主机 ${usableCount.toLocaleString()} 台`,
    previewValue: preview,
    actionLabel: '复制子网范围',
    copyValue: `${firstHost}-${lastHost}`,
    details: {
      '标准 CIDR': normalizedCidr,
      '子网掩码': netmask,
      '广播地址': broadcastAddr,
      '可用主机范围': `${firstHost} - ${lastHost}`,
      '可用主机数': usableCount.toLocaleString(),
    },
  };
}

/**
 * IP 地址识别
 */
export function tryDetectIp(input: string): SpeculativeIntentResult | null {
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
        p0 === 127 ||
        (p0 === 100 && p1 >= 64 && p1 <= 127) ||
        (p0 === 169 && p1 === 254) ||
        (p0 === 192 && p1 === 0 && (p2 === 0 || p2 === 2)) ||
        p0 === 0;
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
 * Curl 语句转 Fetch 脚本生成器
 */
export function tryParseCurl(input: string): SpeculativeIntentResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('curl ') && !trimmed.startsWith('curl.exe ')) return null;

  // 简易 URL 匹配
  const urlMatch = trimmed.match(/https?:\/\/[^\s"']+/);
  if (!urlMatch) return null;
  const targetUrl = urlMatch[0];

  const methodMatch = trimmed.match(/-X\s+([A-Z]+)/i);
  const method = methodMatch ? (methodMatch[1] || 'GET').toUpperCase() : (trimmed.includes('-d ') || trimmed.includes('--data') ? 'POST' : 'GET');
  // 提取 -H/--header 与 -d body，避免生成的 fetch 恒 JSON 误导
  const headerMatches = [...trimmed.matchAll(/(?:-H|--header)\s+["']([^"']+)["']/g)].map((m) => m[1]);
  const dataMatch = trimmed.match(/(?:-d|--data(?:-raw)?)\s+["']([^"']*)["']/);
  const headerLines = headerMatches.length
    ? "\n  headers: { " + headerMatches.map((h) => `"${(h ?? "").split(":")[0]?.trim()}": "${(h ?? "").split(":").slice(1).join(":").trim()}"`).join(", ") + " }"
    : '\n  headers: { "Content-Type": "application/json" }';
  const bodyLine = dataMatch?.[1] ? `,\n  body: ${JSON.stringify(dataMatch[1])}` : "";

  const generatedFetch = `fetch("${targetUrl}", {\n  method: "${method}",${headerLines}${bodyLine}\n})`;

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
 * JWT 离线解码与过期时间分析
 */
export function tryParseJwt(input: string): SpeculativeIntentResult | null {
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
      title: `JWT 结构反序列化 (${status}) — 未验签，仅供调试`,
      subtitle: `算法: ${header.alg || '未知'} | 签发者/主题: ${payload.iss || payload.sub || '缺省'}${payload.nbf ? ` | nbf: ${new Date(payload.nbf * 1000).toLocaleString()}` : ''}`,
      previewValue: JSON.stringify(payload, null, 2),
      actionLabel: '复制 Payload 详情',
      copyValue: JSON.stringify(payload, null, 2),
      details: {
        '算法': String(header.alg || 'none'),
        '状态': status + '（未验签名，切勿信任）',
        '到期时间': expireInfo,
      },
    };
  } catch {
    return null;
  }
}
