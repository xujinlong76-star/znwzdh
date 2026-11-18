/**
 * 场景切换 — 交互测试（node 环境无 jsdom，按仓库惯例测纯匹配层、
 * toast 文案与源码接线守卫；组件挂载行为不在此测）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { matchScenePaletteActions } from '@/lib/modular/scene-palette-actions'
import { sceneSwitchSuccessText } from '@/lib/modular/scene-apply'

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const SCENES = [
  { id: 'scene_work', name: '工作', pinnedSiteIds: ['a', 'b'], theme: { skinSlug: 'deep-sea', skinName: '深海', mode: 'dark' as const } },
  { id: 'scene_study', name: '学习', pinnedSiteIds: ['c'], theme: { skinSlug: null, skinName: null, mode: null } },
]

describe('⌘K 场景匹配', () => {
  it('搜「工作」出现「工作」场景项，回车切换的标题点名场景', () => {
    const items = matchScenePaletteActions('工作', SCENES, null)
    expect(items).toHaveLength(1)
    expect(items[0].sceneId).toBe('scene_work')
    expect(items[0].title).toBe('切换到场景「工作」')
    expect(items[0].description).toContain('置顶 2 个站点')
    expect(items[0].description).toContain('深海')
  })

  it('搜「场景」列出全部场景；搜「学习」只列学习', () => {
    expect(matchScenePaletteActions('场景', SCENES, null)).toHaveLength(2)
    expect(matchScenePaletteActions('学习', SCENES, null)).toHaveLength(1)
    expect(matchScenePaletteActions('scene', SCENES, null)).toHaveLength(2)
  })

  it('空查询 / 单字不匹配；当前场景项标 isActive', () => {
    expect(matchScenePaletteActions('', SCENES, null)).toEqual([])
    expect(matchScenePaletteActions('工', SCENES, null)).toEqual([])
    const items = matchScenePaletteActions('场景', SCENES, 'scene_study')
    expect(items.find((i) => i.sceneId === 'scene_study')?.isActive).toBe(true)
    expect(items.find((i) => i.sceneId === 'scene_work')?.isActive).toBe(false)
  })

  it('search-palette 接线：场景分组参与键盘导航、回车走 handleSceneAction', () => {
    const palette = src('../src/components/search-palette.tsx')
    expect(palette).toContain('matchScenePaletteActions')
    expect(palette).toContain('matchedSceneActions')
    expect(palette).toContain("sceneIds: matchedSceneActions.map((s) => `scene-${s.key}`)")
    expect(palette).toContain('handleSceneAction(item.sceneId)')
    expect(palette).toContain('data-nav-item="scene"')
  })
})

describe('工具栏下拉接线', () => {
  it('SceneSwitcher 与 SkinPicker 收拢进外观小窗，相邻并保留清晰控制布局', () => {
    const dialog = src('../src/components/home-windows/appearance-guide-dialog.tsx')
    const switcherAt = dialog.indexOf('<SceneSwitcher')
    const skinAt = dialog.indexOf('<SkinPicker')
    expect(switcherAt).toBeGreaterThan(-1)
    expect(skinAt).toBeGreaterThan(-1)
    expect(switcherAt).toBeLessThan(skinAt)
    const toolbar = src('../src/components/navigation-toolbar.tsx')
    expect(toolbar).toContain('onOpenAppearanceGuide')
  })

  it('下拉列出场景、打勾当前（aria-selected）、点一切换、三件套 toast 点名', () => {
    const switcher = src('../src/components/scene-switcher.tsx')
    expect(switcher).toContain('aria-selected={isActive}')
    expect(switcher).toContain('performSceneSwitch')
    expect(switcher).toContain('sceneSwitchSuccessText')
    expect(switcher).toContain('一键存为场景')
    expect(switcher).toContain('管理场景')
    expect(switcher).toContain('上次切换未完成，已恢复切换前状态')
    expect(switcher).toContain('场景切换不改变沉浸工作台的看板')
  })

  it('空态文案与新建引导存在，0 场景时按钮仍可点（不隐藏按钮）', () => {
    const switcher = src('../src/components/scene-switcher.tsx')
    expect(switcher).toContain('还没有场景')
    expect(switcher).toContain('把现在的工作状态存成场景，下次一键回来')
    // 按钮 disabled 只在切换中，不因 0 场景禁用
    expect(switcher).toContain('disabled={applyingId !== null}')
  })

  it('单场景：当前项点按提示「已是当前场景」，更新/重命名/删除照常可用', () => {
    const switcher = src('../src/components/scene-switcher.tsx')
    expect(switcher).toContain('已是当前场景')
    const manager = src('../src/components/scene-manager-dialog.tsx')
    expect(manager).toContain('用当前状态更新')
    expect(manager).toContain('重命名')
    expect(manager).toContain('删除场景')
  })
})

describe('一键存为场景与管理对话框', () => {
  it('DIY 工具栏有一键存为场景入口；管理对话框有新建/设默认/上限态', () => {
    const toolbar = src('../src/components/home-diy-toolbar.tsx')
    expect(toolbar).toContain('一键存为场景')
    expect(toolbar).toContain('handleSaveAsScene')
    const manager = src('../src/components/scene-manager-dialog.tsx')
    expect(manager).toContain('新建场景')
    expect(manager).toContain('设为默认')
    expect(manager).toContain('场景已满')
    expect(manager).toContain('MAX_USER_SCENES')
    expect(manager).toContain('只删场景记录，不删你的布局与置顶')
    expect(manager).toContain('布局改了场景不跟变')
  })

  it('DIY 工具栏存场景带上当前筛选：在 dev 筛选下存出的场景 workspaceFilter 为 dev', () => {
    const toolbar = src('../src/components/home-diy-toolbar.tsx')
    // 工具栏收 navigation-content 透传的 activeWorkspace，不再写死 null
    expect(toolbar).toContain('activeWorkspace')
    expect(toolbar).toContain('captureCurrentSceneState(activeWorkspace')
    expect(toolbar).not.toContain('captureCurrentSceneState(null, currentMode)')
    // navigation-content 把自己的 activeWorkspace 原样传给工具栏（与
    // handleWorkspaceChange 同一路的状态，不复制过滤逻辑）
    const content = src('../src/components/navigation-content.tsx')
    const at = content.indexOf('<HomeDIYToolbar')
    expect(at).toBeGreaterThan(-1)
    expect(content.slice(at, at + 600)).toContain('activeWorkspace={activeWorkspace}')
  })

  it('切换未完成旗标接线：切换开始前置、成功/回滚后清除；自检只比对 id，不做全值比对', () => {
    const switcher = src('../src/components/scene-switcher.tsx')
    expect(switcher).toContain('markSceneSwitchStarted')
    expect(switcher).toContain('clearSceneSwitchFlag')
    expect(switcher).toContain('shouldClearSwitchFlag')
    const userScenes = src('../src/lib/modular/user-scenes.ts')
    expect(userScenes).toContain('INCOMPLETE_SWITCH_KEY')
    expect(userScenes).toContain('markSceneSwitchStarted')
    expect(userScenes).toContain('loadUserScenes')
    // 自检注释写明不做全值比对的原因与旗标覆盖
    expect(userScenes).toContain('全值比对会误清')
    expect(userScenes).toContain('incomplete-switch')
    // 管理对话框的回落切换同样置旗标
    const manager = src('../src/components/scene-manager-dialog.tsx')
    expect(manager).toContain('markSceneSwitchStarted')
    expect(manager).toContain('shouldClearSwitchFlag')
  })

  it('删除确认框写明回落链，不提 DEFAULT_CONFIG', () => {
    const manager = src('../src/components/scene-manager-dialog.tsx')
    expect(manager).toContain('优先回落到默认场景')
    expect(manager).toContain('恢复到切换前状态')
    expect(manager).not.toContain('DEFAULT_CONFIG')
  })
})

describe('切换成功 toast 文案', () => {
  it('三件套点名：置顶数 · 皮肤名 · 布局名；禁止只报「已切换到工作」', () => {
    const text = sceneSwitchSuccessText('工作', {
      pinnedCount: 9,
      skinName: '深海',
      layoutName: '经典全景流 · 网格背景',
      mode: 'dark',
      suspended: false,
    })
    expect(text).toContain('已切换到「工作」')
    expect(text).toContain('置顶 9 个站点')
    expect(text).toContain('皮肤「深海」')
    expect(text).toContain('布局「经典全景流 · 网格背景」')
    expect(text).toContain('深色模式')
  })

  it('无皮肤时写「皮肤恢复系统默认」，不谎称有皮肤', () => {
    const text = sceneSwitchSuccessText('学习', {
      pinnedCount: 0,
      skinName: null,
      layoutName: '混合首页 · 网格背景',
      mode: null,
      suspended: false,
    })
    expect(text).toContain('皮肤恢复系统默认')
    expect(text).toContain('置顶 0 个站点')
  })
})

describe('移动端与无障碍接线', () => {
  it('管理对话框小屏可滚动（max-h + overflow-y-auto）；场景项有 aria-selected', () => {
    const manager = src('../src/components/scene-manager-dialog.tsx')
    expect(manager).toContain('max-h-[85vh] overflow-y-auto')
    const switcher = src('../src/components/scene-switcher.tsx')
    expect(switcher).toContain('aria-label')
  })

  it('navigation-content 登记站点索引并监听场景工作区切换事件', () => {
    const content = src('../src/components/navigation-content.tsx')
    expect(content).toContain('registerSceneSiteIndex')
    expect(content).toContain('buildSceneSiteIndex')
    expect(content).toContain('SCENE_WORKSPACE_CHANGE_EVENT')
    expect(content).toContain('handleWorkspaceChange(filter)')
  })
})
