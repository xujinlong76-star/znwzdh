import type { VideoChapter } from '@/types/navigation'

/**
 * 测验题。
 *
 * 历史问题：类型只认 `correctIndex`，而 `video-autonomous-ai-harvester` 生成的是
 * `correctAnswerIndex` —— 两者并存但类型只认一套，于是
 * `video-quiz-dialog.tsx` 的 `idx === currentQ.correctIndex` 对 AI 生成的题恒为
 * `idx === undefined` → **全部判错**。类型检查被 `ignoreBuildErrors` 关掉，没人发现。
 *
 * 现在两个字段都声明为可选，读取方统一走 `quizCorrectIndex()`。
 */
export interface VideoQuizQuestion {
  id: string
  /** 旧上游结构的题目时间点（与 timestamp 同义） */
  timeSec?: number
  /** AI 生成结构的时间点（与 timeSec 同义） */
  timestamp?: number
  question: string
  options: string[]
  correctIndex?: number
  correctAnswerIndex?: number
  explanation: string
  chapterTitle?: string
}

/** 正确答案下标的统一读取口径（correctIndex / correctAnswerIndex 两套字段并存） */
export function quizCorrectIndex(q: VideoQuizQuestion): number {
  const value = q.correctIndex ?? q.correctAnswerIndex ?? 0
  return Number.isInteger(value) && value >= 0 ? value : 0
}

export interface VideoQuizState {
  totalQuestions: number
  answeredCount: number
  correctCount: number
  score: number
  scorePercent: number
  feedback: string
  masteryLevel: 'expert' | 'proficient' | 'apprentice'
  detailedResults: Array<{ questionId: string; isCorrect: boolean; selectedIndex: number; correctIndex: number }>
}

/**
 * Generates technical milestone quiz questions based on video chapters and topics.
 */
export function generateVideoQuizzes(
  paramsOrVideoId: { videoId: string; title: string; chapters?: VideoChapter[]; description?: string } | string,
  chaptersArg?: VideoChapter[],
  titleArg?: string
): VideoQuizQuestion[] {
  let videoId: string
  let title: string
  let chapters: VideoChapter[] = []

  if (typeof paramsOrVideoId === 'object' && paramsOrVideoId !== null) {
    videoId = paramsOrVideoId.videoId
    title = paramsOrVideoId.title
    chapters = paramsOrVideoId.chapters || []
  } else {
    videoId = paramsOrVideoId
    chapters = chaptersArg || []
    title = titleArg || '视频教程'
  }

  const questions: VideoQuizQuestion[] = []

  if (chapters.length > 0) {
    chapters.forEach((ch, idx) => {
      const timeSec = ch.endTime ? Math.max(0, ch.endTime - 5) : ch.startTime + 60
      const chTitle = ch.title

      if (ch.codeLanguage === 'yaml' || chTitle.toLowerCase().includes('k8s') || chTitle.toLowerCase().includes('kubernetes')) {
        questions.push({
          id: `quiz-${videoId}-${idx + 1}`,
          timeSec,
          chapterTitle: chTitle,
          question: `在「${chTitle}」中，Kubernetes 针对高可用与滚动升级的核心机制是什么？`,
          options: [
            '修改 Pod 副本数直接为 0 并重建',
            '配置 maxSurge 与 maxUnavailable 控制滚动平滑替换',
            '手动执行 kubectl delete pod --all',
            '直接修改 etcd 中的 key 数据',
          ],
          correctIndex: 1,
          explanation: 'Kubernetes Deployment 通过 maxSurge 与 maxUnavailable 参数实现平滑零停机的滚动更新。',
        })
      } else if (ch.codeLanguage === 'bash' || chTitle.toLowerCase().includes('docker')) {
        questions.push({
          id: `quiz-${videoId}-${idx + 1}`,
          timeSec,
          chapterTitle: chTitle,
          question: `在「${chTitle}」中，为了压低 Docker 镜像体积与构建缓存失效，最佳实践是？`,
          options: [
            '把所有依赖文件在 Dockerfile 第一行全部 COPY 进去',
            '采用多阶段构建 (multi-stage build) 并合理分层缓存',
            '在单个容器中启动 systemd 运行全部守护进程',
            '构建时不指定基础镜像直接使用 scratch 运行动态链接二进制',
          ],
          correctIndex: 1,
          explanation: '多阶段构建 (multi-stage build) 能够将编译环境与运行环境剥离，极大减小最终镜像体积并利用 Docker 层级缓存。',
        })
      } else {
        questions.push({
          id: `quiz-${videoId}-${idx + 1}`,
          timeSec,
          chapterTitle: chTitle,
          question: `在「${chTitle}」模块中，关于高可用系统架构的设计准则，下列哪项最为合理？`,
          options: [
            '全面依赖单机内存缓存以追求极端吞吐',
            '无状态服务水平横向扩展配合分布式幂等设计',
            '关闭所有超时重试避免级联雪崩',
            '使用全局互斥大锁保证分布式强一致性',
          ],
          correctIndex: 1,
          explanation: '现代分布式架构通过无状态化与横向副本扩展，结合幂等重试与熔断机制，实现具备韧性的高可用服务。',
        })
      }
    })
  }

  // Fallback default question if chapters are empty
  if (questions.length === 0) {
    questions.push({
      id: `quiz-${videoId}-fallback`,
      timeSec: 120,
      chapterTitle: '核心导读',
      question: `针对「${title}」所涉及的技术体系，在生产环境落地时最需优先防范的是？`,
      options: [
        '单点故障与缺乏健康检查导致的服务中断',
        '过度记录结构化日志导致磁盘溢出',
        '没有在本地开发环境配置负载均衡',
        '未采用最新的编译期宏优化参数',
      ],
      correctIndex: 0,
      explanation: '生产级服务治理必须首先保证没有单点故障，并配置精准的就绪与存活探针。',
    })
  }

  return questions
}

/**
 * Grades user quiz answers and returns a mastery scorecard.
 */
export function gradeQuizAnswers(
  questions: VideoQuizQuestion[],
  answers: Record<string, number>
): VideoQuizState {
  let correctCount = 0
  let answeredCount = 0
  const detailedResults: Array<{ questionId: string; isCorrect: boolean; selectedIndex: number; correctIndex: number }> = []

  questions.forEach(q => {
    const selected = answers[q.id]
    if (typeof selected === 'number') {
      answeredCount++
      // 统一口径：AI 生成的题只有 correctAnswerIndex，直接读 correctIndex 会恒判错
      const isCorrect = selected === quizCorrectIndex(q)
      if (isCorrect) {
        correctCount++
      }
      detailedResults.push({
        questionId: q.id,
        isCorrect,
        selectedIndex: selected,
        correctIndex: q.correctIndex,
      })
    } else {
      detailedResults.push({
        questionId: q.id,
        isCorrect: false,
        selectedIndex: -1,
        correctIndex: q.correctIndex,
      })
    }
  })

  const total = questions.length
  const score = total === 0 ? 0 : Math.round((correctCount / total) * 100)

  let masteryLevel: 'expert' | 'proficient' | 'apprentice' = 'apprentice'
  let feedback = '建议重新温习核心章节原理，强化工程实操认知。'

  if (score >= 90) {
    masteryLevel = 'expert'
    feedback = '恭喜！您已全面掌握本教程的核心架构设计与避坑指南。'
  } else if (score >= 60) {
    masteryLevel = 'proficient'
    feedback = '良好！已具备核心实践能力，建议复查错题解析。'
  }

  return {
    totalQuestions: total,
    answeredCount,
    correctCount,
    score,
    scorePercent: score,
    feedback,
    masteryLevel,
    detailedResults,
  }
}

/**
 * Checks if current playhead reaches a quiz checkpoint trigger window.
 */
export function findQuizTrigger(
  questions: VideoQuizQuestion[],
  currentSec: number,
  toleranceSec: number = 4
): VideoQuizQuestion | null {
  for (const q of questions) {
    if (Math.abs(currentSec - q.timeSec) <= toleranceSec) {
      return q
    }
  }
  return null
}

export const findQuizTriggerAtPlayhead = (
  questions: VideoQuizQuestion[],
  currentSec: number,
  _seenIds?: Set<string>,
  toleranceSec: number = 4
): VideoQuizQuestion | null => {
  return findQuizTrigger(questions, currentSec, toleranceSec)
}
