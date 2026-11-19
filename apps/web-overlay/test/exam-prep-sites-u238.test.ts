/**
 * U-238：备考站点区空态文案误归因——取数失败与分类为空都返回 []，空态却
 * 一律写「站内数据服务暂时不可用」；失败后无重试、无替代入口。
 * 修法：loadExamPrepSites() 区分成功列表 / 取数失败 / 分类空三种状态返回；
 * 失败态文案 + 重试按钮（服务端 revalidatePath 重新取数），分类空态文案
 * + 指往 /sites 的链接。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXAM_PREP_CATEGORY_ID, EXAM_PREP_SUB_ID } from '../src/lib/exam-calendar'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

vi.mock('@/lib/navigation-catalog-read', () => ({
  loadNavigationCatalog: vi.fn(),
}))
vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn(),
}))
vi.mock('@/lib/data-loader', () => ({
  getProcessedData: vi.fn(),
}))

import { getProcessedData } from '@/lib/data-loader'
import { getFileContent } from '@/lib/github'
import { loadNavigationCatalog } from '@/lib/navigation-catalog-read'
import { loadExamPrepSites } from '../src/lib/exam-prep-sites'

// mock-hygiene 守卫：跨模块 vi.mock 须带 vi.resetModules() 清理（isolate:false 下模块缓存会跨文件驻留）。
afterAll(() => {
  vi.resetModules()
})

const mockedCatalog = vi.mocked(loadNavigationCatalog)
const mockedFile = vi.mocked(getFileContent)
const mockedProcessed = vi.mocked(getProcessedData)

const siteA = { id: 's1', title: '站 A', href: 'https://example.com/a', description: 'A' }
const siteB = { id: 's2', title: '站 B', href: 'https://example.com/b', description: 'B' }

function processedWith(items: Array<Record<string, unknown>> | undefined, subPresent = true) {
  const sub = subPresent ? { id: EXAM_PREP_SUB_ID, items } : undefined
  const subs = sub === undefined ? [] : [sub]
  return {
    navigationData: {
      navigationItems: [{ id: EXAM_PREP_CATEGORY_ID, subCategories: subs }],
    },
  }
}

beforeEach(() => {
  mockedCatalog.mockReset()
  mockedFile.mockReset()
  mockedProcessed.mockReset()
  mockedCatalog.mockResolvedValue({ data: {}, mode: 'doc', sourceVersion: null, degraded: false } as never)
  mockedFile.mockResolvedValue({} as never)
})

describe('U-238：loadExamPrepSites 三态返回', () => {
  it('成功取到列表 → ok + sites（原样返回，不改顺序）', async () => {
    mockedProcessed.mockReturnValue(processedWith([siteA, siteB]) as never)
    const result = await loadExamPrepSites()
    expect(result).toEqual({ status: 'ok', sites: [siteA, siteB] })
  })

  it('取数抛错（目录加载失败）→ error，不抛到页面', async () => {
    mockedCatalog.mockRejectedValue(new Error('shard unavailable'))
    await expect(loadExamPrepSites()).resolves.toEqual({ status: 'error' })
  })

  it('取数抛错（site.json 失败）→ error', async () => {
    mockedFile.mockRejectedValue(new Error('site.json 404'))
    await expect(loadExamPrepSites()).resolves.toEqual({ status: 'error' })
  })

  it('取数抛错（加工失败）→ error', async () => {
    mockedProcessed.mockImplementation(() => {
      throw new Error('bad data')
    })
    await expect(loadExamPrepSites()).resolves.toEqual({ status: 'error' })
  })

  it('分类不存在 → empty（不再误诊为服务不可用）', async () => {
    mockedProcessed.mockReturnValue({ navigationData: { navigationItems: [] } } as never)
    await expect(loadExamPrepSites()).resolves.toEqual({ status: 'empty' })
  })

  it('子分类不存在 → empty', async () => {
    mockedProcessed.mockReturnValue(processedWith([siteA], false) as never)
    await expect(loadExamPrepSites()).resolves.toEqual({ status: 'empty' })
  })

  it('子分类存在但无站点 → empty', async () => {
    mockedProcessed.mockReturnValue(processedWith([]) as never)
    await expect(loadExamPrepSites()).resolves.toEqual({ status: 'empty' })
  })
})

describe('U-238：/exam 页按状态写空态（源码守卫）', () => {
  it('失败态：保留「服务暂时不可用」文案 + 重试按钮（服务端 revalidatePath 重新取数）', () => {
    const page = read('src/app/exam/page.tsx')
    expect(page).toContain("prepSites.status === 'error'")
    expect(page).toContain('站内数据服务暂时不可用')
    expect(page).toContain('重试')
    expect(page).toContain('revalidatePath')
    expect(page).toContain("revalidatePath('/exam')")
    expect(page).toContain('<form action={retryExamPrepSites}')
    expect(page).toContain("'use server'")
  })

  it('分类空态：写「备考分类暂无站点」，不写「服务不可用」，指往 /sites', () => {
    const page = read('src/app/exam/page.tsx')
    expect(page).toContain("prepSites.status === 'ok'")
    expect(page).toContain('备考分类暂无站点')
    expect(page).toContain('href="/sites"')
    expect(page).toContain('去全部站点找备考入口')
    // 空态分支内不出现「服务不可用」：分类空不再被误诊。
    const emptyBranch = page.split('备考分类暂无站点')[1]!.split('</div>')[0]!
    expect(emptyBranch).not.toContain('服务暂时不可用')
  })

  it('成功态：按分类原顺序渲染列表；旧「失败返回空数组降级」注释已删', () => {
    const page = read('src/app/exam/page.tsx')
    expect(page).toContain('prepSites.sites.map((site)')
    expect(page).not.toContain('失败时返回空数组降级')
    expect(page).not.toContain('prepSites.length > 0')
    expect(page).not.toContain('prepSites.map((site)')
  })
})
