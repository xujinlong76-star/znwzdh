import { getFileContent, commitFile } from '@/lib/github'
import type {
  NavigationData,
  NavigationItem,
  NavigationSubItem,
  VideoConfig,
  VideoHarvestPolicy,
  VideoReplacementRecord,
  VideoStats
} from '@/types/navigation'

const VIDEOS_FILE_PATH = 'src/navsphere/content/videos.json'

export interface ResolvedVideoInfo {
  title: string
  href: string
  description?: string
  icon?: string
  videoConfig: VideoConfig
}

/**
 * 智能解析单一视频 URL（支持 Bilibili 与 YouTube）
 */
export async function resolveVideoUrl(rawUrl: string): Promise<ResolvedVideoInfo> {
  const url = rawUrl.trim()
  if (!url) {
    throw new Error('视频链接不能为空')
  }

  // 1. 尝试匹配 Bilibili
  const bvidMatch = url.match(/BV[a-zA-Z0-9]{10}/i)
  const avidMatch = url.match(/\/av(\d+)/i)

  if (bvidMatch || avidMatch) {
    const bvid = bvidMatch ? bvidMatch[0] : undefined
    const aid = avidMatch ? avidMatch[1] : undefined
    const queryParam = bvid ? `bvid=${bvid}` : `aid=${aid}`

    try {
      const res = await fetch(`https://api.bilibili.com/x/web-interface/view?${queryParam}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com'
        },
        signal: AbortSignal.timeout(8000)
      })

      if (res.ok) {
        const json = await res.json()
        if (json.code === 0 && json.data) {
          const d = json.data
          const stats: VideoStats = {
            views: d.stat?.view || 0,
            likes: d.stat?.like || 0,
            coins: d.stat?.coin || 0,
            favorites: d.stat?.favorite || 0,
            danmaku: d.stat?.danmaku || 0
          }

          const durationSec = d.duration || 0
          const pubDate = d.pubdate ? new Date(d.pubdate * 1000).toISOString() : new Date().toISOString()
          const qualityScore = calculateQualityScore(stats, durationSec, d.pubdate)
          const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90)

          // 规范化封面地址，确保使用 https 并去除可能的 http 前缀
          let coverUrl = d.pic || ''
          if (coverUrl.startsWith('http://')) {
            coverUrl = coverUrl.replace('http://', 'https://')
          } else if (coverUrl.startsWith('//')) {
            coverUrl = `https:${coverUrl}`
          }

          const resolvedBvid = d.bvid || bvid
          const resolvedAid = d.aid ? String(d.aid) : aid
          const resolvedCid = d.cid ? String(d.cid) : undefined

          return {
            title: d.title || '哔哩哔哩视频',
            href: `https://www.bilibili.com/video/${resolvedBvid}`,
            description: d.desc || '',
            icon: coverUrl,
            videoConfig: {
              type: 'bilibili',
              bvid: resolvedBvid,
              aid: resolvedAid,
              cid: resolvedCid,
              p: 1,
              author: d.owner?.name || '',
              authorUrl: d.owner?.mid ? `https://space.bilibili.com/${d.owner.mid}` : undefined,
              durationSec,
              publishedAt: pubDate,
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore,
              sourceType: 'manual',
              pinned: true,
              healthStatus: 'healthy',
              stats
            }
          }
        }
      }
    } catch (err) {
      console.warn('[video-harvester] Bilibili API fetch failed, fallback to basic config:', err)
    }

    // 基础兜底解析
    return {
      title: `哔哩哔哩视频 ${bvid || aid}`,
      href: url,
      description: '',
      videoConfig: {
        type: 'bilibili',
        bvid: bvid || undefined,
        aid: aid || undefined,
        p: 1,
        harvestedAt: Date.now(),
        sourceType: 'manual',
        pinned: true,
        healthStatus: 'healthy'
      }
    }
  }

  // 2. 尝试匹配 YouTube
  const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i)
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1]

    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
        signal: AbortSignal.timeout(6000)
      })

      if (oembedRes.ok) {
        const data = await oembedRes.json()
        return {
          title: data.title || 'YouTube Video',
          href: `https://www.youtube.com/watch?v=${videoId}`,
          description: '',
          icon: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          videoConfig: {
            type: 'youtube',
            videoId,
            author: data.author_name || '',
            authorUrl: data.author_url || '',
            harvestedAt: Date.now(),
            lastVerifiedAt: Date.now(),
            qualityScore: 85,
            freshnessScore: 85,
            sourceType: 'manual',
            pinned: true,
            healthStatus: 'healthy'
          }
        }
      }
    } catch (err) {
      console.warn('[video-harvester] YouTube oEmbed failed, fallback to default:', err)
    }

    return {
      title: `YouTube Video (${videoId})`,
      href: `https://www.youtube.com/watch?v=${videoId}`,
      icon: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      videoConfig: {
        type: 'youtube',
        videoId,
        harvestedAt: Date.now(),
        sourceType: 'manual',
        pinned: true,
        healthStatus: 'healthy'
      }
    }
  }

  throw new Error('未能识别该视频平台的 URL（目前支持 Bilibili 与 YouTube）')
}

/**
 * 综合质量分计算模型 (0 - 100)
 */
export function calculateQualityScore(
  stats?: VideoStats,
  durationSec?: number,
  pubdateUnix?: number
): number {
  if (!stats) return 70

  const views = stats.views || 0
  const likes = stats.likes || 0
  const coins = stats.coins || 0
  const favorites = stats.favorites || 0

  // 1. 播放量级对数评分 (0 - 30)
  // 1万播放约18分，10万播放约24分，100万播放约30分
  const viewsScore = Math.min(30, Math.log10(Math.max(10, views)) * 5)

  // 2. 互动转化率与干货比 (0 - 40)
  // 技术教程最重要的指标是「收藏/播放比」与「投币/点赞比」
  const favRate = views > 0 ? favorites / views : 0
  const likeRate = views > 0 ? likes / views : 0
  const coinToLikeRate = likes > 0 ? coins / likes : 0

  // 收藏率达到 5% 为高质教程满分(20)，投币点赞比达到 30% 满分(20)
  const favScore = Math.min(20, (favRate / 0.05) * 20)
  const coinScore = Math.min(20, (coinToLikeRate / 0.3) * 20)

  // 3. 时长契合度 (0 - 20)
  // 5分钟 - 45分钟为黄金深度教程区间；短于2分钟扣分
  let durationScore = 15
  if (durationSec) {
    if (durationSec < 120) durationScore = 5
    else if (durationSec >= 300 && durationSec <= 2700) durationScore = 20
    else if (durationSec > 2700 && durationSec <= 7200) durationScore = 16
    else durationScore = 12
  }

  // 4. 基础底分 (10)
  const baseScore = 10

  const total = Math.round(viewsScore + favScore + coinScore + durationScore + baseScore)
  return Math.max(20, Math.min(99, total))
}

/**
 * 计算视频当前的保鲜评分 (0 - 100)
 */
export function calculateFreshnessScore(
  publishedAt?: string | number,
  qualityScore: number = 75,
  halfLifeDays: number = 90,
  title?: string
): number {
  if (!publishedAt) return Math.round(qualityScore * 0.8)

  const pubTime = typeof publishedAt === 'number'
    ? (publishedAt < 1e11 ? publishedAt * 1000 : publishedAt)
    : new Date(publishedAt).getTime()

  if (isNaN(pubTime)) return qualityScore

  const now = Date.now()
  const ageDays = Math.max(0, (now - pubTime) / (1000 * 3600 * 24))

  // 半衰期指数衰减
  const decayFactor = Math.pow(0.5, ageDays / Math.max(15, halfLifeDays))

  // 语义年份老化检查：如果标题带有旧年份（如 2021, 2022, 2023），给予额外折旧惩罚
  let yearPenalty = 1.0
  if (title) {
    const currentYear = new Date().getFullYear()
    for (let y = 2018; y < currentYear - 1; y++) {
      if (title.includes(String(y))) {
        yearPenalty = 0.8
        break
      }
    }
  }

  const effective = Math.round(qualityScore * decayFactor * yearPenalty)
  return Math.max(5, Math.min(100, effective))
}

/**
 * 模拟并调用多源公开视频采集通道（根据主题关键词搜索高质量稿件）
 */
export async function harvestVideosForTopic(
  keywords: string[],
  options: {
    platforms?: ('bilibili' | 'youtube')[]
    minDurationSec?: number
    minQualityScore?: number
    limitPerKeyword?: number
  } = {}
): Promise<NavigationSubItem[]> {
  const {
    platforms = ['bilibili'],
    minDurationSec = 180,
    minQualityScore = 60,
    limitPerKeyword = 3
  } = options

  const results: NavigationSubItem[] = []
  const seenIds = new Set<string>()

  for (const kw of keywords) {
    if (!kw.trim()) continue

    if (platforms.includes('bilibili')) {
      try {
        // 请求 B 站综合排序搜索接口
        const searchUrl = `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=${encodeURIComponent(kw.trim())}&order=totalrank&duration=0`
        const res = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.bilibili.com'
          },
          signal: AbortSignal.timeout(6000)
        })

        if (res.ok) {
          const json = await res.json()
          const items = json?.data?.result || []

          for (const item of items.slice(0, limitPerKeyword * 2)) {
            const bvid = item.bvid
            if (!bvid || seenIds.has(bvid)) continue

            // 过滤时长
            const durationSec = parseDurationToSeconds(item.duration)
            if (minDurationSec && durationSec > 0 && durationSec < minDurationSec) continue

            // 过滤标题 html 标签
            const cleanTitle = (item.title || '').replace(/<[^>]+>/g, '').trim()
            const cleanDesc = (item.description || '').replace(/<[^>]+>/g, '').trim()

            const stats: VideoStats = {
              views: item.play || 0,
              likes: item.like || 0,
              danmaku: item.video_review || 0,
              favorites: item.favorites || 0
            }

            const qualityScore = calculateQualityScore(stats, durationSec, item.pubdate)
            if (qualityScore < minQualityScore) continue

            const pubDate = item.pubdate ? new Date(item.pubdate * 1000).toISOString() : new Date().toISOString()
            const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90, cleanTitle)

            let cover = item.pic || ''
            if (cover.startsWith('//')) cover = `https:${cover}`
            if (cover.startsWith('http://')) cover = cover.replace('http://', 'https://')

            seenIds.add(bvid)
            results.push({
              id: `harvest_${bvid}_${Date.now()}`,
              title: cleanTitle,
              href: `https://www.bilibili.com/video/${bvid}`,
              description: cleanDesc,
              icon: cover,
              enabled: true,
              videoConfig: {
                type: 'bilibili',
                bvid,
                aid: item.aid ? String(item.aid) : undefined,
                author: item.author || '',
                durationSec,
                publishedAt: pubDate,
                harvestedAt: Date.now(),
                lastVerifiedAt: Date.now(),
                qualityScore,
                freshnessScore,
                sourceType: 'auto_trend',
                trendKeyword: kw,
                pinned: false,
                healthStatus: 'healthy',
                stats
              }
            })

            if (results.length >= limitPerKeyword * keywords.length) break
          }
        }
      } catch (err) {
        console.warn(`[video-harvester] Search failed for keyword "${kw}":`, err)
      }
    }
  }

  return results
}

function parseDurationToSeconds(durationStr?: string): number {
  if (!durationStr) return 0
  if (typeof durationStr === 'number') return durationStr
  const parts = durationStr.split(':').map(Number)
  if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
    return parts[0]! * 60 + parts[1]!
  }
  if (parts.length === 3 && !isNaN(parts[0]!) && !isNaN(parts[1]!) && !isNaN(parts[2]!)) {
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  }
  return 0
}

export interface VideoHarvestReport {
  timestamp: number
  totalCheckedCategories: number
  totalHarvestedCount: number
  totalAddedCount: number
  totalReplacedCount: number
  additions: Array<{ categoryTitle: string; item: NavigationSubItem }>
  replacements: VideoReplacementRecord[]
  categorySummaries: Array<{
    categoryId: string
    categoryTitle: string
    policyEnabled: boolean
    currentCount: number
    maxCapacity: number
    averageFreshness: number
    addedCount: number
    replacedCount: number
  }>
}

/**
 * 核心：执行自动化热点采集与过时内容平滑轮换
 */
export async function runVideoHarvestAndRotation(options: {
  dryRun?: boolean
  categoryId?: string
  forceKeywords?: string[]
  accessToken?: string
} = {}): Promise<VideoHarvestReport> {
  const { dryRun = false, categoryId, forceKeywords, accessToken } = options

  const data = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
  const categories = data.navigationItems || []
  const replacementHistory: VideoReplacementRecord[] = data.replacementHistory || []

  // 收集历史已存在的所有 video externalId（用于全局去重）
  const existingExternalIds = new Set<string>()
  for (const cat of categories) {
    for (const item of cat.items || []) {
      const vid = item.videoConfig?.bvid || item.videoConfig?.videoId
      if (vid) existingExternalIds.add(vid)
    }
    for (const sub of cat.subCategories || []) {
      for (const item of sub.items || []) {
        const vid = item.videoConfig?.bvid || item.videoConfig?.videoId
        if (vid) existingExternalIds.add(vid)
      }
    }
  }

  const additions: Array<{ categoryTitle: string; item: NavigationSubItem }> = []
  const newReplacements: VideoReplacementRecord[] = []
  const categorySummaries: VideoHarvestReport['categorySummaries'] = []

  let totalHarvested = 0

  for (const cat of categories) {
    if (categoryId && cat.id !== categoryId) continue

    const policy: VideoHarvestPolicy = cat.harvestPolicy || {
      enabled: false,
      keywords: [],
      maxItems: 12,
      minQualityScore: 60,
      minDurationSec: 180,
      freshnessHalfLifeDays: 90,
      autoReplaceOutdated: true
    }

    const currentItems = cat.items || []

    // 重新计算并刷新分类内所有项目的保鲜分
    for (const item of currentItems) {
      if (item.videoConfig) {
        item.videoConfig.freshnessScore = calculateFreshnessScore(
          item.videoConfig.publishedAt,
          item.videoConfig.qualityScore || 75,
          policy.freshnessHalfLifeDays || 90,
          item.title
        )
      }
    }

    const avgFreshness = currentItems.length > 0
      ? Math.round(currentItems.reduce((acc, it) => acc + (it.videoConfig?.freshnessScore || 70), 0) / currentItems.length)
      : 100

    const summary = {
      categoryId: cat.id,
      categoryTitle: cat.title,
      policyEnabled: Boolean(policy.enabled),
      currentCount: currentItems.length,
      maxCapacity: policy.maxItems || 12,
      averageFreshness: avgFreshness,
      addedCount: 0,
      replacedCount: 0
    }

    if (!policy.enabled && !forceKeywords?.length) {
      categorySummaries.push(summary)
      continue
    }

    const queryKeywords = forceKeywords && forceKeywords.length > 0
      ? forceKeywords
      : policy.keywords || [cat.title]

    if (queryKeywords.length === 0) {
      categorySummaries.push(summary)
      continue
    }

    // 针对该分类执行检索采集
    const harvestedCandidates = await harvestVideosForTopic(queryKeywords, {
      platforms: policy.platforms || ['bilibili'],
      minDurationSec: policy.minDurationSec || 180,
      minQualityScore: policy.minQualityScore || 60,
      limitPerKeyword: 2
    })

    totalHarvested += harvestedCandidates.length

    // 过滤掉已存在的项目
    const uniqueCandidates = harvestedCandidates.filter(c => {
      const vid = c.videoConfig?.bvid || c.videoConfig?.videoId
      if (!vid || existingExternalIds.has(vid)) return false
      return true
    })

    for (const candidate of uniqueCandidates) {
      const maxItems = policy.maxItems || 12
      const candidateScore = candidate.videoConfig?.freshnessScore || 80
      const vid = candidate.videoConfig?.bvid || candidate.videoConfig?.videoId

      // 1. 若分类未满，直接增加
      if (currentItems.length < maxItems) {
        currentItems.push(candidate)
        if (vid) existingExternalIds.add(vid)
        additions.push({ categoryTitle: cat.title, item: candidate })
        summary.addedCount++
        continue
      }

      // 2. 若分类已满且开启自动替换，寻找最应当淘汰的非锁定旧条目
      if (policy.autoReplaceOutdated) {
        // 找出所有未被锁定的旧项目
        const replaceableItemsWithIndex = currentItems
          .map((item, index) => ({ item, index }))
          .filter(e => !e.item.videoConfig?.pinned)

        if (replaceableItemsWithIndex.length === 0) continue

        // 寻找有效分最低的项
        replaceableItemsWithIndex.sort((a, b) => {
          const scoreA = a.item.videoConfig?.freshnessScore ?? 60
          const scoreB = b.item.videoConfig?.freshnessScore ?? 60
          return scoreA - scoreB
        })

        const worst = replaceableItemsWithIndex[0]
        if (!worst) continue

        const worstScore = worst.item.videoConfig?.freshnessScore ?? 60

        // 替换门槛：新视频分数必须明显高于旧视频（防抖门槛 +12分）或者旧视频已严重过时（< 45分）
        if (candidateScore >= worstScore + 12 || worstScore < 45) {
          const replacedOldItem = { ...worst.item }

          // 执行平滑替换
          currentItems[worst.index] = candidate
          if (vid) existingExternalIds.add(vid)

          const rec: VideoReplacementRecord = {
            id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            categoryId: cat.id,
            categoryTitle: cat.title,
            oldItem: replacedOldItem,
            newItem: candidate,
            reason: worstScore < 45 ? 'freshness_decay' : 'hot_superseded',
            scoreDiff: candidateScore - worstScore,
            trendKeyword: candidate.videoConfig?.trendKeyword
          }

          newReplacements.push(rec)
          summary.replacedCount++
        }
      }
    }

    cat.items = currentItems
    categorySummaries.push(summary)
  }

  // 若不是 Dry-Run，将更新结果和审计记录落盘
  if (!dryRun && (additions.length > 0 || newReplacements.length > 0)) {
    data.replacementHistory = [...newReplacements, ...replacementHistory].slice(0, 100)
    await commitFile(
      VIDEOS_FILE_PATH,
      JSON.stringify(data, null, 2),
      `Auto harvest & rotation: +${additions.length} new, ~${newReplacements.length} replaced`,
      accessToken
    )
  }

  return {
    timestamp: Date.now(),
    totalCheckedCategories: categories.length,
    totalHarvestedCount: totalHarvested,
    totalAddedCount: additions.length,
    totalReplacedCount: newReplacements.length,
    additions,
    replacements: newReplacements,
    categorySummaries
  }
}

/**
 * 撤销单条自动替换记录：将旧视频恢复原位并加锁
 */
export async function rollbackReplacement(
  recordId: string,
  accessToken?: string
): Promise<{ success: boolean; message: string }> {
  const data = (await getFileContent(VIDEOS_FILE_PATH)) as NavigationData
  const record = data.replacementHistory?.find(r => r.id === recordId)

  if (!record) {
    throw new Error('未找到该替换记录')
  }

  if (record.rolledBack) {
    return { success: true, message: '该记录此前已回滚' }
  }

  const cat = data.navigationItems.find(c => c.id === record.categoryId)
  if (!cat) {
    throw new Error(`目标分类 "${record.categoryTitle}" 不存在`)
  }

  // 恢复旧视频并置为锁定状态
  const restoredItem: NavigationSubItem = {
    ...record.oldItem,
    videoConfig: {
      ...record.oldItem.videoConfig,
      type: record.oldItem.videoConfig?.type || 'bilibili',
      pinned: true
    }
  }

  // 找到新视频在分类中的位置并替换回旧视频，否则直接 push
  const newVideoId = record.newItem.videoConfig?.bvid || record.newItem.id
  const idx = (cat.items || []).findIndex(it => (it.videoConfig?.bvid || it.id) === newVideoId)

  if (idx !== -1 && cat.items) {
    cat.items[idx] = restoredItem
  } else {
    cat.items = [...(cat.items || []), restoredItem]
  }

  record.rolledBack = true

  await commitFile(
    VIDEOS_FILE_PATH,
    JSON.stringify(data, null, 2),
    `Rollback replacement: restored "${restoredItem.title}"`,
    accessToken
  )

  return { success: true, message: `已成功还原视频 "${restoredItem.title}" 并已自动设为防替换锁定` }
}
