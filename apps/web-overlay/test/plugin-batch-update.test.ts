/**
 * P2-4 第一步：已安装页「全部更新」+ 通知中心更新提醒。
 *
 * 守门点：
 * - 可更新判定与已安装页旧 hasUpdate 同口径（版本严格大于，不用字符串不等）；
 * - 批量更新逐个顺序走升级链路，单个失败不掀翻整批，回执一次说清成功/失败数与失败名；
 * - 通知提醒是客户端派生（无可更新项为 null），不写服务端通知、不进未读数；
 * - 自动更新不要做：本批只做手动一键批量，三个文件里都不许出现 autoUpdate 开关。
 *
 * 纯函数单测 + 源码接线断言，不用 vi.mock。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildPluginUpdateReminder,
  getUpdatablePlugins,
  hasPluginUpdate,
  runBatchUpdate,
  summarizeBatchUpdate,
  type BatchUpdateResult,
} from '../src/lib/plugins/plugin-updates.ts'

const item = (slug: string, name: string, version: string, installedVersion: string) => ({
  slug,
  name,
  version,
  installedVersion,
})

describe('hasPluginUpdate（与已安装页旧口径一致）', () => {
  it('市场版本严格高于已装版本才算可更新', () => {
    expect(hasPluginUpdate(item('a', 'A', '1.1.0', '1.0.0'))).toBe(true)
    expect(hasPluginUpdate(item('a', 'A', '1.10.0', '1.2.0'))).toBe(true)
    expect(hasPluginUpdate(item('a', 'A', '2.0.0', '1.9.9'))).toBe(true)
  })

  it('版本相同、本地更新、缺版本号时都不误报', () => {
    expect(hasPluginUpdate(item('a', 'A', '1.0.0', '1.0.0'))).toBe(false)
    // 服务端回滚：市场版本反而更低，不能标成「可升级」
    expect(hasPluginUpdate(item('a', 'A', '1.0.0', '2.0.0'))).toBe(false)
    expect(hasPluginUpdate(item('a', 'A', '', '1.0.0'))).toBe(false)
    expect(hasPluginUpdate(item('a', 'A', '1.1.0', ''))).toBe(false)
  })
})

describe('getUpdatablePlugins', () => {
  it('只挑可更新项，保持原顺序', () => {
    const items = [
      item('a', 'A', '2.0.0', '1.0.0'),
      item('b', 'B', '1.0.0', '1.0.0'),
      item('c', 'C', '1.5.0', '1.4.0'),
    ]
    expect(getUpdatablePlugins(items).map((p) => p.slug)).toEqual(['a', 'c'])
    expect(getUpdatablePlugins([])).toEqual([])
  })
})

describe('buildPluginUpdateReminder（通知中心提醒文案）', () => {
  it('无可更新项返回 null（不渲染提醒）', () => {
    expect(buildPluginUpdateReminder([item('a', 'A', '1.0.0', '1.0.0')])).toBeNull()
    expect(buildPluginUpdateReminder([])).toBeNull()
  })

  it('有更新时标题、数量、版本、正文与入口一次给全', () => {
    const reminder = buildPluginUpdateReminder([
      item('a', '甲插件', '2.0.0', '1.0.0'),
      item('b', '乙插件', '1.3.0', '1.2.0'),
    ])
    expect(reminder).not.toBeNull()
    expect(reminder?.kind).toBe('plugin-update')
    expect(reminder?.count).toBe(2)
    expect(reminder?.title).toBe('有 2 个插件可更新')
    expect(reminder?.link).toBe('/marketplace/installed')
    expect(reminder?.names).toEqual(['甲插件', '乙插件'])
    expect(reminder?.body).toContain('「甲插件」v1.0.0 → v2.0.0')
    expect(reminder?.body).toContain('「乙插件」v1.2.0 → v1.3.0')
    expect(reminder?.body).toContain('一键全部更新')
  })

  it('超过 3 个只列前 3 个名，其余只计个数', () => {
    const items = ['一', '二', '三', '四', '五'].map((n, i) =>
      item(`p${i}`, `${n}插件`, '2.0.0', '1.0.0'),
    )
    const reminder = buildPluginUpdateReminder(items)
    expect(reminder?.title).toBe('有 5 个插件可更新')
    expect(reminder?.body).toContain('等 5 个插件')
    expect(reminder?.body).not.toContain('五插件')
  })
})

describe('runBatchUpdate（失败隔离：单个失败不掀翻整批）', () => {
  it('全部成功时按原顺序返回成功清单', async () => {
    const seen: string[] = []
    const result = await runBatchUpdate(['a', 'b', 'c'], async (s) => {
      seen.push(s)
    })
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(result).toEqual({ succeeded: ['a', 'b', 'c'], failed: [] })
  })

  it('中间一个失败：继续更下一个，失败记名记错', async () => {
    const result = await runBatchUpdate(['a', 'b', 'c'], async (s) => {
      if (s === 'b') throw new Error('网络抖动')
    })
    expect(result.succeeded).toEqual(['a', 'c'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].item).toBe('b')
    expect(result.failed[0].error).toContain('网络抖动')
  })

  it('全部失败也返回完整失败清单，不抛错', async () => {
    const result = await runBatchUpdate(['a', 'b'], async () => {
      throw new Error('服务端不可用')
    })
    expect(result.succeeded).toEqual([])
    expect(result.failed.map((f) => f.item)).toEqual(['a', 'b'])
  })
})

describe('summarizeBatchUpdate（回执文案）', () => {
  const ok = (names: string[]): BatchUpdateResult<{ name: string }> => ({
    succeeded: names.map((name) => ({ name })),
    failed: [],
  })
  const mixed = (okNames: string[], badNames: string[]): BatchUpdateResult<{ name: string }> => ({
    succeeded: okNames.map((name) => ({ name })),
    failed: badNames.map((name) => ({ item: { name }, error: 'x' })),
  })

  it('0 个可更新时明说没有', () => {
    const receipt = summarizeBatchUpdate(ok([]))
    expect(receipt.message).toContain('没有可更新的插件')
    expect(receipt.allSucceeded).toBe(true)
    expect(receipt.failedItems).toEqual([])
  })

  it('全部成功：只报成功数，不挂重试', () => {
    const receipt = summarizeBatchUpdate(ok(['A', 'B']))
    expect(receipt.message).toContain('全部更新完成：2 个插件已升至最新版本')
    expect(receipt.allSucceeded).toBe(true)
  })

  it('部分失败：成功数、失败数、失败名一次说清，重试只含失败的', () => {
    const receipt = summarizeBatchUpdate(mixed(['A'], ['B', 'C']))
    expect(receipt.message).toContain('成功 1 个，失败 2 个')
    expect(receipt.message).toContain('「B」')
    expect(receipt.message).toContain('「C」')
    expect(receipt.allSucceeded).toBe(false)
    expect(receipt.failedItems).toEqual([{ name: 'B' }, { name: 'C' }])
  })

  it('全部失败：明说都未能升级且仍在旧版本', () => {
    const receipt = summarizeBatchUpdate(mixed([], ['A']))
    expect(receipt.message).toContain('全部更新失败')
    expect(receipt.message).toContain('「A」')
    expect(receipt.message).toContain('仍停留在旧版本')
    expect(receipt.allSucceeded).toBe(false)
  })
})

function overlaySource(rel: string): string {
  return readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
}

describe('已安装页「全部更新」接线', () => {
  const src = overlaySource('app/marketplace/installed/page.tsx')

  it('有更新时渲染「全部更新 (N)」按钮，批量走已有升级内核', () => {
    expect(src).toContain('全部更新 (')
    expect(src).toContain('handleUpdateAll(updatableItems)')
    expect(src).toContain('upgradePluginOnce')
    expect(src).toContain('runBatchUpdate(')
  })

  it('批量进行态：按钮文案带进度、单点升级按钮同步禁用', () => {
    expect(src).toContain('正在更新 ${batchProgress.done}/${batchProgress.total}')
    expect(src).toContain('disabled={updatingAll || loading}')
    expect(src).toContain('disabled={isUpgrading || updatingAll}')
  })

  it('回执横幅：失败只重试失败的（不整批重跑已成功的）', () => {
    expect(src).toContain('summarizeBatchUpdate(result)')
    expect(src).toContain('handleUpdateAll(receipt.failedItems)')
  })

  it('单点升级链路未变：仍走同一内核、仍邀评', () => {
    expect(src).toContain('showActionMessage(`插件已成功升级至最新版本`)')
    expect(src).toContain('showInstallReviewPrompt(item.slug, item.name)')
  })
})

describe('通知中心更新提醒接线', () => {
  const src = overlaySource('app/me/notifications/page.tsx')

  it('打开通知中心即按已安装清单派生提醒，失败不打坏通知页', () => {
    expect(src).toContain('fetchInstalledPlugins')
    expect(src).toContain('buildPluginUpdateReminder')
    expect(src).toContain('loadUpdateReminder')
  })

  it('提醒是独立横幅：有标题、去全部更新入口、当次关闭，不走服务端标已读', () => {
    expect(src).toContain('updateReminder.title')
    expect(src).toContain('去全部更新')
    expect(src).toContain('知道了')
    expect(src).toContain('role="status"')
    // 提醒横幅在服务端通知列表之上、与空态无关：无服务端通知时也出现
    const bannerAt = src.indexOf('updateReminder && !reminderDismissed')
    const emptyAt = src.indexOf('还没有通知')
    expect(bannerAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(-1)
    expect(bannerAt).toBeLessThan(emptyAt)
  })
})

describe('自动更新不要做（P2-4 第一步红线）', () => {
  it('三个文件里都没有自动更新开关或轮询', () => {
    for (const rel of [
      'lib/plugins/plugin-updates.ts',
      'app/marketplace/installed/page.tsx',
      'app/me/notifications/page.tsx',
    ]) {
      const src = overlaySource(rel)
      expect(src).not.toContain('autoUpdate')
      expect(src).not.toContain('auto-update')
      expect(src).not.toContain('auto_update')
    }
  })
})
