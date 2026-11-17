/**
 * 插件批量更新与更新提醒（P2-4 第一步）。
 *
 * 只做第一步：已安装页「全部更新」+ 通知中心提醒。自动更新不要做——
 * 本站是声明式内容包，自动更新的安全含义与浏览器扩展不同，
 * 默认开/关策略待裁决（见汇报），本文件不留任何自动更新开关。
 *
 * 本文件是纯函数，不碰网络、不碰 window、不碰服务端通知：
 * - 批量更新逐个走已有单插件升级链路（installPlugin + 主题/搜索包
 *   运行时重应用），由调用方传入 upgradeOne；
 * - 通知提醒是客户端派生：打开通知中心时按已安装清单现算，
 *   不写服务端通知表、不动未读角标（角标仍只计服务端通知）。
 */
import { comparePluginVersions } from './plugin-manifest'

/** 批量更新 / 提醒只需要这四个字段，调用方传完整条目也行。 */
export interface PluginVersionRef {
  slug: string
  name: string
  version: string
  installedVersion: string
}

/**
 * 与已安装页 hasUpdate 同口径：市场版本严格高于已装版本才算可更新。
 * 服务端回滚或预发布版本不会被误标（不用字符串不等判断版本）。
 */
export function hasPluginUpdate(item: {
  version: string | null | undefined
  installedVersion: string | null | undefined
}): boolean {
  return Boolean(
    item.version &&
      item.installedVersion &&
      comparePluginVersions(item.version, item.installedVersion) > 0,
  )
}

/** 从已安装清单里挑出全部可更新项（保持原顺序，即置顶顺序）。 */
export function getUpdatablePlugins<T extends PluginVersionRef>(items: readonly T[]): T[] {
  return items.filter(hasPluginUpdate)
}

export interface PluginUpdateReminder {
  kind: 'plugin-update'
  /** 去已安装页一键更新的入口（通知页「去全部更新」按钮用它）。 */
  link: '/marketplace/installed'
  count: number
  names: string[]
  title: string
  body: string
}

/**
 * 通知中心提醒文案：无可更新项返回 null（调用方不渲染提醒）。
 * 正文最多列 3 个插件名 + 版本，其余只计个数，不把长清单全铺出来。
 */
export function buildPluginUpdateReminder<T extends PluginVersionRef>(
  items: readonly T[],
): PluginUpdateReminder | null {
  const updatable = getUpdatablePlugins(items)
  if (updatable.length === 0) return null
  const shown = updatable.slice(0, 3)
  const detail = shown.map((p) => `「${p.name}」v${p.installedVersion} → v${p.version}`).join('、')
  const rest = updatable.length > shown.length ? `等 ${updatable.length} 个插件` : ''
  return {
    kind: 'plugin-update',
    link: '/marketplace/installed',
    count: updatable.length,
    names: updatable.map((p) => p.name),
    title: `有 ${updatable.length} 个插件可更新`,
    body: rest
      ? `${detail}，${rest}有新版本，去已安装页一键全部更新。`
      : `${detail}有新版本，去已安装页一键全部更新。`,
  }
}

export interface BatchUpdateFailure<T> {
  item: T
  error: string
}

export interface BatchUpdateResult<T> {
  succeeded: T[]
  failed: BatchUpdateFailure<T>[]
}

/**
 * 批量更新执行器：逐个顺序走 upgradeOne，单个失败只记入 failed、
 * 绝不掀翻整批（继续更下一个）。
 *
 * 顺序执行是刻意的，不是偷懒：单插件升级链路会重应用主题 token /
 * 重新注册搜索前缀，并行跑会在共享运行时上互相覆盖；顺序跑也让
 * 回执里的成功/失败顺序与页面置顶顺序一致。
 */
export async function runBatchUpdate<T>(
  targets: readonly T[],
  upgradeOne: (item: T) => Promise<void>,
  describeError: (err: unknown) => string = (err) =>
    err instanceof Error ? err.message : String(err),
): Promise<BatchUpdateResult<T>> {
  const succeeded: T[] = []
  const failed: BatchUpdateFailure<T>[] = []
  for (const item of targets) {
    try {
      await upgradeOne(item)
      succeeded.push(item)
    } catch (err) {
      failed.push({ item, error: describeError(err) })
    }
  }
  return { succeeded, failed }
}

export interface BatchUpdateReceipt<T> {
  /** 横幅文案：成功数、失败数与失败插件名一次说清（回执）。 */
  message: string
  /** 是否全部成功（调用方据此决定横幅要不要挂「重试」）。 */
  allSucceeded: boolean
  /** 重试只重更这些，不要整批重跑已成功的。 */
  failedItems: T[]
}

/** 批量更新回执：0 个可更新、全部成功、部分失败、全部失败四种说法。 */
export function summarizeBatchUpdate<T extends { name: string }>(
  result: BatchUpdateResult<T>,
): BatchUpdateReceipt<T> {
  const ok = result.succeeded.length
  const bad = result.failed.length
  const failedItems = result.failed.map((f) => f.item)
  if (ok === 0 && bad === 0) {
    return { message: '没有可更新的插件。', allSucceeded: true, failedItems }
  }
  if (bad === 0) {
    return {
      message: `全部更新完成：${ok} 个插件已升至最新版本。`,
      allSucceeded: true,
      failedItems,
    }
  }
  const names = failedItems.map((p) => `「${p.name}」`).join('、')
  if (ok === 0) {
    return {
      message: `全部更新失败：${bad} 个插件都未能升级（${names}），仍停留在旧版本。`,
      allSucceeded: false,
      failedItems,
    }
  }
  return {
    message: `全部更新完成：成功 ${ok} 个，失败 ${bad} 个（${names}），失败的插件仍停留在旧版本。`,
    allSucceeded: false,
    failedItems,
  }
}
