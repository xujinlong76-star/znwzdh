import type { VideoStudyNote } from '@/lib/video-frame-clipper'
import type { VideoQuizQuestion } from '@/lib/video-quiz-generator'

export interface FlashcardItem {
  id: string
  videoId?: string
  sourceVideoId?: string
  videoTitle?: string
  timeSec?: number
  question: string
  answer: string
  explanation?: string
  repetitions: number
  easinessFactor: number // Default 2.5
  easeFactor?: number
  intervalDays: number // Next gap in days
  nextReviewTimestamp: number
  nextReviewDate?: number
  createdAt?: number
  lastReviewedTimestamp?: number
}

/**
 * SuperMemo SM-2 Spaced Repetition Algorithm
 * Grade scale:
 * 0 - Completely blackout
 * 1 - Incorrect; familiar upon seeing answer
 * 2 - Incorrect; easy to remember upon seeing answer
 * 3 - Correct; recalled with serious difficulty
 * 4 - Correct; recalled with minor hesitation
 * 5 - Perfect recall
 */
export function calculateNextSM2Schedule(
  card: FlashcardItem,
  grade: number, // 0 - 5
  nowTimestamp: number = Date.now()
): FlashcardItem {
  const safeGrade = Math.max(0, Math.min(5, Math.round(grade)))
  let repetitions = card.repetitions ?? 0
  let easinessFactor = card.easinessFactor ?? card.easeFactor ?? 2.5
  let intervalDays = card.intervalDays ?? 0

  if (safeGrade >= 3) {
    if (repetitions === 0) {
      intervalDays = 1
    } else if (repetitions === 1) {
      intervalDays = 6
    } else {
      intervalDays = Math.round(intervalDays * easinessFactor)
    }
    repetitions += 1
  } else {
    repetitions = 0
    intervalDays = 1
  }

  // Update Easiness Factor (EF): EF' = EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
  easinessFactor = easinessFactor + (0.1 - (5 - safeGrade) * (0.08 + ((5 - safeGrade) * 0.02)))
  if (easinessFactor < 1.3) {
    easinessFactor = 1.3
  }

  const oneDayMs = 24 * 60 * 60 * 1000
  const nextReviewTimestamp = nowTimestamp + (intervalDays * oneDayMs)
  const roundedEF = Number(easinessFactor.toFixed(3))

  return {
    ...card,
    repetitions,
    easinessFactor: roundedEF,
    easeFactor: roundedEF,
    intervalDays,
    nextReviewTimestamp,
    nextReviewDate: nextReviewTimestamp,
    lastReviewedTimestamp: nowTimestamp,
  }
}

/**
 * Transforms study notes into spaced repetition flashcards.
 */
export function generateFlashcardsFromNotes(
  notes: VideoStudyNote[]
): FlashcardItem[] {
  const now = Date.now()
  return notes.map((note) => {
    const timeSec = note.timeSec || 0
    const mins = Math.floor(timeSec / 60).toString().padStart(2, '0')
    const secs = (timeSec % 60).toString().padStart(2, '0')
    const timeStr = `${mins}:${secs}`

    return {
      id: `card-note-${note.id}`,
      videoId: note.videoId,
      sourceVideoId: note.videoId,
      videoTitle: note.videoTitle || '关键要点',
      timeSec: note.timeSec,
      question: `⏱️ ${timeStr} 知识卡：${note.videoTitle || '关键技术总结'}`,
      answer: note.userNote,
      explanation: note.codeSnippet ? `关联代码演练：\n${note.codeSnippet.slice(0, 100)}...` : undefined,
      repetitions: 0,
      easinessFactor: 2.5,
      easeFactor: 2.5,
      intervalDays: 1,
      createdAt: note.createdAt || now,
      nextReviewTimestamp: now,
      nextReviewDate: now,
    }
  })
}

/**
 * Transforms technical quiz questions into flashcards.
 */
export function generateFlashcardsFromQuizzes(
  quizzes: VideoQuizQuestion[],
  videoId: string = 'quiz-gen',
  videoTitle: string = '自测题目'
): FlashcardItem[] {
  const now = Date.now()
  return quizzes.map((q) => {
    const correctOpt = q.options.find(o => o.isCorrect)?.label || '查看详解'
    return {
      id: `card-quiz-${q.id}`,
      videoId,
      sourceVideoId: videoId,
      videoTitle,
      timeSec: 0,
      question: `【自测题】${q.title}`,
      answer: `正确答案：${correctOpt}`,
      explanation: q.explanation,
      repetitions: 0,
      easinessFactor: 2.5,
      easeFactor: 2.5,
      intervalDays: 1,
      createdAt: now,
      nextReviewTimestamp: now,
      nextReviewDate: now,
    }
  })
}

/**
 * Filters flashcards that are due for review.
 */
export function filterDueFlashcards(
  cards: FlashcardItem[],
  currentTimestamp: number = Date.now()
): FlashcardItem[] {
  return cards.filter(card => {
    const dueTime = card.nextReviewTimestamp ?? card.nextReviewDate ?? 0
    return dueTime <= currentTimestamp
  })
}
