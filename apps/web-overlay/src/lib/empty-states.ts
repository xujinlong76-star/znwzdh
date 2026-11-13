/**
 * 空态文案与判定（研究 P0 #5：空态 + 首次引导）。
 *
 * 每一个空态都回答三个问题，各 1–2 句，有且只有一个主行动：
 *   - What：这里本该有什么；
 *   - Why：为什么现在是空的（不是用户的操作失误）；
 *   - Next：下一步做什么（主行动的文案就是它）。
 *
 * 提示（tip）只出现在「需要的那一刻」——也就是空态本身里面，不做
 * 遮罩式 tour、不新增引导卡片：首访引导已有 OnboardingCard 管，
 * 这里只讲当下这个空面能用的下一步。
 *
 * 热榜「种子 vs 解释」的决定：解释，不造假种子。
 *   1. 造假榜单条目违反本站的诚实口径（/brief 页头明言「不拿空榜单
 *      冒充内容」；empty-vs-failure-honesty 钉住「失败 ≠ 空」；
 *      formatHotValue 宁可返回 null 也不编造数值）；
 *   2. 中枢没有手动刷新入口，唯一刷新是 apps/api 里的 hourly
 *      hotlist_refresh 定时任务——web 层没有合法途径给缓存「种」真数据；
 *   3. 真实可用的「种子」已经存在：/hot 站内热度榜永不空白
 *      （未重算时按 visit_count 兜底），所以热榜空态的 Next 就是
 *      把用户带到 /hot，而不是在原地摆一排假条目。
 * 因此 hotlistEmptyVariant 只区分「还没抓过」与「抓过但失败且无缓存」，
 * 两种都是解释 + 一个去 /hot 的真实出口；中枢不可达（hotlist 为 null）
 * 是失败不是空，走现有的降级壳，绝不渲染空态。
 *
 * 共享说明：W2 的搜索零结果页与这里共用同一套约定——标题/解释/行动
 * 走 components/ui/empty-state，文案若要复用就从本模块取，不要各写一份。
 */

export interface EmptyStateCopy {
  /** What：这里本该有什么 */
  title: string
  /** Why：为什么现在是空的（1–2 句） */
  why: string
  /** Next：下一步做什么（主行动的文案就是它） */
  next: string
  /** 唯一主行动的文案 */
  actionLabel: string
  /** 主行动去向（站内路径）；回调型行动（如 DIY 恢复默认）留空 */
  actionHref: string
  /** 需要时刻的提示：只讲当下这一步能用的事，可空 */
  tip?: string
}

/** 收藏真空态：一个收藏都没有（不是筛出来的空，筛空另有分支） */
export const FAVORITES_EMPTY_COPY: EmptyStateCopy = {
  title: '还没有收藏任何站点',
  why: '收藏先存在本机，不用登录；在主页站点卡片或搜索结果里点一下星标就能攒下来。',
  next: '去主页星标第一个站点。',
  actionLabel: '去主页探索发现',
  actionHref: '/',
  tip: '已有浏览器书签？点右上角「导入书签/MD」可以一键搬过来，不用一个个重建。',
}

/** DIY 工作台真空态：看板上一个模块都没有 */
export const DIY_EMPTY_COPY: EmptyStateCopy = {
  title: '当前工作台为空',
  why: '这个看板还没有任何模块——刚开始用都是空的；布局只存在本机，改完会自动保存。',
  next: '一键恢复默认布局，马上就能用；也可以自己挑模块慢慢搭。',
  actionLabel: '恢复默认布局',
  actionHref: '',
}

/** 热榜全空的两种成因：从没抓过 vs 抓过但失败且无缓存 */
export type HotlistEmptyVariant = 'never-fetched' | 'fetch-failed'

export interface HotlistEmptySourceInput {
  status: 'ok' | 'stale' | 'empty'
  items: readonly unknown[]
}

export interface HotlistEmptyInput {
  sources: readonly HotlistEmptySourceInput[]
}

/**
 * 判定全网热榜是否处于「全空」态。
 *
 * 返回 null = 不是空态：中枢不可达（null，是失败）、或任一源已有条目。
 * 全空时再分两种成因——全是 empty（从没抓过）才是首访空白；只要有
 * 一个源不是 empty，说明抓取跑过但失败且无缓存可顶，是失败不是「没数据」。
 */
export function hotlistEmptyVariant(
  hotlist: HotlistEmptyInput | null,
): HotlistEmptyVariant | null {
  if (!hotlist) return null
  if (hotlist.sources.length === 0) return 'never-fetched'
  if (hotlist.sources.some((s) => s.items.length > 0)) return null
  return hotlist.sources.every((s) => s.status === 'empty') ? 'never-fetched' : 'fetch-failed'
}

/** 热榜全空态的 What/Why/Next 文案（两种成因各一套，失败不说成「没数据」） */
export function hotlistAllEmptyCopy(variant: HotlistEmptyVariant): EmptyStateCopy {
  if (variant === 'fetch-failed') {
    return {
      title: '全网热榜这次没能取回数据',
      why: '各平台抓取都失败了，而且之前没有成功的缓存可以顶上，所以这里是空的——不是本站没有热榜。',
      next: '先看站内热度榜，稍后再回来看看。',
      actionLabel: '先看站内热度榜',
      actionHref: '/hot',
    }
  }
  return {
    title: '全网热榜还在等第一次抓取',
    why: '热榜每小时从各平台抓一次；这台站刚部署，第一轮抓取还没跑过，所以这里暂时是空的——不是坏了，也不是你操作错了。',
    next: '站内热度榜一直有内容，先去那里看看；过一会儿再回来，全网热榜就有了。',
    actionLabel: '先看站内热度榜',
    actionHref: '/hot',
  }
}

/** 单个热榜源的空体：为什么空 + 去源站看实时热搜的出口 */
export function hotlistSourceEmptyCopy(source: {
  status: 'ok' | 'stale' | 'empty'
  name: string
}): { why: string; actionLabel: string } {
  return {
    why:
      source.status === 'empty'
        ? '首次抓取按小时跑，跑完这里就有内容了。'
        : source.status === 'stale'
          ? '这次没抓到，也没有旧缓存可显示。'
          : '这个源暂时没有条目。',
    actionLabel: `去${source.name}看实时热搜`,
  }
}
