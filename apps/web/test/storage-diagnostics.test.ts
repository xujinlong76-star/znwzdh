/**
 * 本地存储巡检的「自愈不许丢数据」回归守卫。
 *
 * 修掉的四件事（都是同一个形状：把「我读不出来」处理成「你没有数据」）：
 *   1. 收藏坏了直接 `setItem('...', '[]')` —— 用户唯一的本地资产被「自动修复」清空；
 *   2. 外层 try 把 setItem 的配额错误也当成数据损坏，顺手把还能读的偏好覆盖成默认值；
 *   3. 巡检读的是 'navhub_favorites' / 'navhub_anon_id'，而真实键是
 *      'navhub.favorites.v1' / 'navhub.anonId' —— 检查项永远全绿，其实什么都没查；
 *   4. 匿名标识只要非空就报「格式正确」，坏值也被说成正常（它决定云端归属）。
 *
 * 现在改成：原文整份留档到 `<键>.corrupt.<时间戳>`，留不住就一个字节都不动，
 * 并把「已隔离 / 未改动」如实写进巡检项文案。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { FAVORITES_STORAGE_KEY } from '../src/lib/favorites-storage'
import { ANON_ID_STORAGE_KEY } from '../src/lib/identity-keys'
import {
  deleteQuarantineCopy,
  listQuarantineCopies,
  readQuarantineBytes,
  runClientStorageDiagnostics,
  type ByteStore,
  type DiagnosticCheckItem,
} from '../src/lib/user-settings'

const SETTINGS_KEY = 'navhub_user_settings'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 取 overlay 侧源码：测试真相在 apps/web-overlay，apps/web 只是生成镜像 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

/** 内存替身：能把 setItem 切成「配额已满」，也能逐键比对原文是否被动过 */
class FakeStore implements ByteStore {
  private map = new Map<string, string>()
  writesBlocked = false
  readsBlocked = false

  get length(): number {
    if (this.readsBlocked) throw new Error('SecurityError')
    return this.map.size
  }

  key(index: number): string | null {
    if (this.readsBlocked) throw new Error('SecurityError')
    return [...this.map.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    if (this.readsBlocked) throw new Error('SecurityError')
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    if (this.writesBlocked) throw new Error('QuotaExceededError')
    this.map.set(key, value)
  }

  removeItem(key: string): void {
    if (this.writesBlocked) throw new Error('QuotaExceededError')
    this.map.delete(key)
  }

  seed(key: string, value: string): void {
    this.map.set(key, value)
  }

  keysWithPrefix(prefix: string): string[] {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix))
  }

  /** 直接落一个隔离键（模拟上一轮自检留下的副本，不必再跑一遍巡检） */
  seedCopy(baseKey: string, at: number, raw: string): string {
    const key = `${baseKey}.corrupt.${at}`
    this.map.set(key, raw)
    return key
  }
}

function checkById(checks: DiagnosticCheckItem[], id: string): DiagnosticCheckItem {
  const hit = checks.find((c) => c.id === id)
  if (!hit) throw new Error(`巡检项缺失「${id}」：实际为 ${checks.map((c) => c.id).join(', ')}`)
  return hit
}

/**
 * 按行剥掉注释再断言源码形状。
 * 缺陷说明必须写在注释里（那正是它存在的意义），不剥的话「不许出现幽灵键」
 * 这类否定断言会被自己的说明文字绊倒 —— 注释替代码通过也一样危险。
 */
function stripComments(source: string): string {
  let inBlock = false
  return source
    .split(/\r?\n/)
    .map((rawLine) => {
      let line = rawLine
      let out = ''
      for (;;) {
        if (inBlock) {
          const close = line.indexOf('*/')
          if (close === -1) return out
          inBlock = false
          line = line.slice(close + 2)
          continue
        }
        const lineComment = line.indexOf('//')
        const blockOpen = line.indexOf('/*')
        if (lineComment !== -1 && (blockOpen === -1 || lineComment < blockOpen)) {
          return out + line.slice(0, lineComment)
        }
        if (blockOpen !== -1) {
          out += line.slice(0, blockOpen)
          line = line.slice(blockOpen + 2)
          inBlock = true
          continue
        }
        return out + line
      }
    })
    .join('\n')
}

describe('坏收藏：原文留档，绝不写空', () => {
  const broken = '{"items":[{"siteId"' // 半截写入，JSON.parse 必炸

  it('收藏主键保持原样，原文另存到 .corrupt.<时间戳>', () => {
    const store = new FakeStore()
    store.seed(FAVORITES_STORAGE_KEY, broken)

    const report = runClientStorageDiagnostics(store)

    expect(store.getItem(FAVORITES_STORAGE_KEY)).toBe(broken)
    const copies = store.keysWithPrefix(`${FAVORITES_STORAGE_KEY}.corrupt.`)
    expect(copies).toHaveLength(1)
    expect(store.getItem(copies[0])).toBe(broken)

    const item = checkById(report.checks, 'fav-corrupt')
    expect(item.status).toBe('failed')
    expect(item.detail).toContain(copies[0])
  })

  it('结构能解析但不是数组（早年被别的脚本改写过）同样按坏数据处理', () => {
    const store = new FakeStore()
    store.seed(FAVORITES_STORAGE_KEY, '{"a":1}')
    const report = runClientStorageDiagnostics(store)
    expect(report.checks.map((c) => c.id)).toContain('fav-corrupt')
    expect(store.getItem(FAVORITES_STORAGE_KEY)).toBe('{"a":1}')
  })

  it('「隔离都写不进去」时不能宣称修复成功，也不许动主键', () => {
    const store = new FakeStore()
    store.seed(FAVORITES_STORAGE_KEY, broken)
    store.writesBlocked = true

    const report = runClientStorageDiagnostics(store)
    const item = checkById(report.checks, 'fav-corrupt')

    expect(item.status).toBe('failed')
    expect(item.detail).toContain('一个字节都没动')
    expect(item.detail).not.toContain('留档')
    expect(report.repairedCount).toBe(0)
    expect(store.keysWithPrefix(`${FAVORITES_STORAGE_KEY}.corrupt.`)).toEqual([])
  })

  it('连读都不让读（隐私模式）：如实说没检查过，而不是报「尚未创建收藏记录」', () => {
    const store = new FakeStore()
    store.readsBlocked = true
    const report = runClientStorageDiagnostics(store)
    expect(checkById(report.checks, 'fav-unavailable').status).toBe('failed')
    expect(checkById(report.checks, 'settings-unavailable').status).toBe('failed')
    expect(checkById(report.checks, 'anon-id').status).toBe('failed')
    expect(report.repairedCount).toBe(0)
  })

  it('同一份坏数据反复自检只留档一次（否则每点一次就吃掉一份配额）', () => {
    const store = new FakeStore()
    store.seed(FAVORITES_STORAGE_KEY, broken)
    runClientStorageDiagnostics(store)
    runClientStorageDiagnostics(store)
    runClientStorageDiagnostics(store)
    expect(store.keysWithPrefix(`${FAVORITES_STORAGE_KEY}.corrupt.`)).toHaveLength(1)
  })

  it('健康收藏只是报告条数，不产生隔离副本', () => {
    const store = new FakeStore()
    store.seed(FAVORITES_STORAGE_KEY, JSON.stringify([{ siteId: 'a' }, { siteId: 'b' }, { siteId: 'c' }]))
    const report = runClientStorageDiagnostics(store)
    expect(checkById(report.checks, 'fav-structure').detail).toContain('3 条')
    expect(store.keysWithPrefix(`${FAVORITES_STORAGE_KEY}.corrupt.`)).toEqual([])
  })
})

describe('坏偏好：先留档再重建，并回读确认真的落住了', () => {
  it('偏好是坏 JSON：原文进隔离键，主键重建为默认值', () => {
    const store = new FakeStore()
    store.seed(SETTINGS_KEY, '{"cardDensity":')

    const report = runClientStorageDiagnostics(store)
    const item = checkById(report.checks, 'settings-corrupt')

    expect(item.status).toBe('repaired')
    const copies = store.keysWithPrefix(`${SETTINGS_KEY}.corrupt.`)
    expect(copies).toHaveLength(1)
    expect(store.getItem(copies[0])).toBe('{"cardDensity":')
    expect(JSON.parse(store.getItem(SETTINGS_KEY) as string).cardDensity).toBe('comfortable')
  })

  it('setItem 抛配额错误不再被误判成「数据损坏」（回归：整段 try 兜底的写法）', () => {
    const store = new FakeStore()
    // 第一遍让存储自己长出「已对齐最新 Schema」的内容，避免测试硬编码字段顺序
    runClientStorageDiagnostics(store)
    const healthy = store.getItem(SETTINGS_KEY)
    expect(healthy).toBeTruthy()

    store.writesBlocked = true // 解析没问题，只是写不回去
    const report = runClientStorageDiagnostics(store)

    expect(store.getItem(SETTINGS_KEY)).toBe(healthy)
    expect(report.checks.map((c) => c.id)).not.toContain('settings-corrupt')
    expect(checkById(report.checks, 'settings-schema').status).toBe('ok')
  })

  it('过时字段仍然被对齐，但这是「能再长出来」的数据，不需要隔离', () => {
    const store = new FakeStore()
    store.seed(SETTINGS_KEY, JSON.stringify({ cardDensity: 'roomy', defaultSearchEngine: 'yandex' }))
    const report = runClientStorageDiagnostics(store)
    expect(checkById(report.checks, 'settings-schema').status).toBe('repaired')
    expect(store.keysWithPrefix(`${SETTINGS_KEY}.corrupt.`)).toEqual([])
    const written = JSON.parse(store.getItem(SETTINGS_KEY) as string)
    expect(written.cardDensity).toBe('comfortable')
    expect(written.defaultSearchEngine).toBe('internal')
  })
})

describe('匿名指纹：真正读真实键，也真正判格式', () => {
  it('非法格式的匿名 id 不再被说成「格式正确」', () => {
    const store = new FakeStore()
    store.seed(ANON_ID_STORAGE_KEY, 'tampered-by-extension')
    const report = runClientStorageDiagnostics(store)
    const item = checkById(report.checks, 'anon-id')
    expect(item.status).toBe('failed')
    expect(item.detail).toContain('不是合法格式')
  })

  it('合法匿名 id（anon- 前缀）报正常，并说明它决定数据归属', () => {
    const store = new FakeStore()
    store.seed(ANON_ID_STORAGE_KEY, 'anon-1f7c2b9d4e6a8b03')
    expect(checkById(runClientStorageDiagnostics(store).checks, 'anon-id').status).toBe('ok')
  })

  it('本机还没有指纹时如实说「首次访问时按需生成」', () => {
    const report = runClientStorageDiagnostics(new FakeStore())
    const item = checkById(report.checks, 'anon-id')
    expect(item.status).toBe('ok')
    expect(item.detail).toContain('按需生成')
  })
})

describe('隔离区出口：留档必须看得见、取得出、删得掉', () => {
  it('列出本机副本：标注来源、时间与能否恢复（时间倒序）', () => {
    const store = new FakeStore()
    store.seedCopy(FAVORITES_STORAGE_KEY, 1_700_000_000_000, '[{"siteId":"a","title":"A","href":"https://a","createdAt":1}]')
    store.seedCopy(SETTINGS_KEY, 1_700_000_005_000, '{"cardDensity":')

    const copies = listQuarantineCopies(store)
    expect(copies.map((c) => c.baseKey)).toEqual([SETTINGS_KEY, FAVORITES_STORAGE_KEY])
    expect(copies[0].savedAt).toBe(1_700_000_005_000)
    expect(copies[0].restorable).toBe(false)
    expect(copies[1].restorable).toBe(true)
    expect(copies[1].chars).toBe(store.getItem(copies[1].key)?.length)
  })

  it('键名里没有合法时间戳时 savedAt 给 null，不硬凑一个日期', () => {
    const store = new FakeStore()
    store.seed(`${FAVORITES_STORAGE_KEY}.corrupt.not-a-number`, '[]')
    expect(listQuarantineCopies(store)[0].savedAt).toBeNull()
  })

  it('副本清单只认隔离键，别把正常数据也列成「坏数据」', () => {
    const store = new FakeStore()
    store.seed(FAVORITES_STORAGE_KEY, '[{"siteId":"a"}]')
    store.seed(SETTINGS_KEY, '{}')
    store.seed('navhub.anonId', 'anon-abc')
    expect(listQuarantineCopies(store)).toEqual([])
  })

  it('取原文只允许取隔离键：不能借这个口读走任意存储内容', () => {
    const store = new FakeStore()
    const copy = store.seedCopy(FAVORITES_STORAGE_KEY, 1_700_000_000_000, 'RAW-COPY')
    store.seed('navhub.api_token', 'SECRET-TOKEN')
    store.seed(FAVORITES_STORAGE_KEY, 'SECRET-MAIN-KEY')

    expect(readQuarantineBytes(copy, store)).toBe('RAW-COPY')
    expect(readQuarantineBytes('navhub.api_token', store)).toBeNull()
    expect(readQuarantineBytes(FAVORITES_STORAGE_KEY, store)).toBeNull()
  })

  it('删除副本要回读确认：removeItem 抛错时不能说「已删除」', () => {
    const store = new FakeStore()
    const copy = store.seedCopy(FAVORITES_STORAGE_KEY, 1_700_000_000_000, 'RAW-COPY')

    store.writesBlocked = true
    expect(deleteQuarantineCopy(copy, store)).toBe(false)
    expect(store.getItem(copy)).toBe('RAW-COPY')

    store.writesBlocked = false
    expect(deleteQuarantineCopy(copy, store)).toBe(true)
    expect(store.getItem(copy)).toBeNull()
  })

  it('删除同样只认隔离键：主键与别人的键删不掉', () => {
    const store = new FakeStore()
    store.seed(FAVORITES_STORAGE_KEY, '[{"siteId":"a"}]')
    store.seed('navhub.api_token', 'SECRET')

    expect(deleteQuarantineCopy(FAVORITES_STORAGE_KEY, store)).toBe(false)
    expect(deleteQuarantineCopy('navhub.api_token', store)).toBe(false)
    expect(store.getItem(FAVORITES_STORAGE_KEY)).toBe('[{"siteId":"a"}]')
  })

  it('自检留下的副本，巡检文案指的那个页面真的渲染它', () => {
    expect(overlaySource('src/app/me/data/page.tsx')).toContain('<QuarantineZone />')
  })

  it('隔离区首帧不读存储（服务端拿不到 localStorage，读了就是水合不匹配）', () => {
    const code = stripComments(overlaySource('src/components/user-center/quarantine-zone.tsx'))
    // 挂载前直接返回 null：清单与预览都只在 mounted 之后出现
    expect(code).toMatch(/if \(!mounted \|\| copies\.length === 0\) return null/)
    // 读操作只允许出现在 useEffect / 事件回调里，不能在渲染路径上裸调用
    expect(code).toMatch(/useEffect\(\(\) => \{\s*setMounted\(true\)\s*refresh\(\)/)
    expect(code).toContain('useState<QuarantineCopy[]>([])')
  })
})

describe('巡检读写的必须是真实存储键（回归：幽灵键让检查永远全绿）', () => {
  const src = stripComments(overlaySource('src/lib/user-settings.ts'))

  it('收藏与匿名键一律取自单一来源', () => {
    expect(src).toContain('FAVORITES_STORAGE_KEY')
    expect(src).toContain('ANON_ID_STORAGE_KEY')
    expect(src).not.toContain("'navhub_favorites'")
    expect(src).not.toContain("'navhub_anon_id'")
  })

  it('身份键常量与 identity.ts 用的是同一份', () => {
    expect(overlaySource('src/lib/identity.ts')).toContain("from './identity-keys'")
    expect(ANON_ID_STORAGE_KEY).toBe('navhub.anonId')
  })

  it('巡检里不再出现任何把主键写成空集合的自愈', () => {
    expect(src).not.toContain("setItem('navhub_favorites', '[]')")
    expect(src).not.toContain(`${FAVORITES_STORAGE_KEY}, '[]'`)
  })
})
