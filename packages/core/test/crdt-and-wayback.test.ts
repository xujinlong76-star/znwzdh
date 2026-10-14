import { describe, it, expect } from 'vitest'
import {
  createCRDTOperation,
  mergeOperationLogs,
  reduceOperationsToState,
  compactOperationLog,
  type CRDTOperation,
} from '../src/crdt-sync.ts'
import {
  normalizeTargetUrl,
  buildWaybackSnapshotUrl,
  buildWaybackSaveUrl,
  isPotentialBrokenHttpCode,
  parseWaybackAvailabilityResponse,
} from '../src/wayback-resolver.ts'

describe('本地优先零冲突 CRDT 协同漫游引擎 (CRDT Sync Engine)', () => {
  it('生成具有唯一 ID 和时序标记的原子操作', () => {
    const op1 = createCRDTOperation('SET_CATEGORY_PIN', 'cat_ai', { isPinned: true }, 'client_A', 1000)
    const op2 = createCRDTOperation('SET_CATEGORY_PIN', 'cat_ai', { isPinned: false }, 'client_B', 1005)

    expect(op1.id).toBeDefined()
    expect(op1.type).toBe('SET_CATEGORY_PIN')
    expect(op1.timestamp).toBe(1000)
    expect(op2.timestamp).toBe(1005)
    expect(op1.clientId).toBe('client_A')
  })

  it('多端操作合并具备幂等性与交换律', () => {
    const opA = createCRDTOperation('SET_CATEGORY_PIN', 'cat_dev', { isPinned: true }, 'client_A', 100)
    const opB = createCRDTOperation('REORDER_CATEGORIES', 'global', { categoryOrder: ['cat_dev', 'cat_ai'] }, 'client_B', 200)

    const merged1 = mergeOperationLogs([opA], [opB])
    const merged2 = mergeOperationLogs([opB], [opA])
    const mergedIdempotent = mergeOperationLogs(merged1, [opA, opB])

    expect(merged1).toEqual(merged2)
    expect(merged1).toEqual(mergedIdempotent)
    expect(merged1.length).toBe(2)
    expect(merged1[0]!.id).toBe(opA.id)
    expect(merged1[1]!.id).toBe(opB.id)
  })

  it('准确还原状态并根据 LWW 裁决多端并发修改冲突', () => {
    // 场景：设备 A 在 t=100 将 cat_design 置顶，设备 B 在 t=120 取消置顶
    const op1 = createCRDTOperation('SET_CATEGORY_PIN', 'cat_design', { isPinned: true }, 'client_A', 100)
    const op2 = createCRDTOperation('SET_CATEGORY_PIN', 'cat_design', { isPinned: false }, 'client_B', 120)

    // 设备 A 在 t=110 添加自定义分类
    const op3 = createCRDTOperation(
      'UPSERT_CUSTOM_CATEGORY',
      'custom_web3',
      { id: 'custom_web3', title: 'Web3 研究', items: [] },
      'client_A',
      110
    )

    // 设备 B 在 t=130 向 custom_web3 注入站点
    const op4 = createCRDTOperation(
      'UPSERT_CUSTOM_SITE',
      'site_eth',
      {
        categoryId: 'custom_web3',
        site: { id: 'site_eth', title: 'Ethereum', href: 'https://ethereum.org' },
      },
      'client_B',
      130
    )

    const merged = mergeOperationLogs([op1, op3], [op2, op4])
    const state = reduceOperationsToState(merged)

    // LWW 裁决：cat_design 的最终状态应为未置顶
    expect(state.pinnedCategoryIds).not.includes('cat_design')
    // custom_web3 分类应存在，且包含 site_eth
    const customCat = state.customCategories.find((c) => c.id === 'custom_web3')
    expect(customCat).toBeDefined()
    expect(customCat?.items.some((i) => i.id === 'site_eth')).toBe(true)
  })

  it('支持删除分类与删除站点的墓碑清理', () => {
    const ops: CRDTOperation[] = [
      createCRDTOperation('UPSERT_CUSTOM_CATEGORY', 'cat_temp', { id: 'cat_temp', title: '临时分类' }, 'c1', 10),
      createCRDTOperation('UPSERT_CUSTOM_SITE', 's1', { categoryId: 'cat_temp', site: { id: 's1', title: 'Site 1', href: 'https://test.com' } }, 'c1', 20),
      createCRDTOperation('DELETE_CUSTOM_SITE', 's1', { categoryId: 'cat_temp', siteId: 's1' }, 'c2', 30),
      createCRDTOperation('DELETE_CUSTOM_CATEGORY', 'cat_temp', {}, 'c2', 40),
    ]

    const state = reduceOperationsToState(ops)
    expect(state.customCategories.some((c) => c.id === 'cat_temp')).toBe(false)
  })

  it('压缩机制能够将历史流水压缩为等价的最小基态日志', () => {
    const ops: CRDTOperation[] = [
      createCRDTOperation('SET_CATEGORY_PIN', 'cat_1', { isPinned: true }, 'c1', 10),
      createCRDTOperation('SET_CATEGORY_PIN', 'cat_1', { isPinned: false }, 'c1', 20),
      createCRDTOperation('SET_CATEGORY_PIN', 'cat_1', { isPinned: true }, 'c1', 30),
      createCRDTOperation('REORDER_CATEGORIES', 'global', { categoryOrder: ['cat_2', 'cat_1'] }, 'c2', 40),
      createCRDTOperation('PIN_SITE_IN_CATEGORY', 'cat_1', { siteId: 'site_alpha' }, 'c1', 50),
    ]

    const compacted = compactOperationLog(ops)
    const stateBefore = reduceOperationsToState(ops)
    const stateAfter = reduceOperationsToState(compacted)

    expect(stateAfter).toEqual(stateBefore)
    expect(compacted.length).toBeLessThanOrEqual(ops.length)
  })
})

describe('坏链自愈与时间机器历史镜像回溯 (Wayback Resolver Engine)', () => {
  it('正确清洗目标 URL 追踪参数与锚点', () => {
    const raw = 'https://example.com/docs?utm_source=twitter&utm_medium=social&key=value#section-1'
    const clean = normalizeTargetUrl(raw)
    expect(clean).toBe('https://example.com/docs?key=value')
  })

  it('构造准确的 Wayback Machine 历史快照与存档 URL', () => {
    const target = 'https://news.ycombinator.com'
    const snapshotDefault = buildWaybackSnapshotUrl(target)
    const snapshotTimestamped = buildWaybackSnapshotUrl(target, '20230101000000')
    const saveUrl = buildWaybackSaveUrl(target)

    expect(snapshotDefault).toBe('https://web.archive.org/web/*/https://news.ycombinator.com')
    expect(snapshotTimestamped).toBe('https://web.archive.org/web/20230101000000/https://news.ycombinator.com')
    expect(saveUrl).toBe('https://web.archive.org/save/https://news.ycombinator.com')
  })

  it('精准识别死链与网络故障 HTTP 状态码', () => {
    expect(isPotentialBrokenHttpCode(404)).toBe(true)
    expect(isPotentialBrokenHttpCode(410)).toBe(true)
    expect(isPotentialBrokenHttpCode(500)).toBe(true)
    expect(isPotentialBrokenHttpCode(502)).toBe(true)
    expect(isPotentialBrokenHttpCode(521)).toBe(true)

    expect(isPotentialBrokenHttpCode(200)).toBe(false)
    expect(isPotentialBrokenHttpCode(301)).toBe(false)
    expect(isPotentialBrokenHttpCode(302)).toBe(false)
  })

  it('解析 Internet Archive Availability API 返回结果', () => {
    const mockApiResponse = {
      url: 'https://example.com',
      archived_snapshots: {
        closest: {
          status: '200',
          available: true,
          url: 'http://web.archive.org/web/20200101000000/https://example.com',
          timestamp: '20200101000000',
        },
      },
    }

    const res = parseWaybackAvailabilityResponse(mockApiResponse)
    expect(res.available).toBe(true)
    expect(res.timestamp).toBe('20200101000000')
    expect(res.url).toContain('http://web.archive.org/web/20200101000000')

    const emptyRes = parseWaybackAvailabilityResponse({})
    expect(emptyRes.available).toBe(false)
  })
})
