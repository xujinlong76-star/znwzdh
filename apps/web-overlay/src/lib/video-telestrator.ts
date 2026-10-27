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
 */
export function smoothStrokePoints(points: Point2D[], tension: number = 0.5): Point2D[] {
  if (points.length <= 2) return [...points]

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

      const x =
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)

      const y =
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)

      smoothed.push({ x, y })
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
