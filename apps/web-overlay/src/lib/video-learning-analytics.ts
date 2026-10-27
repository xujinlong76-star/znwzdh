export interface DailyLearningRecord {
  date: string // YYYY-MM-DD
  minutes: number
  videoCount: number
  level: 0 | 1 | 2 | 3 | 4 // 0: 0m, 1: 1-15m, 2: 16-45m, 3: 46-90m, 4: >90m
}

export interface LearningStreakMetrics {
  currentStreakDays: number
  longestStreakDays: number
  totalStudyHours: number
  totalCompletedVideos: number
  calendarGrid: DailyLearningRecord[][] // 52 weeks x 7 days
}

export interface SkillDomainScore {
  domain: string
  name: string
  score: number // 0 - 100
  maxScore: number
}

/**
 * Calculates continuous daily learning streak from learning history map.
 */
export function calculateLearningStreak(
  history: Record<string, number>, // YYYY-MM-DD -> minutes
  nowDate: Date = new Date()
): { currentStreak: number; longestStreak: number; totalMinutes: number } {
  let currentStreak = 0
  let longestStreak = 0
  let tempStreak = 0
  let totalMinutes = 0

  const sortedDates = Object.keys(history).sort()
  sortedDates.forEach((dateStr) => {
    const mins = history[dateStr] || 0
    totalMinutes += mins
    if (mins > 0) {
      tempStreak++
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak
      }
    } else {
      tempStreak = 0
    }
  })

  // Check current streak counting backward from today/yesterday
  const cur = new Date(nowDate)
  while (true) {
    const dStr = cur.toISOString().slice(0, 10)
    const mins = history[dStr] || 0
    if (mins > 0) {
      currentStreak++
      cur.setDate(cur.getDate() - 1)
    } else {
      // Allow 1 day grace if checking early morning before today's study
      if (currentStreak === 0 && dStr === nowDate.toISOString().slice(0, 10)) {
        cur.setDate(cur.getDate() - 1)
        const prevMins = history[cur.toISOString().slice(0, 10)] || 0
        if (prevMins > 0) {
          currentStreak++
          cur.setDate(cur.getDate() - 1)
          continue
        }
      }
      break
    }
  }

  return {
    currentStreak,
    longestStreak,
    totalMinutes,
  }
}

/**
 * Generates a 52-week x 7-day GitHub-style contribution matrix for the past 365 days.
 */
export function generate365DayHeatmapGrid(
  history: Record<string, number>,
  endDate: Date = new Date()
): DailyLearningRecord[][] {
  const weeks: DailyLearningRecord[][] = []
  const current = new Date(endDate)
  // Align to end of week (Saturday)
  current.setDate(current.getDate() + (6 - current.getDay()))

  const startDate = new Date(current)
  startDate.setDate(startDate.getDate() - (52 * 7) + 1)

  const cursor = new Date(startDate)
  let currentWeek: DailyLearningRecord[] = []

  while (cursor <= current) {
    const dateStr = cursor.toISOString().slice(0, 10)
    const minutes = history[dateStr] || 0

    let level: DailyLearningRecord['level'] = 0
    if (minutes > 90) level = 4
    else if (minutes > 45) level = 3
    else if (minutes > 15) level = 2
    else if (minutes > 0) level = 1

    currentWeek.push({
      date: dateStr,
      minutes,
      videoCount: minutes > 0 ? Math.ceil(minutes / 20) : 0,
      level,
    })

    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  if (currentWeek.length > 0) {
    weeks.push(currentWeek)
  }

  return weeks
}

/**
 * Computes vertices for an SVG polygon representing a 5-dimensional skill radar chart.
 */
export function computeRadarPolygonPoints(
  scores: SkillDomainScore[],
  center: { x: number; y: number },
  radius: number
): string {
  const total = scores.length
  if (total === 0) return ''

  return scores
    .map((item, idx) => {
      const angle = (Math.PI * 2 * idx) / total - Math.PI / 2
      const normalizedScore = Math.max(0, Math.min(100, item.score)) / 100
      const r = radius * normalizedScore
      const x = Math.round((center.x + r * Math.cos(angle)) * 10) / 10
      const y = Math.round((center.y + r * Math.sin(angle)) * 10) / 10
      return `${x},${y}`
    })
    .join(' ')
}
