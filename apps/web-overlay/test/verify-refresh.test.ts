/**
 * 刷新验证前端测试（Batch 4 Phase 2 P2-1）。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了（见 compare-page-guard.test.ts 同款说明），接线走源码守卫体例；
 * robots 禁抓本机记忆与结论文案是纯函数，走真实单元测试（内存 Store 注入）。
 *
 * 覆盖：
 *  - 对照表“是否还在维护”格子旁有“刷新验证”按钮，带 loading（“验证中…”）
 *    与“上次验证于 X”文案；robots 禁抓时按钮置灰并注明原因；
 *  - 按钮只出现在 maintenance 格，不出现在其他五格；
 *  - 点击走 POST /api/sites/:id/verify（202 后轮询 GET 状态，重拉
 *    /api/compare 回填格子），不直接写任何健康字段；
 *  - 失败文案只说“未能确认可用性”，源码里刷新验证路径不出现“已停更”；
 *  - robots 记忆：记住/读出/判重（内存 Store），结论文案映射。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  COMPARE_VERIFY_ROBOTS_KEY,
  isRobotsDisallowedSite,
  readRobotsDisallowedSiteIds,
  rememberRobotsDisallowedSiteId,
  verifyOutcomeMessage,
  type CompareNotesStore,
} from '../src/lib/compare'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

function memoryStore(): CompareNotesStore & { dump: () => Record<string, string> } {
  const data: Record<string, string> = {}
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
    dump: () => ({ ...data }),
  }
}

const view = overlaySource('src/components/compare-view.tsx')
const viewCode = stripComments(view)

describe('刷新验证按钮：只在 maintenance 格，带 loading 与上次验证文案', () => {
  it('maintenance 格旁有“刷新验证”按钮，loading 显示“验证中…”', () => {
    expect(viewCode).toContain('刷新验证')
    expect(viewCode).toContain('验证中…')
    expect(viewCode).toContain("dim.key === 'maintenance'")
    expect(viewCode).toContain('aria-label={`刷新验证「${item.title}」`}')
  })

  it('按钮旁显示“上次验证于 X”，从未验证过显示“尚未验证过”', () => {
    expect(viewCode).toContain('上次验证于')
    expect(viewCode).toContain('尚未验证过')
    expect(viewCode).toContain('cell.lastCheckedAt')
  })

  it('robots 禁抓时按钮 disabled 并注明原因', () => {
    expect(viewCode).toContain('robotsBlockedIds.includes(item.siteId)')
    expect(viewCode).toContain('该站点的 robots.txt 禁止抓取，刷新验证已置灰')
    expect(viewCode).toContain('rememberRobotsDisallowedSiteId')
    expect(viewCode).toContain('readRobotsDisallowedSiteIds')
  })
})

describe('刷新验证接线：POST 触发一次，轮询状态后重拉对照表回填', () => {
  it('POST /api/sites/:id/verify，202 后轮询 GET 状态再重拉 /api/compare', () => {
    expect(viewCode).toContain("'/api/sites/' + encodeURIComponent(siteId) + '/verify'")
    expect(viewCode).toContain("method: 'POST'")
    expect(viewCode).toContain('fetchVerifyStatus')
    expect(viewCode).toContain('fetchCompareItems(siteIds)')
  })

  it('预算耗尽（429）如实提示“出站验证预算已耗尽”，不静默重试', () => {
    expect(viewCode).toContain('出站验证预算已耗尽，请稍后再试。')
  })

  it('刷新验证路径不写“已停更”：失败文案只说“未能确认可用性”', () => {
    // “已停更”在文件里只允许出现一次——既有的对照表脚注免责句
    // （“不代表站点已停更或不可用”）；刷新验证的文案走 verifyOutcomeMessage，
    // 失败只说“未能确认可用性”。
    expect(viewCode.split('已停更').length - 1).toBe(1)
    expect(viewCode).toContain('不代表站点已停更或不可用')
    expect(viewCode).toContain('verifyOutcomeMessage')
    expect(viewCode).toContain('验证还在后台跑，格子仍显示上次验证时间')
  })
})

describe('robots 禁抓本机记忆（纯函数，内存 Store）', () => {
  it('空记忆读出 []；记住后读出该 id，重复记住不重复', () => {
    const store = memoryStore()
    expect(readRobotsDisallowedSiteIds(store)).toEqual([])
    expect(isRobotsDisallowedSite('site-a', store)).toBe(false)
    const afterFirst = rememberRobotsDisallowedSiteId('site-a', store)
    expect(afterFirst).toEqual(['site-a'])
    expect(isRobotsDisallowedSite('site-a', store)).toBe(true)
    expect(isRobotsDisallowedSite('site-b', store)).toBe(false)
    expect(rememberRobotsDisallowedSiteId('site-a', store)).toEqual(['site-a'])
    expect(store.dump()[COMPARE_VERIFY_ROBOTS_KEY]).toBe(JSON.stringify(['site-a']))
  })

  it('损坏的记忆 JSON 读出 []，不抛错', () => {
    const store = memoryStore()
    store.setItem(COMPARE_VERIFY_ROBOTS_KEY, '{not-json')
    expect(readRobotsDisallowedSiteIds(store)).toEqual([])
  })
})

describe('验证结论文案：失败一律“未验证”，绝不写“已停更”', () => {
  it('ok/dead 如实说清；blocked/unverified/server-error 都是“未能确认可用性”', () => {
    expect(verifyOutcomeMessage('ok')).toContain('可达')
    expect(verifyOutcomeMessage('dead')).toContain('页面已不存在')
    for (const kind of ['blocked', 'unverified', 'server-error', null, undefined] as const) {
      const message = verifyOutcomeMessage(kind)
      expect(message).toContain('未能确认可用性')
      expect(message).toContain('未验证')
      expect(message).not.toContain('已停更')
      expect(message).not.toContain('不可达')
    }
  })
})
