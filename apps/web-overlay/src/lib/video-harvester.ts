import { getFileContent, commitFile, readStorageFresh, getStorageVersion } from '@/lib/github'
import { appendReplacementHistory } from './video-library-store'
import { videoExternalKey } from '@/lib/video-identity'
import { recordHarvestRun } from '@/lib/video-harvest-metrics'
import { BILI_HEADERS, getWbiMixinKey, signWbiQuery } from '@/lib/bilibili-wbi'
import type {
  NavigationData,
  NavigationItem,
  NavigationSubItem,
  VideoConfig,
  VideoHarvestPolicy,
  VideoReplacementRecord,
  VideoStats
} from '@/types/navigation'

import { calculateQualityScore, calculateFreshnessScore, parseDurationToSeconds } from './video-scoring'
// 保持既有 import 路径可用（众多组件按 '@/lib/video-harvester' 取这两个函数）
export { calculateQualityScore, calculateFreshnessScore, parseDurationToSeconds } from './video-scoring'

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
 * 调用公开视频搜索通道（按主题关键词检索高质量稿件）。
 *
 * 相对历史实现修了三处：
 *   1. **串行 → 有界并发**：原来 `for (const kw of keywords)` 逐个 await，每词 6s 超时，
 *      5 个关键词最坏 30s+，叠加分类循环必然撞上函数超时；现在并发 3 + 25s 总预算。
 *   2. **超额采集**：原来的 `if (results.length >= limitPerKeyword * keywords.length) break`
 *      只跳出内层循环，外层继续，实际条数会超过上限。改为每关键词独立计数。
 *   3. **失败不可见**：原来 `catch { console.warn }` 后返回空数组，任务仍报成功；
 *      现在把失败原因写进 `failures`，报告能区分「没采到」与「接口被风控」。
 *
 * 注：B 站 `wbi/search/type` 需要 `w_rid`/`wts` 签名，缺失时接口返回 -352/-412。
 * 这类响应现在会被记为失败原因，而不是伪装成「没有结果」。
 */
export async function harvestVideosForTopic(
  keywords: string[],
  options: {
    platforms?: ('bilibili' | 'youtube')[]
    minDurationSec?: number
    minQualityScore?: number
    limitPerKeyword?: number
    /** 本次采集的总时间预算（毫秒） */
    totalBudgetMs?: number
    /** 同时在飞的请求数上限 */
    concurrency?: number
    /** 出参：失败/跳过的关键词及原因 */
    failures?: Array<{ keyword: string; reason: string }>
  } = {}
): Promise<NavigationSubItem[]> {
  const {
    platforms = ['bilibili'],
    minDurationSec = 180,
    minQualityScore = 60,
    limitPerKeyword = 3,
    totalBudgetMs = 25_000,
    concurrency = 3,
    failures,
  } = options

  const results: NavigationSubItem[] = []
  const seenIds = new Set<string>()
  const pending = keywords.map(k => k.trim()).filter(Boolean)
  const deadline = Date.now() + totalBudgetMs

  /**
   * wbi 签名密钥只取一次（并发关键词共用；`getWbiMixinKey` 内部有缓存 + 并发去重）。
   *
   * 拿不到时不要静默降级 —— 无签名请求会被风控挡下并返回空结果，那看起来和
   * 「没有好稿件」一模一样。这里显式记一条 degraded。
   */
  const mixinKey = platforms.includes('bilibili') ? await getWbiMixinKey() : null
  if (platforms.includes('bilibili') && !mixinKey) {
    failures?.push({
      keyword: '(全局)',
      reason: '未能取得 B 站 wbi 签名密钥（/x/web-interface/nav 不可达或结构变化），本次搜索降级为无签名请求，多半会被风控挡下',
    })
  }

  const harvestOne = async (kw: string): Promise<void> => {
    if (!platforms.includes('bilibili')) return
    if (Date.now() > deadline) {
      failures?.push({ keyword: kw, reason: '超出本次采集时间预算，未执行' })
      return
    }

    try {
      // 请求 B 站综合排序搜索接口（必须带 wbi 签名，否则风控返回 -352/-412 或空结果）
      const baseParams = {
        search_type: 'video',
        keyword: kw,
        order: 'totalrank',
        duration: 0,
      }
      const query = mixinKey
        ? signWbiQuery(baseParams, mixinKey, Math.floor(Date.now() / 1000)).query
        : new URLSearchParams(
            Object.entries(baseParams).map(([k, v]) => [k, String(v)]),
          ).toString()
      const searchUrl = `https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`

      const res = await fetch(searchUrl, {
        headers: { ...BILI_HEADERS },
        signal: AbortSignal.timeout(6000)
      })

      if (!res.ok) {
        failures?.push({ keyword: kw, reason: `B 站搜索返回 HTTP ${res.status}` })
        return
      }

      const json = await res.json()
      // code !== 0 是风控/签名问题，不是「没有结果」
      if (json?.code !== 0) {
        failures?.push({
          keyword: kw,
          reason: `B 站接口 code=${json?.code}${json?.message ? ' ' + json.message : ''}（多为 wbi 签名缺失或被风控）`
        })
        return
      }

      const items = json?.data?.result || []
      let taken = 0

      for (const item of items) {
        if (taken >= limitPerKeyword) break

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

        // 没有 pubdate 就**不写** publishedAt：原来兜底成 now 会把老视频标成今天发布
        const pubDate = item.pubdate ? new Date(item.pubdate * 1000).toISOString() : undefined
        const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90, cleanTitle)

        let cover = item.pic || ''
        if (cover.startsWith('//')) cover = `https:${cover}`
        if (cover.startsWith('http://')) cover = cover.replace('http://', 'https://')

        seenIds.add(bvid)
        taken++
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
            ...(pubDate ? { publishedAt: pubDate } : {}),
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
      }

      if (taken === 0) {
        failures?.push({ keyword: kw, reason: '接口有响应，但没有满足时长/质量阈值的稿件' })
      }
    } catch (err) {
      failures?.push({
        keyword: kw,
        reason: err instanceof Error ? err.message : '请求异常'
      })
    }
  }

  // js 单线程事件循环下，`pending.shift()` 与 `seenIds` 的检查-写入之间没有 await，
  // 因此不需要额外加锁。
  const workerCount = Math.max(1, Math.min(concurrency, pending.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (pending.length > 0) {
      const kw = pending.shift()
      if (!kw) break
      await harvestOne(kw)
    }
  })
  await Promise.all(workers)

  return results
}


export interface VideoHarvestReport {
  timestamp: number
  /** 本次是否为试运行（未写库）。通知/简报要如实标注，不能一律说「已应用」。 */
  dryRun: boolean
  totalCheckedCategories: number
  totalHarvestedCount: number
  totalAddedCount: number
  totalReplacedCount: number
  additions: Array<{ categoryTitle: string; item: NavigationSubItem }>
  replacements: VideoReplacementRecord[]
  /**
   * 本次采集失败/跳过的关键词。
   *
   * 为什么需要：历史实现把「接口被风控」和「真的没有好稿件」都吞成空数组，
   * 报告只显示「+0」，运营无法判断是内容饱和还是采集坏了。
   */
  degradedKeywords: Array<{ keyword: string; reason: string }>
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
export interface HarvestRunOptions {
  dryRun?: boolean
  categoryId?: string
  forceKeywords?: string[]
  accessToken?: string
}

/** 冲突重试上限：每次重试都会重新读库、重新计算，代价是又一轮搜索请求。 */
const HARVEST_CONFLICT_RETRIES = 3

/**
 * 替换审计最多保留多少条。
 *
 * 为什么必须有上限：每条记录内嵌完整的 `oldItem` / `newItem`（含章节树与逐句字幕），
 * 单条实测 6–10KB。整包文档参与**每一次读取**，留几千条会让视频库变成数 MB 的 JSON。
 * 100 条约数百 KB，按每天数次轮换算可覆盖一两个月。
 *
 * 为什么丢弃时必须告警：原实现是裸的 `slice(0, 100)`，**超出的记录静默消失** ——
 * 运营想回滚两周前的替换时才发现记录没了，而日志里没有任何痕迹。
 *
 * 完整的替换历史在关系库的 `video_replacements` 表里（C6，`dual` / `db` 模式会同步），
 * 所以「永久丢失」只在纯 `json` 模式下成立。
 */
const REPLACEMENT_HISTORY_LIMIT = 100

function capReplacementHistory(records: VideoReplacementRecord[]): VideoReplacementRecord[] {
  if (records.length <= REPLACEMENT_HISTORY_LIMIT) return records
  const dropped = records.length - REPLACEMENT_HISTORY_LIMIT
  console.warn(
    `[video-harvester] 替换历史超过 ${REPLACEMENT_HISTORY_LIMIT} 条，丢弃最旧的 ${dropped} 条` +
      `（完整历史见 video_replacements 表；纯 json 模式下这部分不可恢复）`,
  )
  return records.slice(0, REPLACEMENT_HISTORY_LIMIT)
}

function isVersionConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as { status?: number }).status === 409
  )
}

/**
 * 执行采集与轮换；遇版本冲突时**整体重放**（重读 → 重算 → 重写）。
 *
 * 为什么必须整体重放而不是「重试写入」：写的是整包快照，重试同一个快照只会
 * 再次冲突，或把对方刚写入的条目抹掉。重读后重新计算才能把两边的变更合并。
 */
export async function runVideoHarvestAndRotation(
  options: HarvestRunOptions = {},
  attempt: number = 1,
): Promise<VideoHarvestReport> {
  try {
    return await runVideoHarvestOnce(options)
  } catch (err) {
    if (isVersionConflict(err) && attempt < HARVEST_CONFLICT_RETRIES) {
      console.warn(
        `[video-harvester] 写入版本冲突，第 ${attempt} 次重放（重新读取后再合并）`
      )
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
      return runVideoHarvestAndRotation(options, attempt + 1)
    }
    // 只在「最终失败」时计一次：重试中的失败不该让失败率虚高
    recordHarvestRun({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

async function runVideoHarvestOnce(options: HarvestRunOptions = {}): Promise<VideoHarvestReport> {
  const { dryRun = false, categoryId, forceKeywords, accessToken } = options

  /**
   * 必须用「绕过一切缓存」的读链路拿基准数据。
   *
   * `getFileContent` 有 2.5s 进程内缓存 + Next Data Cache（默认 60s）。
   * 若版本号来自实时查询、而数据来自 60s 前的缓存，两者会错配：
   * 写回时把这一分钟内的他人变更整包覆盖掉，且版本校验还会通过（版本号是新的）。
   */
  const [freshData, version] = await Promise.all([
    readStorageFresh<NavigationData>(VIDEOS_FILE_PATH),
    getStorageVersion(VIDEOS_FILE_PATH),
  ])
  const data = (freshData ?? (await getFileContent(VIDEOS_FILE_PATH))) as NavigationData
  const categories = data.navigationItems || []
  const replacementHistory: VideoReplacementRecord[] = data.replacementHistory || []

  // 收集历史已存在的视频（用于全局去重）。
  // 键必须是 `platform:externalId`：只比 bvid/videoId 会让不同平台的同名 ID 互相判重。
  const existingExternalIds = new Set<string>()
  for (const cat of categories) {
    for (const item of cat.items || []) {
      const key = videoExternalKey(item.videoConfig)
      if (key) existingExternalIds.add(key)
    }
    for (const sub of cat.subCategories || []) {
      for (const item of sub.items || []) {
        const key = videoExternalKey(item.videoConfig)
        if (key) existingExternalIds.add(key)
      }
    }
  }

  const additions: Array<{ categoryTitle: string; item: NavigationSubItem }> = []
  const newReplacements: VideoReplacementRecord[] = []
  const categorySummaries: VideoHarvestReport['categorySummaries'] = []
  const degradedKeywords: Array<{ keyword: string; reason: string }> = []

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
      limitPerKeyword: 2,
      // 失败原因汇总进报告，不再只打 console.warn
      failures: degradedKeywords,
    })

    totalHarvested += harvestedCandidates.length

    // 过滤掉已存在的项目
    const uniqueCandidates = harvestedCandidates.filter(c => {
      const key = videoExternalKey(c.videoConfig)
      if (!key || existingExternalIds.has(key)) return false
      return true
    })

    for (const candidate of uniqueCandidates) {
      const maxItems = policy.maxItems || 12
      const candidateScore = candidate.videoConfig?.freshnessScore || 80
      const candidateKey = videoExternalKey(candidate.videoConfig)

      // 1. 若分类未满，直接增加
      if (currentItems.length < maxItems) {
        currentItems.push(candidate)
        if (candidateKey) existingExternalIds.add(candidateKey)
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
          if (candidateKey) existingExternalIds.add(candidateKey)

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
    data.replacementHistory = capReplacementHistory([...newReplacements, ...replacementHistory])
    await commitFile(
      VIDEOS_FILE_PATH,
      JSON.stringify(data, null, 2),
      `Auto harvest & rotation: +${additions.length} new, ~${newReplacements.length} replaced`,
      accessToken,
      3,
      // 版本号来自实时查询；null 表示该后端不支持版本校验（github/sqlite）
      version ?? undefined
    )

    // 内联历史有容量上限（capReplacementHistory），独立文件是**不截断**的权威副本：
    // 回滚记录不会因为超过上限而永久丢失。失败不影响主流程（主数据已落盘）。
    try {
      await appendReplacementHistory(newReplacements, { token: accessToken })
    } catch (error) {
      console.warn('[video-harvester] 写入独立替换历史失败，回滚记录仅保留在内联上限内', error)
    }
  }

  recordHarvestRun({
    ok: true,
    added: additions.length,
    replaced: newReplacements.length,
    degradedKeywords: degradedKeywords.length,
  })

  return {
    timestamp: Date.now(),
    dryRun,
    totalCheckedCategories: categories.length,
    totalHarvestedCount: totalHarvested,
    totalAddedCount: additions.length,
    totalReplacedCount: newReplacements.length,
    additions,
    replacements: newReplacements,
    categorySummaries,
    degradedKeywords
  }
}

/**
 * 撤销单条自动替换记录：将旧视频恢复原位并加锁
 */
export async function rollbackReplacement(
  recordId: string,
  accessToken?: string
): Promise<{ success: boolean; message: string }> {
  // 回滚同样是整包覆盖写：基准必须实时读，并带版本号，否则会把
  // 「打开历史弹窗之后」发生的采集结果整批抹掉。
  const [freshRollback, rollbackVersion] = await Promise.all([
    readStorageFresh<NavigationData>(VIDEOS_FILE_PATH),
    getStorageVersion(VIDEOS_FILE_PATH),
  ])
  const data = (freshRollback ?? (await getFileContent(VIDEOS_FILE_PATH))) as NavigationData
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
    accessToken,
    3,
    rollbackVersion ?? undefined
  )

  return { success: true, message: `已成功还原视频 "${restoredItem.title}" 并已自动设为防替换锁定` }
}
