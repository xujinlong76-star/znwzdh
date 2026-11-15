/**
 * 我的场景 — 单元测试（纯函数 + 假 storage）。
 *
 * 只测 lib/modular/user-scenes.ts；不碰 DOM、不发网络。
 */
import { describe, expect, it } from 'vitest'
import {
  INCOMPLETE_SWITCH_KEY,
  MAX_USER_SCENES,
  USER_SCENES_KEY,
  cleanLastSwitchBackup,
  cleanUserScenesDoc,
  createUserScene,
  defaultSceneName,
  deleteUserScene,
  derivePinnedSites,
  emptyUserScenesDoc,
  loadUserScenes,
  markSceneSwitchStarted,
  markSceneUsed,
  readIncompleteSwitchFlag,
  renameUserScene,
  saveUserScenes,
  setDefaultUserScene,
  updateSceneFromCurrent,
  reconcileActiveSceneId,
  type CurrentSceneState,
  type LastSwitchBackup,
  type UserSceneStorage,
  type UserScenesDoc,
} from '@/lib/modular/user-scenes'
import { DEFAULT_CONFIG, type HomeDIYConfig } from '@/lib/modular/home-diy-storage'

function makeStorage(initial: Record<string, string> = {}): UserSceneStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

function layout(overrides: Partial<HomeDIYConfig> = {}): HomeDIYConfig {
  return { ...DEFAULT_CONFIG, ...overrides, updatedAt: 1000 }
}

function state(overrides: Partial<CurrentSceneState> = {}): CurrentSceneState {
  return {
    pinnedSiteIds: ['site-a', 'site-b'],
    theme: { skinSlug: null, skinName: null, mode: null },
    layout: layout(),
    workspaceFilter: null,
    ...overrides,
  }
}

function docWithScenes(count: number): UserScenesDoc {
  let doc = emptyUserScenesDoc()
  for (let i = 0; i < count; i += 1) {
    const created = createUserScene(doc, { name: `场景 ${i + 1}`, state: state() })
    expect(created.ok).toBe(true)
    doc = created.doc as UserScenesDoc
  }
  return doc
}

describe('校验与损坏处理', () => {
  it('损坏 JSON → 备份原始串 + 返回空 doc，不抛', () => {
    const storage = makeStorage({ [USER_SCENES_KEY]: '{not json' })
    const loaded = loadUserScenes(storage)
    expect(loaded.corrupt).toBe(true)
    expect(loaded.doc.scenes).toEqual([])
    expect(loaded.backupKey).toContain(`${USER_SCENES_KEY}.corrupt.`)
    expect(storage.map.get(loaded.backupKey as string)).toBe('{not json')
  })

  it('缺字段 / 非法枚举 / 超长名称 / 非法站点 id 有丢弃台账', () => {
    const raw = {
      version: 1,
      scenes: [
        {
          id: 'scene_ok',
          name: '工作场景名称超过二十个字的工作场景名称超过二十个字',
          pinnedSiteIds: ['site-a', 'bad id!', 'site-a'],
          theme: { skinSlug: 'deep-sea', mode: 'nope' },
          layout: layout(),
          workspaceFilter: 'nope',
          createdAt: 1,
          updatedAt: 1,
        },
        { id: 'scene_broken', name: '', pinnedSiteIds: [], theme: {}, layout: { nope: true } },
        { id: 'scene_broken2', name: '坏布局', pinnedSiteIds: [], theme: {}, layout: null },
      ],
      activeSceneId: 'scene_ok',
      defaultSceneId: 'scene_ok',
      updatedAt: 1,
    }
    const { doc, dropped, notes } = cleanUserScenesDoc(raw)
    expect(doc.scenes).toHaveLength(1)
    expect(doc.scenes[0].name.length).toBeLessThanOrEqual(20)
    expect(doc.scenes[0].pinnedSiteIds).toEqual(['site-a'])
    expect(doc.scenes[0].theme.mode).toBeNull()
    expect(doc.scenes[0].workspaceFilter).toBeNull()
    expect(dropped).toBe(2)
    expect(notes.join('\n')).toContain('超长')
    expect(doc.activeSceneId).toBe('scene_ok')
  })

  it('activeSceneId 指向不存在的场景 → 启动自检清 null', () => {
    const doc = docWithScenes(1)
    const { doc: cleared, cleared: wasCleared } = reconcileActiveSceneId({
      ...doc,
      activeSceneId: 'scene_missing',
    })
    expect(wasCleared).toBe(true)
    expect(cleared.activeSceneId).toBeNull()
    expect(reconcileActiveSceneId(doc).cleared).toBe(false)
  })

  it('写不进去（配额满）返回 false', () => {
    const storage = makeStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(saveUserScenes(storage, emptyUserScenesDoc())).toBe(false)
  })
})

describe('切换前备份 lastSwitchBackup：加载时保留', () => {
  function backup(overrides: Partial<LastSwitchBackup> = {}): LastSwitchBackup {
    return {
      diyConfig: layout({ viewMode: 'classic' }),
      theme: { slug: 'deep-sea', name: '深海', tokens: { '--background': '#001122' }, accent: 'ocean', appliedAt: 5 },
      mode: 'light',
      activeSceneId: null,
      createdAt: 7,
      ...overrides,
    }
  }

  it('save→load 往返：含备份的 doc 存下来再加载，备份仍在且可用', () => {
    const base = docWithScenes(1)
    const doc = markSceneUsed(base, base.scenes[0].id)
    const withBackup: UserScenesDoc = { ...doc, lastSwitchBackup: backup({ activeSceneId: doc.scenes[0].id }) }
    const storage = makeStorage()
    expect(saveUserScenes(storage, withBackup)).toBe(true)
    const loaded = loadUserScenes(storage)
    expect(loaded.incompleteSwitch).toBe(false)
    const restored = loaded.doc.lastSwitchBackup
    expect(restored).not.toBeNull()
    expect(restored?.diyConfig.viewMode).toBe('classic')
    expect(restored?.theme?.slug).toBe('deep-sea')
    expect(restored?.theme?.accent).toBe('ocean')
    expect(restored?.mode).toBe('light')
    expect(restored?.activeSceneId).toBe(doc.scenes[0].id)
  })

  it('脏备份被丢弃：布局校验不通过 → 备份整体丢弃并记台账，场景本身不受影响', () => {
    const raw = {
      version: 1,
      scenes: [{ id: 'scene_ok', name: '工作', pinnedSiteIds: [], theme: {}, layout: layout(), createdAt: 1, updatedAt: 1 }],
      activeSceneId: 'scene_ok',
      defaultSceneId: null,
      lastSwitchBackup: { diyConfig: { nope: true }, theme: null, mode: 'light', activeSceneId: null, createdAt: 1 },
      updatedAt: 1,
    }
    const { doc, notes } = cleanUserScenesDoc(raw)
    expect(doc.scenes).toHaveLength(1)
    expect(doc.lastSwitchBackup).toBeNull()
    expect(notes.join('\n')).toContain('切换前备份的布局数据已损坏，已丢弃该备份')
  })

  it('备份主题按字段校验：非法 accent 丢弃、缺 slug 丢弃皮肤部分，布局备份仍保留', () => {
    const badAccent = cleanLastSwitchBackup(
      backup({ theme: { slug: 'deep-sea', name: '深海', accent: 'not-a-color' as never, appliedAt: 5 } }),
      [],
    )
    expect(badAccent).not.toBeNull()
    expect(badAccent?.theme?.slug).toBe('deep-sea')
    expect(badAccent?.theme?.accent).toBeUndefined()
    const noSlug = cleanLastSwitchBackup(
      backup({ theme: { slug: '', name: '无名', appliedAt: 5 } }),
      [],
    )
    expect(noSlug).not.toBeNull()
    expect(noSlug?.theme).toBeNull()
    expect(noSlug?.diyConfig.viewMode).toBe('classic')
    expect(cleanLastSwitchBackup(null, [])).toBeNull()
    expect(cleanLastSwitchBackup({ diyConfig: layout() }, [])).not.toBeNull()
  })
})

describe('切换未完成旗标 incomplete-switch', () => {
  it('设置旗标 → 加载 → 标注出现且 activeSceneId 被清；旗标只消费一次', () => {
    const doc = docWithScenes(1)
    const active = markSceneUsed(doc, doc.scenes[0].id)
    const storage = makeStorage()
    expect(saveUserScenes(storage, active)).toBe(true)
    expect(markSceneSwitchStarted(storage, doc.scenes[0].id)).toBe(true)
    expect(readIncompleteSwitchFlag(storage)?.sceneId).toBe(doc.scenes[0].id)

    const loaded = loadUserScenes(storage)
    expect(loaded.incompleteSwitch).toBe(true)
    expect(loaded.doc.activeSceneId).toBeNull()
    expect(loaded.doc.scenes).toHaveLength(1)
    expect(loaded.notes.join('\n')).toContain('上次切换未完成')
    // 旗标已被本次加载消费：键已清，下次加载不再标注
    expect(storage.map.get(INCOMPLETE_SWITCH_KEY)).toBeUndefined()
    const again = loadUserScenes(storage)
    expect(again.incompleteSwitch).toBe(false)
    // load 本身不写盘：清掉的 activeSceneId 由调用方（useUserScenes.refresh）落盘，
    // 所以第二次加载读到的仍是盘上原值，只是不再重复标注
    expect(again.doc.activeSceneId).toBe(doc.scenes[0].id)
  })

  it('损坏的旗标内容当无旗标，不抛、不标注', () => {
    const storage = makeStorage({ [INCOMPLETE_SWITCH_KEY]: '{broken' })
    expect(readIncompleteSwitchFlag(storage)).toBeNull()
    const loaded = loadUserScenes(storage)
    expect(loaded.incompleteSwitch).toBe(false)
  })
})

describe('CRUD', () => {
  it('新建从当前状态捕获三件套齐全', () => {
    const created = createUserScene(emptyUserScenesDoc(), {
      name: '工作',
      state: state({
        pinnedSiteIds: ['site-a', 'site-b'],
        theme: { skinSlug: 'deep-sea', skinName: '深海', mode: 'dark' },
        layout: layout({ viewMode: 'classic', canvasBackground: 'grid' }),
        workspaceFilter: 'dev',
      }),
    })
    expect(created.ok).toBe(true)
    const scene = created.scene as NonNullable<typeof created.scene>
    expect(scene.pinnedSiteIds).toEqual(['site-a', 'site-b'])
    expect(scene.theme).toEqual({ skinSlug: 'deep-sea', skinName: '深海', mode: 'dark' })
    expect(scene.layout.viewMode).toBe('classic')
    expect(scene.layout.canvasBackground).toBe('grid')
    expect(scene.workspaceFilter).toBe('dev')
    expect(scene.id.startsWith('scene_')).toBe(true)
  })

  it('重名允许但 duplicateName 提醒；空名拒绝', () => {
    const doc = docWithScenes(1)
    const created = createUserScene(doc, { name: '场景 1', state: state() })
    expect(created.ok).toBe(true)
    expect(created.duplicateName).toBe(true)
    expect(createUserScene(doc, { name: '   ', state: state() }).ok).toBe(false)
  })

  it('重命名：超长截断、重名提醒', () => {
    const doc = docWithScenes(2)
    const renamed = renameUserScene(doc, doc.scenes[0].id, '学习学习学习学习学习学习学习学习学习学习学习')
    expect(renamed.ok).toBe(true)
    expect(renamed.doc?.scenes[0].name.length).toBeLessThanOrEqual(20)
    const dup = renameUserScene(doc, doc.scenes[0].id, '场景 2')
    expect(dup.duplicateName).toBe(true)
  })

  it('删除：activeSceneId / defaultSceneId 连带清理', () => {
    const doc = docWithScenes(2)
    const active = markSceneUsed(doc, doc.scenes[0].id)
    const withDefault = setDefaultUserScene(active, active.scenes[0].id).doc as UserScenesDoc
    const deleted = deleteUserScene(withDefault, withDefault.scenes[0].id)
    expect(deleted.ok).toBe(true)
    expect(deleted.wasActive).toBe(true)
    expect(deleted.wasDefault).toBe(true)
    expect(deleted.doc?.activeSceneId).toBeNull()
    expect(deleted.doc?.defaultSceneId).toBeNull()
    expect(deleted.doc?.scenes).toHaveLength(1)
  })

  it('设默认：不存在的场景拒绝；可清掉默认', () => {
    const doc = docWithScenes(1)
    expect(setDefaultUserScene(doc, 'scene_missing').ok).toBe(false)
    const set = setDefaultUserScene(doc, doc.scenes[0].id)
    expect(set.doc?.defaultSceneId).toBe(doc.scenes[0].id)
    expect(setDefaultUserScene(set.doc as UserScenesDoc, null).doc?.defaultSceneId).toBeNull()
  })

  it('上限 8 个到顶拒绝', () => {
    const doc = docWithScenes(MAX_USER_SCENES)
    const created = createUserScene(doc, { name: '再建一个', state: state() })
    expect(created.ok).toBe(false)
    expect(created.reason).toContain('8')
  })

  it('一键存为场景默认名取第一个未被占用的「场景 N」', () => {
    const doc = docWithScenes(2)
    expect(defaultSceneName(doc)).toBe('场景 3')
    expect(defaultSceneName(emptyUserScenesDoc())).toBe('场景 1')
  })
})

describe('置顶派生', () => {
  const index = new Map([
    ['a', { id: 'a', title: 'A 站', categoryId: 'cat-dev' }],
    ['b', { id: 'b', title: 'B 站', categoryId: 'cat-dev' }],
    ['c', { id: 'c', title: 'C 站', categoryId: 'cat-design' }],
    ['d', { id: 'd', title: 'D 站', categoryId: 'custom-1' }],
  ])

  it('扁平列表 → 坞直写 + 分类映射派生（含自定义分类）', () => {
    const derived = derivePinnedSites(['a', 'c', 'b', 'd'], index)
    expect(derived.dockIds).toEqual(['a', 'c', 'b', 'd'])
    expect(derived.byCategory).toEqual({ 'cat-dev': ['a', 'b'], 'cat-design': ['c'], 'custom-1': ['d'] })
    expect(derived.removed).toEqual([])
  })

  it('站点改分类后按新分类派生；已删 id 被剪掉并计数', () => {
    const moved = new Map(index)
    moved.set('a', { id: 'a', title: 'A 站', categoryId: 'cat-design' })
    const derived = derivePinnedSites(['a', 'gone-1', 'gone-2', 'b', 'a'], moved)
    expect(derived.dockIds).toEqual(['a', 'b'])
    expect(derived.byCategory).toEqual({ 'cat-design': ['a'], 'cat-dev': ['b'] })
    expect(derived.removed).toHaveLength(2)
  })
})

describe('内嵌快照语义', () => {
  it('改布局后场景不变；「用当前状态更新」后才变', () => {
    const doc = docWithScenes(1)
    const scene = doc.scenes[0]
    expect(scene.layout.viewMode).toBe('hybrid')
    // 布局改了：场景记录里的 layout 还是旧的（有意为之，不是 bug）
    const updated = updateSceneFromCurrent(doc, scene.id, state({
      layout: layout({ viewMode: 'classic', canvasBackground: 'aurora' }),
      pinnedSiteIds: ['site-x'],
    }))
    expect(updated.ok).toBe(true)
    const next = updated.doc?.scenes[0]
    expect(next?.layout.viewMode).toBe('classic')
    expect(next?.layout.canvasBackground).toBe('aurora')
    expect(next?.pinnedSiteIds).toEqual(['site-x'])
    // 原 doc 不变
    expect(doc.scenes[0].layout.viewMode).toBe('hybrid')
  })

  it('更新不存在的场景拒绝', () => {
    expect(updateSceneFromCurrent(emptyUserScenesDoc(), 'scene_missing', state()).ok).toBe(false)
  })
})
