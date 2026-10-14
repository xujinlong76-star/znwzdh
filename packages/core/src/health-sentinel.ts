/**
 * Health Sentinel & Anti-Hijacking Sensor (页面视觉感知防劫持与软 404 巡检引擎)
 *
 * 核心设计目标：
 * 终结以 HTTP 200 为唯一标准的盲目健康假象。
 * 综合利用 DOM 文本 Shannon 信息熵、停放关键词语义密度以及 64 位视觉感知哈希（pHash）汉明距离，
 * 精准识别“域名抢注停放广告”、“SPA 假 200 软 404”、“单页黑产劫持”。
 */

export const DOMAIN_PARKING_KEYWORDS = [
  'domain for sale',
  'buy this domain',
  'renew this domain',
  'is parked free',
  'hugedomains',
  'dan.com',
  'godaddy domain',
  'sedo domain parking',
  'inquire about this domain',
  '域名出售',
  '此域名正在出售',
  '域名续费',
  '页面未找到',
  '404 not found',
  '404 page not found',
  'error 404',
  'forbidden',
  'access denied',
  'blocked by cloudflare',
];

/**
 * 提取纯文本（去除 HTML 标签、脚本、样式）
 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 计算文本的 Shannon 信息熵 (Shannon Entropy)
 * H(S) = - ∑ p(x) * log2(p(x))
 */
export function calculateShannonEntropy(text: string): number {
  if (!text || text.length === 0) return 0.0;

  const len = text.length;
  const freqMap: Record<string, number> = {};

  for (let i = 0; i < len; i++) {
    const char = text[i];
    if (char !== undefined) {
      freqMap[char] = (freqMap[char] ?? 0) + 1;
    }
  }

  let entropy = 0;
  for (const char in freqMap) {
    const count = freqMap[char] ?? 0;
    const p = count / len;
    entropy -= p * Math.log2(p);
  }


  return Number(entropy.toFixed(4));
}

/**
 * 计算两个 64-bit (16 个十六进制字符) 感知哈希的汉明距离 (Hamming Distance)
 */
export function hammingDistance64(hashA: string, hashB: string): number {
  const cleanA = hashA.trim().replace(/^0x/, '').toLowerCase().padStart(16, '0');
  const cleanB = hashB.trim().replace(/^0x/, '').toLowerCase().padStart(16, '0');

  let distance = 0;
  for (let i = 0; i < 16; i++) {
    const valA = Number.parseInt(cleanA[i] || '0', 16) || 0;
    const valB = Number.parseInt(cleanB[i] || '0', 16) || 0;
    let xor = valA ^ valB;
    while (xor > 0) {
      xor &= xor - 1;
      distance++;
    }
  }

  return distance;
}


export type HealthStatus = 'HEALTHY' | 'SUSPICIOUS_PARKED' | 'SOFT_404' | 'THIN_CONTENT';

export interface HealthAuditResult {
  url: string;
  status: HealthStatus;
  confidence: number;
  shannonEntropy: number;
  textLength: number;
  matchedParkingKeywords: string[];
  minHammingDistance?: number;
  reason: string;
}

/**
 * 页面健康与防劫持审计
 */
export function auditPageHealth(
  url: string,
  htmlContent: string,
  perceptualHash?: string,
  knownBadHashes?: string[]
): HealthAuditResult {
  const plainText = stripHtmlToText(htmlContent);
  const textLength = plainText.length;
  const entropy = calculateShannonEntropy(plainText);
  const lowerText = plainText.toLowerCase();

  // 1. 命中停放/404关键词
  const matchedKeywords = DOMAIN_PARKING_KEYWORDS.filter((kw) => lowerText.includes(kw));

  // 2. 视觉哈希比对
  let minDistance: number | undefined;
  if (perceptualHash && knownBadHashes && knownBadHashes.length > 0) {
    minDistance = Math.min(...knownBadHashes.map((h) => hammingDistance64(perceptualHash, h)));
  }

  // 判定逻辑
  if (minDistance !== undefined && minDistance <= 8) {
    return {
      url,
      status: 'SUSPICIOUS_PARKED',
      confidence: 0.95,
      shannonEntropy: entropy,
      textLength,
      matchedParkingKeywords: matchedKeywords,
      minHammingDistance: minDistance,
      reason: `视觉感知哈希与已知停放模板高度吻合 (汉明距离: ${minDistance})`,
    };
  }

  if (matchedKeywords.length >= 2 || (matchedKeywords.length === 1 && textLength < 300)) {
    const is404 = matchedKeywords.some((k) => k.includes('404') || k.includes('未找到'));
    return {
      url,
      status: is404 ? 'SOFT_404' : 'SUSPICIOUS_PARKED',
      confidence: 0.9,
      shannonEntropy: entropy,
      textLength,
      matchedParkingKeywords: matchedKeywords,
      minHammingDistance: minDistance,
      reason: `检测到停放或404特征关键词: [${matchedKeywords.join(', ')}]`,
    };
  }

  if (textLength < 60) {
    return {
      url,
      status: 'THIN_CONTENT',
      confidence: 0.75,
      shannonEntropy: entropy,
      textLength,
      matchedParkingKeywords: matchedKeywords,
      minHammingDistance: minDistance,
      reason: `页面内容极度匮乏 (有效字符仅 ${textLength})`,
    };
  }

  if (entropy < 2.0 && textLength > 100) {
    return {
      url,
      status: 'SUSPICIOUS_PARKED',
      confidence: 0.7,
      shannonEntropy: entropy,
      textLength,
      matchedParkingKeywords: matchedKeywords,
      minHammingDistance: minDistance,
      reason: `文本信息熵极低 (${entropy} < 2.0)，疑似空白或重复模板页面`,
    };
  }

  return {
    url,
    status: 'HEALTHY',
    confidence: 0.95,
    shannonEntropy: entropy,
    textLength,
    matchedParkingKeywords: [],
    minHammingDistance: minDistance,
    reason: `页面文本与信息熵正常 (${entropy})，未检出劫持特征`,
  };
}
