import type { VideoChapter } from '@/types/navigation'
import { chapterStartSec } from '@/types/navigation'

export interface CodeDiffLine {
  type: 'add' | 'del' | 'remove' | 'context' | 'normal'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffSummary {
  totalOldLines: number
  totalNewLines: number
  addedLines: number
  removedLines: number
  unchangedLines: number
}

export type UnifiedDiffResult = CodeDiffLine[] & {
  lines: CodeDiffLine[]
  summary: DiffSummary
}

export interface VideoCodeMilestone {
  id: string
  timeSec: number
  title: string
  language: string
  filePath: string
  beforeCode: string
  afterCode: string
  explanation: string
  diffFromPrev?: UnifiedDiffResult
}

export type CodeMilestone = VideoCodeMilestone

/**
 * Computes a unified line-by-line diff using Longest Common Subsequence (LCS).
 */
export function computeUnifiedDiff(beforeCode: string, afterCode: string): UnifiedDiffResult {
  const beforeLines = beforeCode ? beforeCode.replace(/\r\n/g, '\n').split('\n') : []
  const afterLines = afterCode ? afterCode.replace(/\r\n/g, '\n').split('\n') : []

  const n = beforeLines.length
  const m = afterLines.length

  // Build LCS matrix
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  // Backtrack to build diff lines
  let i = n
  let j = m

  const temp: CodeDiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      temp.push({
        type: 'context',
        content: beforeLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({
        type: 'add',
        content: afterLines[j - 1],
        newLineNumber: j,
      })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      temp.push({
        type: 'del',
        content: beforeLines[i - 1],
        oldLineNumber: i,
      })
      i--
    }
  }

  temp.reverse()

  const addedLines = temp.filter(l => l.type === 'add').length
  const removedLines = temp.filter(l => l.type === 'del' || l.type === 'remove').length
  const unchangedLines = temp.filter(l => l.type === 'context' || l.type === 'normal').length

  const summary: DiffSummary = {
    totalOldLines: beforeLines.length,
    totalNewLines: afterLines.length,
    addedLines,
    removedLines,
    unchangedLines,
  }

  const result = temp as UnifiedDiffResult
  result.lines = temp
  result.summary = summary

  return result
}

/**
 * Extracts chronological code progression milestones from video chapters.
 */
export function extractCodeMilestones(
  chapters: VideoChapter[] = [],
  fallbackTitle: string = '代码演练'
): VideoCodeMilestone[] {
  const codeChapters = chapters.filter(c => Boolean(c.codeSnippet))
  const milestones: VideoCodeMilestone[] = []

  let prevCode = ''

  for (let i = 0; i < codeChapters.length; i++) {
    const ch = codeChapters[i]
    const currentCode = ch.codeSnippet || ''
    const lang = ch.codeLanguage || 'typescript'
    const ext = lang === 'typescript' ? 'ts' : lang === 'python' ? 'py' : lang === 'yaml' ? 'yaml' : 'sh'

    const milestone: VideoCodeMilestone = {
      id: ch.id || `ms-${i + 1}-${ch.startTime}`,
      // startTime / timeSec 两套字段并存（见 VideoChapter），统一走 chapterStartSec
      timeSec: chapterStartSec(ch),
      title: ch.title,
      language: lang,
      filePath: `src/solution_${i + 1}.${ext}`,
      beforeCode: prevCode || '// 初始代码模版\n// 等待演进...',
      afterCode: currentCode,
      explanation: ch.summary || `第 ${i + 1} 阶段：${ch.title} 代码实操演进`,
    }

    if (i > 0 && prevCode) {
      milestone.diffFromPrev = computeUnifiedDiff(prevCode, currentCode)
    }

    milestones.push(milestone)
    prevCode = currentCode
  }

  // If no milestones found, synthesize a default 2-step tutorial diff
  if (milestones.length === 0 && chapters.length === 0) {
    const m1: VideoCodeMilestone = {
      id: 'ms-demo-1',
      timeSec: 60,
      title: '基础服务初始化',
      language: 'typescript',
      filePath: 'src/main.ts',
      beforeCode: '// Step 1: 基础服务\nexport function start() {\n  console.log("Starting server...");\n}',
      afterCode: '// Step 1: 基础服务 (增加就绪检查)\nexport function start() {\n  console.log("Starting server...");\n  setupHealthCheck();\n}\n\nfunction setupHealthCheck() {\n  return { status: "ok" };\n}',
      explanation: `${fallbackTitle}：初始化核心服务与就绪探针路由`,
    }
    milestones.push(m1)
  }

  return milestones
}

/**
 * Resolves the active code milestone corresponding to current playhead timestamp.
 */
export function findMilestoneByTimestamp(
  milestones: VideoCodeMilestone[],
  currentSec: number
): VideoCodeMilestone | null {
  if (!milestones || milestones.length === 0) return null
  let active: VideoCodeMilestone = milestones[0]

  for (const m of milestones) {
    if (currentSec >= m.timeSec) {
      active = m
    } else {
      break
    }
  }

  return active
}

export const findMilestoneAtTime = findMilestoneByTimestamp
