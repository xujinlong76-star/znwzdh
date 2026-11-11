import { SITE_DESCRIPTION_MAX } from './site-description'

/**
 * 场景落地页的 title/description 合成（SEO_PLAN §二「场景包」行）。
 *
 * 关键词落法：任务型长尾 =「{场景}的网站」+「流程」，如「做 PPT 的网站流程」、
 * 「做短剧流程」——用户真实搜法就是把一件事拆成先后步骤找配套网站。
 *
 * 红线与 site-description.ts 同一条：数字只用接口按真实召回算出的计数，
 * 站点名只用真实召回的前几名；不编评分、排名，不写「最好/第一/必备」。
 */

/** 步骤标题去掉「第X步：」前缀，做流程预览（如「找模板与灵感 → 做稿件」） */
export function sceneStepHead(label: string): string {
  return (label ?? '').replace(/^第[一二三四五六七八九十\d]+步[:：]\s*/, '').trim()
}

export function sceneMetaTitle(title: string): string {
  const t = (title ?? '').trim()
  if (!t) return '场景包全流程'
  if (/(大全|导航|流程)$/.test(t)) return t
  return `${t}的网站与全流程`
}

export interface SceneMetaInput {
  title: string
  /** 服务端编辑文案（SCENE_PACKS.description），本身即真实说明，优先保留 */
  description: string
  stepCount: number
  siteCount: number
  stepLabels: string[]
  topSiteTitles?: string[]
}

/**
 * 详情页 description：编辑文案打头，后面拼真实事实——共几步、流程骨架、
 * 本次真实召回到的网站数与代表站点。召回为 0 时不写数量（不拿 0 冒充规模，
 * 也不编造数字），只保留文案与流程骨架。
 */
export function sceneMetaDescription(input: SceneMetaInput): string {
  const base = (input.description ?? '').trim()
  const heads = (input.stepLabels ?? []).map(sceneStepHead).filter(Boolean).slice(0, 4)
  const tops = (input.topSiteTitles ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3)

  const facts: string[] = []
  if (input.stepCount > 0) {
    facts.push(`全程共 ${input.stepCount} 步${heads.length > 0 ? `：${heads.join(' → ')}` : ''}`)
  }
  if (input.siteCount > 0) {
    facts.push(`每步都给能直接打开的网站（共 ${input.siteCount} 个${tops.length > 0 ? `，含 ${tops.join('、')}` : ''}）`)
  }
  const factText = facts.join('；')
  if (!factText) return base.slice(0, SITE_DESCRIPTION_MAX)
  const sep = base && !/[。！？.!?]$/.test(base) ? '。' : ''
  return `${base}${sep}${factText}。`.slice(0, SITE_DESCRIPTION_MAX)
}

/** 索引页 description：总数与覆盖站点数全部来自列表接口的真实汇总 */
export function scenesIndexDescription(input: {
  sceneCount: number
  totalSites: number
  sceneTitles: string[]
}): string {
  const titles = (input.sceneTitles ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6)
  let text = `共 ${input.sceneCount} 个场景包`
  if (titles.length > 0) text += `：${titles.join('、')}等`
  text += '。每个场景都按先后顺序拆成几步，每步给出能直接打开的网站，照着走就能把一件事办完'
  if (input.totalSites > 0) text += `；全部场景合计覆盖 ${input.totalSites} 个真实收录的网站`
  return `${text}。`.slice(0, SITE_DESCRIPTION_MAX)
}
