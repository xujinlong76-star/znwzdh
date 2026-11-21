/**
 * 云端同步状态条的文案决策（P1 抽出的可测逻辑）。
 *
 * 为什么值得单独一个文件：这条状态条是收藏页唯一向用户解释「数据同步成功了没有」
 * 的地方，而它原来是一段三层嵌套三元表达式——「同步中 / 成功推了 N 条 / 成功但没推 /
 * 失败带原因 / 另一台设备删了 N 条」五种说法挤在 JSX 里，改一句就要通读整段，
 * 也没有任何测试能证明「失败时一定带原因」「墓碑删除一定告知」。
 *
 * 纯函数化之后：输入同步结果，输出语气与文案。测试直接断言五种分支。
 */
export type SyncTone = 'syncing' | 'success' | 'error' | 'hidden'

export interface SyncBannerInput {
  /** 是否正在同步。可选：调用方常常直接传同步结果（它本身没有 syncing 字段） */
  syncing?: boolean
  ok?: boolean
  pushed?: number
  /** U-371：服务端确认应用的 ops 数（缺失时回退 pushed，老调用方仍能用） */
  applied?: number
  /** U-371：被另一台设备的更新版本覆盖、LWW 跳过的 ops 数 */
  skipped?: number
  /** 服务端截断超长备注的条数 */
  truncatedNotes?: number
  cloudCount?: number | null
  remoteRemoved?: number
  error?: string
  /** 失败是否值得重试（5xx / 超时 / 登录过期）；404 之类按了也没用 */
  retryable?: boolean
}

export interface SyncBanner {
  tone: SyncTone
  text: string
}

/** 同步状态条的最终文案：未知输入一律 hidden（没有信息就不占位） */
export function describeSyncBanner(input: SyncBannerInput | null): SyncBanner {
  if (!input) return { tone: 'hidden', text: '' }
  if (input.syncing) return { tone: 'syncing', text: '正在与云端同步收藏…' }

  if (input.ok) {
    const cloud = typeof input.cloudCount === 'number' ? `（云端共 ${input.cloudCount} 条）` : ''
    // U-371：成功数按 applied 说，不许拿 pushed（提交数）冒充「已合并」。
    // 老调用方没传 applied 时回退 pushed，文案与以前一致。
    const pushed = input.pushed ?? 0
    const applied = typeof input.applied === 'number' ? input.applied : pushed
    const skipped = input.skipped ?? 0
    // 被跳过的改动必须说出来：用户要知道「有改动没上去、本机还留着」，
    // 而不是看到一句「已合并」以为万事大吉。
    if (skipped > 0) {
      const text =
        applied > 0
          ? `已把本机 ${applied} 条收藏合并到云端${cloud}；另有 ${skipped} 条被另一台设备的更新版本覆盖，本机改动已保留，再改一次即可重试同步`
          : `本次提交的 ${pushed} 条收藏改动都被另一台设备的更新版本覆盖，未合并到云端；本机改动已保留，再改一次即可重试同步`
      const removed =
        input.remoteRemoved && input.remoteRemoved > 0
          ? `；另一台设备删除了 ${input.remoteRemoved} 条收藏，已与云端保持一致`
          : ''
      return { tone: 'success', text: text + removed }
    }
    // 墓碑提示优先级高于普通成功文案：用户需要知道「有东西被另一台设备删了」
    if (input.remoteRemoved && input.remoteRemoved > 0) {
      return { tone: 'success', text: `另一台设备删除了 ${input.remoteRemoved} 条收藏，已与云端保持一致` }
    }
    let text =
      applied > 0
        ? `已把本机 ${applied} 条收藏合并到云端${cloud}`
        : `云端同步正常${cloud}`
    if (input.truncatedNotes && input.truncatedNotes > 0) {
      text += `；其中 ${input.truncatedNotes} 条备注过长，已按 200 字截断保存`
    }
    return { tone: 'success', text }
  }

  // 失败必须带原因、说清后果：只说"已保存在本机"会让用户以为改动已经安全了，
  // 实际上它还没上云端、换设备就看不到——必须点明「未同步」与「重试」。
  const reason = input.error?.trim()
  return {
    tone: 'error',
    text: reason
      ? `云端同步失败：${reason}。本次改动未同步到云端，只保存在本机浏览器；请检查网络后重试同步，换设备登录可能看不到未同步的改动。`
      : '云端同步失败：原因未知。本次改动未同步到云端，只保存在本机浏览器；请稍后重试同步。',
  }
}

/**
 * 是否值得给用户一个「重试」按钮。
 *
 * 只有「失败 + 可重试」才给：404 之类的原因重试一次还是失败，给按钮等于
 * 让用户反复确认同一件坏事。登录过期要单独文案（重试前得先重新登录）。
 */
export function shouldOfferRetry(input: SyncBannerInput | null): boolean {
  return Boolean(input && !input.syncing && input.ok === false && input.retryable === true)
}

/**
 * B15：匿名收藏只活在本机——文案决策。
 *
 * 匿名用户从不触发云端同步，于是 `describeSyncBanner(null)` 恒为 hidden：
 * 收藏页没有任何地方告诉他「收藏只保存在这台设备的浏览器里，清除浏览器
 * 数据或换设备会丢」。「本地收藏 N 条」徽章只报数量，不报风险——攒了几十条
 * 才发现清缓存就全没了，是最伤留存的静默丢失。
 *
 * 文案只说三件实事（只存本机 / 怎么丢 / 登录能找回），不承诺做不到的事；
 * 登录入口由调用方渲染（带 callbackUrl 回收藏页），不塞进纯函数。
 */
export function describeAnonymousFavoritesNote(): string {
  return '未登录：收藏只保存在这台设备的浏览器里，清除浏览器数据或换设备会丢失。登录后可同步到云端，随时找回。'
}
