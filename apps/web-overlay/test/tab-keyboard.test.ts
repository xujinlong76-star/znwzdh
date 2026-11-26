/**
 * U-434：9 处 role="tablist" 的 ←/→（+ Home/End）漫游。
 *
 * 分层（仓库 vitest 是 node 环境、无 jsdom，挂载测不了按键）：
 *  - 纯函数半：handleTabListKeyDown 直接单测（假 currentTarget + 桩 document）；
 *  - 接线半：9 个文件都 import 同一个处理器、都挂 onKeyDown、tab 都写
 *    roving tabindex、面板齐全的都带 id / aria-controls / role="tabpanel"；
 *  - 例外半（见 SUMMARY）：bookmark-importer 的目标模式 / 收藏来源、
 *    search-palette 的「全站检索」tab 没有单个面板容器可指，故无
 *    aria-controls——指错元素比不指更糟；键盘漫游与 roving tabindex
 *    在这三处同样齐全。
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { KeyboardEvent } from 'react'

import { handleTabListKeyDown } from '../src/lib/tab-keyboard'

const HERE = dirname(fileURLToPath(import.meta.url))

/** overlay 与 apps/web 两份布局下都能定位到 overlay 源码（测试跑在镜像里，真相在 overlay） */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function fakeTab() {
  return { focus: vi.fn(), click: vi.fn() }
}

function keyEvent(key: string, tabs: ReturnType<typeof fakeTab>[], active: unknown) {
  vi.stubGlobal('document', { activeElement: active })
  const event = {
    key,
    preventDefault: vi.fn(),
    currentTarget: {
      querySelectorAll: vi.fn(() => tabs),
    },
  } as unknown as KeyboardEvent<HTMLElement>
  return event
}

describe('handleTabListKeyDown：纯函数漫游', () => {
  it('ArrowRight → 下一个 tab，焦点 + click 一起走', () => {
    const tabs = [fakeTab(), fakeTab(), fakeTab()]
    const e = keyEvent('ArrowRight', tabs, tabs[0])
    handleTabListKeyDown(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.currentTarget.querySelectorAll).toHaveBeenCalledWith('[role="tab"]')
    expect(tabs[1].focus).toHaveBeenCalled()
    expect(tabs[1].click).toHaveBeenCalled()
    expect(tabs[0].focus).not.toHaveBeenCalled()
    expect(tabs[2].focus).not.toHaveBeenCalled()
  })

  it('ArrowRight 在末尾回绕到第一个；ArrowLeft 在开头回绕到最后一个', () => {
    const tabs = [fakeTab(), fakeTab(), fakeTab()]
    handleTabListKeyDown(keyEvent('ArrowRight', tabs, tabs[2]))
    expect(tabs[0].focus).toHaveBeenCalled()
    expect(tabs[0].click).toHaveBeenCalled()
    const tabs2 = [fakeTab(), fakeTab(), fakeTab()]
    handleTabListKeyDown(keyEvent('ArrowLeft', tabs2, tabs2[0]))
    expect(tabs2[2].focus).toHaveBeenCalled()
    expect(tabs2[2].click).toHaveBeenCalled()
  })

  it('Home → 第一个，End → 最后一个', () => {
    const tabs = [fakeTab(), fakeTab(), fakeTab()]
    handleTabListKeyDown(keyEvent('Home', tabs, tabs[2]))
    expect(tabs[0].focus).toHaveBeenCalled()
    handleTabListKeyDown(keyEvent('End', tabs, tabs[0]))
    expect(tabs[2].focus).toHaveBeenCalled()
  })

  it('非方向键一律放行：不 preventDefault、不移动焦点', () => {
    const tabs = [fakeTab(), fakeTab()]
    for (const key of ['Enter', ' ', 'Tab', 'a', 'ArrowDown', 'ArrowUp']) {
      const e = keyEvent(key, tabs, tabs[0])
      handleTabListKeyDown(e)
      expect(e.preventDefault, key).not.toHaveBeenCalled()
    }
    for (const t of tabs) {
      expect(t.focus).not.toHaveBeenCalled()
      expect(t.click).not.toHaveBeenCalled()
    }
  })

  it('焦点不在任何 tab 上、或 tablist 为空时不做任何事', () => {
    const tabs = [fakeTab(), fakeTab()]
    const e = keyEvent('ArrowRight', tabs, null)
    handleTabListKeyDown(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    for (const t of tabs) expect(t.focus).not.toHaveBeenCalled()
    const e2 = keyEvent('ArrowRight', [], null)
    expect(() => handleTabListKeyDown(e2)).not.toThrow()
    expect(e2.preventDefault).not.toHaveBeenCalled()
  })
})

describe('U-434 接线：9 处共用同一个处理器', () => {
  const NINE = [
    'src/app/admin/site-reports/page.tsx',
    'src/app/me/history/page.tsx',
    'src/components/drama-rankings-section.tsx',
    'src/components/video-ai-learning-dialog.tsx',
    'src/components/video-auto-harvest-dialog.tsx',
    'src/components/bookmark-importer.tsx',
    'src/app/favorites/page.tsx',
    'src/components/search-palette.tsx',
    'src/components/home-windows/ai-finder-dialog.tsx',
  ] as const

  it('共享处理器本体：方向键 + Home/End，现取现算 tab 列表，移动后 focus + click', () => {
    const lib = overlayFile('src/lib/tab-keyboard.ts')
    expect(lib).toContain('export function handleTabListKeyDown')
    expect(lib).toContain("querySelectorAll<HTMLButtonElement>('[role=\"tab\"]')")
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(lib).toContain(key)
    }
    expect(lib).toContain('document.activeElement')
    expect(lib).toContain('.focus()')
    expect(lib).toContain('.click()')
    // 钩子住在 lib 里，不住在 U-439 待删的死代码 workspace-filter.tsx 里。
    expect(overlayFile('src/components/workspace-filter.tsx')).not.toContain('tab-keyboard')
    expect(overlayFile('src/components/workspace-filter.tsx')).not.toContain('handleTabListKeyDown')
  })

  it('9 处都 import 同一个处理器、tablist 都挂 onKeyDown、tab 都写 roving tabindex', () => {
    for (const rel of NINE) {
      const src = overlayFile(rel)
      // drama-rankings-section.tsx 用双引号，其余用单引号——两种都认。
      expect(src, rel).toMatch(/import \{ handleTabListKeyDown \} from ['"]@\/lib\/tab-keyboard['"]/)
      expect(src, rel).toContain('onKeyDown={handleTabListKeyDown}')
      expect(src, rel).toContain('tabIndex={')
      expect(src, rel).toContain('? 0 : -1')
    }
    // bookmark-importer 有 3 个 tablist，3 处都挂同一个处理器。
    const bookmark = overlayFile('src/components/bookmark-importer.tsx')
    expect(bookmark.match(/onKeyDown=\{handleTabListKeyDown\}/g)?.length).toBe(3)
  })

  it('面板齐全的 tab：id / aria-controls / role="tabpanel" 成套出现', () => {
    const pairs: Array<[string, string[]]> = [
      ['src/app/admin/site-reports/page.tsx', ['site-report-tab-', 'aria-controls="site-reports-tabpanel"', 'id="site-reports-tabpanel"']],
      ['src/app/me/history/page.tsx', ['history-tab-searches', 'history-tab-visits', 'id="history-panel-searches"', 'id="history-panel-visits"']],
      ['src/components/drama-rankings-section.tsx', ['drama-rankings-tab-', 'aria-controls="drama-rankings-tabpanel"', 'id="drama-rankings-tabpanel"']],
      ['src/components/video-ai-learning-dialog.tsx', ['ai-learning-tab-', 'ai-learning-panel-copilot', 'ai-learning-panel-concept', 'ai-learning-panel-flashcards']],
      ['src/components/video-auto-harvest-dialog.tsx', ['auto-harvest-tab-manual', 'auto-harvest-tab-autonomous', 'auto-harvest-panel-manual', 'auto-harvest-panel-autonomous']],
      ['src/components/bookmark-importer.tsx', ['bookmark-import-tab-file', 'bookmark-import-tab-paste', 'id="bookmark-import-panel-file"', 'id="bookmark-import-panel-paste"']],
      ['src/app/favorites/page.tsx', ['favorites-tab-', 'favorites-panel-sites', 'favorites-panel-plugins', 'favorites-panel-annotations', 'favorites-panel-public']],
      ['src/components/search-palette.tsx', ['search-palette-tab-ai', 'search-palette-tab-similar', 'id="search-palette-discovery-panel"']],
      ['src/components/home-windows/ai-finder-dialog.tsx', ['ai-finder-tab-ai', 'ai-finder-tab-similar', 'ai-finder-panel-ai', 'ai-finder-panel-similar']],
    ]
    for (const [rel, needles] of pairs) {
      const src = overlayFile(rel)
      for (const n of needles) expect(src, `${rel}: ${n}`).toContain(n)
      expect(src, rel).toContain('role="tabpanel"')
    }
  })

  it('范围外不碰：高频直达坞（U-394，另线负责）不挂共享处理器', () => {
    expect(overlayFile('src/components/home-quick-dock.tsx')).not.toContain('handleTabListKeyDown')
  })
})
