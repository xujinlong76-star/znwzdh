/**
 * 客户端预测性预取与 0-RTT 极速连接适配器
 */

export interface Point {
  x: number;
  y: number;
  t: number;
}

export interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MotionVector {
  vx: number;
  vy: number;
  speed: number;
}

export function calculateMotionVector(p1: Point, p2: Point): MotionVector {
  const dt = Math.max(1, p2.t - p1.t);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const vx = dx / dt;
  const vy = dy / dt;
  const speed = Math.sqrt(vx * vx + vy * vy);
  return { vx, vy, speed };
}

export function isHeadingTowardsRect(
  currentPos: { x: number; y: number },
  vector: MotionVector,
  rect: RectBounds,
  maxDistance = 250,
  minSpeed = 0.15
): boolean {
  if (vector.speed < minSpeed) return false;

  const rectCenterX = (rect.left + rect.right) / 2;
  const rectCenterY = (rect.top + rect.bottom) / 2;

  const toCenterX = rectCenterX - currentPos.x;
  const toCenterY = rectCenterY - currentPos.y;
  const dist = Math.sqrt(toCenterX * toCenterX + toCenterY * toCenterY);

  if (dist > maxDistance || dist < 2) return false;

  const dot = vector.vx * toCenterX + vector.vy * toCenterY;
  const cosTheta = dot / (vector.speed * dist);

  return cosTheta >= 0.819; // cos 35°
}

export function extractSafeOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // ignore
  }
  return null;
}

export function shouldPreconnectOrigin(
  origin: string,
  connectedOrigins: Set<string>,
  maxConnections = 8
): boolean {
  if (!origin) return false;
  if (connectedOrigins.has(origin)) return false;
  if (connectedOrigins.size >= maxConnections) return false;
  return true;
}
