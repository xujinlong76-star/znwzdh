/**
 * 用户偏好接入层（`lib/user-preferences.ts`）与它的真实消费者。
 *
 * 要钉住的原始缺陷（不是假设，是改造前的实际状态）：
 * `UserSettingsModel` 里 openLinksInNewTab / cardDensity / spotlightShortcut /
 * speculativeZeroRttEnabled / daypartSceneEnabled 五项**全仓没有任何行为消费者** ——
 * 只有 settings-panel 写盘、me-view 显示「已开启 / 已关闭」。用户在界面上关掉
 * 「新标签页打开站点」，点卡片照样弹新窗口；把呼出键改成「仅 /」，⌘K 照样生效、
 * 徽标照样写 ⌘K。界面在说假话。
 *
 * 分层：
 *  - 纯逻辑（打开方式、密度映射、呼出键判定、站外引擎 URL、零结果出口）直接调函数；
 *  - 「消费者存在」这类接线事实用源码守卫（重构拆文件会误红，所以只钉语义关键字）；
 *  - 真的点一次开关看界面变不变，留给浏览器实测（真人模式）与 e2e。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  cardDensityOf,
  contentDensityOf,
  isContentDensity,
  readUserPreferences,
  resolveExternalLinkTarget,
  spotlightHotkeyHint,
  spotlightHotkeyMatches,
} from '../src/lib/user-preferences'
import { planSearchPanel } from '../src/lib/search-panel'
import {
  DEFAULT_USER_SETTINGS,
  externalSearchEngineName,
  externalSearchUrl,
  type CardDensityMode,
  type SearchEngineId,
  type SpotlightShortcutMode,
  type UserSettingsModel,
} from '../src/lib/user-settings'

const HERE = dirname(fileURLToPath(import.meta.url))

/** overlay 与 apps/web 两份布局下都能定位到 overlay 源码（测试跑在镜像里，真相在 overlay） */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

/** 剥掉注释再断言：说明文字里出现的写法不该替代码通过守卫 */
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

function overlayCode(rel: string): string {
  return stripComments(overlayFile(rel))
}

const model = (patch: Partial<UserSettingsModel>): UserSettingsModel => ({
  ...DEFAULT_USER_SETTINGS,
  ...patch,
})

describe('打开方式：站点配置是默认值，用户开关是最终决定', () => {
  it('这台设备从未保存过偏好 → 跟随后台站点配置（保住站内导航型部署的行为）', () => {
    const fresh = model({ updatedAt: 0, openLinksInNewTab: false })
    expect(resolveExternalLinkTarget(fresh, '_self')).toBe('_self')
    expect(resolveExternalLinkTarget(fresh, '_blank')).toBe('_blank')
    expect(resolveExternalLinkTarget(fresh, undefined)).toBe('_blank')
  })

  it('保存过之后，用户开关说话才算数', () => {
    expect(resolveExternalLinkTarget(model({ updatedAt: 1, openLinksInNewTab: false }), '_blank')).toBe('_self')
    expect(resolveExternalLinkTarget(model({ updatedAt: 1, openLinksInNewTab: true }), '_self')).toBe('_blank')
  })

  it('站点配置里除 _self 外的任何取值（含脏值）都只当 _blank，不原样透传', () => {
    for (const dirty of ['_top', '_parent', '', 'javascript:alert(1)']) {
      expect(resolveExternalLinkTarget(model({ updatedAt: 0 }), dirty)).toBe('_blank')
    }
  })
})

describe('卡片密度：偏好枚举与 CSS 的三档同源，映射只在一处', () => {
  it('三档往返还原值', () => {
    for (const mode of ['comfortable', 'compact', 'minimal'] as CardDensityMode[]) {
      expect(cardDensityOf(contentDensityOf(mode))).toBe(mode)
    }
  })

  it('钉住反直觉的那两条：compact→dense（更密）、minimal→spacious（更疏）', () => {
    expect(contentDensityOf('compact')).toBe('dense')
    expect(contentDensityOf('minimal')).toBe('spacious')
    expect(contentDensityOf('comfortable')).toBe('comfortable')
  })

  it('认不出的取值回落到默认档，而不是留下 undefined', () => {
    // @ts-expect-error 故意传脏值（历史 localStorage / 被污染的配置）
    expect(contentDensityOf('cozy')).toBe('comfortable')
    // @ts-expect-error 故意传脏值（历史 localStorage / 被污染的配置）
    expect(cardDensityOf('roomy')).toBe(DEFAULT_USER_SETTINGS.cardDensity)
  })

  it('isContentDensity 只认 CSS 真正有定义的那三档', () => {
    for (const good of ['dense', 'comfortable', 'spacious']) expect(isContentDensity(good)).toBe(true)
    for (const bad of ['cozy', '', undefined, null, 'COMPACT']) expect(isContentDensity(bad)).toBe(false)
  })
})

/** 造一个只有判据需要字段的 KeyboardEvent 替身 */
function keyEvent(init: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  target?: unknown
}): KeyboardEvent {
  return init as unknown as KeyboardEvent
}

const INPUT = { tagName: 'INPUT' }
const TEXTAREA = { tagName: 'TEXTAREA' }
const SELECT = { tagName: 'SELECT' }
const CONTENT_EDITABLE = { tagName: 'DIV', isContentEditable: true }
const BODY = { tagName: 'BODY' }

describe('呼出键：四个入口共用同一判据，斜杠不许抢走打字', () => {
  const modK = { key: 'k', metaKey: true, target: BODY }
  const ctrlK = { key: 'K', ctrlKey: true, target: BODY }
  const slash = { key: '/', target: BODY }

  it('mod+k 档：只认组合键，「/」不算呼出', () => {
    const mode: SpotlightShortcutMode = 'mod+k'
    expect(spotlightHotkeyMatches(keyEvent(modK), mode)).toBe(true)
    expect(spotlightHotkeyMatches(keyEvent(ctrlK), mode)).toBe(true)
    expect(spotlightHotkeyMatches(keyEvent(slash), mode)).toBe(false)
  })

  it('slash 档：只认非输入态的「/」，⌘K 不再呼出', () => {
    const mode: SpotlightShortcutMode = 'slash'
    expect(spotlightHotkeyMatches(keyEvent(slash), mode)).toBe(true)
    expect(spotlightHotkeyMatches(keyEvent(modK), mode)).toBe(false)
  })

  it('both 档：两者都行', () => {
    expect(spotlightHotkeyMatches(keyEvent(modK), 'both')).toBe(true)
    expect(spotlightHotkeyMatches(keyEvent(slash), 'both')).toBe(true)
  })

  it('输入态里的「/」是正文，任何档都不算呼出', () => {
    for (const mode of ['slash', 'both'] as SpotlightShortcutMode[]) {
      for (const target of [INPUT, TEXTAREA, SELECT, CONTENT_EDITABLE]) {
        expect(spotlightHotkeyMatches(keyEvent({ ...slash, target }), mode), `${mode} / ${target.tagName}`).toBe(false)
      }
    }
  })

  it('组合键不受输入态限制（不会和打字冲突）', () => {
    for (const mode of ['mod+k', 'both'] as SpotlightShortcutMode[]) {
      expect(spotlightHotkeyMatches(keyEvent({ ...modK, target: INPUT }), mode)).toBe(true)
    }
  })

  it('缺修饰键的裸 k、以及别的关键字都不算', () => {
    expect(spotlightHotkeyMatches(keyEvent({ key: 'k', target: BODY }), 'both')).toBe(false)
    expect(spotlightHotkeyMatches(keyEvent({ key: '?', target: BODY }), 'both')).toBe(false)
    expect(spotlightHotkeyMatches(keyEvent({ key: '', target: BODY }), 'both')).toBe(false)
  })

  it('事件里没有 key 字段（老浏览器 / 伪造事件）时不炸', () => {
    expect(spotlightHotkeyMatches(keyEvent({ key: undefined as unknown as string, metaKey: true, target: null }), 'both')).toBe(false)
  })
})

describe('界面那枚按键提示与真实呼出键逐字一致', () => {
  it('mac 用连写 ⌘K，Windows / Linux 必须写成 Ctrl+K', () => {
    expect(spotlightHotkeyHint('mod+k', '⌘')).toBe('⌘K')
    expect(spotlightHotkeyHint('mod+k', 'Ctrl')).toBe('Ctrl+K')
    expect(spotlightHotkeyHint('both', 'Ctrl')).toBe('Ctrl+K 或 /')
  })

  it('选了「仅 /」就只写 /，不许再显示 ⌘K', () => {
    expect(spotlightHotkeyHint('slash', '⌘')).toBe('/')
    expect(spotlightHotkeyHint('slash', 'Ctrl')).toBe('/')
  })
})

describe('站外引擎：设置里的每个选项都能真的跳出去', () => {
  const externals: SearchEngineId[] = ['google', 'bing', 'duckduckgo', 'github', 'perplexity']

  it('选「站内聚合」时不给站外出口（不把用户的选择当没发生）', () => {
    expect(externalSearchUrl('internal', 'react')).toBeNull()
    expect(externalSearchEngineName('internal')).toBeNull()
  })

  it('五个站外引擎都有 https 地址，且带编码后的查询词', () => {
    for (const engine of externals) {
      const url = externalSearchUrl(engine, 'rust 异步')
      expect(url, engine).not.toBeNull()
      expect(url!.startsWith('https://'), engine).toBe(true)
      expect(url!, engine).toContain(encodeURIComponent('rust 异步').slice(0, 8))
      expect(externalSearchEngineName(engine), engine).toBeTruthy()
    }
  })

  it('空 / 纯空白查询不给出口（否则会跳出一个空搜索结果页）', () => {
    for (const engine of externals) {
      expect(externalSearchUrl(engine, '   ')).toBeNull()
    }
    expect(externalSearchUrl('google', '')).toBeNull()
  })

  it('查询词里的 URL 语义字符被编码，不能拼出可劫持的额外参数', () => {
    const url = externalSearchUrl('google', 'a&b#c')!
    expect(url).not.toContain('&b')
    expect(url).not.toContain('#c')
    expect(url).toContain('a%26b%23c')
  })

  it('认不出的引擎 id 不抛异常，按站内处理', () => {
    // @ts-expect-error 故意传脏值（被污染的 localStorage）
    expect(externalSearchUrl('yandex', 'q')).toBeNull()
    // @ts-expect-error 故意传脏值（新版本写入的引擎 id 被旧页面读到）
    expect(externalSearchEngineName('yandex')).toBeNull()
  })
})

const panelBase = { loading: false, degraded: false, hitCount: 0, query: 'react vue', hasWidgetResult: false }

describe('零结果出口：站外直达只在用户选了外部引擎时出现', () => {
  it('没传引擎（其它调用点）时行为与改造前完全一致', () => {
    expect(planSearchPanel(panelBase).actions.map((a) => a.kind)).toEqual([
      'clear',
      'browse-tags',
      'browse-hot',
    ])
    expect(planSearchPanel({ ...panelBase, degraded: true }).actions.map((a) => a.kind)).toEqual([
      'retry',
      'browse-tags',
      'browse-hot',
    ])
  })

  it('选了 google：真零结果给出「用 Google 搜索…」，并标成站外动作', () => {
    const plan = planSearchPanel({ ...panelBase, searchEngine: 'google' })
    const external = plan.actions.find((a) => a.kind === 'external-search')
    expect(external).toBeDefined()
    expect(external!.external).toBe(true)
    expect(external!.href).toContain('google.com/search')
    expect(external!.label).toContain('Google')
    expect(external!.label).toContain('react vue')
  })

  it('降级态更需要出口：重试之后紧跟站外直达', () => {
    const plan = planSearchPanel({ ...panelBase, degraded: true, searchEngine: 'github' })
    expect(plan.actions.map((a) => a.kind)).toEqual([
      'retry',
      'external-search',
      'browse-tags',
      'browse-hot',
    ])
  })

  it('选内引擎 / 空查询都不追加站外动作', () => {
    expect(
      planSearchPanel({ ...panelBase, searchEngine: 'internal' }).actions.some((a) => a.kind === 'external-search'),
    ).toBe(false)
    expect(
      planSearchPanel({ ...panelBase, query: '  ', searchEngine: 'google' }).actions.some(
        (a) => a.kind === 'external-search',
      ),
    ).toBe(false)
  })

  it('站外动作一律带 external 标记（渲染成 <a target>，绝不交给 <Link> 做客户端路由）', () => {
    for (const engine of ['google', 'bing', 'duckduckgo', 'github', 'perplexity'] as SearchEngineId[]) {
      for (const action of planSearchPanel({ ...panelBase, searchEngine: engine }).actions) {
        if (action.external) expect(action.kind).toBe('external-search')
        else if (action.href) expect(action.href.startsWith('/'), action.label).toBe(true)
      }
    }
  })
})

describe('水合安全：服务端只看得见默认值', () => {
  it('没有 window 时 readUserPreferences 返回默认档且不抛', () => {
    expect(typeof window).toBe('undefined')
    expect(readUserPreferences()).toEqual(DEFAULT_USER_SETTINGS)
  })

  it('默认档本身是一套自洽的值（密度回环、内引擎、both 呼出）', () => {
    expect(cardDensityOf(contentDensityOf(DEFAULT_USER_SETTINGS.cardDensity))).toBe(
      DEFAULT_USER_SETTINGS.cardDensity,
    )
    expect(DEFAULT_USER_SETTINGS.defaultSearchEngine).toBe('internal')
    expect(DEFAULT_USER_SETTINGS.spotlightShortcut).toBe('both')
    expect(resolveExternalLinkTarget(DEFAULT_USER_SETTINGS)).toBe('_blank')
  })
})

describe('接线守卫：这五项偏好各自都有真实消费者', () => {
  it('openLinksInNewTab → 卡片 / 内联搜索 / 检索面板 / 超级控制台都取同一个 target', () => {
    expect(overlayCode('src/lib/user-preferences.ts')).toContain('prefs.openLinksInNewTab')
    for (const rel of [
      'src/components/navigation-card.tsx',
      'src/components/search-bar.tsx',
      'src/components/search-palette.tsx',
      'src/components/search/spotlight-modal.tsx',
    ]) {
      expect(overlayCode(rel), rel).toContain('useExternalLinkTarget')
    }
  })

  it('cardDensity → DensityProvider 写同一份偏好，并驱动 [data-density]；旧独立键不再被读', () => {
    const provider = overlayCode('src/components/density-provider.tsx')
    expect(provider).toContain('updateUserPreferences({ cardDensity: cardDensityOf(next) })')
    // 属性写的是「存储里的真实档位」而不是 hook 值：水合首帧 useContentDensity 只能拿到
    // getServerSnapshot（还是默认档），照写会把 <head> 预绘画对的布局打回默认再改回来，
    // 整片网格两次重排。判据必须与预绘脚本同源，不一致那一拍跳过。
    expect(provider).toContain('const stored = contentDensityOf(readUserPreferences().cardDensity)')
    expect(provider).toContain('if (stored !== density) return')
    expect(provider).toContain("setAttribute('data-density', stored)")
    expect(provider).not.toContain("setAttribute('data-density', density)")
    expect(provider).not.toContain('navhub_content_density')
  })

  it('spotlightShortcut → 呼出与徽标都走同一判据', () => {
    expect(overlayCode('src/components/search/global-spotlight-gateway.tsx')).toContain('spotlightHotkeyMatches')
    const modal = overlayCode('src/components/search/spotlight-modal.tsx')
    expect(modal).toContain('spotlightHotkeyMatches')
    expect(modal).toContain('useSpotlightShortcutMode')
    expect(overlayCode('src/components/search-palette.tsx')).toContain('spotlightHotkeyHint')
  })

  it('speculativeZeroRttEnabled → 检索面板与工作台终端都听它', () => {
    expect(overlayCode('src/components/search-palette.tsx')).toContain(
      'preferences.speculativeZeroRttEnabled ? parseSpeculativeIntent(query)',
    )
    const widget = overlayCode('src/components/modular/modules/speculative-terminal-widget.tsx')
    expect(widget).toContain("useUserPreference('speculativeZeroRttEnabled')")
    expect(widget).toContain('if (zeroRttEnabled)')
  })

  it('daypartSceneEnabled → 筛选行确实按开关换文案；默认引擎接进零结果出口', () => {
    const filter = overlayCode('src/components/workspace-filter.tsx')
    expect(filter).toContain("useUserPreference('daypartSceneEnabled')")
    expect(filter).toContain('时段场景推荐已关闭')
    expect(overlayCode('src/components/search-palette.tsx')).toContain(
      'searchEngine: preferences.defaultSearchEngine',
    )
  })

  it('呼出键只有一个主人：内联搜索框不再自己抢 ⌘K（同一次按键既开弹窗又抢焦点）', () => {
    for (const rel of ['src/components/search-palette.tsx', 'src/components/search-bar.tsx']) {
      const src = overlayCode(rel)
      expect(src, rel).not.toMatch(/key\s*===?\s*'k'/)
      expect(src, rel).not.toMatch(/toLowerCase\(\)\s*===\s*'k'/)
    }
    expect(overlayCode('src/components/search-bar.tsx')).not.toContain('metaKey')
  })

  it('超级控制台打开站点也过安全闸，并写离线「最近访问」快照', () => {
    const modal = overlayCode('src/components/search/spotlight-modal.tsx')
    expect(modal).toContain('isSafeHttpUrl(url)')
    expect(modal).toContain('recordOfflineVisit({')
    expect(modal).not.toContain("window.open(safeHref(site.url")
  })
})

describe('设置页文案不许承诺没实现的行为', () => {
  const panel = overlayCode('src/components/user-center/settings-panel.tsx')
  const options = overlayCode('src/lib/user-settings.ts')

  it('时段推荐写的是「只建议、不会自动换整屏」', () => {
    expect(panel).toContain('只建议')
    expect(panel).not.toContain('智能切换高频工作台场景流')
  })

  it('密度档位名称与真实效果一致（minimal 是更多留白，不是「极简」）', () => {
    expect(options).toContain("宽松沉浸")
    expect(options).toContain("紧凑密排")
    expect(options).not.toMatch(/value: 'minimal', label: '极简'/)
  })

  it('默认引擎的说明会随取值变化，而不是一句万能话术', () => {
    expect(panel).toContain("value.defaultSearchEngine === 'internal'")
  })
})
