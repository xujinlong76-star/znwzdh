export interface FilmstripThumbnail {
  timeSec: number
  dataUrl: string
  width: number
  height: number
  chapterTitle?: string
}

export interface FilmstripOptions {
  intervalSec: number // Default 15s
  width: number // Default 160
  height: number // Default 90
}

/**
 * Checks if WebCodecs VideoDecoder API is supported in current environment.
 */
export function isWebCodecsSupported(): boolean {
  return typeof window !== 'undefined' && 'VideoDecoder' in window
}

/**
 * Finds the closest filmstrip thumbnail for a given video timestamp using binary search.
 */
export function findClosestThumbnail(
  thumbnails: FilmstripThumbnail[],
  targetSec: number
): FilmstripThumbnail | null {
  if (thumbnails.length === 0) return null

  let low = 0
  let high = thumbnails.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const midVal = thumbnails[mid].timeSec

    if (midVal === targetSec) {
      return thumbnails[mid]
    } else if (midVal < targetSec) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  // Pick nearest between low and high
  if (low >= thumbnails.length) return thumbnails[thumbnails.length - 1]
  if (high < 0) return thumbnails[0]

  const diffLow = Math.abs(thumbnails[low].timeSec - targetSec)
  const diffHigh = Math.abs(thumbnails[high].timeSec - targetSec)
  return diffLow < diffHigh ? thumbnails[low] : thumbnails[high]
}

/**
 * Generates an SVG Data URL representing a high-performance mock thumbnail
 * with timestamp, miniature terminal lines, and chapter markers.
 */
export function renderThumbnailDataUrl(
  timeSec: number,
  width: number = 160,
  height: number = 90,
  chapterTitle?: string
): string {
  const mins = Math.floor(timeSec / 60).toString().padStart(2, '0')
  const secs = Math.floor(timeSec % 60).toString().padStart(2, '0')
  const timeStr = `${mins}:${secs}`
  const title = chapterTitle ? chapterTitle.slice(0, 14) : '技术实战讲解'

  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#09090b" />
      <stop offset="100%" stop-color="#18181b" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <!-- Terminal window mock header -->
  <rect x="6" y="6" width="${width - 12}" height="10" rx="3" fill="#27272a" />
  <circle cx="12" cy="11" r="2" fill="#ef4444" />
  <circle cx="18" cy="11" r="2" fill="#f59e0b" />
  <circle cx="24" cy="11" r="2" fill="#10b981" />
  <!-- Simulated code lines -->
  <rect x="10" y="24" width="${width * 0.6}" height="4" rx="2" fill="#38bdf8" opacity="0.8" />
  <rect x="10" y="32" width="${width * 0.75}" height="4" rx="2" fill="#a1a1aa" opacity="0.6" />
  <rect x="10" y="40" width="${width * 0.45}" height="4" rx="2" fill="#34d399" opacity="0.7" />
  <rect x="10" y="48" width="${width * 0.65}" height="4" rx="2" fill="#a1a1aa" opacity="0.5" />
  <!-- Timestamp Badge -->
  <rect x="8" y="${height - 20}" width="42" height="14" rx="4" fill="#000000" opacity="0.85" />
  <text x="29" y="${height - 10}" font-family="monospace" font-size="9" fill="#38bdf8" text-anchor="middle" font-weight="bold">${timeStr}</text>
  <!-- Chapter title -->
  <text x="${width - 8}" y="${height - 10}" font-family="system-ui, sans-serif" font-size="8" fill="#e4e4e7" text-anchor="end" opacity="0.9">${title}</text>
</svg>
`.trim()

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Generates an indexed filmstrip sprite set across the whole video duration.
 */
export function generateFilmstripSequence(
  durationSec: number,
  chapters: Array<{ startTime: number; title: string }> = [],
  options?: Partial<FilmstripOptions>
): FilmstripThumbnail[] {
  const { intervalSec = 15, width = 160, height = 90 } = options || {}
  const list: FilmstripThumbnail[] = []
  const safeDuration = Math.max(1, durationSec)

  for (let t = 0; t <= safeDuration; t += intervalSec) {
    let matchedChapter: string | undefined = undefined
    for (let c = chapters.length - 1; c >= 0; c--) {
      if (t >= chapters[c].startTime) {
        matchedChapter = chapters[c].title
        break
      }
    }

    list.push({
      timeSec: t,
      dataUrl: renderThumbnailDataUrl(t, width, height, matchedChapter),
      width,
      height,
      chapterTitle: matchedChapter,
    })
  }

  return list
}
