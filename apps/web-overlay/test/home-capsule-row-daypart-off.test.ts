/**
 * U-393：关掉「时段场景推荐」后，首页不得再出现一枚点不开的
 * 「时段场景推荐已关闭」死胶囊。
 *
 * 开关本身的说明留在设置页（settings-panel「全天候时段场景流推荐」
 * ToggleRow 有标题与 hint）；首页这一行关掉就是关掉，不留一枚
 * 既不能点、又不解释去哪重开的提示。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：用 renderToString 断言首帧 HTML，
 * daypartSceneEnabled 经 vi.mock 固定为 false（服务端快照默认是 true，
 * 不 mock 测不到关态）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('@/lib/user-preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/user-preferences')>()
  const { DEFAULT_USER_SETTINGS } = await import('@/lib/user-settings')
  return {
    ...actual,
    // U-393 repro：时段推荐开关关掉；其余偏好保持默认值（类型与真值一致）。
    useUserPreference: (key: string) =>
      key === 'daypartSceneEnabled'
        ? false
        : (DEFAULT_USER_SETTINGS as unknown as Record<string, unknown>)[key],
  }
})

import { HomeCapsuleRow } from '../src/components/home-capsule-row'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROW_SRC = readFileSync(resolve(HERE, '..', 'src', 'components', 'home-capsule-row.tsx'), 'utf8')

describe('U-393：时段推荐关掉后首页不再出现死胶囊', () => {
  it('关态首帧 HTML 里没有「时段场景推荐已关闭」', () => {
    const html = renderToString(
      createElement(HomeCapsuleRow, {
        pluginItems: null,
        onWorkspaceChange: () => {},
      }),
    )
    expect(html).not.toContain('时段场景推荐已关闭')
  })

  it('源码里首页胶囊行不再渲染这枚死胶囊（开关说明只留在设置页）', () => {
    expect(ROW_SRC).not.toContain('时段场景推荐已关闭')
  })
})
