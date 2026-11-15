/**
 * 场景切换 — 守卫测试（红线级，node 环境无 jsdom）。
 *
 * 半切换否决 / 脏场景否决 / 回滚 / 删除回落 / 深色暂停 / data-accent
 * 优先全部走可注入的假 deps；DOM 行为（data-accent 的最终落点）按
 * 仓库惯例补源码守卫：use-home-diy 的 effect 必须经
 * resolveDiyDataAccent 裁决，皮肤 accent 优先于 DIY accentColor。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyScene, deleteActiveSceneFallback, resolvePostSwitchDark, rollbackSceneSwitch, sceneSwitchSuccessText, type SceneApplyDeps } from '@/lib/modular/scene-apply'
import { buildLiveSceneDeps, buildLiveSceneDepsAsync } from '@/lib/modular/scene-apply-live'
import { resolveDiyDataAccent, DEFAULT_CONFIG, type HomeDIYConfig } from '@/lib/modular/home-diy-storage'
import {
  USER_SCENES_KEY,
  deleteUserScene,
  emptyUserScenesDoc,
  createUserScene,
  loadUserScenes,
  markSceneUsed,
  setDefaultUserScene,
  type UserScene,
  type UserSceneStorage,
  type UserScenesDoc,
} from '@/lib/modular/user-scenes'
import { isThemeSuspended } from '@/lib/plugins/theme-runtime'

function layout(overrides: Partial<HomeDIYConfig> = {}): HomeDIYConfig {
  return { ...DEFAULT_CONFIG, ...overrides, updatedAt: 1000 }
}

function makeScene(overrides: Partial<UserScene> = {}): UserScene {
  return {
    id: 'scene_work',
    name: '工作',
    pinnedSiteIds: ['site-a', 'site-b'],
    theme: { skinSlug: 'deep-sea', skinName: '深海', mode: 'dark' },
    layout: layout({ viewMode: 'classic', accentColor: 'rose' }),
    workspaceFilter: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

interface FakeWorld {
  diy: HomeDIYConfig
  theme: { slug: string; name: string; tokens?: Record<string, string>; accent?: string } | null
  mode: string | null
  dark: boolean
  calls: string[]
  failCommitAfter?: number
  failSetTheme?: boolean
}

function makeDeps(world: FakeWorld, themeDeps?: SceneApplyDeps['themeDeps']): SceneApplyDeps {
  let commits = 0
  return {
    getDiyConfig: () => world.diy,
    commitDiy: (updater) => {
      world.calls.push('commitDiy')
      commits += 1
      if (world.failCommitAfter !== undefined && commits > world.failCommitAfter) {
        throw new Error('commit boom')
      }
      world.diy = updater(world.diy)
      return { ok: true }
    },
    getActiveTheme: () => world.theme as never,
    setActiveTheme: (config) => {
      world.calls.push('setActiveTheme')
      // 只失败一次：模拟「主题应用那一刻抛错」，回滚时的再次应用应成功
      if (world.failSetTheme) {
        world.failSetTheme = false
        throw new Error('theme boom')
      }
      world.theme = { ...config }
    },
    resetTheme: () => {
      world.calls.push('resetTheme')
      world.theme = null
    },
    getMode: () => world.mode,
    setMode: (mode) => {
      world.calls.push('setMode')
      world.mode = mode
    },
    isDarkMode: () => world.dark,
    saveSnapshot: () => ({ id: 'snap_1' }),
    siteIndex: new Map([
      ['site-a', { id: 'site-a', title: 'A 站', categoryId: 'cat-dev' }],
      ['site-b', { id: 'site-b', title: 'B 站', categoryId: 'cat-design' }],
      ['site-c', { id: 'site-c', title: 'C 站', categoryId: 'cat-dev' }],
    ]),
    themeDeps,
  }
}

const GOOD_THEME_DEPS: SceneApplyDeps['themeDeps'] = {
  installPlugin: async () => ({}),
  fetchPluginDetail: async () => ({
    plugin: {
      name: '深海',
      manifest: { payload: { tokens: { '--background': '#001122' }, accent: 'ocean' as never } },
    },
  }),
  installedSlugs: new Set(),
}

function docWith(scene: UserScene): UserScenesDoc {
  const created = createUserScene(emptyUserScenesDoc(), {
    name: scene.name,
    state: { pinnedSiteIds: scene.pinnedSiteIds, theme: scene.theme, layout: scene.layout, workspaceFilter: scene.workspaceFilter },
  })
  const doc = created.doc as UserScenesDoc
  // createUserScene 生成新 id；测试用固定 id 的场景对象时，把 doc 里的场景换成它
  return { ...doc, scenes: [scene] }
}

describe('半切换否决', () => {
  it('皮肤安装失败 → DIY 配置、明暗、activeSceneId 全 untouched', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const beforeDiy = world.diy
    const deps = makeDeps(world, {
      installPlugin: async () => {
        throw new Error('network down')
      },
      fetchPluginDetail: async () => null,
    })
    const doc = docWith(makeScene())
    const result = await applyScene(makeScene(), doc, deps)
    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('theme-install')
    expect(world.diy).toBe(beforeDiy)
    expect(world.mode).toBe('light')
    expect(world.theme).toBeNull()
    expect(world.calls).toEqual([])
    expect(result.rolledBack).toBe(false)
  })

  it('皮肤拉取失败同理：什么都不改', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const deps = makeDeps(world, {
      installPlugin: async () => ({}),
      fetchPluginDetail: async () => null,
    })
    const result = await applyScene(makeScene(), docWith(makeScene()), deps)
    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('theme-payload')
    expect(world.calls).toEqual([])
  })
})

describe('脏场景否决', () => {
  it('layout 校验 invalid → 中止，什么都不改', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const dirty = makeScene({ layout: { nope: true } as unknown as HomeDIYConfig })
    const result = await applyScene(dirty, docWith(makeScene()), deps)
    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('layout')
    expect(result.reason).toContain('损坏')
    expect(world.calls).toEqual([])
  })
})

describe('成功切换：一次提交 + 三件套 + toast 点名', () => {
  it('DIY 一次提交、皮肤后于 DIY、明暗最后；activeSceneId 与 lastUsedAt 落盘', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const scene = makeScene()
    const result = await applyScene(scene, docWith(scene), deps)
    expect(result.ok).toBe(true)
    expect(world.calls).toEqual(['commitDiy', 'setActiveTheme', 'setMode'])
    expect(world.diy.viewMode).toBe('classic')
    expect(world.diy.speedDialPinnedIds).toEqual(['site-a', 'site-b'])
    expect(world.diy.speedDialEnabled).toBe(true)
    expect(world.diy.pinnedSiteIdsByCategory).toEqual({ 'cat-dev': ['site-a'], 'cat-design': ['site-b'] })
    expect(world.theme?.slug).toBe('deep-sea')
    expect(world.mode).toBe('dark')
    expect(result.doc?.activeSceneId).toBe('scene_work')
    expect(result.doc?.scenes[0].lastUsedAt).toBeGreaterThan(0)
    expect(result.summary?.pinnedCount).toBe(2)
    expect(result.summary?.skinName).toBe('深海')
    const text = sceneSwitchSuccessText('工作', result.summary as NonNullable<typeof result.summary>)
    expect(text).toContain('置顶 2 个站点')
    expect(text).toContain('皮肤「深海」')
    expect(text).toContain('布局「经典全景流')
    expect(text).not.toBe('已切换到工作')
  })

  it('skinSlug 为空时 resetTheme；mode 为空时不明暗不动', async () => {
    const world: FakeWorld = { diy: layout(), theme: { slug: 'old', name: '旧皮肤' }, mode: 'light', dark: false, calls: [] }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const scene = makeScene({ theme: { skinSlug: null, skinName: null, mode: null } })
    const result = await applyScene(scene, docWith(scene), deps)
    expect(result.ok).toBe(true)
    expect(world.calls).toEqual(['commitDiy', 'resetTheme'])
    expect(world.theme).toBeNull()
    expect(world.mode).toBe('light')
  })

  it('已删置顶被剪掉并计数，不阻断切换', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const scene = makeScene({ pinnedSiteIds: ['site-a', 'gone-1', 'site-c'] })
    const result = await applyScene(scene, docWith(scene), deps)
    expect(result.ok).toBe(true)
    expect(result.removed).toHaveLength(1)
    expect(world.diy.speedDialPinnedIds).toEqual(['site-a', 'site-c'])
  })

  it('空置顶列表 → 速览坞关闭（speedDialEnabled=false）', async () => {
    const world: FakeWorld = {
      diy: layout({ speedDialEnabled: true, speedDialPinnedIds: ['site-a'] }),
      theme: null,
      mode: 'light',
      dark: false,
      calls: [],
    }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const scene = makeScene({ pinnedSiteIds: [] })
    const result = await applyScene(scene, docWith(scene), deps)
    expect(result.ok).toBe(true)
    expect(world.diy.speedDialEnabled).toBe(false)
    expect(world.diy.speedDialPinnedIds).toEqual([])
  })
})

describe('失败回滚', () => {
  it('DIY 提交后、主题应用前注入失败 → 三件套恢复到切换前值，activeSceneId 不变', async () => {
    const beforeDiy = layout({ viewMode: 'hybrid' })
    const world: FakeWorld = {
      diy: beforeDiy,
      theme: { slug: 'old', name: '旧皮肤' },
      mode: 'light',
      dark: false,
      calls: [],
      failSetTheme: true,
    }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const scene = makeScene()
    const doc = markSceneUsed(docWith(scene), 'scene_work')
    const result = await applyScene(scene, doc, deps)
    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('theme-apply')
    expect(result.rolledBack).toBe(true)
    expect(world.diy.viewMode).toBe('hybrid')
    expect(world.theme?.slug).toBe('old')
    expect(world.mode).toBe('light')
    // activeSceneId 不改：仍指向切换前的场景（doc 本身未被调用方保存）
    expect(result.doc).toBeUndefined()
  })

  it('rollbackSceneSwitch 直接还原三件套', () => {
    const world: FakeWorld = {
      diy: layout({ viewMode: 'classic' }),
      theme: { slug: 'new', name: '新皮肤' },
      mode: 'dark',
      dark: false,
      calls: [],
    }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const backup = {
      diyConfig: layout({ viewMode: 'hybrid' }),
      theme: { slug: 'old', name: '旧皮肤', appliedAt: 1 },
      mode: 'light',
      activeSceneId: null,
      createdAt: 1,
    }
    expect(rollbackSceneSwitch(backup, deps)).toBe(true)
    expect(world.diy.viewMode).toBe('hybrid')
    expect(world.theme?.slug).toBe('old')
    expect(world.mode).toBe('light')
  })
})

describe('删除回落', () => {
  it('有默认场景 → 回落到默认；无默认但有备份 → 恢复备份；都没有 → 原地不动', () => {
    const work = makeScene({ id: 'scene_work', name: '工作' })
    const study = makeScene({ id: 'scene_study', name: '学习', theme: { skinSlug: null, skinName: null, mode: null } })
    let doc = docWith(work)
    doc = { ...doc, scenes: [work, study] }
    doc = setDefaultUserScene(doc, 'scene_study').doc as UserScenesDoc
    const toDefault = deleteActiveSceneFallback(doc, 'scene_work')
    expect(toDefault.kind).toBe('switch-to-default')
    if (toDefault.kind === 'switch-to-default') expect(toDefault.scene.id).toBe('scene_study')

    const withBackup: UserScenesDoc = {
      ...doc,
      defaultSceneId: null,
      lastSwitchBackup: {
        diyConfig: layout(),
        theme: null,
        mode: 'light',
        activeSceneId: null,
        createdAt: 1,
      },
    }
    expect(deleteActiveSceneFallback(withBackup, 'scene_work').kind).toBe('restore-backup')
    expect(deleteActiveSceneFallback({ ...withBackup, lastSwitchBackup: null }, 'scene_work').kind).toBe('stay-put')
  })

  it('跨加载的删除回落：经 loadUserScenes 加载含备份的 doc 后删当前场景 → restore-backup 而非 stay-put', () => {
    const work = makeScene({ id: 'scene_work', name: '工作' })
    const storage: UserSceneStorage & { map: Map<string, string> } = {
      map: new Map(),
      getItem: function (k) {
        return this.map.get(k) ?? null
      },
      setItem: function (k, v) {
        this.map.set(k, v)
      },
      removeItem: function (k) {
        this.map.delete(k)
      },
    }
    const rawDoc = {
      version: 1,
      scenes: [work],
      activeSceneId: 'scene_work',
      defaultSceneId: null,
      lastSwitchBackup: {
        diyConfig: layout({ viewMode: 'hybrid' }),
        theme: null,
        mode: 'light',
        activeSceneId: null,
        createdAt: 1,
      },
      updatedAt: 1,
    }
    storage.setItem(USER_SCENES_KEY, JSON.stringify(rawDoc))
    // 模拟刷新/重开浏览器：重新加载 doc（此前这里会把 lastSwitchBackup 写死丢弃）
    const loaded = loadUserScenes(storage)
    expect(loaded.doc.lastSwitchBackup).not.toBeNull()
    expect(loaded.doc.lastSwitchBackup?.diyConfig.viewMode).toBe('hybrid')
    const deleted = deleteUserScene(loaded.doc, 'scene_work')
    expect(deleted.wasActive).toBe(true)
    const fallback = deleteActiveSceneFallback(deleted.doc as UserScenesDoc, 'scene_work')
    expect(fallback.kind).toBe('restore-backup')
    if (fallback.kind === 'restore-backup') {
      expect(fallback.backup.diyConfig.viewMode).toBe('hybrid')
      expect(fallback.backup.mode).toBe('light')
    }
  })

  it('回落链里绝不出现 DEFAULT_CONFIG', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/lib/modular/scene-apply.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/deleteActiveSceneFallback[\s\S]{0,2000}DEFAULT_CONFIG/)
    expect(source).toContain("kind: 'stay-put'")
  })
})

describe('suspended 按切换后目标状态算（不读切换瞬间的 document class）', () => {
  function withMatchMedia(matches: boolean): () => void {
    const prev = (globalThis as unknown as { window?: unknown }).window
    ;(globalThis as unknown as { window?: unknown }).window = {
      matchMedia: (query: string) => ({ matches, media: query }),
    }
    return () => {
      if (prev === undefined) delete (globalThis as unknown as { window?: unknown }).window
      else (globalThis as unknown as { window?: unknown }).window = prev
    }
  }

  it('light→dark 带皮肤：切换前还是浅色，summary.suspended 也为真（旧实现会漏提示）', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const result = await applyScene(makeScene(), docWith(makeScene()), deps)
    expect(result.ok).toBe(true)
    expect(result.summary?.suspended).toBe(true)
  })

  it('dark→light 带皮肤：切换前还是深色，summary.suspended 为假（旧实现会多一句）', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'dark', dark: true, calls: [] }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const scene = makeScene({ theme: { skinSlug: 'deep-sea', skinName: '深海', mode: 'light' } })
    const result = await applyScene(scene, docWith(scene), deps)
    expect(result.ok).toBe(true)
    expect(result.summary?.suspended).toBe(false)
  })

  it('mode 为 system：按 matchMedia 现算，深色系统 → 暂停，浅色系统 → 不暂停', () => {
    const fakeDeps = { isDarkMode: () => false } as unknown as SceneApplyDeps
    const systemScene = makeScene({ theme: { skinSlug: 'deep-sea', skinName: '深海', mode: 'system' } })
    const restoreDark = withMatchMedia(true)
    try {
      expect(resolvePostSwitchDark(systemScene, fakeDeps)).toBe(true)
    } finally {
      restoreDark()
    }
    const restoreLight = withMatchMedia(false)
    try {
      expect(resolvePostSwitchDark(systemScene, fakeDeps)).toBe(false)
    } finally {
      restoreLight()
    }
  })

  it('mode 为 null（不动模式）：保持切换前状态', () => {
    const noMode = makeScene({ theme: { skinSlug: 'deep-sea', skinName: '深海', mode: null } })
    expect(resolvePostSwitchDark(noMode, { isDarkMode: () => true } as unknown as SceneApplyDeps)).toBe(true)
    expect(resolvePostSwitchDark(noMode, { isDarkMode: () => false } as unknown as SceneApplyDeps)).toBe(false)
  })
})

describe('真机路径：已装皮肤跳过安装', () => {
  function countingThemeDeps(installed: ReadonlySet<string>): {
    themeDeps: NonNullable<SceneApplyDeps['themeDeps']>
    installs: () => number
  } {
    let installs = 0
    return {
      themeDeps: {
        installPlugin: async () => {
          installs += 1
          return {}
        },
        fetchPluginDetail: async () => ({
          plugin: {
            name: '深海',
            manifest: { payload: { tokens: { '--background': '#001122' }, accent: 'ocean' as never } },
          },
        }),
        installedSlugs: installed,
      },
      installs: () => installs,
    }
  }

  it('已装皮肤切换时 installPlugin 不被调用', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const { themeDeps, installs } = countingThemeDeps(new Set(['deep-sea']))
    const live = buildLiveSceneDeps({
      getMode: () => 'light',
      setMode: () => {},
      installedSlugs: new Set(['deep-sea']),
      themeDeps,
    })
    // buildLiveSceneDeps 只负责接线：DIY 读写仍用假实现，只断言 themeDeps 的传递
    const deps = makeDeps(world, live.themeDeps)
    const result = await applyScene(makeScene(), docWith(makeScene()), deps)
    expect(result.ok).toBe(true)
    expect(installs()).toBe(0)
  })

  it('未装皮肤切换时仍先安装', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const { themeDeps, installs } = countingThemeDeps(new Set())
    const live = buildLiveSceneDeps({
      getMode: () => 'light',
      setMode: () => {},
      installedSlugs: new Set(),
      themeDeps,
    })
    const deps = makeDeps(world, live.themeDeps)
    const result = await applyScene(makeScene(), docWith(makeScene()), deps)
    expect(result.ok).toBe(true)
    expect(installs()).toBe(1)
  })

  it('buildLiveSceneDepsAsync：已装列表拉到 → 跳过安装；拉取失败 → 回落先安装，不阻断切换', async () => {
    let installs = 0
    const themeDeps: NonNullable<SceneApplyDeps['themeDeps']> = {
      installPlugin: async () => {
        installs += 1
        return {}
      },
      fetchPluginDetail: async () => ({
        plugin: {
          name: '深海',
          manifest: { payload: { tokens: { '--background': '#001122' }, accent: 'ocean' as never } },
        },
      }),
    }
    const fetched = await buildLiveSceneDepsAsync({
      getMode: () => 'light',
      setMode: () => {},
      themeDeps,
      fetchInstalledSlugs: async () => new Set(['deep-sea']),
    })
    expect(fetched.themeDeps?.installedSlugs?.has('deep-sea')).toBe(true)
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const result = await applyScene(makeScene(), docWith(makeScene()), makeDeps(world, fetched.themeDeps))
    expect(result.ok).toBe(true)
    expect(installs).toBe(0)

    const fallback = await buildLiveSceneDepsAsync({
      getMode: () => 'light',
      setMode: () => {},
      themeDeps,
      fetchInstalledSlugs: async () => {
        throw new Error('network down')
      },
    })
    expect(fallback.themeDeps?.installedSlugs).toBeUndefined()
    const world2: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: false, calls: [] }
    const result2 = await applyScene(makeScene(), docWith(makeScene()), makeDeps(world2, fallback.themeDeps))
    expect(result2.ok).toBe(true)
    expect(installs).toBe(1)
  })
})

describe('深色暂停与 data-accent 优先', () => {
  it('深色下切带皮肤场景 → summary.suspended 为真，toast 含暂停说明', async () => {
    const world: FakeWorld = { diy: layout(), theme: null, mode: 'light', dark: true, calls: [] }
    const deps = makeDeps(world, GOOD_THEME_DEPS)
    const scene = makeScene()
    const result = await applyScene(scene, docWith(scene), deps)
    expect(result.ok).toBe(true)
    expect(result.summary?.suspended).toBe(true)
    const text = sceneSwitchSuccessText('工作', result.summary as NonNullable<typeof result.summary>)
    expect(text).toContain('皮肤在深色模式下暂停，切回浅色自动恢复')
  })

  it('isThemeSuspended 的口径：node 环境无 document 时为 false（不谎称暂停）', () => {
    expect(isThemeSuspended()).toBe(false)
  })

  it('resolveDiyDataAccent：皮肤 accent 优先于 DIY 旧值；无皮肤时 DIY 生效', () => {
    // 皮肤 accent 'ocean' 不在 DIY 合法值里，也必须赢
    expect(resolveDiyDataAccent('rose', 'ocean')).toBe('ocean')
    expect(resolveDiyDataAccent('rose', 'violet')).toBe('violet')
    expect(resolveDiyDataAccent('rose', null)).toBe('rose')
    expect(resolveDiyDataAccent('default', null)).toBeNull()
    expect(resolveDiyDataAccent('default', undefined)).toBeNull()
  })

  it('切场景后布局 accentColor 与皮肤 accent 对齐（可映射时）', async () => {
    const world: FakeWorld = { diy: layout({ accentColor: 'rose' }), theme: null, mode: 'light', dark: false, calls: [] }
    const deps = makeDeps(world, {
      installPlugin: async () => ({}),
      fetchPluginDetail: async () => ({
        plugin: {
          name: '紫罗兰',
          manifest: { payload: { tokens: {}, accent: 'violet' as never } },
        },
      }),
    })
    const scene = makeScene({ theme: { skinSlug: 'violet-skin', skinName: '紫罗兰', mode: null } })
    const result = await applyScene(scene, docWith(scene), deps)
    expect(result.ok).toBe(true)
    // 布局里的 accentColor 已写成皮肤 accent，effect 再跑也不会盖回旧值
    expect(world.diy.accentColor).toBe('violet')
  })

  it('源码守卫：use-home-diy 的 data-accent effect 必须经 resolveDiyDataAccent 裁决', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/lib/modular/use-home-diy.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('resolveDiyDataAccent(config.accentColor')
    // effect 里不许再有直接拿 config.accentColor 写 data-accent 的旁路
    expect(source).not.toMatch(/setAttribute\('data-accent', config\.accentColor\)/)
  })

  it('reset 后 DIY 强调色立即恢复：use-home-diy 监听 navhub_theme_changed 重算 data-accent，卸载时清理', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/lib/modular/use-home-diy.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain("window.addEventListener('navhub_theme_changed'")
    expect(source).toContain("window.removeEventListener('navhub_theme_changed'")
    // 监听回调里仍走同一裁决：reset 后 getActiveTheme() 为 null → 回到 DIY 值
    expect(source).toContain('resolveDiyDataAccent(config.accentColor, getActiveTheme()?.accent)')
    // 服务端渲染路径不跑监听
    expect(source).toContain("typeof window === 'undefined'")
    const runtime = readFileSync(
      fileURLToPath(new URL('../src/lib/plugins/theme-runtime.ts', import.meta.url)),
      'utf8',
    )
    // resetTheme 必须派发该事件，否则重算永远不会被触发
    const resetAt = runtime.indexOf('export function resetTheme()')
    expect(resetAt).toBeGreaterThan(-1)
    expect(runtime.slice(resetAt, resetAt + 1200)).toContain("new CustomEvent('navhub_theme_changed'")
  })
})
