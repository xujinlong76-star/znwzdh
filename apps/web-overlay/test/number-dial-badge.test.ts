/**
 * 首屏数字直达：角标与接线（源码级守卫）。
 *
 * 渲染本身是 React 组件（vitest 环境是 node、无 DOM），这里按仓库惯例
 * （search-keyboard.test.ts）用源码断言锁住接线，行为级判定在
 * number-dial.test.ts（纯函数）与 quick-dial-slots.test.ts（清洗）里覆盖：
 *   1. 角标组件：aria-hidden、pointer-events-none、sm 以下隐藏、无 digit 不渲染。
 *   2. 三种卡片形态（compact / standard / rich）各有一处渲染点，
 *      坞芯片有一处；位置在图标右下角，不碰右上操作药丸与左上置顶徽标。
 *   3. 主锚点 aria-keyshortcuts 按有无快拨位动态拼接。
 *   4. 映射由 navigation-content 一个 useMemo 算出并透传，坞与卡片不重算；
 *      挂载前一律不传（SSR 无角标）。
 *   5. 视图切换已迁到 Alt+1/2/3，裸 1/2/3 不再切视图；指南与设置矩阵文案一致。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('NumberDialBadge 本体', () => {
  const src = overlaySource('src/components/number-dial-badge.tsx')

  it('aria-hidden + pointer-events-none + sm 以下隐藏', () => {
    expect(src).toContain('aria-hidden="true"')
    expect(src).toContain('pointer-events-none')
    expect(src).toContain('hidden h-4 w-4')
    expect(src).toContain('sm:inline-flex')
  })

  it('digit 为空时不渲染', () => {
    expect(src).toContain("if (digit === undefined || digit === null || digit === '') return null")
  })

  it('16×16 kbd 芯片', () => {
    expect(src).toContain('<kbd')
    expect(src).toContain('h-4 w-4')
  })
})

describe('卡片三形态 + 坞芯片渲染点', () => {
  const card = overlaySource('src/components/navigation-card.tsx')
  const dock = overlaySource('src/components/speed-dial-dock.tsx')

  it('三形态各有一处 NumberDialBadge（紧凑图标角、标准与丰富卡片右上角）', () => {
    // 订正（2026-11-20 首屏瘦身）：标准卡与富卡的角标由图标/缩略图角标移至
    // 卡片右上角极简 <kbd>（各一处），紧凑行仍在图标角标（行布局无「右上角」）。
    // 总数由 5 处（紧凑 1 + 标准 2 + 富卡 2）变为 3 处（每形态各 1 处）。
    expect(card).toContain('import { NumberDialBadge }')
    const hits = card.split('<NumberDialBadge').length - 1
    expect(hits).toBe(3)
  })

  it('坞芯片有一处 NumberDialBadge，数字只取透传映射（无映射不渲染，不回退本列表下标）', () => {
    expect(dock).toContain('import { NumberDialBadge }')
    expect(dock).toContain('dialDigitById?.get(site.id)')
    expect(dock).not.toContain('?? index + 1')
    expect(dock).not.toContain('dialDigitById?.get(site.id) ??')
  })

  it('角标定位：紧凑行在图标右下角，标准与富卡在卡片右上角（top-2 right-11，星标左侧）', () => {
    // 订正（2026-11-20 首屏瘦身）：标准/富卡角标由图标右下角移至卡片右上角
    // 极简 <kbd>；紧凑行与坞芯片仍在图标右下角（行布局与胶囊无「右上角」概念）。
    // 再订正（dee0c333 卡片悬浮修复）：星标改为常驻 top-2 right-2 后，角标再
    // 左移一位至 right-11（星标左侧），否则会被星标盖住；仍在卡片右上角 top-2。
    expect(card).toContain('className="-bottom-1 -right-1"')
    expect(card).toContain('className="top-2 right-11')
    // 角标不得再回到星标正下方（top-2 right-2 是星标容器位置）
    expect(card).not.toContain('className="top-2 right-2')
    expect(card).not.toContain('className="bottom-1 right-1"')
    expect(dock).toContain('className="-bottom-1 -right-1"')
  })

  it('角标父级是 relative 的图标盒，不碰右上操作药丸（z-20）与左上置顶徽标', () => {
    expect(card).toContain('relative flex-shrink-0 w-6 h-6')
    expect(card).toContain('relative flex-shrink-0 w-7 h-7')
    expect(card).toContain('relative flex-shrink-0 w-11 h-11')
  })

  it('主锚点 aria-keyshortcuts 按有无快拨位动态拼接', () => {
    expect(card).toContain('aria-keyshortcuts={dialKeyshortcuts}')
    expect(card).toContain("...(dialDigit ? [String(dialDigit)] : [])")
    expect(card).toContain("`Ctrl+Shift+${quickDialDigit}`")
  })

  it('卡片 ⋯ 菜单拿到 siteId 与标题索引（绑定覆盖时报被顶掉的站名）', () => {
    expect(card).toContain('siteId={item.id}')
    expect(card).toContain('siteTitleById={siteTitleById}')
  })
})

describe('映射唯一口径：navigation-content 算一次，处处透传', () => {
  const content = overlaySource('src/components/navigation-content.tsx')
  const section = overlaySource('src/components/navigation-category-section.tsx')
  const dock = overlaySource('src/components/speed-dial-dock.tsx')
  const order = overlaySource('src/lib/speed-dial-order.ts')

  it('上限是 9（SPEED_DIAL_LIMIT），坞与映射共用 computeSpeedDialSites', () => {
    expect(order).toContain('export const SPEED_DIAL_LIMIT = 9')
    expect(order).toContain('export function computeSpeedDialSites')
    expect(content).toContain('computeSpeedDialSites({')
    expect(dock).toContain('computeSpeedDialSites({')
    expect(dock).not.toContain('WORKSPACE_KEYWORDS[activeWorkspace]')
  })

  it('navigation-content 一个 useMemo 算映射，透传给分类区与坞；挂载前不传', () => {
    expect(content).toContain('buildDialMap(dialSites)')
    expect(content).toContain('dialDigitById={mounted ? dialMap.digitById : undefined}')
    expect(content).toContain('siteTitleById={siteTitleById}')
    expect(content).toContain('useNumberDial({')
    expect(content).toContain('enabled: mounted && numberDialEnabled')
    expect(section).toContain('dialDigit={dialDigitById?.get(item.id)}')
    expect(section).toContain('quickDialDigit={quickDigitBySiteId.get(item.id)}')
  })

  it('键盘提示追加数字直达说明（修饰键文案是 Ctrl+Shift，不是 Alt）', () => {
    expect(content).toContain('按数字键 1 到 9 直接打开速览坞对应站点；Shift+数字在新标签页打开；Ctrl+Shift+数字打开自定义快拨位。')
  })
})

describe('视图切换迁到 Alt+1/2/3，裸数字全给开站', () => {
  const dialog = overlaySource('src/components/keyboard-shortcuts-dialog.tsx')

  it('指南里 1/2/3 写成 Alt+1/2/3，处理分支用 e.code + altKey', () => {
    expect(dialog).toContain("{ key: 'Alt+1', desc: '切换为极客混合流 (Hybrid)' }")
    expect(dialog).toContain("{ key: 'Alt+2', desc: '切换为经典全景流 (Classic)' }")
    expect(dialog).toContain("{ key: 'Alt+3', desc: '切换为沉浸工作台 (Workbench)' }")
    expect(dialog).toContain("e.code === 'Digit1'")
    expect(dialog).toContain("e.code === 'Digit2'")
    expect(dialog).toContain("e.code === 'Digit3'")
    expect(dialog).not.toContain("if (e.key === '1')")
  })

  it('指南新增数字直达行（1–9 / Shift+1–9 / Ctrl+Shift+1–0）', () => {
    expect(dialog).toContain("key: '1–9'")
    expect(dialog).toContain("key: 'Shift+1–9'")
    expect(dialog).toContain("key: 'Ctrl+Shift+1–0'")
  })
})

describe('设置面板：数字快拨区与过期文案修复', () => {
  const panel = overlaySource('src/components/user-center/settings-panel.tsx')

  it('过期文案「进入工作台 DIY 排版 E」已改成 Ctrl/Cmd+E', () => {
    expect(panel).toContain('Ctrl/Cmd+E')
    expect(panel).not.toContain('>E</kbd>')
  })

  it('#shortcuts 矩阵新增数字快拨卡片（三行：1–9 / Shift+1–9 / Ctrl+Shift+1–0）', () => {
    expect(panel).toContain('数字快拨')
    expect(panel).toContain('直接打开速览坞对应站点')
    expect(panel).toContain('在新标签页打开速览坞站点')
    expect(panel).toContain('打开自定义快拨位站点')
    expect(panel).toContain('>1–9</kbd>')
    expect(panel).toContain('>Shift+1–9</kbd>')
    expect(panel).toContain('>Ctrl+Shift+1–0</kbd>')
  })

  it('矩阵下方有数字快拨总览区：总开关 + 十行绑定 + 清除', () => {
    expect(panel).toContain('QuickDialSettingsSection')
    expect(panel).toContain('numberDialEnabled')
    expect(panel).toContain('setQuickDialSlot(digit, null)')
    expect(panel).toContain('站点已失效')
    expect(panel).toContain('未绑定')
  })
})

describe('DIY 配置接线：setQuickDialSlot 与白名单', () => {
  const hook = overlaySource('src/lib/modular/use-home-diy.ts')
  const menu = overlaySource('src/components/diy/diy-card-menu.tsx')

  it('useHomeDIY 透出 quickDialSlots 与 setQuickDialSlot（persistConfig + updatedAt）', () => {
    expect(hook).toContain('quickDialSlots: config.quickDialSlots || {}')
    expect(hook).toContain('const setQuickDialSlot = useCallback((digit: QuickDialDigit, siteId: string | null)')
    expect(hook).toContain('setQuickDialSlot,')
  })

  it('卡片菜单有「绑定到快拨位」子组：十项 Ctrl+Shift+数字，已绑打勾', () => {
    expect(menu).toContain('绑定到快拨位')
    expect(menu).toContain('QUICK_DIAL_DIGITS.map((digit)')
    expect(menu).toContain('Ctrl+Shift+{digit}')
    expect(menu).toContain('handleBindQuickDial(digit)')
  })
})
