export type SessionEventType =
  | 'play'
  | 'pause'
  | 'seek'
  | 'rate_change'
  | 'take_note'
  | 'quiz_attempt'
  | 'sandbox_run'
  | 'confusion_marker'

export interface SessionTimelineEvent {
  id: string
  type: SessionEventType
  videoSec: number
  wallTimestamp: number
  metadata?: Record<string, any>
}

export interface CognitiveEngagementReport {
  totalEvents: number
  frictionScore: number // 0 - 100: Higher indicates difficult concepts with frequent replays/pauses
  handsOnScore: number // 0 - 100: Driven by sandbox and note actions
  fluencyScore: number // 0 - 100: Driven by sustained uninterrupted playback
  rewindHotspotsSec: number[]
  eventsSummary: Record<SessionEventType, number>
}

/**
 * In-memory recording recorder for learner micro-actions during a video playback session.
 */
export class SessionActivityRecorder {
  private events: SessionTimelineEvent[] = []
  private videoId: string

  constructor(videoId: string) {
    this.videoId = videoId
  }

  recordEvent(type: SessionEventType, videoSec: number, metadata?: Record<string, any>): void {
    const event: SessionTimelineEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      videoSec: Math.round(videoSec * 10) / 10,
      wallTimestamp: Date.now(),
      metadata,
    }
    this.events.push(event)
  }

  getEvents(): SessionTimelineEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events = []
  }

  /**
   * Generates a cognitive load and engagement report from the recorded event stream.
   */
  generateEngagementReport(): CognitiveEngagementReport {
    const counts: Record<SessionEventType, number> = {
      play: 0,
      pause: 0,
      seek: 0,
      rate_change: 0,
      take_note: 0,
      quiz_attempt: 0,
      sandbox_run: 0,
      confusion_marker: 0,
    }

    const rewinds: number[] = []

    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i]
      counts[e.type] = (counts[e.type] || 0) + 1

      if (e.type === 'seek' && i > 0) {
        const prev = this.events[i - 1]
        // If user jumped backward more than 5 seconds
        if (e.videoSec < prev.videoSec - 5) {
          rewinds.push(e.videoSec)
        }
      }
    }

    // Cognitive Friction: rewinds + pauses + confusion markers
    const rawFriction = (rewinds.length * 15) + (counts.pause * 4) + (counts.confusion_marker * 20)
    const frictionScore = Math.min(100, Math.max(10, Math.round(rawFriction)))

    // Hands-on Score: notes + sandbox runs
    const rawHandsOn = (counts.take_note * 25) + (counts.sandbox_run * 20) + (counts.quiz_attempt * 15)
    const handsOnScore = Math.min(100, Math.max(0, Math.round(rawHandsOn)))

    // Fluency Score
    const fluencyScore = Math.max(0, 100 - (frictionScore / 2))

    return {
      totalEvents: this.events.length,
      frictionScore,
      handsOnScore,
      fluencyScore,
      rewindHotspotsSec: rewinds,
      eventsSummary: counts,
    }
  }
}
