/**
 * WebCodecs / Canvas Accelerated Presentation Slide Deck & Chapter Boundary Detector
 * Computes perceptual difference hash (dHash) and hamming distance to detect slide page transitions.
 */

export interface SlideSnapshot {
  id: string
  pageNumber: number
  timestampSec: number
  durationSec: number
  title: string
  pHash: string
  thumbnailDataUrl: string
  ocrKeywords: string[]
}

export interface SlideDetectionOptions {
  hammingDistanceThreshold: number // Default 12 (out of 64 bits)
  minSlideDurationSec: number // Default 4 seconds
  sampleWidth: number // Default 9
  sampleHeight: number // Default 8 (9x8 matrix for 64-bit dHash)
}

/**
 * Computes a 64-bit perceptual difference hash (dHash) from grayscale image pixels.
 * Resizes conceptually to (width x height) where width = 9, height = 8 => 8x8 = 64 adjacent pixel gradients.
 */
export function computeDifferenceHash(
  grayscaleMatrix: number[][],
  width: number = 9,
  height: number = 8
): bigint {
  let hash = 0n
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = grayscaleMatrix[y]?.[x] ?? 0
      const right = grayscaleMatrix[y]?.[x + 1] ?? 0
      hash <<= 1n
      if (left > right) {
        hash |= 1n
      }
    }
  }
  return hash
}

/**
 * Calculates bitwise Hamming distance between two 64-bit perceptual hashes.
 */
export function hammingDistance(hashA: bigint, hashB: bigint): number {
  let xor = hashA ^ hashB
  let distance = 0
  while (xor > 0n) {
    if ((xor & 1n) === 1n) {
      distance++
    }
    xor >>= 1n
  }
  return distance
}

/**
 * Converts a 64-bit hash bigint to a 16-character hexadecimal string representation.
 */
export function hashToHexString(hash: bigint): string {
  return hash.toString(16).padStart(16, '0')
}

/**
 * Renders an SVG placeholder thumbnail for a slide.
 */
export function generateSlideThumbnailSvg(page: number, title: string, timeSec: number): string {
  const min = Math.floor(timeSec / 60)
  const sec = Math.floor(timeSec % 60).toString().padStart(2, '0')
  const timeFormatted = `${min}:${sec}`
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" fill="none">
    <rect width="320" height="180" rx="8" fill="#18181b"/>
    <rect x="12" y="12" width="296" height="156" rx="6" fill="#27272a" stroke="#3f3f46" stroke-width="1.5"/>
    <rect x="24" y="24" width="40" height="18" rx="4" fill="#3b82f6"/>
    <text x="32" y="37" fill="#ffffff" font-family="sans-serif" font-size="11" font-weight="bold">P.${page}</text>
    <text x="288" y="37" text-anchor="end" fill="#94a3b8" font-family="monospace" font-size="11">${timeFormatted}</text>
    <text x="24" y="80" fill="#f8fafc" font-family="sans-serif" font-size="14" font-weight="600">${safeTitle}</text>
    <line x1="24" y1="96" x2="296" y2="96" stroke="#3f3f46" stroke-width="1"/>
    <rect x="24" y="112" width="160" height="8" rx="2" fill="#52525b"/>
    <rect x="24" y="128" width="120" height="8" rx="2" fill="#3f3f46"/>
  </svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Scans sampled video frames, detects slide changes, and yields organized presentation slides.
 */
export function detectSlideTransitions(
  samples: Array<{
    timeSec: number
    grayscaleMatrix: number[][]
    ocrText?: string
    title?: string
  }>,
  options: Partial<SlideDetectionOptions> = {}
): SlideSnapshot[] {
  const config: SlideDetectionOptions = {
    hammingDistanceThreshold: 10,
    minSlideDurationSec: 4,
    sampleWidth: 9,
    sampleHeight: 8,
    ...options,
  }

  if (samples.length === 0) return []

  const slides: SlideSnapshot[] = []
  let prevHash: bigint | null = null
  let currentSlideStartSec = samples[0]!.timeSec
  let currentTitle = samples[0]!.title || '导言与课程大纲'
  let currentOcrWords: string[] = samples[0]!.ocrText ? samples[0]!.ocrText.split(/\s+/).slice(0, 8) : ['架构', '核心原则']
  let prevSampleTime = samples[0]!.timeSec

  samples.forEach((sample, idx) => {
    const hash = computeDifferenceHash(sample.grayscaleMatrix, config.sampleWidth, config.sampleHeight)
    prevSampleTime = sample.timeSec

    if (prevHash === null) {
      prevHash = hash
      return
    }

    const dist = hammingDistance(prevHash, hash)
    const elapsedSinceSlideStart = sample.timeSec - currentSlideStartSec

    // If Hamming distance exceeds threshold and slide persisted longer than min duration
    if (dist >= config.hammingDistanceThreshold && elapsedSinceSlideStart >= config.minSlideDurationSec) {
      const pageNumber = slides.length + 1
      slides.push({
        id: `slide-page-${pageNumber}`,
        pageNumber,
        timestampSec: currentSlideStartSec,
        durationSec: sample.timeSec - currentSlideStartSec,
        title: currentTitle,
        pHash: hashToHexString(prevHash),
        thumbnailDataUrl: generateSlideThumbnailSvg(pageNumber, currentTitle, currentSlideStartSec),
        ocrKeywords: currentOcrWords,
      })

      // Prepare for next slide
      currentSlideStartSec = sample.timeSec
      currentTitle = sample.title || (sample.ocrText ? sample.ocrText.slice(0, 20) : `课件主题探讨 #${pageNumber + 1}`)
      currentOcrWords = sample.ocrText ? sample.ocrText.split(/\s+/).slice(0, 8) : ['技术演练', '代码实现']
      prevHash = hash
    }
  })

  // Final trailing slide
  if (samples.length > 0) {
    const lastPage = slides.length + 1
    const lastSample = samples[samples.length - 1]!
    const finalDuration = Math.max(config.minSlideDurationSec, lastSample.timeSec - currentSlideStartSec)
    slides.push({
      id: `slide-page-${lastPage}`,
      pageNumber: lastPage,
      timestampSec: currentSlideStartSec,
      durationSec: finalDuration,
      title: currentTitle,
      pHash: prevHash ? hashToHexString(prevHash) : '0000000000000000',
      thumbnailDataUrl: generateSlideThumbnailSvg(lastPage, currentTitle, currentSlideStartSec),
      ocrKeywords: currentOcrWords,
    })
  }

  return slides
}
