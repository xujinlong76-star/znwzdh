import type { VideoChapter } from '@/types/navigation'

export interface VideoAISummary {
  videoId: string
  title: string
  overview: string
  keyTakeaways: string[]
  chapters: VideoChapter[]
  generatedAt: string
  source: 'ai-gemini' | 'heuristic-extractor' | 'cache'
}

const SUMMARY_STORAGE_KEY = 'devops_video_ai_summaries_v1'
const memoryCache = new Map<string, VideoAISummary>()

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage
  }
  return null
}

/**
 * Converts a timestamp string (HH:MM:SS or MM:SS) to total seconds.
 */
export function parseTimestampToSeconds(ts: string): number {
  const parts = ts.trim().split(':').map(part => parseInt(part, 10))
  if (parts.some(p => isNaN(p))) return 0
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]
  }
  return 0
}

/** 秒 → m:ss（仅用于占位小节的标题提示） */
function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Extracts chapters, timestamps, and embedded code blocks from description text heuristics.
 */
export function extractHeuristicChapters(
  title: string,
  description: string = '',
  durationSec: number = 600
): { chapters: VideoChapter[]; keyTakeaways: string[]; overview: string } {
  const chapters: VideoChapter[] = []
  const keyTakeaways: string[] = []
  /** 是否走了「无时间戳」的估算分支——overview 必须如实说明，不能宣称是提炼结果 */
  let synthesized = false

  const lines = description.split('\n')
  let currentChapter: VideoChapter | null = null
  let inCodeBlock = false
  let currentCode = ''
  let currentLang = 'bash'

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    // Handle markdown code block boundary
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        currentLang = trimmed.slice(3).trim() || 'bash'
        currentCode = ''
      } else {
        inCodeBlock = false
        if (currentChapter && !currentChapter.codeSnippet) {
          currentChapter.codeSnippet = currentCode.trim()
          currentChapter.codeLanguage = currentLang
        }
      }
      continue
    }

    if (inCodeBlock) {
      currentCode += (currentCode ? '\n' : '') + rawLine
      continue
    }

    if (!trimmed) continue

    // Check if line contains a timestamp: e.g. 01:23, 01:23:45, [02:30], (05:12)
    const tsMatch = trimmed.match(/(?:\[|\()?(?:(\d{1,2}:\d{2}(?::\d{2})?))(?:\]|\))?\s*[-–—:]?\s*(.+)/)
    if (tsMatch && tsMatch[1] && tsMatch[2]) {
      const startTime = parseTimestampToSeconds(tsMatch[1])
      const chapterTitle = tsMatch[2].replace(/[#*`_]/g, '').trim()

      currentChapter = {
        id: `ch-${chapters.length + 1}-${startTime}`,
        title: chapterTitle,
        startTime,
        summary: `聚焦于 ${chapterTitle} 的核心架构与最佳实践`,
      }
      chapters.push(currentChapter)
      keyTakeaways.push(chapterTitle)
    }
  }

  // If no timestamp chapters were found in description, synthesize logical milestone chapters.
  //
  // 注意：这里**只做按时长均分的占位骨架**，不编造代码。
  // 原实现给每个里程碑塞了硬编码的 `git clone https://github.com/example/demo.git`、
  // docker-compose 片段、TypeScript 函数——它们与视频内容毫无关系，却以「AI 章节 +
  // 代码摘要」的名义展示给用户。没有真实字幕/简介时间戳时，诚实的产出就是「估算大纲」。
  if (chapters.length === 0) {
    synthesized = true
    const safeDuration = durationSec > 60 ? durationSec : 600
    const step = Math.floor(safeDuration / 4)
    const milestones = [
      { offset: 0, title: '开场与背景铺垫' },
      { offset: step, title: '核心概念与原理讲解' },
      { offset: step * 2, title: '动手实践与问题排查' },
      { offset: step * 3, title: '总结与延伸阅读' },
    ]

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i]
      chapters.push({
        id: `ch-auto-${i + 1}-${m.offset}`,
        title: `${m.title}（约 ${formatClock(m.offset)}）`,
        startTime: m.offset,
        summary: '该视频未提供章节时间戳，此段为按时长均分的估算区间，不代表真实小节标题。',
      })
      keyTakeaways.push(m.title)
    }
  }

  // Assign endTime for each chapter
  for (let i = 0; i < chapters.length; i++) {
    if (i < chapters.length - 1) {
      chapters[i].endTime = chapters[i + 1].startTime
    } else {
      chapters[i].endTime = durationSec
    }
  }

  // 如实描述来源：有时间戳就是「按简介时间戳整理」，没有就是「按时长估算」。
  // 旧文案一律称「深度技术拆解 / 核心关键里程碑」，对估算结果同样使用，属于夸大。
  const overview = synthesized
    ? `${title}：该视频未提供章节时间戳，以下 ${chapters.length} 段为按总时长均分的估算大纲，仅用于定位播放位置。`
    : `${title}：根据视频简介中的时间戳整理出 ${chapters.length} 个章节。`

  return { chapters, keyTakeaways, overview }
}

/**
 * Get cached summary from memory or storage.
 */
export function getCachedAISummary(videoId: string): VideoAISummary | null {
  if (memoryCache.has(videoId)) {
    return memoryCache.get(videoId)!
  }

  try {
    const storage = getStorage()
    if (!storage) return null
    const raw = storage.getItem(SUMMARY_STORAGE_KEY)
    if (!raw) return null
    const dict: Record<string, VideoAISummary> = JSON.parse(raw)
    const item = dict[videoId]
    if (item) {
      memoryCache.set(videoId, item)
      return item
    }
  } catch {
    // Ignore storage parse errors
  }
  return null
}

/**
 * Save summary to cache.
 */
export function saveAISummaryToCache(summary: VideoAISummary): void {
  memoryCache.set(summary.videoId, summary)
  try {
    const storage = getStorage()
    if (!storage) return
    const raw = storage.getItem(SUMMARY_STORAGE_KEY)
    const dict: Record<string, VideoAISummary> = raw ? JSON.parse(raw) : {}
    dict[summary.videoId] = summary
    storage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(dict))
  } catch {
    // Ignore
  }
}

/**
 * Generate or fetch structured AI summary for a video.
 */
export async function getVideoAISummary(params: {
  videoId: string
  title: string
  description?: string
  durationSec?: number
  apiKey?: string
}): Promise<VideoAISummary> {
  const { videoId, title, description = '', durationSec = 600, apiKey } = params

  const cached = getCachedAISummary(videoId)
  if (cached) {
    return { ...cached, source: 'cache' }
  }

  const effectiveApiKey = apiKey || (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined)

  // Try Gemini API if key is present
  if (effectiveApiKey) {
    try {
      const prompt = `你是一个资深全栈与 DevOps 架构师。请分析以下技术视频信息并返回结构化章节目录与代码摘要：
视频标题: ${title}
视频简介与内容: ${description.slice(0, 1500)}
视频时长: ${durationSec}秒

请直接返回合法 JSON 对象，不要添加任何 markdown 引号或额外解释，格式严格如下：
{
  "overview": "视频核心概要一句话总结",
  "keyTakeaways": ["要点1", "要点2", "要点3"],
  "chapters": [
    {
      "id": "ch-1-0",
      "title": "章节名称",
      "startTime": 0,
      "endTime": 120,
      "codeSnippet": "可选的代码段示例",
      "codeLanguage": "bash|yaml|typescript|go|python",
      "summary": "本章节核心解析"
    }
  ]
}`

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${effectiveApiKey}`
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      })

      if (resp.ok) {
        const data = await resp.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          const parsed = JSON.parse(text)
          if (Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
            const summary: VideoAISummary = {
              videoId,
              title,
              overview: parsed.overview || `${title} 核心技术指南`,
              keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
              chapters: parsed.chapters,
              generatedAt: new Date().toISOString(),
              source: 'ai-gemini',
            }
            saveAISummaryToCache(summary)
            return summary
          }
        }
      }
    } catch {
      // Fallback to heuristic parser on Gemini API error
    }
  }

  // Fallback to Heuristic Extractor
  const heuristic = extractHeuristicChapters(title, description, durationSec)
  const summary: VideoAISummary = {
    videoId,
    title,
    overview: heuristic.overview,
    keyTakeaways: heuristic.keyTakeaways,
    chapters: heuristic.chapters,
    generatedAt: new Date().toISOString(),
    source: 'heuristic-extractor',
  }

  saveAISummaryToCache(summary)
  return summary
}
