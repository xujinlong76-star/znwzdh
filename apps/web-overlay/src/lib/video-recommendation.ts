import type { NavigationSubItem } from '@/types/navigation'
import { getPlaybackHistory } from '@/lib/video-playback-storage'
import { getUserPlaylists } from '@/lib/user-playlists'

const TECH_KEYWORDS = [
  'k8s', 'kubernetes', 'docker', 'container', 'ci/cd', 'devops',
  'react', 'nextjs', 'vue', 'nuxt', 'typescript', 'javascript',
  'rust', 'golang', 'python', 'java', 'spring', 'linux',
  'ai', 'llm', 'rag', 'agent', 'gemini', 'openai', 'deepseek',
  'mysql', 'postgres', 'redis', 'kafka', 'grpc', 'graphql',
  'microservices', 'architecture', 'serverless', 'cloud', 'aws', 'gcp'
]

/**
 * Extracts normalized tokens and tech keywords from text.
 */
export function extractTechKeywords(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const found = new Set<string>()

  for (const kw of TECH_KEYWORDS) {
    if (normalized.includes(kw)) {
      found.add(kw)
    }
  }

  // Also include alphanumeric word tokens >= 3 chars
  const words = normalized.match(/[a-z0-9_+#.-]{3,}/g)
  if (words) {
    for (const w of words) {
      if (w.length <= 15) {
        found.add(w)
      }
    }
  }

  return found
}

/**
 * Computes Jaccard Similarity between two sets: |A ∩ B| / |A ∪ B|.
 */
export function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0
  let intersectionCount = 0
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionCount++
    }
  }
  const unionCount = new Set([...setA, ...setB]).size
  return unionCount === 0 ? 0 : intersectionCount / unionCount
}

/**
 * Builds user's interest profile based on watch history and user playlists.
 */
export function buildUserProfile(): {
  preferredTags: Map<string, number>
  preferredAuthors: Map<string, number>
  preferredKeywords: Set<string>
} {
  const preferredTags = new Map<string, number>()
  const preferredAuthors = new Map<string, number>()
  const preferredKeywords = new Set<string>()

  // 1. Ingest watch history
  const history = getPlaybackHistory()
  for (const record of history) {
    if (record.author) {
      preferredAuthors.set(record.author, (preferredAuthors.get(record.author) || 0) + 1.5)
    }
    const kws = extractTechKeywords(record.title)
    for (const kw of kws) {
      preferredKeywords.add(kw)
      preferredTags.set(kw, (preferredTags.get(kw) || 0) + 1.0)
    }
  }

  // 2. Ingest playlists (Watch Later & favorites)
  const playlists = getUserPlaylists()
  for (const pl of playlists) {
    for (const item of pl.items) {
      if (item.videoConfig?.author) {
        preferredAuthors.set(
          item.videoConfig.author,
          (preferredAuthors.get(item.videoConfig.author) || 0) + 2.0
        )
      }
      if (Array.isArray(item.tags)) {
        for (const t of item.tags) {
          const lower = t.toLowerCase()
          preferredTags.set(lower, (preferredTags.get(lower) || 0) + 2.0)
          preferredKeywords.add(lower)
        }
      }
      const kws = extractTechKeywords(`${item.title} ${item.description || ''}`)
      for (const kw of kws) {
        preferredKeywords.add(kw)
      }
    }
  }

  return { preferredTags, preferredAuthors, preferredKeywords }
}

/**
 * Scores a video item based on personalized behavioral match, quality score, and freshness.
 */
export function scoreVideoItem(
  item: NavigationSubItem,
  userProfile: ReturnType<typeof buildUserProfile>,
  targetKeywords?: Set<string>
): number {
  let score = 0

  const itemKeywords = extractTechKeywords(`${item.title} ${item.description || ''}`)
  if (Array.isArray(item.tags)) {
    for (const t of item.tags) {
      itemKeywords.add(t.toLowerCase())
    }
  }

  // 1. Content similarity (if comparing with a target video)
  if (targetKeywords && targetKeywords.size > 0) {
    const similarity = computeJaccardSimilarity(targetKeywords, itemKeywords)
    score += similarity * 40
  }

  // 2. User behavioral interest match
  if (userProfile.preferredKeywords.size > 0) {
    const interestMatch = computeJaccardSimilarity(userProfile.preferredKeywords, itemKeywords)
    score += interestMatch * 35
  }

  // Author loyalty bonus
  const author = item.videoConfig?.author
  if (author && userProfile.preferredAuthors.has(author)) {
    score += Math.min(15, (userProfile.preferredAuthors.get(author) || 0) * 5)
  }

  // 3. Quality & Freshness boosts
  const quality = item.videoConfig?.qualityScore || 80
  score += (quality / 100) * 15

  const freshness = item.videoConfig?.freshnessScore || 50
  score += (freshness / 100) * 10

  // 4. Pinned bonus
  if (item.videoConfig?.pinned) {
    score += 5
  }

  return score
}

/**
 * Generates personalized recommendations for user ("猜你想学").
 */
export function getPersonalizedRecommendations(params: {
  pool: NavigationSubItem[]
  currentVideoId?: string
  limit?: number
}): NavigationSubItem[] {
  const { pool, currentVideoId, limit = 8 } = params
  if (!pool || pool.length === 0) return []

  const userProfile = buildUserProfile()
  const candidates = pool.filter(item => item.id !== currentVideoId && item.videoConfig)

  const scored = candidates.map(item => ({
    item,
    score: scoreVideoItem(item, userProfile),
  }))

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map(s => s.item)
}

/**
 * Generates related videos based on a specific current video.
 */
export function getRelatedVideos(
  currentVideo: NavigationSubItem,
  pool: NavigationSubItem[],
  limit: number = 6
): NavigationSubItem[] {
  if (!pool || pool.length === 0) return []

  const userProfile = buildUserProfile()
  const targetKeywords = extractTechKeywords(`${currentVideo.title} ${currentVideo.description || ''}`)
  if (Array.isArray(currentVideo.tags)) {
    for (const t of currentVideo.tags) {
      targetKeywords.add(t.toLowerCase())
    }
  }

  const candidates = pool.filter(item => item.id !== currentVideo.id && item.videoConfig)

  const scored = candidates.map(item => ({
    item,
    score: scoreVideoItem(item, userProfile, targetKeywords),
  }))

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map(s => s.item)
}
