/**
 * 离线个人数据层「我的常用」（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * 只测 lib/personal-data.ts 的纯逻辑与存储适配（注入假 storage，不碰
 * 真 localStorage / IndexedDB）；React hook 与组件由 E2E 覆盖。
 *
 * 冻结口径（复盘报告 §四）：
 * - 置顶上限 24，超限提示、不静默丢弃；自定义链接仅 http/https；
 * - 最近使用上限 8（读 offline-recent 快照，本文件只锁配额常量与开关）；
 * - 导出仅含收藏 ID、分组、偏好，不含历史/搜索词/计数器；
 * - 导入先校验、坏文件拒绝并提示；坏 JSON 隔离、不覆盖原数据
 *   （复用 favorites-storage.ts 的 {items, corrupt} 模式）。
 */
import { describe, expect, it } from 'vitest'
import {
  BACKUP_REMINDER_AFTER_DAYS,
  BACKUP_REMINDER_DISMISS_DAYS,
  MAX_CUSTOM_LINKS,
  MAX_PINNED_SITES,
  MAX_RECENT_PERSONAL,
  MS_PER_DAY,
  PERSONAL_FORMAT,
  PERSONAL_FORMAT_VERSION,
  PERSONAL_STORAGE_KEY,
  RECENT_PAUSED_KEY,
  addCustomLink,
  addPin,
  backupReminderStatus,
  buildPresetScenes,
  bumpCounter,
  clearAllPersonalData,
  daysSinceLastExport,
  defaultPersonalData,
  exportPersonalData,
  hasPersonalContent,
  isRecentRecordingPaused,
  letterBadgeFor,
  loadPersonalData,
  mergePersonalImport,
  movePin,
  parsePersonalData,
  parsePersonalImport,
  personalCorruptBackupKey,
  removeCustomLink,
  removePin,
  savePersonalData,
  setRecentRecordingPaused,
  storageUsageBytes,
  validateCustomLinkUrl,
  validatePersonalData,
  type CatalogCategory,
  type PersonalData,
  type PersonalStorage,
} from '@/lib/personal-data'

function memoryStorage(initial: Record<string, string> = {}): PersonalStorage & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    dump: () => Object.fromEntries(map),
  }
}

function quotaStorage(): PersonalStorage {
  return {
    getItem: () => null,
    setItem: () => {
      const err = new Error('QuotaExceededError') as Error & { name: string; code: number }
      err.name = 'QuotaExceededError'
      err.code = 22
      throw err
    },
    removeItem: () => {},
  }
}

const SITE_A = { siteId: 'github', title: 'GitHub', href: 'https://github.com', icon: 'github.svg' }
const SITE_B = { siteId: 'bilibili', title: '哔哩哔哩', href: 'https://www.bilibili.com' }

const CATALOG: CatalogCategory[] = [
  {
    id: 'reg-office-productivity',
    title: '效率办公',
    subCategories: [
      { id: 'reg-online-docs', title: '在线文档与表格', items: [{ id: 'docs-a', title: '文档 A' }, { id: 'docs-b', title: '文档 B' }] },
      { id: 'reg-mindmaps-and-boards', title: '思维导图与白板', items: [{ id: 'mind-a', title: '导图 A' }] },
    ],
  },
  {
    id: 'reg-learning-growth',
    title: '学习成长',
    subCategories: [
      { id: 'reg-online-courses', title: '在线课程', items: [{ id: 'course-a', title: '课程 A' }] },
      { id: 'reg-exam-prep', title: '考试备考', items: [{ id: 'exam-a', title: '国考报名入口' }, { id: 'exam-b', title: '查分' }] },
    ],
  },
  {
    id: 'reg-ai-tools',
    title: 'AI 工具',
    subCategories: [{ id: 'reg-chat-assistants', title: '对话助手', items: [{ id: 'chat-a', title: '对话 A' }] }],
  },
  {
    id: 'reg-public-services',
    title: '公共服务',
    subCategories: [{ id: 'reg-government-affairs', title: '政务办事', items: [{ id: 'gov-a', title: '政务 A' }] }],
  },
]

describe('defaultPersonalData / parsePersonalData', () => {
  it('空存储读出默认空数据，不算损坏', () => {
    expect(parsePersonalData(null)).toEqual({ data: defaultPersonalData(), corrupt: false })
    expect(parsePersonalData('')).toEqual({ data: defaultPersonalData(), corrupt: false })
    const d = defaultPersonalData()
    expect(d.version).toBe(1)
    expect(d.pinned).toEqual([])
    expect(d.customLinks).toEqual([])
    expect(d.scenes).toEqual([])
    expect(d.activeSceneId).toBeNull()
    expect(d.prefs.recordRecent).toBe(true)
  })

  it('坏 JSON 读出默认数据并标记 corrupt（调用方必须隔离、不覆盖原数据）', () => {
    const { data, corrupt } = parsePersonalData('{"pinned": [')
    expect(corrupt).toBe(true)
    expect(data).toEqual(defaultPersonalData())
  })

  it('结构非法（pinned 不是数组）同样 corrupt', () => {
    expect(parsePersonalData('{"version":1,"pinned":{}}').corrupt).toBe(true)
  })

  it('合法 v1 原样读出，未知字段丢弃', () => {
    const raw = JSON.stringify({ ...defaultPersonalData(), pinned: [SITE_A], unknownField: 1 })
    const { data, corrupt } = parsePersonalData(raw)
    expect(corrupt).toBe(false)
    expect(data.pinned).toEqual([SITE_A])
    expect((data as unknown as Record<string, unknown>).unknownField).toBeUndefined()
  })

  it('隔离键带时间戳，与 favorites-storage 同一形状', () => {
    expect(personalCorruptBackupKey(123)).toBe(`${PERSONAL_STORAGE_KEY}.corrupt.123`)
  })
})

describe('validatePersonalData', () => {
  it('合法数据通过', () => {
    const d = { ...defaultPersonalData(), pinned: [SITE_A] }
    expect(validatePersonalData(d).ok).toBe(true)
  })

  it('版本号不是 1 拒绝', () => {
    expect(validatePersonalData({ ...defaultPersonalData(), version: 2 }).ok).toBe(false)
  })

  it('pinned 里混入 javascript: 链接拒绝', () => {
    const d = { ...defaultPersonalData(), pinned: [{ siteId: 'x', title: 'X', href: 'javascript:alert(1)' }] }
    const r = validatePersonalData(d)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('场景角色非法拒绝', () => {
    const d = {
      ...defaultPersonalData(),
      scenes: [{ id: 's1', name: '工作', color: '#fff', siteIds: ['a'], roles: { a: 'boss' }, goal: 'g', builtin: false }],
    }
    expect(validatePersonalData(d).ok).toBe(false)
  })
})

describe('置顶收藏（上限 24）', () => {
  it('加入与取消', () => {
    let d = defaultPersonalData()
    const added = addPin(d, SITE_A)
    expect('error' in added).toBe(false)
    if ('data' in added) d = added.data
    expect(d.pinned.map((p) => p.siteId)).toEqual(['github'])
    // 重复固定不产生第二条
    const dup = addPin(d, SITE_A)
    expect('error' in dup).toBe(false)
    if ('data' in dup) expect(dup.data.pinned).toHaveLength(1)
    d = removePin(d, 'github')
    expect(d.pinned).toEqual([])
    // 取消不存在的 id 不报错、不改数据
    expect(removePin(d, 'nope')).toEqual(d)
  })

  it('第 25 个拒绝并报超限，原数据不动', () => {
    let d = defaultPersonalData()
    for (let i = 0; i < MAX_PINNED_SITES; i++) {
      const r = addPin(d, { siteId: `s${i}`, title: `站 ${i}`, href: `https://example.com/${i}` })
      expect('error' in r).toBe(false)
      if ('data' in r) d = r.data
    }
    expect(d.pinned).toHaveLength(MAX_PINNED_SITES)
    const over = addPin(d, { siteId: 's24', title: '站 24', href: 'https://example.com/24' })
    expect('error' in over).toBe(true)
    if ('error' in over) expect(over.error).toMatch(/24/)
    expect(d.pinned).toHaveLength(MAX_PINNED_SITES)
  })

  it('排序：移到指定位置，越界 clamp，未知 id 不动', () => {
    let d = defaultPersonalData()
    for (const s of [SITE_A, SITE_B, { siteId: 'c', title: 'C', href: 'https://c.example' }]) {
      const r = addPin(d, s)
      if ('data' in r) d = r.data
    }
    d = movePin(d, 'c', 0)
    expect(d.pinned.map((p) => p.siteId)).toEqual(['c', 'github', 'bilibili'])
    d = movePin(d, 'c', 99)
    expect(d.pinned.map((p) => p.siteId)).toEqual(['github', 'bilibili', 'c'])
    expect(movePin(d, 'nope', 0)).toEqual(d)
  })
})

describe('自定义链接', () => {
  it('仅收 http/https；无协议补 https；javascript/ftp/空串拒绝', () => {
    expect(validateCustomLinkUrl('https://example.com/a').ok).toBe(true)
    expect(validateCustomLinkUrl('http://example.com').ok).toBe(true)
    const bare = validateCustomLinkUrl('example.com/path')
    expect(bare.ok).toBe(true)
    if (bare.ok) expect(bare.url).toBe('https://example.com/path')
    expect(validateCustomLinkUrl('javascript:alert(1)').ok).toBe(false)
    expect(validateCustomLinkUrl('ftp://example.com').ok).toBe(false)
    expect(validateCustomLinkUrl('').ok).toBe(false)
    expect(validateCustomLinkUrl('http://').ok).toBe(false)
  })

  it('增删：名称必填、超长截断不静默接受；上限 100', () => {
    let d = defaultPersonalData()
    expect('error' in addCustomLink(d, '', 'https://example.com')).toBe(true)
    const r = addCustomLink(d, '我的站', 'example.com', 1000)
    expect('error' in r).toBe(false)
    if ('data' in r) {
      d = r.data
      expect(d.customLinks).toHaveLength(1)
      expect(d.customLinks[0]!.url).toBe('https://example.com/')
      expect(d.customLinks[0]!.createdAt).toBe(1000)
      d = removeCustomLink(d, d.customLinks[0]!.id)
      expect(d.customLinks).toEqual([])
    }
    // 上限
    let full = defaultPersonalData()
    for (let i = 0; i < MAX_CUSTOM_LINKS; i++) {
      const rr = addCustomLink(full, `站${i}`, `https://example.com/${i}`)
      if ('data' in rr) full = rr.data
    }
    expect('error' in addCustomLink(full, '再一个', 'https://example.com/x')).toBe(true)
  })
})

describe('字母徽标', () => {
  it('取首字：拉丁大写、中文原字、空名回退问号', () => {
    expect(letterBadgeFor('GitHub')).toBe('G')
    expect(letterBadgeFor('知乎')).toBe('知')
    expect(letterBadgeFor('  bilibili')).toBe('B')
    expect(letterBadgeFor('')).toBe('?')
    expect(letterBadgeFor('🎬猫眼')).toBe('🎬')
  })
})

describe('预置场景（只用现有分类生成，不新增人工编目）', () => {
  it('生成 4 个预置场景，站点只来自所给分类，角色与成功标准齐全', () => {
    const scenes = buildPresetScenes(CATALOG)
    expect(scenes.map((s) => s.id)).toEqual(['work', 'study', 'exam', 'daily'])
    expect(scenes.every((s) => s.builtin)).toBe(true)
    expect(scenes.every((s) => s.goal.trim().length > 0)).toBe(true)
    expect(scenes.every((s) => s.siteIds.length > 0 && s.siteIds.length <= 8)).toBe(true)
    const work = scenes.find((s) => s.id === 'work')!
    expect(work.siteIds).toContain('docs-a')
    expect(work.roles[work.siteIds[0]!]).toBe('main')
    const exam = scenes.find((s) => s.id === 'exam')!
    expect(exam.siteIds).toContain('exam-a')
    // 标题含报名/查分的站标为公告角色
    expect(exam.roles['exam-a']).toBe('notice')
    expect(exam.roles['exam-b']).toBe('notice')
  })

  it('分类缺失时对应场景为空列表，不崩、不编站', () => {
    const scenes = buildPresetScenes([])
    expect(scenes).toHaveLength(4)
    expect(scenes.every((s) => s.siteIds.length === 0)).toBe(true)
  })
})

describe('导出 / 导入', () => {
  it('导出含版本号与格式名；仅含收藏 ID、分组、偏好，不含计数器/历史/搜索词', () => {
    const d: PersonalData = {
      ...defaultPersonalData(),
      pinned: [SITE_A],
      counters: { ...defaultPersonalData().counters, pin: 5, personalClick: 9 },
    }
    const json = exportPersonalData(d)
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.format).toBe(PERSONAL_FORMAT)
    expect(parsed.version).toBe(PERSONAL_FORMAT_VERSION)
    expect(typeof parsed.exportedAt).toBe('string')
    const payload = parsed.data as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['activeSceneId', 'customLinks', 'pinned', 'prefs', 'scenes'])
    expect(json).not.toContain('personalClick')
    expect(json).not.toContain('counters')
  })

  it('导出 → 导入往返成功', () => {
    const d: PersonalData = {
      ...defaultPersonalData(),
      pinned: [SITE_A, SITE_B],
      scenes: [{ id: 'work', name: '工作', color: '#2563eb', siteIds: ['github'], roles: { github: 'main' }, goal: 'g', builtin: true }],
      activeSceneId: 'work',
    }
    const back = parsePersonalImport(exportPersonalData(d))
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.data.pinned).toEqual([SITE_A, SITE_B])
      expect(back.data.activeSceneId).toBe('work')
    }
  })

  it('坏文件拒绝：坏 JSON、格式名错、版本 2、置顶超 24、混入 javascript 链接', () => {
    expect(parsePersonalImport('{bad').ok).toBe(false)
    expect(parsePersonalImport(JSON.stringify({ format: 'other', version: 1, data: defaultPersonalData() })).ok).toBe(false)
    expect(parsePersonalImport(JSON.stringify({ format: PERSONAL_FORMAT, version: 2, data: defaultPersonalData() })).ok).toBe(false)
    const tooMany = { ...defaultPersonalData(), pinned: Array.from({ length: 25 }, (_, i) => ({ siteId: `s${i}`, title: 'x', href: 'https://e.com' })) }
    expect(parsePersonalImport(JSON.stringify({ format: PERSONAL_FORMAT, version: 1, data: tooMany })).ok).toBe(false)
    const badHref = { ...defaultPersonalData(), pinned: [{ siteId: 'x', title: 'X', href: 'javascript:1' }] }
    const r = parsePersonalImport(JSON.stringify({ format: PERSONAL_FORMAT, version: 1, data: badHref }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
  })

  it('导入合并：replace 整替、merge 按 id 并集；两种模式都保留本地计数器', () => {
    const current: PersonalData = {
      ...defaultPersonalData(),
      pinned: [SITE_A],
      counters: { ...defaultPersonalData().counters, pin: 7 },
    }
    const incoming: PersonalData = { ...defaultPersonalData(), pinned: [SITE_B] }
    const replaced = mergePersonalImport(current, incoming, 'replace')
    expect(replaced.pinned).toEqual([SITE_B])
    expect(replaced.counters.pin).toBe(7)
    const merged = mergePersonalImport(current, incoming, 'merge')
    expect(merged.pinned.map((p) => p.siteId).sort()).toEqual(['bilibili', 'github'])
    expect(merged.counters.pin).toBe(7)
    // merge 下重复 id 不翻倍
    const mergedDup = mergePersonalImport(current, { ...defaultPersonalData(), pinned: [SITE_A] }, 'merge')
    expect(mergedDup.pinned).toHaveLength(1)
  })
})

describe('存储适配（注入式，不碰真 localStorage）', () => {
  it('保存 → 读取往返；坏内容读出 corrupt', () => {
    const store = memoryStorage()
    const d: PersonalData = { ...defaultPersonalData(), pinned: [SITE_A] }
    expect(savePersonalData(store, d)).toEqual({ ok: true })
    const loaded = loadPersonalData(store)
    expect(loaded.corrupt).toBe(false)
    expect(loaded.data.pinned).toEqual([SITE_A])
    store.setItem(PERSONAL_STORAGE_KEY, 'not json{')
    expect(loadPersonalData(store).corrupt).toBe(true)
  })

  it('配额超限返回 quota，不抛错', () => {
    const r = savePersonalData(quotaStorage(), defaultPersonalData())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('quota')
  })

  it('用量统计只算个人数据相关键', () => {
    const store = memoryStorage({ [PERSONAL_STORAGE_KEY]: '{"a":1}', 'other-key': 'xxxx' })
    expect(storageUsageBytes(store)).toBe(new TextEncoder().encode('{"a":1}').length)
  })

  it('清除：个人键、最近快照键、频次键、暂停开关一起清', () => {
    const store = memoryStorage({
      [PERSONAL_STORAGE_KEY]: '{}',
      'navhub:recent-offline:v1': '[]',
      'navhub_visit_counts_v1': '{}',
      [RECENT_PAUSED_KEY]: '1',
    })
    clearAllPersonalData(store)
    expect(store.dump()).toEqual({})
  })

  it('最近记录开关：默认开，可关可开', () => {
    const store = memoryStorage()
    expect(isRecentRecordingPaused(store)).toBe(false)
    setRecentRecordingPaused(store, true)
    expect(isRecentRecordingPaused(store)).toBe(true)
    expect(store.dump()[RECENT_PAUSED_KEY]).toBe('1')
    setRecentRecordingPaused(store, false)
    expect(isRecentRecordingPaused(store)).toBe(false)
  })
})

describe('本地计数器（仅计数，无 URL/标题/时间戳明细）', () => {
  it('bumpCounter 只加指定项', () => {
    const d = bumpCounter(defaultPersonalData(), 'pin')
    expect(d.counters.pin).toBe(1)
    expect(d.counters.personalClick).toBe(0)
    expect(bumpCounter(d, 'exportCount').counters.exportCount).toBe(1)
  })

  it('最近上限常量为 8', () => {
    expect(MAX_RECENT_PERSONAL).toBe(8)
  })
})

describe('备份提醒（2026-11-27 命令面板 v2：14 天未导出提醒）', () => {
  const NOW = Date.parse('2026-11-27T20:00:00+08:00')
  const withContent = (over: Partial<PersonalData> = {}): PersonalData => ({
    ...defaultPersonalData(),
    pinned: [SITE_A],
    ...over,
  })

  it('默认两个时间戳都是 null；老 JSON 缺字段时补 null，不拒绝', () => {
    expect(defaultPersonalData().lastExportAt).toBeNull()
    expect(defaultPersonalData().backupReminderDismissedAt).toBeNull()
    const parsed = parsePersonalData(JSON.stringify({ ...defaultPersonalData(), pinned: [SITE_A] }))
    expect(parsed.corrupt).toBe(false)
    expect(parsed.data.lastExportAt).toBeNull()
    expect(parsed.data.backupReminderDismissedAt).toBeNull()
    // 非法时间戳只按 null 计，不整文件拒绝
    const dirty = parsePersonalData(
      JSON.stringify({ ...defaultPersonalData(), pinned: [SITE_A], lastExportAt: '昨天', backupReminderDismissedAt: -5 }),
    )
    expect(dirty.corrupt).toBe(false)
    expect(dirty.data.lastExportAt).toBeNull()
    expect(dirty.data.backupReminderDismissedAt).toBeNull()
  })

  it('没内容时不提醒（哪怕从未导出过）', () => {
    expect(hasPersonalContent(defaultPersonalData())).toBe(false)
    expect(backupReminderStatus(defaultPersonalData(), NOW)).toEqual({
      show: false,
      neverExported: false,
      daysOverdue: null,
    })
  })

  it('有内容、从未导出过 → 提醒（neverExported）', () => {
    expect(backupReminderStatus(withContent(), NOW)).toEqual({
      show: true,
      neverExported: true,
      daysOverdue: null,
    })
  })

  it('阈值 14 天：13 天不提醒，14 天整提醒并附天数，30 天附 30', () => {
    expect(BACKUP_REMINDER_AFTER_DAYS).toBe(14)
    expect(backupReminderStatus(withContent({ lastExportAt: NOW - 13 * MS_PER_DAY }), NOW).show).toBe(false)
    expect(backupReminderStatus(withContent({ lastExportAt: NOW - 14 * MS_PER_DAY }), NOW)).toEqual({
      show: true,
      neverExported: false,
      daysOverdue: 14,
    })
    expect(backupReminderStatus(withContent({ lastExportAt: NOW - 30 * MS_PER_DAY }), NOW).daysOverdue).toBe(30)
  })

  it('daysSinceLastExport：从未导出为 null；未来时间戳按 0 天计', () => {
    expect(daysSinceLastExport(null, NOW)).toBeNull()
    expect(daysSinceLastExport(NOW - 36 * 60 * 60 * 1000, NOW)).toBe(1)
    expect(daysSinceLastExport(NOW + MS_PER_DAY, NOW)).toBe(0)
  })

  it('关闭后 7 天内不提醒；第 8 天若仍未导出会再次出现', () => {
    expect(BACKUP_REMINDER_DISMISS_DAYS).toBe(7)
    const dismissed = withContent({
      lastExportAt: NOW - 30 * MS_PER_DAY,
      backupReminderDismissedAt: NOW - 6 * MS_PER_DAY,
    })
    expect(backupReminderStatus(dismissed, NOW).show).toBe(false)
    const expired = withContent({
      lastExportAt: NOW - 30 * MS_PER_DAY,
      backupReminderDismissedAt: NOW - 8 * MS_PER_DAY,
    })
    expect(backupReminderStatus(expired, NOW).show).toBe(true)
  })

  it('导入 replace/merge 都保留本地 lastExportAt 与关闭时间（不被备份文件清零）', () => {
    const current = withContent({ lastExportAt: NOW - 20 * MS_PER_DAY, backupReminderDismissedAt: NOW - MS_PER_DAY })
    const incoming: PersonalData = { ...defaultPersonalData(), pinned: [SITE_B] }
    const replaced = mergePersonalImport(current, incoming, 'replace')
    expect(replaced.pinned).toEqual([SITE_B])
    expect(replaced.lastExportAt).toBe(NOW - 20 * MS_PER_DAY)
    expect(replaced.backupReminderDismissedAt).toBe(NOW - MS_PER_DAY)
    const merged = mergePersonalImport(current, incoming, 'merge')
    expect(merged.lastExportAt).toBe(NOW - 20 * MS_PER_DAY)
    expect(merged.backupReminderDismissedAt).toBe(NOW - MS_PER_DAY)
  })

  it('导出文件不含备份时间戳（设备本地状态，与计数器同口径）', () => {
    const json = exportPersonalData(withContent({ lastExportAt: NOW }))
    expect(json).not.toContain('lastExportAt')
    expect(json).not.toContain('backupReminderDismissedAt')
  })
})
