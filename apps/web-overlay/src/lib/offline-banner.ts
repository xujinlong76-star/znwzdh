/**
 * 网络状态提示的文案与可见性判定（纯函数，可单测）。
 *
 * 背景（真实缺陷，两处）：
 *  1. `components/offline-banner.tsx` 早就写好了，但**从未被挂载** ——
 *     用户离线时页面只会静默降级（现在至少会显示「无法连接中枢」），
 *     却没有任何地方告诉他「是你的网络断了，不是站点没数据」；
 *  2. 它的文案在编造能力：「已启用本地离岸存储与缓存，您的私密收藏与端侧工具
 *     100% 可用」「已自动恢复云端同步与实时检索」—— 离线时搜索、榜单、
 *     收藏云端同步恰恰都不可用；而重连后也**没有**任何自动同步（云端同步只在
 *     打开收藏页时触发）。说了做不到，比不说更伤信任。
 *
 * 这里把「什么时候显示、显示什么」收敛成一个纯函数：组件只负责渲染。
 */

export type NetworkTone = 'offline' | 'restored'

export interface OfflineBannerState {
  /** 是否需要显示（在线且不在「刚恢复」提示期内 → 不显示） */
  visible: boolean
  tone: NetworkTone
  title: string
  /** 一句实话：现在什么不可用 / 现在可以做什么 */
  hint: string
}

export function describeOfflineBanner(online: boolean, justReconnected: boolean): OfflineBannerState {
  if (online && !justReconnected) {
    return { visible: false, tone: 'restored', title: '', hint: '' }
  }

  if (!online) {
    return {
      visible: true,
      tone: 'offline',
      title: '当前处于离线状态',
      hint: '已加载的内容仍可浏览；搜索、榜单、收藏云端同步等需要中枢的功能暂不可用，联网后重试即可。',
    }
  }

  return {
    visible: true,
    tone: 'restored',
    title: '网络已恢复连接',
    hint: '需要中枢的功能现在可以正常重试了。',
  }
}

/** 「刚恢复」提示停留时长（毫秒）：够看见，不碍事 */
export const RECONNECTED_NOTICE_MS = 3500
