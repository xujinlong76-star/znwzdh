/**
 * Spatial Air-Gesture Video Commander Engine
 * Privacy-first optical hand centroid tracking and gesture state machine for touchless playback control.
 */

export type AirGestureType =
  | 'none'
  | 'pinch'
  | 'swipe_left'
  | 'swipe_right'
  | 'open_palm'
  | 'index_point_up'

export interface HandPoint2D {
  x: number // 0.0 to 1.0 (normalized screen coordinates)
  y: number // 0.0 to 1.0
  z?: number
}

export interface RecognizedGestureEvent {
  gesture: AirGestureType
  confidence: number
  timestamp: number
  description: string
  action: 'toggle_play' | 'seek_back' | 'seek_forward' | 'pause' | 'toggle_mute' | 'none'
}

/**
 * Calculates Euclidean distance between two 2D points.
 */
export function calculatePointDistance(p1: HandPoint2D, p2: HandPoint2D): number {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Analyzes standard 21-point hand skeleton landmarks to classify the dominant gesture.
 * Landmark Indices:
 * 0: Wrist, 4: Thumb Tip, 8: Index Tip, 12: Middle Tip, 16: Ring Tip, 20: Pinky Tip
 */
export function classifyHandGesture(
  landmarks: HandPoint2D[],
  previousCentroid?: HandPoint2D
): { gesture: AirGestureType; confidence: number; action: RecognizedGestureEvent['action']; description: string } {
  if (!landmarks || landmarks.length < 21) {
    return { gesture: 'none', confidence: 0, action: 'none', description: '未检测到手势' }
  }

  const wrist = landmarks[0]!
  const thumbTip = landmarks[4]!
  const indexTip = landmarks[8]!
  const middleTip = landmarks[12]!
  const ringTip = landmarks[16]!
  const pinkyTip = landmarks[20]!

  // 1. Pinch Detection: Thumb tip and Index tip distance is very close
  const pinchDist = calculatePointDistance(thumbTip, indexTip)
  if (pinchDist < 0.055) {
    return {
      gesture: 'pinch',
      confidence: 0.92,
      action: 'toggle_play',
      description: '隔空捏合：播放 / 暂停切换',
    }
  }

  // 2. Index Point Up (Shh / Mute): Index extended upward while others folded
  const indexExtended = indexTip.y < landmarks[6]!.y
  const middleFolded = middleTip.y > landmarks[10]!.y
  const ringFolded = ringTip.y > landmarks[14]!.y
  const pinkyFolded = pinkyTip.y > landmarks[18]!.y

  if (indexExtended && middleFolded && ringFolded && pinkyFolded) {
    return {
      gesture: 'index_point_up',
      confidence: 0.88,
      action: 'toggle_mute',
      description: '竖起食指：静音 / 取消静音',
    }
  }

  // 3. Open Palm Detection: All 5 fingertips are higher than wrist and spread apart
  const allTipsExtended =
    indexTip.y < landmarks[6]!.y &&
    middleTip.y < landmarks[10]!.y &&
    ringTip.y < landmarks[14]!.y &&
    pinkyTip.y < landmarks[18]!.y

  // 4. Swipe Left / Right Detection via centroid delta
  if (previousCentroid) {
    const currentCentroid = {
      x: (wrist.x + indexTip.x + middleTip.x) / 3,
      y: (wrist.y + indexTip.y + middleTip.y) / 3,
    }

    const deltaX = currentCentroid.x - previousCentroid.x

    if (deltaX < -0.12) {
      return {
        gesture: 'swipe_left',
        confidence: 0.85,
        action: 'seek_back',
        description: '向左挥掌：快退 10 秒',
      }
    } else if (deltaX > 0.12) {
      return {
        gesture: 'swipe_right',
        confidence: 0.85,
        action: 'seek_forward',
        description: '向右挥掌：快进 10 秒',
      }
    }
  }

  if (allTipsExtended) {
    return {
      gesture: 'open_palm',
      confidence: 0.9,
      action: 'pause',
      description: '张开五指：暂停画面',
    }
  }

  return { gesture: 'none', confidence: 0.2, action: 'none', description: '等待明确手势' }
}

/**
 * Controller class filtering jitter, throttling event triggers, and notifying UI subscribers.
 */
export class AirGestureTracker {
  private lastCentroid?: HandPoint2D
  private lastTriggerTime: number = 0
  private cooldownMs: number
  private subscribers = new Set<(event: RecognizedGestureEvent) => void>()

  constructor(cooldownMs: number = 600) {
    this.cooldownMs = cooldownMs
  }

  processFrame(landmarks: HandPoint2D[]): RecognizedGestureEvent | null {
    const now = Date.now()
    const { gesture, confidence, action, description } = classifyHandGesture(landmarks, this.lastCentroid)

    if (landmarks.length >= 21) {
      this.lastCentroid = {
        x: (landmarks[0]!.x + landmarks[8]!.x + landmarks[12]!.x) / 3,
        y: (landmarks[0]!.y + landmarks[8]!.y + landmarks[12]!.y) / 3,
      }
    }

    if (gesture !== 'none' && confidence >= 0.8) {
      if (now - this.lastTriggerTime >= this.cooldownMs) {
        this.lastTriggerTime = now
        const event: RecognizedGestureEvent = {
          gesture,
          confidence,
          timestamp: now,
          description,
          action,
        }
        this.subscribers.forEach(cb => cb(event))
        return event
      }
    }

    return null
  }

  onGesture(callback: (event: RecognizedGestureEvent) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }
}
