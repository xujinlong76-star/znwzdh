export interface Point2D {
  x: number
  y: number
  timeOffsetMs?: number
}

export type TelestratorTool = 'pen' | 'highlighter' | 'arrow' | 'rect'

export interface TelestratorStroke {
  id: string
  tool: TelestratorTool
  color: string
  lineWidth: number
  opacity: number
  points: Point2D[]
  timeSec: number
  durationSec: number
}

export interface TelestratorAnnotation {
  id: string
  videoId: string
  strokes: TelestratorStroke[]
  createdAt: number
  updatedAt: number
}

/**
 * Computes Catmull-Rom spline control points to render smooth Bezier curves from raw pointer input.
 *
 * `tension` is a true cardinal-spline tension: it scales only the tangent
 * terms, tau * (P2 - P0) and tau * (P3 - P1), while the interpolation terms
 * are untouched. At the default 0.5 this is the standard Catmull-Rom spline;
 * at 0 the tangents vanish and each segment degenerates to the straight line
 * P1 -> P2; at 1 the tangents are at full strength.
 */
export function smoothStrokePoints(points: Point2D[], tension: number = 0.5): Point2D[] {
  if (points.length <= 2) return [...points]

  // Tension scales only the cardinal-spline tangents; 0.5 is the standard
  // Catmull-Rom value and the default. Clamp to [0, 1] and fall back to 0.5
  // for non-finite input.
  const tau = Number.isFinite(tension) ? Math.min(1, Math.max(0, tension)) : 0.5

  const smoothed: Point2D[] = [points[0]]
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = i < points.length - 2 ? points[i + 2] : p2

    // Intermediate subdivision
    for (let t = 0.25; t <= 0.75; t += 0.25) {
      const t2 = t * t
      const t3 = t2 * t

      // Cardinal spline in Hermite form:
      //   P(t) = h00 * P1 + h10 * tau * (P2 - P0) + h01 * P2 + h11 * tau * (P3 - P1)
      //   h00 = 2t^3 - 3t^2 + 1, h10 = t^3 - 2t^2 + t,
      //   h01 = -2t^3 + 3t^2,    h11 = t^3 - t^2
      // At tau = 0.5 the Hermite form expands coefficient-wise to exactly
      // the classic Catmull-Rom polynomial used as the base term below
      // (e.g. the P0 coefficient -tau*t + 2*tau*t^2 - tau*t^3 becomes
      // 0.5 * (-t + 2t^2 - t^3); likewise for P1/P2/P3), so the base term
      // alone reproduces the previous implementation bit for bit. The
      // correction term is linear in (tau - 0.5): exactly zero at the
      // default, and it carries only the tangent difference for other
      // tensions — the interpolation terms never move. This decomposed form
      // (instead of evaluating the Hermite form directly) is what keeps the
      // default output bit-identical to the pre-fix implementation.
      const baseX =
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)

      const baseY =
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)

      const h10 = t3 - 2 * t2 + t
      const h11 = t3 - t2
      const corrX = (tau - 0.5) * (h10 * (p2.x - p0.x) + h11 * (p3.x - p1.x))
      const corrY = (tau - 0.5) * (h10 * (p2.y - p0.y) + h11 * (p3.y - p1.y))

      smoothed.push({ x: baseX + corrX, y: baseY + corrY })
    }
    smoothed.push(p2)
  }

  return smoothed
}

/**
 * Evaluates the visual opacity of a stroke based on video playback current timestamp.
 * Staged: 0 -> full opacity at stroke timeSec -> fades out over durationSec.
 */
export function getStrokeDisplayOpacity(
  stroke: TelestratorStroke,
  currentTimeSec: number
): number {
  const { timeSec, durationSec, opacity } = stroke
  const endTime = timeSec + durationSec

  if (currentTimeSec < timeSec || currentTimeSec > endTime) {
    return 0
  }

  const elapsed = currentTimeSec - timeSec
  const remaining = endTime - currentTimeSec

  // Fade in during first 0.2s
  if (elapsed < 0.2) {
    return (elapsed / 0.2) * opacity
  }

  // Fade out during last 0.8s
  if (remaining < 0.8) {
    return (remaining / 0.8) * opacity
  }

  return opacity
}

/**
 * In-memory Telestrator session manager handling undo/redo, timeline filtering, and serialization.
 */
export class TelestratorManager {
  private strokes: TelestratorStroke[] = []
  private undoStack: TelestratorStroke[] = []
  private videoId: string

  constructor(videoId: string, initialStrokes: TelestratorStroke[] = []) {
    this.videoId = videoId
    this.strokes = [...initialStrokes]
  }

  addStroke(stroke: TelestratorStroke): void {
    this.strokes.push(stroke)
    this.undoStack = []
  }

  undo(): TelestratorStroke | undefined {
    const stroke = this.strokes.pop()
    if (stroke) {
      this.undoStack.push(stroke)
    }
    return stroke
  }

  redo(): TelestratorStroke | undefined {
    const stroke = this.undoStack.pop()
    if (stroke) {
      this.strokes.push(stroke)
    }
    return stroke
  }

  clear(): void {
    this.undoStack.push(...this.strokes)
    this.strokes = []
  }

  getStrokes(): TelestratorStroke[] {
    return [...this.strokes]
  }

  getActiveStrokes(currentTimeSec: number): TelestratorStroke[] {
    return this.strokes.filter(s => {
      return currentTimeSec >= s.timeSec && currentTimeSec <= (s.timeSec + s.durationSec)
    })
  }

  exportJson(): string {
    const annotation: TelestratorAnnotation = {
      id: `telestrator-${this.videoId}`,
      videoId: this.videoId,
      strokes: this.strokes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return JSON.stringify(annotation, null, 2)
  }

  importJson(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr) as TelestratorAnnotation
      if (parsed && Array.isArray(parsed.strokes)) {
        this.strokes = parsed.strokes
        this.undoStack = []
        return true
      }
      return false
    } catch {
      return false
    }
  }
}
