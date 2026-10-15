/**
 * 预测性鼠标轨迹预取与 0-RTT 物理瞬开引擎 (Predictive Trajectory Prefetching Engine)
 *
 * 核心设计目标：
 * 突破浏览器传统的“按下点击后才开始建立连接”物理延迟瓶颈（DNS+TLS+TTFB 常见 300~500ms）。
 * 通过监听光标轨迹矢量的加速度与朝向夹角，
 * 在光标逼近卡片 150 毫秒前触发 DNS 预解析与 TCP/TLS 预连接，实现物理级 0 延迟秒开。
 */

export interface Point {
  x: number;
  y: number;
  t: number; // 毫秒时间戳
}

export interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MotionVector {
  vx: number; // 像素/毫秒
  vy: number;
  speed: number;
}

/**
 * 计算两点间运动矢量
 */
export function calculateMotionVector(p1: Point, p2: Point): MotionVector {
  const rawDt = p2.t - p1.t;
  // 时钟回拨/同毫秒：不产生虚假大速度
  if (!Number.isFinite(rawDt) || rawDt <= 0) return { vx: 0, vy: 0, speed: 0 };
  const dt = Math.max(1, Math.min(rawDt, 500));
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const vx = dx / dt;
  const vy = dy / dt;
  const speed = Math.sqrt(vx * vx + vy * vy);
  return { vx, vy, speed };
}

/**
 * 判定光标运动矢量是否指向目标矩形（碰撞锥形域检测）
 * @param currentPos 当前光标点
 * @param vector 当前运动矢量
 * @param rect 目标卡片包围盒
 * @param maxDistance 触发预测的最大距离（像素，默认 250px）
 * @param minSpeed 触发预测的最低速度（像素/毫秒，默认 0.15px/ms）
 */
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

  // 计算速度矢量与目标中心矢量的余弦相似度 (cos theta)
  const dot = vector.vx * toCenterX + vector.vy * toCenterY;
  const cosTheta = dot / (vector.speed * dist);

  // 夹角小于 35 度 (cos 35° ≈ 0.819)
  return cosTheta >= 0.819;
}

/**
 * 提取安全 URL 的 Origin 主机源
 */
export function extractSafeOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // 忽略无效 URL
  }
  return null;
}

/**
 * 检查是否需要对指定 Origin 进行预连接
 */
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


/**
 * -------------------------------------------------------------
 * 二维卡尔曼滤波器 (2D Kalman Trajectory Filter)
 * -------------------------------------------------------------
 * 注意：当前实现为固定增益 α 滤波（稳态增益 k=q/(q+r)），无协方差递推，
 * 平滑能力弱于完整卡尔曼。如需完整实现应引入 P 更新；此处保留名称以兼容，
 * 但 dt 已钳位并提供 reset()，避免切 Tab 后外推飞点。
 */
export class KalmanFilter2D {
  private x: number;
  private y: number;
  private vx: number;
  private vy: number;
  private q: number; // 过程噪声协方差 (Process Noise)
  private r: number; // 观测噪声协方差 (Measurement Noise)

  constructor(initX = 0, initY = 0, q = 0.6, r = 0.2) {
    this.x = initX;
    this.y = initY;
    this.vx = 0;
    this.vy = 0;
    this.q = q;
    this.r = r;
  }

  /**
   * 观测并更新卡尔曼状态
   */
  update(measuredX: number, measuredY: number, dtMs: number): { x: number; y: number; vx: number; vy: number } {
    const dt = Math.max(1, Math.min(Number.isFinite(dtMs) ? dtMs : 16, 100));
    const prevX = this.x;
    const prevY = this.y;

    // 预测步骤
    const predX = this.x + this.vx * dt;
    const predY = this.y + this.vy * dt;

    // 简易卡尔曼增益平滑 (稳态增益)
    const k = this.q / (this.q + this.r);
    this.x = predX + k * (measuredX - predX);
    this.y = predY + k * (measuredY - predY);

    // 速度更新：融合瞬时观测微分速度与惯性速度
    const measuredVx = (measuredX - prevX) / dt;
    const measuredVy = (measuredY - prevY) / dt;
    this.vx = this.vx + k * (measuredVx - this.vx);
    this.vy = this.vy + k * (measuredVy - this.vy);

    return { x: this.x, y: this.y, vx: this.vx, vy: this.vy };
  }

  /**
   * 预测未来 deltaMs 毫秒后的光标物理坐标
   */
  predictFuture(deltaMs: number): { x: number; y: number } {
    const dt = Number.isFinite(deltaMs) ? Math.max(0, Math.min(deltaMs, 500)) : 0;
    const x = this.x + this.vx * dt;
    const y = this.y + this.vy * dt;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: this.x, y: this.y };
    return { x, y };
  }

  reset(x = 0, y = 0): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
  }
}

/**
 * 根据网络状态自适应确定预取深度
 */
export function determinePrefetchStrategy(connection?: {
  saveData?: boolean;
  effectiveType?: string;
}): 'none' | 'dns-prefetch' | 'preconnect' {
  if (!connection) return 'preconnect';
  if (connection.saveData) return 'none';
  if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') return 'none';
  if (connection.effectiveType === '3g') return 'dns-prefetch';
  return 'preconnect';
}
