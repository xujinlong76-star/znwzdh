// 轨迹捕获器（W1-5 算法实验室沙箱）纯函数层。
// 只做算术，不触 DOM、不持久化、不上报；轨迹采样点只放组件内存。
// 阈值沿用生产值，不发明新阈值：速度 0.15px/ms、夹角 35°（cosθ ≥ 0.819）、
// 距离 220px、预计抵达 < 180ms；预渲染置信度阈值 0.82 与
// compileSpeculationRules 默认值、SpeculationPanel 初始值统一。

import { compileSpeculationRules, isSafeForSpeculation } from './speculative-prerender';
import type { SpeculationCandidate } from './speculative-prerender';

export const TRAJECTORY_MIN_SPEED_PX_PER_MS = 0.15;
export const TRAJECTORY_MIN_COS_THETA = 0.819; // cos(35°)
export const TRAJECTORY_MAX_DISTANCE_PX = 220;
export const TRAJECTORY_MAX_ARRIVAL_MS = 180;
export const TRAJECTORY_PREDICT_HORIZON_MS = 120; // Kalman 外推落点时延
export const TRAJECTORY_SAMPLE_CAPACITY = 8; // 环形缓冲容量，仅内存

export const TRAJECTORY_THROTTLE_MS = 60; // 与生产 PredictivePrefetchProvider 同款下限
export const PRERENDER_CONFIDENCE_THRESHOLD = 0.82;
export const PREFETCH_CONFIDENCE_THRESHOLD = 0.45;
export const TRAJECTORY_HIT_LOG_KEY = 'trajectory-hit-log';

export type SandboxCandidatePath = {
  path: string;
  label: string;
  confidence: number;
  predictedArrivalMs: number;
};

// 沙箱候选全部为本站同源内部路由（路径形式；编译时在挂载后拼
// window.location.origin 得到绝对同源 URL，相对路径不得直接进
// isSafeForSpeculation——它会把路径解析成 host，/logout 这类
// 不安全路径会被误判为安全）。
export const SANDBOX_CANDIDATE_PATHS: SandboxCandidatePath[] = [
  { path: '/algorithms', label: '算法实验室', confidence: 0.92, predictedArrivalMs: 110 },
  { path: '/hot', label: '今日热榜', confidence: 0.78, predictedArrivalMs: 240 },
  { path: '/collections', label: '精选合集', confidence: 0.52, predictedArrivalMs: 380 },
  { path: '/logout', label: '退出登录', confidence: 0.95, predictedArrivalMs: 90 },
  { path: '/admin', label: '管理后台', confidence: 0.82, predictedArrivalMs: 130 },
];

// 沙箱内可命中的目标卡片：只有前三条安全同源路由；
// /logout、/admin 只进规则预览的“被安全拦截”一条，不设卡片、
// 不可命中，永远进不了规则。
export const SANDBOX_TARGET_PATHS = SANDBOX_CANDIDATE_PATHS.slice(0, 3);

export function toAbsoluteCandidates(
  paths: SandboxCandidatePath[],
  origin: string,
): SpeculationCandidate[] {
  return paths.map((candidate) => ({
    url: origin ? `${origin}${candidate.path}` : candidate.path,
    confidence: candidate.confidence,
    predictedArrivalMs: candidate.predictedArrivalMs,
  }));
}

export type CompiledRules = ReturnType<typeof compileSpeculationRules>;

export type RuleAction = 'prerender' | 'prefetch' | 'below-threshold' | 'blocked';

export function classifyCandidate(url: string, compiled: CompiledRules): RuleAction {
  if (!isSafeForSpeculation(url)) return 'blocked';
  if (!compiled) return 'below-threshold';
  const inGroup = (groups?: { urls: string[] }[]) =>
    (groups ?? []).some((group) => group.urls.includes(url));
  if (inGroup(compiled.prerender)) return 'prerender';
  if (inGroup(compiled.prefetch)) return 'prefetch';
  return 'below-threshold';
}

export function ruleActionLabel(action: RuleAction): string {
  if (action === 'prerender') return 'prerender';
  if (action === 'prefetch') return 'prefetch';
  if (action === 'blocked') return '被安全拦截';
  return '低于阈值';
}

// 实验室评分公式（公示用，与页面文案一致）：
// confidence = clamp(0.45 + 0.35·cosθ + 0.20·min(speed/1.0, 1), 0, 1)
export function computeHitConfidence(cosTheta: number, speed: number): number {
  const raw = 0.45 + 0.35 * cosTheta + 0.2 * Math.min(speed / 1.0, 1);
  return Math.min(1, Math.max(0, raw));
}

export function computeCosTheta(
  from: { x: number; y: number },
  vector: { vx: number; vy: number; speed: number },
  centre: { x: number; y: number },
): number {
  const dx = centre.x - from.x;
  const dy = centre.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (vector.speed <= 0 || dist <= 0) return 0;
  return (vector.vx * dx + vector.vy * dy) / (vector.speed * dist);
}

export type HitEvaluation = {
  hit: boolean;
  confidence: number;
  etaMs: number;
  cosTheta: number;
  distPx: number;
  angleDeg: number;
  reason: string;
};

// 命中判定（显式公式，页面上原样公示）：
// 速度 ≥ 0.15px/ms 且 cosθ ≥ 0.819 且 dist ≤ 220px 且 dist/speed < 180ms。
// 命中 ≠ 预渲染：这里只给结论，沙箱不注入任何规则。
export function evaluateTrajectoryHit(args: {
  speed: number;
  cosTheta: number;
  distPx: number;
}): HitEvaluation {
  const etaMs = args.speed > 0 ? args.distPx / args.speed : Number.POSITIVE_INFINITY;
  const confidence = computeHitConfidence(args.cosTheta, args.speed);
  const angleDeg = (Math.acos(Math.min(1, Math.max(-1, args.cosTheta))) * 180) / Math.PI;
  const base = { confidence, etaMs, cosTheta: args.cosTheta, distPx: args.distPx, angleDeg };
  if (args.speed < TRAJECTORY_MIN_SPEED_PX_PER_MS) {
    return { ...base, hit: false, reason: `速度 ${args.speed.toFixed(2)}px/ms < ${TRAJECTORY_MIN_SPEED_PX_PER_MS}px/ms（低于阈值）` };
  }
  if (args.cosTheta < TRAJECTORY_MIN_COS_THETA) {
    return { ...base, hit: false, reason: `cosθ ${args.cosTheta.toFixed(3)} < ${TRAJECTORY_MIN_COS_THETA}（35° 锥外，未朝向目标）` };
  }
  if (args.distPx > TRAJECTORY_MAX_DISTANCE_PX) {
    return { ...base, hit: false, reason: `距离 ${Math.round(args.distPx)}px > ${TRAJECTORY_MAX_DISTANCE_PX}px（超出命中范围）` };
  }
  if (etaMs >= TRAJECTORY_MAX_ARRIVAL_MS) {
    return { ...base, hit: false, reason: `预计抵达 ${Math.round(etaMs)}ms ≥ ${TRAJECTORY_MAX_ARRIVAL_MS}ms（来不及 0-RTT）` };
  }
  return { ...base, hit: true, reason: '命中：速度、夹角、距离、抵达四项条件全部满足' };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
