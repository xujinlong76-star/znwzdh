/**
 * 追剧清单同步状态条的文案决策：与收藏的 favorites-sync-copy 同构，
 * 但名词换成追剧清单自己的（清单里装的是在追的剧，不是站点）。
 * 纯函数化是为了让「失败一定带原因」「墓碑删除一定告知」能被测试钉住。
 */

export type WatchSyncTone = 'syncing' | 'success' | 'error' | 'hidden'

export interface WatchSyncBannerInput {
  syncing?: boolean
  ok?: boolean
  pushed?: number
  remoteRemoved?: number
  error?: string
  retryable?: boolean
}

export interface WatchSyncBanner {
  tone: WatchSyncTone
  text: string
}

export function describeWatchlistSyncBanner(input: WatchSyncBannerInput | null): WatchSyncBanner {
  if (!input) return { tone: 'hidden', text: '' }
  if (input.syncing) return { tone: 'syncing', text: '正在与云端同步追剧清单…' }

  if (input.ok) {
    if (input.remoteRemoved && input.remoteRemoved > 0) {
      return { tone: 'success', text: `另一台设备移除了 ${input.remoteRemoved} 部剧，已与云端保持一致` }
    }
    return {
      tone: 'success',
      text:
        input.pushed && input.pushed > 0
          ? `已把本机 ${input.pushed} 条追剧更新合并到云端`
          : '云端同步正常',
    }
  }

  const reason = input.error?.trim()
  return {
    tone: 'error',
    text: reason
      ? `云端同步失败：${reason}。追剧清单已保存在本机浏览器，换设备登录可能看不到。`
      : '云端同步失败：原因未知。追剧清单已保存在本机浏览器，换设备登录可能看不到。',
  }
}

export function shouldOfferWatchlistRetry(input: WatchSyncBannerInput | null): boolean {
  return Boolean(input && !input.syncing && input.ok === false && input.retryable === true)
}

/** 未登录提示（沿用 B15 收藏页的诚实口径）：只存本机 / 怎么丢 / 登录能同步，三件实事 */
export function describeAnonymousWatchlistNote(): string {
  return '未登录：追剧清单只保存在这台设备的浏览器里，清除浏览器数据或换设备会丢失。登录后可同步到云端，换设备也能接着追。'
}
