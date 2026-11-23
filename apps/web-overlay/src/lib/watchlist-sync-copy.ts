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
  /** U-460：服务端确认应用的 ops 数（缺失时回退 pushed，老调用方仍能用） */
  applied?: number
  /** U-460：被另一台设备的更新版本覆盖、LWW 跳过的 ops 数 */
  skipped?: number
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
    // U-460：成功数按 applied 说，不许拿 pushed（提交数）冒充「已合并」。
    // 老调用方没传 applied 时回退 pushed，文案与以前一致。
    const pushed = input.pushed ?? 0
    const applied = typeof input.applied === 'number' ? input.applied : pushed
    const skipped = input.skipped ?? 0
    // 被跳过的改动必须说出来：用户要知道「有改动没上去、本机还留着」，
    // 而不是看到一句「已合并」以为万事大吉。
    if (skipped > 0) {
      const text =
        applied > 0
          ? `已把本机 ${applied} 条追剧更新合并到云端；另有 ${skipped} 条被另一台设备的更新版本覆盖，本机改动已保留，再改一次即可重试同步`
          : `本次提交的 ${pushed} 条追剧更新都被另一台设备的更新版本覆盖，未合并到云端；本机改动已保留，再改一次即可重试同步`
      const removed =
        input.remoteRemoved && input.remoteRemoved > 0
          ? `；另一台设备移除了 ${input.remoteRemoved} 部剧，已与云端保持一致`
          : ''
      return { tone: 'success', text: text + removed }
    }
    if (input.remoteRemoved && input.remoteRemoved > 0) {
      return { tone: 'success', text: `另一台设备移除了 ${input.remoteRemoved} 部剧，已与云端保持一致` }
    }
    return {
      tone: 'success',
      text:
        applied > 0
          ? `已把本机 ${applied} 条追剧更新合并到云端`
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
