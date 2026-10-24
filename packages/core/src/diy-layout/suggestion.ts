/**
 * 关键词重合度分类推荐（**纯启发式，不是 AI**）Fuzzy Category Auto-Classifier。
 *
 * 判据只有「分类名 / 分词是否出现在标题+描述+URL 里」，没有模型。所以 confidence
 * 的口径是重合度得分，天花板 0.85：曾经用 Math.min(0.99, ...) 配合界面上的
 * 「AI 推荐分类（99% 匹配）」，把字符串包含判断包装成模型置信度。
 * 与 apps/web-overlay/src/lib/modular/diy-presets.ts 的同名实现保持同口径。
 */

export interface CategorySuggestion {
  categoryId: string
  categoryTitle: string
  /** 关键词重合度得分（0.3~0.85），不是概率 */
  confidence: number
  matchReason: string
  /** 判定来源：目前是纯关键词启发式，未来接真模型时这里会是 'llm' */
  method: 'keyword'
}

/** 启发式得分的天花板：字符串包含判断永远不该自称 100% */
const KEYWORD_SCORE_CEILING = 0.85

/**
 * 依据站点标题、URL 和描述，智能推荐最贴切的归属分类
 */
export function suggestCategoryForSite<TCat extends { id: string; title: string }>(
  site: { title: string; href?: string; description?: string },
  categories: TCat[]
): CategorySuggestion | null {
  if (!categories || categories.length === 0 || !site.title) return null

  const targetText = `${site.title} ${site.description || ''} ${site.href || ''}`.toLowerCase()

  let bestCat: TCat | null = null
  let maxScore = 0
  let reason = ''

  for (const cat of categories) {
    let score = 0
    const catTitle = cat.title.toLowerCase()

    // 1. 分类名称直接包含检测 (最高权重)
    if (targetText.includes(catTitle)) {
      score += 0.85
      reason = `站点信息直接包含分类名「${cat.title}」`
    } else {
      // 2. 词素交集与中文连词智能切分
      const catKeywords = catTitle
        .split(/[\s/、,，与和及&·+—_-]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)

      let hits = 0
      const matchedWords: string[] = []
      for (const kw of catKeywords) {
        if (targetText.includes(kw)) {
          hits++
          matchedWords.push(kw)
        }
      }
      if (hits > 0 && catKeywords.length > 0) {
        score += 0.35 + (hits / catKeywords.length) * 0.4
        reason = `命中分类关键词「${matchedWords.join(' / ')}」`
      }
    }

    if (score > maxScore) {
      maxScore = score
      bestCat = cat
    }
  }

  if (bestCat && maxScore >= 0.3) {
    return {
      categoryId: bestCat.id,
      categoryTitle: bestCat.title,
      confidence: Number(Math.min(KEYWORD_SCORE_CEILING, maxScore).toFixed(2)),
      matchReason: reason,
      method: 'keyword',
    }
  }

  return null
}
