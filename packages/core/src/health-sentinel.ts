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


/* ------------------------------------------------------------------ *
 * 基于 Weibull 寿命分布的死链巡检调度
 * ------------------------------------------------------------------ *
 * 为什么需要它：按「所有站点一个固定周期轮流查」排巡检，等价于假设
 * 每个站点的失效风险与年龄无关。但外链的真实形态是**失效率随年龄上升**
 * （域名到期、站点关停、改版换路由），所以老链接该被查得更勤。
 *
 * Weibull 的 shape k 正好表达这一点：
 *   k < 1  早期失效（新生儿死亡）——链接刚收录时最容易是错的
 *   k = 1  指数分布，风险与年龄无关（等价于固定周期轮询）
 *   k > 1  磨损失效，越老越危险 —— 外链的常态
 *
 * 存活函数  S(t) = exp(-(t/λ)^k)
 * 风险函数  h(t) = (k/λ)(t/λ)^(k-1)
 */

export interface WeibullParams {
  /** 形状参数 k */
  shape: number;
  /** 尺度参数 λ（特征寿命），单位：天 */
  scale: number;
}

/** 默认参数：k=1.6 表示失效率随年龄上升；λ=900 天（约 2.5 年）为外链特征寿命 */
export const DEFAULT_WEIBULL: WeibullParams = { shape: 1.6, scale: 900 };

/** 巡检节奏的上下界：再急也不天天查，再稳也不能放任一两年 */
export const PATROL_MIN_DAYS = 1;
export const PATROL_MAX_DAYS = 180;

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
  1.5056327351493116e-7,
];

/** 对数 Gamma（Lanczos 近似），用于 Weibull 矩估计里的 Γ(1+1/k) */
export function logGamma(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return Number.NaN;
  if (x < 0.5) {
    // 反射公式 Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS_C[0]!;
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_C.length; i++) {
    a += LANCZOS_C[i]! / (z + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gamma(x: number): number {
  const l = logGamma(x);
  return Number.isFinite(l) ? Math.exp(l) : Number.NaN;
}

/** 存活概率 S(t)：活到 ageDays 天仍然健康的概率 */
export function weibullSurvival(ageDays: number, params: WeibullParams = DEFAULT_WEIBULL): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  const k = params.shape > 0 ? params.shape : 1;
  const lam = params.scale > 0 ? params.scale : DEFAULT_WEIBULL.scale;
  const v = Math.exp(-Math.pow(ageDays / lam, k));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** 瞬时失效率 h(t) */
export function weibullHazard(ageDays: number, params: WeibullParams = DEFAULT_WEIBULL): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 0;
  const k = params.shape > 0 ? params.shape : 1;
  const lam = params.scale > 0 ? params.scale : DEFAULT_WEIBULL.scale;
  const v = (k / lam) * Math.pow(ageDays / lam, k - 1);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/**
 * 由观测到的寿命样本（单位天）做矩估计拟合 Weibull。
 *
 * 用变异系数反解 shape：CV² = Γ(1+2/k)/Γ(1+1/k)² − 1，该式只依赖 k 且单调递减，
 * 二分即可稳定求解；再由 mean = λΓ(1+1/k) 解出 λ。
 *
 * 样本不足或退化（均值非正、方差为 0）时退回默认参数——
 * 宁可用先验，也不要拟合出一个把巡检周期压到 0 天的病态参数。
 */
export function fitWeibullByMoments(lifetimesDays: number[]): WeibullParams {
  const xs = lifetimesDays.filter((v) => Number.isFinite(v) && v > 0);
  if (xs.length < 2) return { ...DEFAULT_WEIBULL };

  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  if (!(mean > 0)) return { ...DEFAULT_WEIBULL };
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  if (!(variance > 0)) return { ...DEFAULT_WEIBULL };

  const cv2 = variance / (mean * mean);

  // f(k) = Γ(1+2/k)/Γ(1+1/k)² − 1 − cv2，单调递减，二分求根
  const f = (k: number): number => {
    const g1 = gamma(1 + 1 / k);
    const g2 = gamma(1 + 2 / k);
    if (!Number.isFinite(g1) || !Number.isFinite(g2) || g1 <= 0) return Number.NaN;
    return g2 / (g1 * g1) - 1 - cv2;
  };

  let lo = 0.2;
  let hi = 20;
  let flo = f(lo);
  let fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) {
    return { ...DEFAULT_WEIBULL };
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (!Number.isFinite(fmid)) break;
    if (fmid > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }

  const shape = (lo + hi) / 2;
  const g1 = gamma(1 + 1 / shape);
  const scale = Number.isFinite(g1) && g1 > 0 ? mean / g1 : mean;
  if (!Number.isFinite(shape) || !Number.isFinite(scale) || shape <= 0 || scale <= 0) {
    return { ...DEFAULT_WEIBULL };
  }
  return { shape, scale };
}

/**
 * 已知活了 ageDays 天，再隔多久它的存活概率会跌到 (1 - riskBudget)。
 *
 * 解 S(t+Δ)/S(t) = 1 − riskBudget：
 *   ((t+Δ)/λ)^k − (t/λ)^k = −ln(1 − riskBudget)
 *   t+Δ = λ · ((t/λ)^k − ln(1 − riskBudget))^(1/k)
 */
export function nextPatrolDelayDays(
  ageDays: number,
  riskBudget = 0.15,
  params: WeibullParams = DEFAULT_WEIBULL
): number {
  const k = params.shape > 0 ? params.shape : 1;
  const lam = params.scale > 0 ? params.scale : DEFAULT_WEIBULL.scale;
  const t = Number.isFinite(ageDays) && ageDays > 0 ? ageDays : 0;
  const budget = Math.min(0.95, Math.max(0.01, riskBudget));

  const target = Math.pow(t / lam, k) - Math.log(1 - budget);
  if (!Number.isFinite(target) || target <= 0) return PATROL_MIN_DAYS;

  const tNext = lam * Math.pow(target, 1 / k);
  const delta = tNext - t;
  if (!Number.isFinite(delta)) return PATROL_MAX_DAYS;
  return Math.min(PATROL_MAX_DAYS, Math.max(PATROL_MIN_DAYS, Math.round(delta * 100) / 100));
}

export interface PatrolTarget {
  siteId: string;
  /** 上次巡检时间戳（ms）；没有就按创建时间算年龄 */
  lastCheckedAt?: number | null;
  createdAt?: number | null;
}

export interface PatrolPlanEntry {
  siteId: string;
  ageDays: number;
  /** 当前估计的存活概率 [0,1] */
  survival: number;
  /** 距下次该查它的天数 */
  nextCheckInDays: number;
  /** 距下次巡检的绝对时间戳 */
  nextCheckAt: number;
}

/**
 * 生成巡检优先级队列：存活概率越低（越可能是死链）排越前。
 *
 * 这就是「按风险排巡检」相对「按 id 顺序取前 N 个」的全部价值：
 * 同样的 limit 预算，优先覆盖真正可能已经挂掉的站点。
 */
export function planPatrol(
  targets: PatrolTarget[],
  now: number = Date.now(),
  params: WeibullParams = DEFAULT_WEIBULL,
  riskBudget = 0.15
): PatrolPlanEntry[] {
  const DAY = 86_400_000;
  const out: PatrolPlanEntry[] = [];

  for (const t of targets) {
    const ref = t.lastCheckedAt ?? t.createdAt ?? null;
    const ageDays = ref && ref > 0 ? Math.max(0, (now - ref) / DAY) : 0;
    const survival = weibullSurvival(ageDays, params);
    const delay = nextPatrolDelayDays(ageDays, riskBudget, params);
    out.push({
      siteId: t.siteId,
      ageDays: Math.round(ageDays * 100) / 100,
      survival: Math.round(survival * 1e4) / 1e4,
      nextCheckInDays: delay,
      nextCheckAt: Math.round(now + delay * DAY),
    });
  }

  // 存活概率升序（最危险的先查）；相同则按 siteId 保证确定性
  out.sort((a, b) => a.survival - b.survival || a.siteId.localeCompare(b.siteId));
  return out;
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
  /** 本次判定是否建立在「被截断的响应体」之上（true 时正文长度类结论不可信） */
  truncated?: boolean;
  reason: string;
}

/**
 * 内容判定的可选事实。
 *
 * 为什么需要它（实测缺陷）：采集器只读前 8KB，而判定逻辑里
 * 「命中 1 个停放关键词且正文 < 300 字」→ 判疑似停放。
 * 在截断的响应上，正文长度是**采集宽度**而不是**页面内容量**，于是
 * MDN 的「403 Forbidden」说明页（正文 150 字）被判成了疑似停放的域名页。
 *
 * 反过来说，能超过 8KB HTML 的页面不可能是「一页域名出售」——
 * 截断本身就是「这站有大量标记」的证据。所以截断时只保留强证据
 * （≥2 个关键词、视觉哈希吻合），不再用正文长度做加权。
 */
export interface HealthAuditOptions {
  /** 响应体是否被截断（只采集到前若干 KB） */
  truncated?: boolean;
}

/**
 * 页面健康与防劫持审计
 */
export function auditPageHealth(
  url: string,
  htmlContent: string,
  perceptualHash?: string,
  knownBadHashes?: string[],
  options?: HealthAuditOptions
): HealthAuditResult {
  const plainText = stripHtmlToText(htmlContent);
  const textLength = plainText.length;
  const entropy = calculateShannonEntropy(plainText);
  const lowerText = plainText.toLowerCase();
  const truncated = options?.truncated === true;

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
      truncated,
      matchedParkingKeywords: matchedKeywords,
      minHammingDistance: minDistance,
      reason: `视觉感知哈希与已知停放模板高度吻合 (汉明距离: ${minDistance})`,
    };
  }

  /**
   * 「1 个关键词 + 正文短」这条加权只在**整页都读到**时成立。
   * 截断时 textLength 反映的是采集宽度，不是页面内容量——MDN 的 403 说明页
   * （正文 150 字）就是这样被误判成停放页的，而能超过 8KB 的页面不可能是域名出售页。
   */
  if (matchedKeywords.length >= 2 || (matchedKeywords.length === 1 && textLength < 300 && !truncated)) {
    const is404 = matchedKeywords.some((k) => k.includes('404') || k.includes('未找到'));
    return {
      url,
      status: is404 ? 'SOFT_404' : 'SUSPICIOUS_PARKED',
      confidence: 0.9,
      shannonEntropy: entropy,
      textLength,
      truncated,
      matchedParkingKeywords: matchedKeywords,
      minHammingDistance: minDistance,
      reason: `检测到停放或404特征关键词: [${matchedKeywords.join(', ')}]`,
    };
  }

  if (textLength < 60) {
    return {
      url,
      status: 'THIN_CONTENT',
      // 截断时不能断言「内容匮乏」：正文可能全在未采集的后半段
      confidence: truncated ? 0.4 : 0.75,
      shannonEntropy: entropy,
      textLength,
      truncated,
      matchedParkingKeywords: matchedKeywords,
      minHammingDistance: minDistance,
      reason: truncated
        ? `响应被截断，仅采集到 ${textLength} 个有效字符，不足以判断内容是否匮乏`
        : `页面内容极度匮乏 (有效字符仅 ${textLength})`,
    };
  }

  /**
   * 低信息熵只在整页可读时才算证据：截断样本可能只截到导航与脚本，
   * 字符分布天然集中，据此判「疑似停放」是拿缺失证据下结论。
   */
  if (entropy < 2.0 && textLength > 100 && !truncated) {
    return {
      url,
      status: 'SUSPICIOUS_PARKED',
      confidence: 0.7,
      shannonEntropy: entropy,
      textLength,
      truncated,
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
    truncated,
    matchedParkingKeywords: [],
    minHammingDistance: minDistance,
    reason: `页面文本与信息熵正常 (${entropy})，未检出劫持特征`,
  };
}
