/**
 * 视频知识库混合全文与分词倒排索引引擎 (Video Search & Index Engine)
 * 
 * 核心技术：
 * 1. CJK 双字切分（Bigram）与英文词干规范化；
 * 2. 常见技术简称同义词扩展（如 k8s <-> kubernetes, ts <-> typescript）；
 * 3. 字段加权 BM25 评分：Title(3.5x) > Author(2.5x) > Category(1.5x) > Description(1.0x)；
 * 4. 融合质量分（QualityScore）与时效分（FreshnessScore）动态重排；
 * 5. 多维属性过滤器（平台、时长区间、分类过滤、排序规则）。
 */

import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'

export interface VideoIndexDocument {
  id: string
  categoryId: string
  categoryTitle: string
  subCategoryId?: string
  subCategoryTitle?: string
  item: NavigationSubItem
  title: string
  description: string
  author: string
  platform: string
  durationSec: number
  qualityScore: number
  freshnessScore: number
  pinned: boolean
  tokens: Map<string, number> // token -> term frequency (TF)
  docLength: number
}

export interface VideoSearchIndex {
  documents: Map<string, VideoIndexDocument>
  invertedIndex: Map<string, Set<string>> // token -> Set<docId>
  avgDocLength: number
  totalDocs: number
}

export interface VideoSearchResult {
  item: NavigationSubItem
  category: NavigationItem
  subCategory?: { id: string; title: string }
  score: number
  relevanceScore: number
  qualityScore: number
  freshnessScore: number
  highlightField: 'title' | 'author' | 'description'
  highlightSnippet: string
}

export interface VideoSearchFilterOptions {
  platform?: 'bilibili' | 'youtube' | 'all'
  minDurationSec?: number
  maxDurationSec?: number
  categoryId?: string
  sortBy?: 'relevance' | 'freshness' | 'quality' | 'views' | 'duration'
}

// 常见技术简称同义词典
const SYNONYM_MAP: Record<string, string[]> = {
  k8s: ['kubernetes'],
  kubernetes: ['k8s'],
  docker: ['容器', 'container'],
  ts: ['typescript'],
  typescript: ['ts'],
  js: ['javascript'],
  javascript: ['js'],
  ai: ['大模型', 'llm', '人工智能'],
  llm: ['ai', '大模型', 'claude', 'gpt'],
  mcp: ['model context protocol'],
  cursor: ['ai代码', '编程'],
  react: ['next.js', 'nextjs'],
  nextjs: ['next.js', 'react'],
  vue: ['vue3', 'vite']
}

/**
 * 分词工具：提取 CJK 字符双元组以及单词
 */
export function tokenizeText(text: string): string[] {
  if (!text) return []
  const normalized = text.toLowerCase()
  const tokens = new Set<string>()

  // 1. 提取英数单词 (如 cursor, next.js, k8s, bv123)
  const words = normalized.match(/[a-z0-9_.-]+/g) || []
  for (const w of words) {
    if (w.length >= 2) {
      tokens.add(w)
      // 同义词注入
      const synonyms = SYNONYM_MAP[w]
      if (synonyms) {
        synonyms.forEach(syn => tokens.add(syn))
      }
    }
  }

  // 2. 提取 CJK 字符与双字组合（Bigram）
  const cjkChars = normalized.match(/[\u4e00-\u9fa5]/g) || []
  for (let i = 0; i < cjkChars.length; i++) {
    const single = cjkChars[i]
    if (single) tokens.add(single)
    if (i < cjkChars.length - 1) {
      tokens.add(`${single}${cjkChars[i + 1]}`)
    }
  }

  return Array.from(tokens)
}

/**
 * 构建全量内存倒排索引
 */
export function buildVideoSearchIndex(navigationData: NavigationData): VideoSearchIndex {
  const documents = new Map<string, VideoIndexDocument>()
  const invertedIndex = new Map<string, Set<string>>()
  let totalLength = 0

  const processItem = (
    item: NavigationSubItem,
    category: NavigationItem,
    subCategory?: { id: string; title: string }
  ) => {
    if (item.enabled === false) return

    const title = item.title || ''
    const description = item.description || ''
    const author = item.videoConfig?.author || ''
    const platform = item.videoConfig?.type || 'unknown'
    const durationSec = item.videoConfig?.durationSec || 0
    const qualityScore = item.videoConfig?.qualityScore ?? 75
    const freshnessScore = item.videoConfig?.freshnessScore ?? 75
    const pinned = Boolean(item.videoConfig?.pinned)

    // 分词及各字段词频加权统计
    const tokens = new Map<string, number>()
    const titleTokens = tokenizeText(title)
    const authorTokens = tokenizeText(author)
    const descTokens = tokenizeText(description)
    const catTokens = tokenizeText(category.title)

    titleTokens.forEach(t => tokens.set(t, (tokens.get(t) || 0) + 3.5))
    authorTokens.forEach(t => tokens.set(t, (tokens.get(t) || 0) + 2.5))
    catTokens.forEach(t => tokens.set(t, (tokens.get(t) || 0) + 1.5))
    descTokens.forEach(t => tokens.set(t, (tokens.get(t) || 0) + 1.0))

    let docLength = 0
    tokens.forEach(val => (docLength += val))
    totalLength += docLength

    const doc: VideoIndexDocument = {
      id: item.id,
      categoryId: category.id,
      categoryTitle: category.title,
      subCategoryId: subCategory?.id,
      subCategoryTitle: subCategory?.title,
      item,
      title,
      description,
      author,
      platform,
      durationSec,
      qualityScore,
      freshnessScore,
      pinned,
      tokens,
      docLength
    }

    documents.set(item.id, doc)

    // 建立倒排索引
    tokens.forEach((_, token) => {
      let docSet = invertedIndex.get(token)
      if (!docSet) {
        docSet = new Set<string>()
        invertedIndex.set(token, docSet)
      }
      docSet.add(item.id)
    })
  }

  for (const category of navigationData.navigationItems || []) {
    if (category.enabled === false) continue
    for (const item of category.items || []) {
      processItem(item, category)
    }
    for (const sub of category.subCategories || []) {
      if (sub.enabled === false) continue
      for (const item of sub.items || []) {
        processItem(item, category, { id: sub.id, title: sub.title })
      }
    }
  }

  const totalDocs = documents.size
  const avgDocLength = totalDocs > 0 ? totalLength / totalDocs : 1

  return {
    documents,
    invertedIndex,
    avgDocLength,
    totalDocs
  }
}

/**
 * 执行混合 BM25 + 质量与时效权重的视频搜索
 */
export function searchVideoIndex(
  index: VideoSearchIndex,
  query: string,
  categories: NavigationItem[],
  options: VideoSearchFilterOptions = {}
): VideoSearchResult[] {
  const trimmed = query.trim()
  const searchTokens = tokenizeText(trimmed)

  const categoryMap = new Map<string, NavigationItem>()
  categories.forEach(c => categoryMap.set(c.id, c))

  // 1. 如果没有搜索词，返回按过滤和排序规则的全部视频
  if (searchTokens.length === 0) {
    const list: VideoSearchResult[] = []
    index.documents.forEach(doc => {
      if (!passesFilter(doc, options)) return
      const category = categoryMap.get(doc.categoryId)
      if (!category) return

      list.push({
        item: doc.item,
        category,
        subCategory: doc.subCategoryId ? { id: doc.subCategoryId, title: doc.subCategoryTitle || '' } : undefined,
        score: (doc.qualityScore + doc.freshnessScore) / 2,
        relevanceScore: 0,
        qualityScore: doc.qualityScore,
        freshnessScore: doc.freshnessScore,
        highlightField: 'title',
        highlightSnippet: doc.title
      })
    })

    return sortResults(list, options.sortBy || 'relevance')
  }

  // 2. BM25 检索评分 (k1 = 1.2, b = 0.75)
  const k1 = 1.2
  const b = 0.75
  const candidateScores = new Map<string, number>()

  for (const qToken of searchTokens) {
    const matchedDocIds = index.invertedIndex.get(qToken)
    if (!matchedDocIds || matchedDocIds.size === 0) continue

    // 逆文档频率 IDF 计算
    const n = matchedDocIds.size
    const idf = Math.log(1 + (index.totalDocs - n + 0.5) / (n + 0.5))

    matchedDocIds.forEach(docId => {
      const doc = index.documents.get(docId)
      if (!doc) return
      if (!passesFilter(doc, options)) return

      const tf = doc.tokens.get(qToken) || 0
      const numerator = tf * (k1 + 1)
      const denominator = tf + k1 * (1 - b + b * (doc.docLength / index.avgDocLength))
      const bm25TermScore = idf * (numerator / denominator)

      candidateScores.set(docId, (candidateScores.get(docId) || 0) + bm25TermScore)
    })
  }

  const results: VideoSearchResult[] = []

  candidateScores.forEach((relevanceScore, docId) => {
    const doc = index.documents.get(docId)
    if (!doc) return
    const category = categoryMap.get(doc.categoryId)
    if (!category) return

    // 综合加权：BM25 基础分 × (0.5 + 0.3*质量分比 + 0.2*新鲜度比) × 置顶系数
    const qualityFactor = 0.5 + 0.3 * (doc.qualityScore / 100) + 0.2 * (doc.freshnessScore / 100)
    const pinnedBonus = doc.pinned ? 1.25 : 1.0
    const finalScore = relevanceScore * qualityFactor * pinnedBonus

    // 高亮字段探测
    let highlightField: 'title' | 'author' | 'description' = 'title'
    let highlightSnippet = doc.title

    const lowerQuery = trimmed.toLowerCase()
    if (doc.title.toLowerCase().includes(lowerQuery)) {
      highlightField = 'title'
      highlightSnippet = doc.title
    } else if (doc.author.toLowerCase().includes(lowerQuery)) {
      highlightField = 'author'
      highlightSnippet = `UP主: ${doc.author}`
    } else if (doc.description.toLowerCase().includes(lowerQuery)) {
      highlightField = 'description'
      highlightSnippet = doc.description
    }

    results.push({
      item: doc.item,
      category,
      subCategory: doc.subCategoryId ? { id: doc.subCategoryId, title: doc.subCategoryTitle || '' } : undefined,
      score: finalScore,
      relevanceScore,
      qualityScore: doc.qualityScore,
      freshnessScore: doc.freshnessScore,
      highlightField,
      highlightSnippet
    })
  })

  return sortResults(results, options.sortBy || 'relevance')
}

function passesFilter(doc: VideoIndexDocument, options: VideoSearchFilterOptions): boolean {
  if (options.platform && options.platform !== 'all') {
    if (doc.platform !== options.platform) return false
  }
  if (options.categoryId) {
    if (doc.categoryId !== options.categoryId) return false
  }
  if (options.minDurationSec !== undefined && options.minDurationSec > 0) {
    if (doc.durationSec < options.minDurationSec) return false
  }
  if (options.maxDurationSec !== undefined && options.maxDurationSec > 0) {
    if (doc.durationSec > options.maxDurationSec) return false
  }
  return true
}

function sortResults(
  results: VideoSearchResult[],
  sortBy: 'relevance' | 'freshness' | 'quality' | 'views' | 'duration'
): VideoSearchResult[] {
  return [...results].sort((a, b) => {
    switch (sortBy) {
      case 'freshness':
        return b.freshnessScore - a.freshnessScore
      case 'quality':
        return b.qualityScore - a.qualityScore
      case 'duration':
        return (b.item.videoConfig?.durationSec || 0) - (a.item.videoConfig?.durationSec || 0)
      case 'views':
        return (b.item.videoConfig?.stats?.views || 0) - (a.item.videoConfig?.stats?.views || 0)
      case 'relevance':
      default:
        return b.score - a.score
    }
  })
}
