'use client';

// W1-5 轨迹捕获器（沙箱作用域组件，挂在 speculation Tab 内，
// 与 SpeculationPanel 并列）。
// 隐私：轨迹数据只放内存（最近 8 个采样点环形缓冲），不持久化、
// 不上报；命中日志进 localStorage 时只存目标 URL + 数字指标，
// 不存坐标序列。命中 ≠ 预渲染：沙箱不注入任何规则、不写
// <script type="speculationrules">、不加任何 <link>。
// 复用生产函数，不重写：calculateMotionVector /
// isHeadingTowardsRect（0.15px/ms、35°、220px）/
// KalmanFilter2D（固定增益 α 滤波，非完整 Kalman）/
// compileSpeculationRules / renderSpeculationRulesScript /
// generateFallbackLinkTags / isSafeForSpeculation。

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { calculateMotionVector, isHeadingTowardsRect, KalmanFilter2D } from '@/lib/prefetch';
import {
  compileSpeculationRules,
  generateFallbackLinkTags,
  isSafeForSpeculation,
  renderSpeculationRulesScript,
} from '@/lib/speculative-prerender';
import {
  PREFETCH_CONFIDENCE_THRESHOLD,
  PRERENDER_CONFIDENCE_THRESHOLD,
  SANDBOX_CANDIDATE_PATHS,
  SANDBOX_TARGET_PATHS,
  TRAJECTORY_HIT_LOG_KEY,
  TRAJECTORY_MAX_DISTANCE_PX,
  TRAJECTORY_MIN_COS_THETA,
  TRAJECTORY_PREDICT_HORIZON_MS,
  TRAJECTORY_SAMPLE_CAPACITY,
  TRAJECTORY_THROTTLE_MS,
  classifyCandidate,
  computeCosTheta,
  evaluateTrajectoryHit,
  ruleActionLabel,
  toAbsoluteCandidates,
} from '@/lib/trajectory-hit';
import type { RuleAction } from '@/lib/trajectory-hit';

type SamplePoint = { x: number; y: number; t: number };

// 命中日志条目：只存目标 URL + 数字指标，不存坐标序列。
export type TrajectoryHitLogEntry = {
  time: string;
  url: string;
  speed: number;
  angleDeg: number;
  confidence: number;
  etaMs: number;
  ruleAction: RuleAction;
  reason: string;
};

type LiveState = {
  speed: number;
  cosTheta: number;
  distPx: number;
  etaMs: number;
  confidence: number;
  targetPath: string | null;
  targetLabel: string | null;
  hit: boolean;
  reason: string;
  kalmanX: number | null;
  kalmanY: number | null;
  kalmanInTarget: boolean;
  speeds: number[];
  decelerating: boolean;
  sampleCount: number;
};

const IDLE_LIVE: LiveState = {
  speed: 0,
  cosTheta: 0,
  distPx: 0,
  etaMs: Number.POSITIVE_INFINITY,
  confidence: 0,
  targetPath: null,
  targetLabel: null,
  hit: false,
  reason: '在沙箱内移动鼠标，轨迹与命中判定将实时出现。',
  kalmanX: null,
  kalmanY: null,
  kalmanInTarget: false,
  speeds: [],
  decelerating: false,
  sampleCount: 0,
};

const TARGET_STYLE: Record<string, CSSProperties> = {
  '/algorithms': { top: 16, right: 16 },
  '/hot': { bottom: 16, right: 16 },
  '/collections': { bottom: 16, left: 16 },
};

// Canvas 绘制（防重排：只在 Canvas 上画，不改 DOM 布局）：轨迹折线、
// 速度向量箭头（长度 ∝ 速度）、朝向目标的 35° 锥形、Kalman 预测落点（虚线圆）。
function drawTrajectory(
  canvas: HTMLCanvasElement | null,
  box: HTMLDivElement | null,
  samples: SamplePoint[],
  speed: number,
  kalman: { x: number; y: number } | null,
) {
  if (!canvas || !box) return;
  const rect = box.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (samples.length < 2) return;
  ctx.beginPath();
  samples.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();
  const last = samples[samples.length - 1];
  const prev = samples[samples.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const ux = dx / len;
    const uy = dy / len;
    const arrowLen = Math.min(160, Math.max(24, speed * 80));
    const tipX = last.x + ux * arrowLen;
    const tipY = last.y + uy * arrowLen;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * 10 - uy * 5, tipY - uy * 10 + ux * 5);
    ctx.lineTo(tipX - ux * 10 + uy * 5, tipY - uy * 10 - ux * 5);
    ctx.closePath();
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    const baseAngle = Math.atan2(uy, ux);
    const half = (35 / 2) * (Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(last.x + Math.cos(baseAngle - half) * TRAJECTORY_MAX_DISTANCE_PX, last.y + Math.sin(baseAngle - half) * TRAJECTORY_MAX_DISTANCE_PX);
    ctx.arc(last.x, last.y, TRAJECTORY_MAX_DISTANCE_PX, baseAngle - half, baseAngle + half);
    ctx.closePath();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (kalman) {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.arc(kalman.x, kalman.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(kalman.x, kalman.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#7c3aed';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#2563eb';
  ctx.fill();
}

export default function TrajectoryLab() {
  const sandboxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRefs = useRef(new Map<string, HTMLDivElement>());
  // 环形缓冲：最近 8 个采样点 {x, y, t}，只放 ref 内存，不持久化、不上报。
  const samplesRef = useRef<SamplePoint[]>([]);
  const kalmanRef = useRef<KalmanFilter2D | null>(null);
  const pendingRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastProcessedRef = useRef(0);
  const lastHitRef = useRef<string | null>(null);
  const latchedHitRef = useRef<LiveState | null>(null);
  const hitLogLoadedRef = useRef(false);
  // 同源绝对地址只在挂载后拼 window.location.origin，避免水合不一致。
  const [origin, setOrigin] = useState('');
  const [isCoarse, setIsCoarse] = useState(false);
  const [prerenderThreshold, setPrerenderThreshold] = useState(PRERENDER_CONFIDENCE_THRESHOLD);
  const [prefetchThreshold, setPrefetchThreshold] = useState(PREFETCH_CONFIDENCE_THRESHOLD);
  const [live, setLive] = useState<LiveState>(IDLE_LIVE);
  const [latchedHit, setLatchedHit] = useState<LiveState | null>(null);
  const [hitLog, setHitLog] = useState<TrajectoryHitLogEntry[]>([]);
  const [touchHint, setTouchHint] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    const coarse = window.matchMedia('(pointer: coarse)').matches || window.navigator.maxTouchPoints > 0;
    setIsCoarse(coarse);
    if (coarse) setTouchHint('触屏提示：轻触目标卡片查看命中提示；触屏无连续轨迹，不计算速度 / 夹角与置信度。');
    kalmanRef.current = new KalmanFilter2D();
    try {
      const raw = window.localStorage.getItem(TRAJECTORY_HIT_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TrajectoryHitLogEntry[];
        if (Array.isArray(parsed)) {
          setHitLog(parsed.filter((entry) => entry && typeof entry.url === 'string').slice(0, 20));
        }
      }
    } catch {
      // 读不到就从空日志开始
    }
    hitLogLoadedRef.current = true;
    return () => {
      kalmanRef.current = null;
    };
  }, []);

  // 命中日志只存目标 URL + 数字指标，不存坐标序列。
  useEffect(() => {
    if (!hitLogLoadedRef.current) return;
    try {
      window.localStorage.setItem(TRAJECTORY_HIT_LOG_KEY, JSON.stringify(hitLog.slice(0, 20)));
    } catch {
      // 写不进也不影响沙箱演示
    }
  }, [hitLog]);

  const candidates = useMemo(() => toAbsoluteCandidates(SANDBOX_CANDIDATE_PATHS, origin), [origin]);
  // 未挂载（origin 为空）时不编译：相对路径进 isSafeForSpeculation
  // 会被误判，/logout 这类不安全目标必须等绝对同源地址出来再编译。
  const compiled = useMemo(
    () =>
      origin
        ? compileSpeculationRules(candidates, {
            prerenderConfidenceThreshold: prerenderThreshold,
            prefetchConfidenceThreshold: prefetchThreshold,
          })
        : null,
    [origin, candidates, prerenderThreshold, prefetchThreshold],
  );
  const scriptText = compiled ? renderSpeculationRulesScript(compiled) : '挂载后以本站同源绝对地址编译（仅预览，不注入、不执行）。';
  const fallbackTags = useMemo(() => (compiled ? generateFallbackLinkTags(compiled) : []), [compiled]);

  // 只绑沙箱容器（pointermove + pointerdown，{ passive: true }），不绑 window。
  // 节流：requestAnimationFrame 合并为主（每帧至多处理最新一次事件），
  // 沿用生产 provider 的 60ms 时间节流作下限兜底。
  useEffect(() => {
    const box = sandboxRef.current;
    if (!box) return;
    const process = (pending: { x: number; y: number; t: number }) => {
      const rect = box.getBoundingClientRect();
      const point: SamplePoint = { x: pending.x - rect.left, y: pending.y - rect.top, t: pending.t };
      const samples = samplesRef.current;
      const prevPoint = samples[samples.length - 1];
      if (prevPoint && pending.t <= prevPoint.t) return;
      samples.push(point);
      if (samples.length > TRAJECTORY_SAMPLE_CAPACITY) samples.shift();
      if (samples.length < 2) {
        setLive({ ...IDLE_LIVE, sampleCount: samples.length });
        return;
      }
      const last = samples[samples.length - 1];
      const before = samples[samples.length - 2];
      const vector = calculateMotionVector(before, last);
      const dt = last.t - before.t;
      const kalman = kalmanRef.current;
      let kalmanPoint: { x: number; y: number } | null = null;
      if (kalman) {
        // KalmanFilter2D 第一次生产调用点：每帧 update 后用 predictFuture(120) 外推落点。
        kalman.update(last.x, last.y, dt);
        kalmanPoint = kalman.predictFuture(TRAJECTORY_PREDICT_HORIZON_MS);
      }
      const speeds = samples.slice(1).map((p, i) => calculateMotionVector(samples[i], p).speed);
      const decelerating = speeds.length >= 3 && speeds[speeds.length - 1] < speeds[speeds.length - 2];
      let best: LiveState & { path: string } | null = null;
      let nearest: LiveState & { path: string } | null = null;
      for (const target of SANDBOX_TARGET_PATHS) {
        const el = targetRefs.current.get(target.path);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const bounds = {
          left: r.left - rect.left,
          top: r.top - rect.top,
          right: r.right - rect.left,
          bottom: r.bottom - rect.top,
        };
        const centre = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
        const dist = Math.hypot(centre.x - last.x, centre.y - last.y);
        const cosTheta = computeCosTheta(last, vector, centre);
        const heading = isHeadingTowardsRect(last, vector, bounds, TRAJECTORY_MAX_DISTANCE_PX, 0.15);
        const evalResult = evaluateTrajectoryHit({ speed: vector.speed, cosTheta, distPx: dist });
        const hit = heading && evalResult.hit;
        const kalmanInTarget =
          kalmanPoint !== null &&
          kalmanPoint.x >= bounds.left &&
          kalmanPoint.x <= bounds.right &&
          kalmanPoint.y >= bounds.top &&
          kalmanPoint.y <= bounds.bottom;
        const entry: LiveState & { path: string } = {
          speed: vector.speed,
          cosTheta,
          distPx: dist,
          etaMs: evalResult.etaMs,
          confidence: evalResult.confidence,
          targetPath: target.path,
          targetLabel: target.label,
          hit,
          reason: evalResult.reason,
          kalmanX: kalmanPoint ? kalmanPoint.x : null,
          kalmanY: kalmanPoint ? kalmanPoint.y : null,
          kalmanInTarget,
          speeds,
          decelerating,
          sampleCount: samples.length,
          path: target.path,
        };
        if (!nearest || dist < nearest.distPx) nearest = entry;
        if (hit && (!best || evalResult.confidence > best.confidence)) best = entry;
      }
      const next = best ?? nearest ?? { ...IDLE_LIVE, speeds, decelerating, sampleCount: samples.length };
      setLive(next);
      if (next.hit && next.targetPath && lastHitRef.current !== next.targetPath) {
        lastHitRef.current = next.targetPath;
        const url = origin ? `${origin}${next.targetPath}` : next.targetPath;
        const action = classifyCandidate(url, compiled);
        const entry: TrajectoryHitLogEntry = {
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          url,
          speed: Number(next.speed.toFixed(3)),
          angleDeg: Number((Math.acos(Math.min(1, Math.max(-1, next.cosTheta))) * 180 / Math.PI).toFixed(1)),
          confidence: Number(next.confidence.toFixed(2)),
          etaMs: Number.isFinite(next.etaMs) ? Math.round(next.etaMs) : 0,
          ruleAction: action,
          reason: `${next.reason}；规则分类：${ruleActionLabel(action)}；无动作（沙箱未注入）`,
        };
        setHitLog((prevLog) => [entry, ...prevLog].slice(0, 20));
      } else if (!next.hit) {
        lastHitRef.current = null;
      }
      // 命中徽章闩锁：命中一旦进入即保持显示（值随当前命中帧刷新），直到光标移开 / 反向或离开沙箱。
      // 只看朝向（cosθ）与距离，不看已衰减的速度——否则鼠标停下后徽章闪一下就消失。
      if (next.hit && next.targetPath) {
        latchedHitRef.current = next;
        setLatchedHit(next);
      } else if (latchedHitRef.current) {
        const latched = latchedHitRef.current;
        const stillToward =
          next.targetPath === latched.targetPath &&
          next.cosTheta >= TRAJECTORY_MIN_COS_THETA &&
          next.distPx <= TRAJECTORY_MAX_DISTANCE_PX;
        if (!stillToward) {
          latchedHitRef.current = null;
          setLatchedHit(null);
        }
      }
      drawTrajectory(canvasRef.current, box, samples, vector.speed, kalmanPoint);
    };
    const schedule = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (!pending) return;
        if (pending.t - lastProcessedRef.current < TRAJECTORY_THROTTLE_MS) return;
        lastProcessedRef.current = pending.t;
        process(pending);
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pendingRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      schedule();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pendingRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      schedule();
    };
    const onTouchStart = (event: TouchEvent) => {
      const target = (event.target as HTMLElement).closest?.('[data-target-path]');
      const path = target?.getAttribute('data-target-path');
      const found = SANDBOX_TARGET_PATHS.find((candidate) => candidate.path === path);
      if (found) {
        setTouchHint(`触屏提示：已点按「${found.label}」（${found.path}）。触屏无连续轨迹，不计算速度 / 夹角与置信度，不假装有轨迹。`);
      }
    };
    const onMouseOver = (event: MouseEvent) => {
      const coarse = window.matchMedia('(pointer: coarse)').matches || window.navigator.maxTouchPoints > 0;
      if (!coarse) return;
      const target = (event.target as HTMLElement).closest?.('[data-target-path]');
      const path = target?.getAttribute('data-target-path');
      const found = SANDBOX_TARGET_PATHS.find((candidate) => candidate.path === path);
      if (found) {
        setTouchHint(`触屏 / 悬停提示：「${found.label}」（${found.path}），触屏无轨迹，不做命中判定。`);
      }
    };
    const onPointerLeave = () => {
      samplesRef.current = [];
      kalmanRef.current?.reset();
      lastHitRef.current = null;
      latchedHitRef.current = null;
      setLatchedHit(null);
      setLive(IDLE_LIVE);
      drawTrajectory(canvasRef.current, box, [], 0, null);
    };
    box.addEventListener('pointermove', onPointerMove, { passive: true });
    box.addEventListener('pointerdown', onPointerDown, { passive: true });
    box.addEventListener('touchstart', onTouchStart, { passive: true });
    box.addEventListener('mouseover', onMouseOver);
    box.addEventListener('pointerleave', onPointerLeave);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      box.removeEventListener('pointermove', onPointerMove);
      box.removeEventListener('pointerdown', onPointerDown);
      box.removeEventListener('touchstart', onTouchStart);
      box.removeEventListener('mouseover', onMouseOver);
      box.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [compiled, origin]);

  const chartMaxSpeed = Math.max(0.2, ...live.speeds);
  const chartPoints = live.speeds
    .map((speed, index) => `${(index / Math.max(live.speeds.length - 1, 1)) * 200},${52 - (speed / chartMaxSpeed) * 48}`)
    .join(' ');
  const chartHighlight = live.decelerating && live.cosTheta >= 0.819;

  return (
    <Card data-testid="trajectory-lab">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          <CardTitle>W1-5 轨迹捕获器（沙箱）</CardTitle>
        </div>
        <CardDescription>
          只绑沙箱容器，不绑 window；轨迹只放内存，不持久化、不上报。命中 ≠ 预渲染——沙箱不注入任何规则。
          Kalman 为固定增益 α 滤波（非完整 Kalman），无协方差递推。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCoarse && (
          <p data-testid="trajectory-touch-fallback" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            触屏设备：无连续轨迹，已降级为触摸 / 悬停命中提示，不假装有轨迹。
          </p>
        )}
        {touchHint && (
          <p data-testid="trajectory-touch-hint" className="rounded-md border p-2 text-xs text-muted-foreground">
            {touchHint}
          </p>
        )}
        <div
          ref={sandboxRef}
          data-testid="trajectory-sandbox"
          className="relative h-[340px] overflow-hidden rounded-lg border bg-muted/30"
        >
          <canvas ref={canvasRef} data-testid="trajectory-canvas" className="pointer-events-none absolute inset-0 h-full w-full" />
          {SANDBOX_TARGET_PATHS.map((target) => (
            <div
              key={target.path}
              ref={(el) => {
                if (el) targetRefs.current.set(target.path, el);
                else targetRefs.current.delete(target.path);
              }}
              data-testid={`trajectory-target-${target.path.slice(1)}`}
              data-target-path={target.path}
              style={TARGET_STYLE[target.path]}
              className="absolute w-40 rounded-md border bg-background/90 p-3 shadow-sm"
            >
              <p className="text-sm font-medium">{target.label}</p>
              <p className="text-xs text-muted-foreground">{target.path}</p>
              {latchedHit && latchedHit.targetPath === target.path && (
                <span data-testid="trajectory-hit-badge" className="mt-2 inline-block rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white">
                  0-RTT 意图命中 · 置信度 {latchedHit.confidence.toFixed(2)} · 预计抵达 {Math.round(latchedHit.etaMs)} ms
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <p data-testid="trajectory-speed">速度：{live.speed.toFixed(2)} px/ms</p>
          <p data-testid="trajectory-cos">cosθ：{live.cosTheta.toFixed(3)}</p>
          <p data-testid="trajectory-dist">距离：{Math.round(live.distPx)} px</p>
          <p data-testid="trajectory-eta">预计抵达：{Number.isFinite(live.etaMs) ? `${Math.round(live.etaMs)} ms` : '—'}</p>
          <p data-testid="trajectory-confidence">置信度：{live.confidence.toFixed(2)}</p>
          <p data-testid="trajectory-kalman">
            Kalman 落点：{live.kalmanX === null || live.kalmanY === null ? '—' : `(${Math.round(live.kalmanX)}, ${Math.round(live.kalmanY)})${live.kalmanInTarget ? '（在目标内）' : '（目标外）'}`}
          </p>
        </div>
        <p data-testid="trajectory-status" className="text-xs">
          {live.hit ? '命中' : '未命中'}：{live.reason}
        </p>
        <div>
          <p className="text-xs font-medium">减速曲线（横轴时间、纵轴速度，最近 8 点）</p>
          <svg data-testid="trajectory-deceleration-chart" viewBox="0 0 200 56" className="h-14 w-full rounded border bg-background">
            <polyline points={chartPoints} fill="none" stroke="#2563eb" strokeWidth="2" />
            {chartHighlight && live.speeds.length >= 2 && (
              <polyline
                points={chartPoints.split(' ').slice(-2).join(' ')}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="3"
              />
            )}
          </svg>
          <p className="text-xs text-muted-foreground">
            {chartHighlight ? '减速段高亮：dSpeed/dt < 0 且朝向目标。' : '减速段：最近速度下降且朝向目标时高亮。'}
          </p>
        </div>
        <p className="text-xs">
          命中公式：速度 ≥ 0.15 px/ms 且 cosθ ≥ 0.819 且 dist ≤ 220px 且 预计抵达 dist/speed &lt; 180ms。
          置信度（实验室评分公式）：confidence = clamp(0.45 + 0.35·cosθ + 0.20·min(speed/1.0, 1), 0, 1)。
        </p>
        <div className="space-y-2">
          <p className="text-xs font-medium">预渲染阈值（统一 0.82）</p>
          <div className="flex flex-wrap gap-1">
            {[0.75, 0.82, 0.9, 0.95].map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`trajectory-threshold-${value}`}
                data-active={prerenderThreshold === value}
                onClick={() => setPrerenderThreshold(value)}
                className={`rounded-md border px-2 py-0.5 text-xs ${prerenderThreshold === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {value.toFixed(2)}
              </button>
            ))}
          </div>
          <p className="text-xs font-medium">预取阈值</p>
          <div className="flex flex-wrap gap-1">
            {[0.35, 0.45, 0.55, 0.65].map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`trajectory-prefetch-threshold-${value}`}
                data-active={prefetchThreshold === value}
                onClick={() => setPrefetchThreshold(value)}
                className={`rounded-md border px-2 py-0.5 text-xs ${prefetchThreshold === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {value.toFixed(2)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">当前：预渲染 ≥ {prerenderThreshold.toFixed(2)}、预取 ≥ {prefetchThreshold.toFixed(2)}；改动后下方规则代码实时变化。</p>
        </div>
        <div>
          <p className="text-xs font-medium">规则代码预览（仅预览，不注入、不执行）</p>
          <pre data-testid="trajectory-rules-script" className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 text-xs">
            {scriptText}
          </pre>
          <ul className="mt-2 space-y-1 text-xs">
            {SANDBOX_CANDIDATE_PATHS.map((candidate) => {
              const url = origin ? `${origin}${candidate.path}` : candidate.path;
              const action = compiled ? classifyCandidate(url, compiled) : 'below-threshold';
              const safe = isSafeForSpeculation(url);
              const lastHit = hitLog.find((entry) => entry.url === url);
              return (
                <li key={candidate.path} data-testid={`trajectory-rule-note-${candidate.path.slice(1)}`}>
                  {url} —— {ruleActionLabel(action)}：置信度 {candidate.confidence.toFixed(2)}
                  {candidate.confidence >= prerenderThreshold
                    ? ` ≥ 预渲染阈值 ${prerenderThreshold.toFixed(2)}`
                    : candidate.confidence >= prefetchThreshold
                      ? ` ≥ 预取阈值 ${prefetchThreshold.toFixed(2)}`
                      : ` < 预取阈值 ${prefetchThreshold.toFixed(2)}`}
                  ；预计抵达 {candidate.predictedArrivalMs}ms；安全：
                  {safe ? '通过 isSafeForSpeculation（同源、安全路径）' : '被安全规则拦截（/logout、/admin、/api/tokens 等高危路径永不进规则）'}
                  ；最近命中：{lastHit ? `置信度 ${lastHit.confidence.toFixed(2)}（${ruleActionLabel(lastHit.ruleAction)}）` : '无'}
                </li>
              );
            })}
          </ul>
          {fallbackTags.length > 0 && (
            <p data-testid="trajectory-fallback-tags" className="mt-2 break-all text-xs text-muted-foreground">
              降级 link 标签：{fallbackTags.join(' ')}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium">命中日志（本地，仅目标 URL + 数字指标）</p>
          {hitLog.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无命中记录：在沙箱内朝向目标卡片移动鼠标。</p>
          ) : (
            <ul data-testid="trajectory-hit-log" className="space-y-1 text-xs">
              {hitLog.map((entry, index) => (
                <li key={`${entry.time}-${entry.url}-${index}`} data-testid="trajectory-hit-log-item">
                  {entry.time} · {entry.url} · 速度 {entry.speed.toFixed(2)} px/ms · 夹角 {entry.angleDeg.toFixed(1)}° ·
                  置信度 {entry.confidence.toFixed(2)} · 预计抵达 {entry.etaMs} ms · 规则分类：{ruleActionLabel(entry.ruleAction)} ·
                  无动作（沙箱未注入） · {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div data-testid="trajectory-comparison">
          <p className="text-xs font-medium">命中 vs 实际点击对比</p>
          <p data-testid="trajectory-comparison-empty" className="text-xs text-muted-foreground">暂无实测数据</p>
          <p className="text-xs text-muted-foreground">本轮只做沙箱演示：不注入真实规则、不采集对比数据；命中记录仅用于追溯规则分类。</p>
        </div>
        <p className="text-xs text-muted-foreground">
          隐私：轨迹数据只放内存（最近 8 个采样点），离开沙箱即丢弃，不持久化、不上报；命中日志只存目标 URL 与数字指标，不存坐标序列。
          离开沙箱时取消 rAF 并移除全部监听器，无残留注入。
        </p>
      </CardContent>
    </Card>
  );
}
